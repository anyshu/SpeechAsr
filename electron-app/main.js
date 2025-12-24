const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  clipboard,
  screen,
  Tray,
  nativeImage,
  Menu,
  systemPreferences
} = require('electron');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
const path = require('path');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const https = require('https');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const { SpeechASR, DEFAULT_OPTIONS } = require('@sherpa-onnx/speech-asr');
const SelectionHook = require('selection-hook');

const OFFLINE_MODEL_URL = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2';
// const OFFLINE_MODEL_URL = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-funasr-nano-2025-12-17.tar.bz2';
// const OFFLINE_MODEL_URL = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-funasr-nano-int8-2025-12-17.tar.bz2'
const OFFLINE_MODEL_DIR_NAME = 'offline-recognition-model';
const PUNCT_MODEL_URL = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/punctuation-models/sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12-int8.tar.bz2';
const PUNCT_MODEL_DIR_NAME = 'punctuation-model';
const STREAMING_MODEL_URL = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20.tar.bz2';
const STREAMING_MODEL_DIR_NAME = 'online-recognition-model';
const VAD_MODEL_URL = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad_v5.onnx';
const VAD_MODEL_FILENAME = 'silero_vad.onnx';
const ICON_PATH = path.join(__dirname, 'ok.png');
const APP_NAME = '西瓜说';
function getIconPath() {
  // 在打包后优先使用 resources 目录下的同名文件
  if (app.isPackaged) {
    const packaged = path.join(process.resourcesPath, 'ok.png');
    if (fs.existsSync(packaged)) return packaged;
  }
  return ICON_PATH;
}

function getIconImage() {
  const img = nativeImage.createFromPath(getIconPath());
  return img.isEmpty() ? null : img;
}

let mainWindow;
let cachedPythonPath = null;
let overlayWindow = null;
let overlayHideTimer = null;
let overlayPendingPayload = null;
let overlayArmed = false;
let overlayTimer = null;
let overlayStartTime = 0;
let overlayLocked = false;
let overlayMessageCache = '';
let tray = null;
let forceQuit = false;
let liveSessionMode = null; // null | 'shared'
let liveModelsLoaded = false;
const PYTHON_NOT_FOUND_MESSAGE =
  '未找到可用的 Python3，请安装 Python3 或将 SPEECH_ASR_PYTHON 指向可执行文件';

function getResourceBase() {
  // 开发环境使用项目根目录，打包后使用资源目录
  return app.isPackaged ? process.resourcesPath : path.join(__dirname, '..');
}

function ensureOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) return overlayWindow;

  overlayWindow = new BrowserWindow({
    width: 360,
    height: 64,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    focusable: false,
    show: false,
    alwaysOnTop: true,
    hasShadow: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'overlay-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  overlayWindow.loadFile(path.join(__dirname, 'ptt-overlay.html')).catch((err) => {
    console.error('Failed to load overlay window', err);
  });

  overlayWindow.webContents.on('did-finish-load', () => {
    positionOverlayWindow();
    if (overlayPendingPayload) {
      overlayWindow.webContents.send('overlay:update', overlayPendingPayload);
      overlayPendingPayload = null;
    }
    // DEBUG: 打开小窗的开发者工具
    overlayWindow.webContents.openDevTools({ mode: 'detach' });
  });

  overlayWindow.on('closed', () => {
    overlayWindow = null;
    overlayPendingPayload = null;
    clearTimeout(overlayHideTimer);
  });

  return overlayWindow;
}

function positionOverlayWindow() {
  if (!app.isReady()) return;
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const bounds = overlayWindow.getBounds();
  const display = screen.getPrimaryDisplay();
  const workArea = display?.workArea || display?.bounds;
  const x = Math.round(workArea.x + (workArea.width - bounds.width) / 2);
  const y = Math.round(workArea.y + workArea.height - bounds.height - 20);
  overlayWindow.setPosition(x, y);
}

function sendOverlayPayload(payload) {
  const win = ensureOverlayWindow();
  if (!win || win.isDestroyed()) return;
  if (win.webContents.isLoading()) {
    overlayPendingPayload = payload;
    return;
  }
  overlayPendingPayload = null;
  try {
    console.log('[sendOverlayPayload] Sending:', payload);
    win.webContents.send('overlay:update', payload);
  } catch (err) {
    console.warn('Failed to send overlay payload', err);
  }
}

function updateOverlay(state = 'recording', message, hint, options = {}) {
  const { autoHideMs, lock = false } = options || {};
  const win = ensureOverlayWindow();
  if (!win || win.isDestroyed()) return;
  overlayLocked = lock || overlayLocked;
  clearTimeout(overlayHideTimer);
  positionOverlayWindow();
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  sendOverlayPayload({ state, message, hint });
  win.showInactive();
  if (autoHideMs && Number.isFinite(autoHideMs)) {
    overlayHideTimer = setTimeout(() => hideOverlay(), autoHideMs);
  }
}

function hideOverlay(force = false) {
  if (overlayLocked && !force) return;
  clearTimeout(overlayHideTimer);
  overlayHideTimer = null;
  stopOverlayTimer();
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    sendOverlayPayload({ state: 'idle' });
    overlayWindow.hide();
  }
}

function startOverlayTimer(message, hint, lock) {
  stopOverlayTimer();
  overlayLocked = lock || overlayLocked;
  overlayStartTime = Date.now();
  // Cache the message so renderer can update it while timer runs
  overlayMessageCache = message || '';
  console.log('[startOverlayTimer] Initialized with:', { message, hint, overlayMessageCache });

  const tick = () => {
    const elapsed = Date.now() - overlayStartTime;
    const formatted = formatDurationMs(elapsed);
    const durationHint = `按键录音 ${formatted}`;
    // Send one-pass text in `message` and duration label in `hint`.
    console.log('[tick] Sending:', { overlayMessageCache, durationHint });
    updateOverlay('recording', overlayMessageCache || '', durationHint, { lock: true });
  };

  tick();
  overlayTimer = setInterval(tick, 50);
}

function stopOverlayTimer() {
  if (overlayTimer) {
    clearInterval(overlayTimer);
    overlayTimer = null;
  }
}

function formatDurationMs(ms) {
  const clamped = Math.max(0, Math.floor(ms));
  const minutes = Math.floor(clamped / 60000);
  const seconds = Math.floor((clamped % 60000) / 1000);
  const millis = clamped % 1000;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

function ensureTray() {
  if (tray) return tray;
  const baseImage = getIconImage();
  const trayImage =
    baseImage && !baseImage.isEmpty()
      ? baseImage.resize({ width: 22, height: 22, quality: 'best' })
      : nativeImage.createEmpty();
  tray = new Tray(trayImage);
  tray.setToolTip(APP_NAME);
  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示窗口',
      click: () => {
        if (!mainWindow || mainWindow.isDestroyed()) {
          createWindow();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        forceQuit = true;
        app.quit();
      }
    }
  ]);
  tray.setContextMenu(contextMenu);
  tray.on('click', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
  if (process.platform === 'darwin' && app.dock) {
    try {
      app.dock.show();
      const dockImage = getIconImage();
      if (dockImage && !dockImage.isEmpty()) {
        app.dock.setIcon(dockImage);
      }
    } catch (err) {
      console.warn('Failed to show dock icon', err);
    }
  }
  return tray;
}

function getModelPaths() {
  const downloadBase = path.join(app.getPath('userData'), 'models');
  const downloadedModelDir = path.join(downloadBase, OFFLINE_MODEL_DIR_NAME);
  const bundledNew = path.join(getResourceBase(), OFFLINE_MODEL_DIR_NAME);

  const candidates = [downloadedModelDir, bundledNew];
  const resolved = candidates.find(
    (dir) =>
      fs.existsSync(path.join(dir, 'model.int8.onnx')) ||
      fs.existsSync(path.join(dir, 'model.onnx'))
  );

  return {
    downloadBase,
    archivePath: path.join(downloadBase, 'sense-voice.tar.bz2'),
    modelDir: resolved || bundledNew
  };
}

function getPunctuationPaths() {
  const downloadBase = path.join(app.getPath('userData'), 'models');
  const downloadedModelDir = path.join(downloadBase, PUNCT_MODEL_DIR_NAME);
  const bundledDir = path.join(getResourceBase(), PUNCT_MODEL_DIR_NAME);

  const candidates = [downloadedModelDir, bundledDir];
  const resolved = candidates.find(
    (dir) =>
      fs.existsSync(path.join(dir, 'model.int8.onnx')) ||
      fs.existsSync(path.join(dir, 'model.onnx'))
  );

  return {
    downloadBase,
    archivePath: path.join(downloadBase, 'punctuation.tar.bz2'),
    modelDir: resolved || downloadedModelDir
  };
}

function getStreamingModelPaths() {
  const downloadBase = path.join(app.getPath('userData'), 'models');
  const downloadedModelDir = path.join(downloadBase, STREAMING_MODEL_DIR_NAME);
  const bundledDir = path.join(getResourceBase(), STREAMING_MODEL_DIR_NAME);

  const candidates = [downloadedModelDir, bundledDir];
  const resolved = candidates.find((dir) => resolveStreamingZipformerComponents(dir));

  return {
    downloadBase,
    archivePath: path.join(downloadBase, 'streaming-model.tar.bz2'),
    modelDir: resolved || downloadedModelDir
  };
}

function getVadPaths() {
  const downloadBase = path.join(app.getPath('userData'), 'models');
  const modelPath = path.join(downloadBase, VAD_MODEL_FILENAME);
  return { downloadBase, modelPath };
}

function resolveSenseVoiceModel(modelDir) {
  const int8Path = path.join(modelDir, 'model.int8.onnx');
  const fpPath = path.join(modelDir, 'model.onnx');
  if (fs.existsSync(fpPath)) return fpPath;
  if (fs.existsSync(int8Path)) return int8Path;
  return null;
}

function resolvePunctuationModel(modelDir) {
  const int8Path = path.join(modelDir, 'model.int8.onnx');
  const fpPath = path.join(modelDir, 'model.onnx');
  if (fs.existsSync(fpPath)) return fpPath;
  if (fs.existsSync(int8Path)) return int8Path;
  return null;
}

const sleep = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function performPasteShortcutOnMac() {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'darwin') {
      reject(new Error('Paste shortcut is only supported on macOS'));
      return;
    }

    // 策略：先短暂延迟让系统稳定，然后发送粘贴快捷键
    // 由于物理 Option 键可能干扰 osascript，我们使用原生模块会更可靠
    // 但作为临时方案，先用 osascript 尝试
    const script =
      'tell application "System Events"\n' +
      '  -- 发送 Cmd+V 粘贴快捷键\n' +
      '  -- keyCode 9 = V, with command down\n' +
      '  key code 9 using command down\n' +
      'end tell';

    console.log('[SystemInput] Executing paste shortcut...');

    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        reject(new Error('Paste shortcut timed out'));
      }
    }, 5000);

    const child = execFile('osascript', ['-e', script], (error, stdout, stderr) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);

      if (stdout?.trim()) {
        console.log('[SystemInput] osascript stdout:', stdout.trim());
      }
      if (stderr?.trim()) {
        console.warn('[SystemInput] osascript stderr:', stderr.trim());
      }

      if (error) {
        const message = String(error?.message || error);
        if (message.includes('Not authorized') || message.includes('(-1743)')) {
          console.warn(
            '[SystemInput] macOS 自动化权限未授权：请到 系统设置 > 隐私与安全性 > 自动化 中允许此应用控制 System Events'
          );
        }
        reject(error);
        return;
      }

      console.log('[SystemInput] Paste shortcut executed');
      resolve();
    });

    child.on('error', (err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}

// 选中并替换文本：先通过 Shift+Left 选中 1pass 增量内容，然后输入 2pass 替换
async function selectAndReplaceText(selectLength, secondPassText) {
  if (process.platform !== 'darwin') {
    throw new Error('Select and replace is only supported on macOS');
  }

  if (!selectLength || !secondPassText) {
    throw new Error('Select length and second pass text are required');
  }

  console.log(`[SelectAndReplace] 选中 ${selectLength} 字符，2pass [${Number(selectLength)}]文本: "${secondPassText}"`);

  // 设置标志，阻止新的 1pass 粘贴操作
  isSelectAndReplaceInProgress = true;

  try {
    // 等待 pasteOnceQueue 中的所有操作完成，然后重置队列，丢弃积压的 1pass 粘贴
    await pasteOnceQueue;
    pasteOnceQueue = Promise.resolve(); // 重置队列，丢弃积压的操作

    // 先复制 2pass 内容到剪贴板
    clipboard.writeText(secondPassText);
    await sleep(100);

    // 如果选中的字符数很多（>200），使用 Command+A 全选更快
    const useSelectAll = selectLength > 200;

    // 构建多行 AppleScript（使用数组拼接避免转义问题）
    const appleScriptLines = [
      'tell application "System Events"'
    ];

    if (useSelectAll) {
      // 使用全选
      appleScriptLines.push('  keystroke "a" using {command down}');
    } else {
      // 使用 Shift+Left 逐字符选中
      appleScriptLines.push(`  repeat ${selectLength} times`);
      appleScriptLines.push('    keystroke (ASCII character 28) using {shift down}');
      appleScriptLines.push('  end repeat');
    }

    appleScriptLines.push(
      '  delay 0.05',
      '  keystroke (ASCII character 127)',  // Delete
      '  delay 0.05',
      '  keystroke "v" using {command down}',  // Paste
      'end tell'
    );

    const appleScript = appleScriptLines.join('\n');

    await new Promise((resolve, reject) => {
      let resolved = false;
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          reject(new Error('Select and replace timed out'));
        }
      }, 10000);

      const child = execFile('osascript', ['-e', appleScript], (error, stdout, stderr) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);

        if (error) {
          const message = String(error?.message || error);
          console.warn('[SelectAndReplace] Error:', message);
          console.warn('[SelectAndReplace] stderr:', stderr);
          if (message.includes('Not authorized') || message.includes('(-1743)')) {
            console.warn(
              '[SelectAndReplace] macOS 自动化权限未授权：请到 系统设置 > 隐私与安全性 > 辅助功能 中允许此应用'
            );
          }
          reject(error);
          return;
        }

        if (stdout?.trim()) {
          console.log('[SelectAndReplace] stdout:', stdout.trim());
        }
        console.log('[SelectAndReplace] Completed successfully');
        resolve();
      });

      child.on('error', (err) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        reject(err);
      });
    });
  } finally {
    // 无论成功或失败，都要重置标志
    isSelectAndReplaceInProgress = false;
  }
}

let pasteOnceQueue = Promise.resolve();

// 标志：2pass 替换是否正在进行（在此期间阻止 1pass 粘贴）
let isSelectAndReplaceInProgress = false;

// 重置粘贴队列（用于停止录音时清空待处理的粘贴任务）
function resetPasteQueue() {
  pasteOnceQueue = Promise.resolve();
  console.log('[PasteQueue] Queue reset');
}

async function pasteTextToFocusedInputOnce(text) {
  const normalized = typeof text === 'string' ? text : '';
  if (!normalized.trim()) {
    throw new Error('粘贴内容为空');
  }

  try {
    clipboard.clear();
    clipboard.writeText(normalized);
    console.log(
      '[SystemInput] Text copied to clipboard:',
      normalized.slice(0, 50) + (normalized.length > 50 ? '...' : '')
    );
  } catch (err) {
    throw new Error(`复制到剪贴板失败: ${err?.message || err}`);
  }

  if (process.platform !== 'darwin') {
    return { copied: true, pasted: false };
  }

  // macOS: 尝试使用多种方法粘贴，以确保在修饰键按住时也能工作
  try {
    await performPasteShortcutOnMac();
    await sleep(300);
    console.log('[SystemInput] Paste completed (primary method)');
    return { copied: true, pasted: true };
  } catch (err) {
    console.warn('[SystemInput] Primary paste method failed:', err?.message || err);
    // 如果主要方法失败，尝试备用方案：使用 Electron 的 clipboard
    // 但这需要用户手动按 Cmd+V，所以返回 pasted: false
    console.log('[SystemInput] Clipboard ready, manual Cmd+V required');
    return { copied: true, pasted: false };
  }
}

const TRIGGER_UNI_KEY = 'Alt'; // 左侧 Option
let globalPttHook = null;
const TRIGGER_MIN_HOLD_MS = 180; // 忽略过短的抬起抖动（ms）

function setupGlobalPttHook() {
  let hookInstance = null;
  try {
    hookInstance = new SelectionHook();
  } catch (err) {
    console.warn('[Push-to-Talk] Failed to init selection-hook:', err?.message || err);
    return;
  }

  const started = hookInstance.start({
    enableClipboard: false,
    selectionPassiveMode: true
  });

  if (!started) {
    console.warn('[Push-to-Talk] selection-hook failed to start');
    return;
  }

  const isTriggerKey = (event) => {
    if (!event || event.uniKey !== TRIGGER_UNI_KEY) return false;
    if (process.platform === 'darwin' && typeof event.vkCode === 'number') {
      // macOS 左侧 Option 键 vkCode = 58
      return event.vkCode === 58;
    }
    return true;
  };

  let isRecordingActive = false;
  let lastTriggerDownTs = 0;

  hookInstance.on('key-down', (event) => {
    if (!isTriggerKey(event) || isRecordingActive) return;
    lastTriggerDownTs = Date.now();
    isRecordingActive = true;
    if (overlayArmed) {
      updateOverlay('recording', '正在录音...', '123松开设定按键以结束', { lock: true });
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('global-ptt:start');
    }
  });

  hookInstance.on('key-up', (event) => {
    if (!isTriggerKey(event) || !isRecordingActive) return;
    const elapsed = Date.now() - lastTriggerDownTs;
    if (elapsed < TRIGGER_MIN_HOLD_MS) {
      // 忽略过短的抬起抖动，避免误触 stop
      return;
    }
    isRecordingActive = false;
    overlayLocked = false;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('global-ptt:stop');
    }
  });

  app.on('before-quit', () => {
    try {
      hookInstance.stop();
      hookInstance.cleanup();
    } catch (err) {
      console.warn('[Push-to-Talk] Failed to cleanup selection-hook', err);
    }
  });

  globalPttHook = hookInstance;
  console.log('[Push-to-Talk] Listening for Left Option key globally (hold to record, release to stop)');
}

function resolveStreamingZipformerComponents(modelDir) {
  if (!modelDir || !fs.existsSync(modelDir)) return null;
  const candidates = (baseNames) => {
    for (const base of baseNames) {
      const int8Path = path.join(modelDir, `${base}.int8.onnx`);
      const fpPath = path.join(modelDir, `${base}.onnx`);
      if (fs.existsSync(fpPath)) return fpPath;
      if (fs.existsSync(int8Path)) return int8Path;
    }
    // fallback: scan for the first matching pattern
    const anyMatch = fs
      .readdirSync(modelDir)
      .filter((f) => f.endsWith('.onnx') && baseNames.some((b) => f.includes(b)))
      .map((f) => path.join(modelDir, f))[0];
    return anyMatch || null;
  };

  const encoder = candidates(['encoder-epoch-99-avg-1', 'encoder-epoch-12-avg-4', 'encoder']);
  const decoder = candidates(['decoder-epoch-99-avg-1', 'decoder-epoch-12-avg-4', 'decoder']);
  const joiner = candidates(['joiner-epoch-99-avg-1', 'joiner-epoch-12-avg-4', 'joiner']);
  const tokens = path.join(modelDir, 'tokens.txt');

  if (!encoder || !decoder || !joiner || !fs.existsSync(tokens)) {
    return null;
  }

  return { encoder, decoder, joiner, tokens };
}

function resolveSenseVoiceFiles(modelDir) {
  if (!modelDir || !fs.existsSync(modelDir)) return null;
  const model = resolveSenseVoiceModel(modelDir);
  const tokens = path.join(modelDir, 'tokens.txt');
  if (!model || !fs.existsSync(tokens)) return null;
  return { model, tokens, modelDir };
}

function modelExists() {
  const { modelDir } = getModelPaths();
  return (
    fs.existsSync(path.join(modelDir, 'model.int8.onnx')) ||
    fs.existsSync(path.join(modelDir, 'model.onnx'))
  );
}

function punctuationModelExists() {
  const { modelDir } = getPunctuationPaths();
  return (
    fs.existsSync(path.join(modelDir, 'model.int8.onnx')) ||
    fs.existsSync(path.join(modelDir, 'model.onnx'))
  );
}

function streamingModelExists() {
  const { modelDir } = getStreamingModelPaths();
  return Boolean(resolveStreamingZipformerComponents(modelDir));
}

function vadModelExists() {
  const { modelPath } = getVadPaths();
  return fs.existsSync(modelPath);
}

function resetLiveSessionState() {
  liveSessionMode = null;
  liveModelsLoaded = false;
}

function sendModelProgress(payload) {
  if (mainWindow) {
    mainWindow.webContents.send('model-download-progress', payload);
  }
}

function sendPunctuationProgress(payload) {
  if (mainWindow) {
    mainWindow.webContents.send('punctuation-download-progress', payload);
  }
}

function sendStreamingProgress(payload) {
  if (mainWindow) {
    mainWindow.webContents.send('streaming-download-progress', payload);
  }
}

function sendVadProgress(payload) {
  if (mainWindow) {
    mainWindow.webContents.send('vad-download-progress', payload);
  }
}

function extractTarArchive(archivePath, targetDir, label) {
  return new Promise((resolve, reject) => {
    try {
      if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true });
      }
    } catch (err) {
      console.warn(`清理旧${label}目录失败`, err);
    }

    fs.mkdirSync(targetDir, { recursive: true });

    // 将内容直接解压到目标目录，确保目录名称保持一致
    const tarProcess = spawn('tar', ['-xjf', archivePath, '-C', targetDir, '--strip-components', '1']);

    tarProcess.on('close', (code) => {
      if (code === 0) {
        try {
          fs.rmSync(archivePath, { force: true });
        } catch (err) {
          console.warn(`删除${label}压缩包失败`, err);
        }
        resolve(true);
      } else {
        reject(new Error(`${label}解压失败，退出码 ${code}`));
      }
    });

    tarProcess.on('error', (err) => reject(err));
  });
}

function withFfmpegPath(extraEnv = {}) {
  const basePath = process.env.PATH || '';
  const ffmpegDir = path.dirname(ffmpegInstaller.path);
  const pathWithFfmpeg = basePath.includes(ffmpegDir)
    ? basePath
    : `${ffmpegDir}:${basePath}`;
  return {
    ...process.env,
    PATH: pathWithFfmpeg,
    ...extraEnv
  };
}

function resolveBundledPython() {
  if (cachedPythonPath && fs.existsSync(cachedPythonPath)) {
    return cachedPythonPath;
  }

  const base = getResourceBase();
  
  // 首先尝试打包的 Python 可执行文件
  const bundledExe = app.isPackaged 
    ? path.join(process.resourcesPath, 'python-dist', 'two_pass_asr')
    : path.join(base, 'electron-app', 'python-dist', 'two_pass_asr');
  
  if (fs.existsSync(bundledExe)) {
    cachedPythonPath = bundledExe;
    return bundledExe;
  }

  // 开发环境或未找到打包的可执行文件时，查找系统 Python
  const binNames = process.platform === 'win32' ? ['python.exe', 'python3.exe'] : ['python3', 'python'];
  const candidates = [
    process.env.SPEECH_ASR_PYTHON,
    path.join(base, 'python', process.platform === 'win32' ? 'python.exe' : path.join('bin', 'python3')),
    path.join(base, 'python', process.platform === 'win32' ? 'python.exe' : path.join('bin', 'python'))
  ].filter(Boolean);

  const pathEntries = new Set((process.env.PATH || '').split(path.delimiter).filter(Boolean));
  ['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin'].forEach((p) => pathEntries.add(p));

  for (const dir of pathEntries) {
    for (const name of binNames) {
      candidates.push(path.join(dir, name));
    }
  }

  const hit = candidates.find((p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });

  if (hit) {
    cachedPythonPath = hit;
    return hit;
  }

  return null;
}

const speechAsr = new SpeechASR({
  twoPass: { enabled: true, backend: 'python' },
  assetBaseUrl: getResourceBase(),
  pythonPath: resolveBundledPython() || undefined,
  sampleRate: 16000,
  bufferSize: 1600,
  onTwoPassStart: () =>
    sendLiveResult({ type: 'log', message: '启动两段式实时识别 (ZipFormer -> SenseVoice)...' }),
  onReady: () => sendLiveResult({ type: 'ready' }),
  onPartial: (text) => sendLiveResult({ type: 'first-pass', text }),
  onTwoPassResult: (payload) => sendLiveResult(payload),
  onResult: (payload) => {
    if (!payload?.stage) {
      sendLiveResult(payload);
    }
  },
  onTwoPassError: (payload) =>
    sendLiveResult({
      type: 'error',
      message: payload?.message || '实时转写出错',
      detail: payload?.detail
    }),
  onError: (payload) =>
    sendLiveResult({
      type: 'error',
      message: payload?.message || '实时转写出错',
      detail: payload?.detail
  })
});

speechAsr.on('log', (payload) => sendLiveResult(payload));
speechAsr.on('devices', (payload) => sendLiveResult(payload));
speechAsr.on('complete', (payload) => {
  resetLiveSessionState();
  sendLiveResult(payload);
});
speechAsr.on('error', (payload) => console.error('SpeechASR error event:', payload));

function downloadModel() {
  return new Promise((resolve, reject) => {
    const { downloadBase, archivePath } = getModelPaths();
    fs.mkdirSync(downloadBase, { recursive: true });

    sendModelProgress({ status: 'starting', percent: 0, message: '开始下载模型' });

    const doRequest = (url) => {
      const fileStream = fs.createWriteStream(archivePath);
      https
        .get(url, (res) => {
          // 处理重定向
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.destroy();
            doRequest(res.headers.location);
            return;
          }

          if (res.statusCode !== 200) {
            reject(new Error(`下载失败，状态码 ${res.statusCode}`));
            return;
          }

          const total = parseInt(res.headers['content-length'] || '0', 10);
          let downloaded = 0;

          res.on('data', (chunk) => {
            downloaded += chunk.length;
            if (total > 0) {
              const percent = Math.min(100, Math.round((downloaded / total) * 100));
              sendModelProgress({
                status: 'downloading',
                percent,
                downloaded,
                total
              });
            } else {
              sendModelProgress({ status: 'downloading', percent: 0, downloaded, total: 0 });
            }
          });

          res.pipe(fileStream);

          fileStream.on('finish', () => {
            fileStream.close(() => {
              sendModelProgress({ status: 'extracting', percent: 95, message: '正在解压...' });
              extractModel(archivePath)
                .then(() => {
                  sendModelProgress({ status: 'done', percent: 100, message: '模型已就绪' });
                  resolve(true);
                })
                .catch((err) => {
                  sendModelProgress({ status: 'error', percent: 0, message: err.message });
                  reject(err);
                });
            });
          });
        })
        .on('error', (err) => {
          sendModelProgress({ status: 'error', percent: 0, message: err.message });
          reject(err);
        });
    };

    doRequest(OFFLINE_MODEL_URL);
  });
}

function downloadPunctuationModel() {
  return new Promise((resolve, reject) => {
    const { downloadBase, archivePath } = getPunctuationPaths();
    fs.mkdirSync(downloadBase, { recursive: true });

    sendPunctuationProgress({ status: 'starting', percent: 0, message: '开始下载标点模型' });

    const doRequest = (url) => {
      const fileStream = fs.createWriteStream(archivePath);
      https
        .get(url, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.destroy();
            doRequest(res.headers.location);
            return;
          }

          if (res.statusCode !== 200) {
            reject(new Error(`下载失败，状态码 ${res.statusCode}`));
            return;
          }

          const total = parseInt(res.headers['content-length'] || '0', 10);
          let downloaded = 0;

          res.on('data', (chunk) => {
            downloaded += chunk.length;
            if (total > 0) {
              const percent = Math.min(100, Math.round((downloaded / total) * 100));
              sendPunctuationProgress({
                status: 'downloading',
                percent,
                downloaded,
                total
              });
            } else {
              sendPunctuationProgress({ status: 'downloading', percent: 0, downloaded, total: 0 });
            }
          });

          res.pipe(fileStream);

          fileStream.on('finish', () => {
            fileStream.close(() => {
              sendPunctuationProgress({ status: 'extracting', percent: 95, message: '正在解压标点模型...' });
              extractPunctuationModel(archivePath)
                .then(() => {
                  sendPunctuationProgress({ status: 'done', percent: 100, message: '标点模型已就绪' });
                  resolve(true);
                })
                .catch((err) => {
                  sendPunctuationProgress({ status: 'error', percent: 0, message: err.message });
                  reject(err);
                });
            });
          });
        })
        .on('error', (err) => {
          sendPunctuationProgress({ status: 'error', percent: 0, message: err.message });
          reject(err);
        });
    };

    doRequest(PUNCT_MODEL_URL);
  });
}

function downloadStreamingModel() {
  return new Promise((resolve, reject) => {
    const { downloadBase, archivePath } = getStreamingModelPaths();
    fs.mkdirSync(downloadBase, { recursive: true });

    sendStreamingProgress({ status: 'starting', percent: 0, message: '开始下载流式模型' });

    const doRequest = (url) => {
      const fileStream = fs.createWriteStream(archivePath);
      https
        .get(url, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.destroy();
            doRequest(res.headers.location);
            return;
          }

          if (res.statusCode !== 200) {
            reject(new Error(`下载失败，状态码 ${res.statusCode}`));
            return;
          }

          const total = parseInt(res.headers['content-length'] || '0', 10);
          let downloaded = 0;

          res.on('data', (chunk) => {
            downloaded += chunk.length;
            if (total > 0) {
              const percent = Math.min(100, Math.round((downloaded / total) * 100));
              sendStreamingProgress({
                status: 'downloading',
                percent,
                downloaded,
                total
              });
            } else {
              sendStreamingProgress({ status: 'downloading', percent: 0, downloaded, total: 0 });
            }
          });

          res.pipe(fileStream);

          fileStream.on('finish', () => {
            fileStream.close(() => {
              sendStreamingProgress({ status: 'extracting', percent: 95, message: '正在解压流式模型...' });
              extractStreamingModel(archivePath)
                .then(() => {
                  sendStreamingProgress({ status: 'done', percent: 100, message: '流式模型已就绪' });
                  resolve(true);
                })
                .catch((err) => {
                  sendStreamingProgress({ status: 'error', percent: 0, message: err.message });
                  reject(err);
                });
            });
          });
        })
        .on('error', (err) => {
          sendStreamingProgress({ status: 'error', percent: 0, message: err.message });
          reject(err);
        });
    };

    doRequest(STREAMING_MODEL_URL);
  });
}

function downloadVadModel() {
  return new Promise((resolve, reject) => {
    const { downloadBase, modelPath } = getVadPaths();
    fs.mkdirSync(downloadBase, { recursive: true });

    sendVadProgress({ status: 'starting', percent: 0, message: '开始下载 VAD 模型' });

    const fileStream = fs.createWriteStream(modelPath);

    const handleResponse = (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.destroy();
        https.get(res.headers.location, handleResponse).on('error', (err) => {
          sendVadProgress({ status: 'error', percent: 0, message: err.message });
          reject(err);
        });
        return;
      }

      if (res.statusCode !== 200) {
        const err = new Error(`下载失败，状态码 ${res.statusCode}`);
        sendVadProgress({ status: 'error', percent: 0, message: err.message });
        reject(err);
        return;
      }

      const total = parseInt(res.headers['content-length'] || '0', 10);
      let downloaded = 0;

      res.on('data', (chunk) => {
        downloaded += chunk.length;
        if (total > 0) {
          const percent = Math.min(100, Math.round((downloaded / total) * 100));
          sendVadProgress({ status: 'downloading', percent, message: `下载中... ${percent}%` });
        }
      });

      res.pipe(fileStream);

      res.on('end', () => {
        sendVadProgress({ status: 'completed', percent: 100, message: '下载完成' });
        resolve(true);
      });

      res.on('error', (err) => {
        sendVadProgress({ status: 'error', percent: 0, message: err.message });
        reject(err);
      });
    };

    https.get(VAD_MODEL_URL, handleResponse).on('error', (err) => {
      sendVadProgress({ status: 'error', percent: 0, message: err.message });
      reject(err);
    });
  });
}

function extractModel(archivePath) {
  const { downloadBase } = getModelPaths();
  const targetDir = path.join(downloadBase, OFFLINE_MODEL_DIR_NAME);
  return extractTarArchive(archivePath, targetDir, 'SenseVoice 模型');
}

function extractStreamingModel(archivePath) {
  const { downloadBase } = getStreamingModelPaths();
  const targetDir = path.join(downloadBase, STREAMING_MODEL_DIR_NAME);
  return extractTarArchive(archivePath, targetDir, '流式模型');
}

function extractPunctuationModel(archivePath) {
  const { downloadBase } = getPunctuationPaths();
  const targetDir = path.join(downloadBase, PUNCT_MODEL_DIR_NAME);
  return extractTarArchive(archivePath, targetDir, '标点模型');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: getIconPath(),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    frame: false, // 无边框窗口
    titleBarStyle: 'customButtonsOnHover',
    title: APP_NAME
  });

  mainWindow.on('close', (e) => {
    if (forceQuit) return;
    e.preventDefault();
    mainWindow.hide();
  });

  // 设置CSP，允许外部API调用
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': ['default-src \'self\' \'unsafe-inline\' data: https: http: blob:']
      }
    });
  });

  mainWindow.loadFile('index.html');

  // 开发环境下打开开发者工具
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(() => {
  try {
    app.setName(APP_NAME);
    if (app.setAboutPanelOptions) {
      app.setAboutPanelOptions({ applicationName: APP_NAME });
    }
  } catch (err) {
    console.warn('Failed to set app name', err);
  }
  if (process.platform === 'darwin' && app.dock && ICON_PATH) {
    try {
      const dockImage = getIconImage();
      if (dockImage && !dockImage.isEmpty()) {
        app.dock.setIcon(dockImage);
      }
    } catch (err) {
      console.warn('Failed to set dock icon', err);
    }
  }
  createWindow();
  ensureOverlayWindow();
  ensureTray();
  setupGlobalPttHook();
  screen.on('display-metrics-changed', () => positionOverlayWindow());
  screen.on('display-added', () => positionOverlayWindow());
  screen.on('display-removed', () => positionOverlayWindow());
});

app.on('window-all-closed', () => {
  if (forceQuit) {
    app.quit();
    return;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  forceQuit = true;
  hideOverlay(true);
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.destroy();
  }
});

app.on('activate', () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
});

// 处理文件选择
ipcMain.handle('select-audio-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: '所有支持的文件', extensions: ['wav', 'mp3', 'm4a', 'mp4', 'flac', 'aac', 'avi', 'mov', 'mkv', 'wmv', 'flv', 'm4v'] },
      { name: '音频文件', extensions: ['wav', 'mp3', 'm4a', 'flac', 'aac'] },
      { name: '视频文件', extensions: ['mp4', 'avi', 'mov', 'mkv', 'wmv', 'flv', 'm4v'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  });

  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

// 处理音频文件处理
ipcMain.handle('process-audio', async (event, audioFilePath, options = {}) => {
  return new Promise((resolve, reject) => {
    // 获取sherpa-onnx的路径（假设在上级目录）
    const sherpaPath = getResourceBase();
    const pythonScript = path.join(sherpaPath, 'scripts', 'diarization_asr_electron_helper.py');
    const pythonPath = resolveBundledPython();
    const { modelDir } = getModelPaths();

    if (!pythonPath) {
      reject(new Error(PYTHON_NOT_FOUND_MESSAGE));
      return;
    }
    
    // 准备参数
    const args = [
      pythonScript,
      audioFilePath,
      options.enableDiarization !== undefined ? options.enableDiarization.toString() : 'true',
      options.maxWorkers || 4,
      options.clusterThreshold || 0.9,
      options.numClusters ? options.numClusters.toString() : 'null'
    ];
    
    // 执行Python脚本
    const pythonProcess = spawn(pythonPath, args, {
      cwd: sherpaPath,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: withFfmpegPath({
        SENSE_VOICE_MODEL_DIR: modelDir
      })
    });

    let stdout = '';
    let stderr = '';

    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
      // 发送进度更新到渲染进程
      event.sender.send('processing-progress', data.toString());
    });

    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
      event.sender.send('processing-error', data.toString());
    });

    pythonProcess.on('close', (code) => {
      if (code === 0) {
        try {
          // 解析输出结果
          const results = parseProcessingResults(stdout);
          resolve(results);
        } catch (error) {
          reject(new Error('解析结果失败: ' + error.message));
        }
      } else {
        console.error('Python脚本失败详情:');
        console.error('退出码:', code);
        console.error('标准输出:', stdout);
        console.error('标准错误:', stderr);
        console.error('工作目录:', sherpaPath);
        console.error('命令参数:', args);
        reject(new Error(`处理失败，退出码: ${code}\n标准输出: ${stdout}\n错误信息: ${stderr}`));
      }
    });

    pythonProcess.on('error', (error) => {
      reject(new Error('启动Python进程失败: ' + error.message));
    });
  });
});



// 解析处理结果
function parseProcessingResults(output) {
  const lines = output.split('\n');
  let jsonStart = -1;
  let jsonEnd = -1;
  
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === 'RESULTS_START') {
      jsonStart = i + 1;
    } else if (lines[i].trim() === 'RESULTS_END') {
      jsonEnd = i;
      break;
    }
  }
  
  if (jsonStart === -1 || jsonEnd === -1) {
    throw new Error('无法找到结果数据');
  }
  
  const jsonStr = lines.slice(jsonStart, jsonEnd).join('\n');
  return JSON.parse(jsonStr);
}

// 打开外部链接
ipcMain.handle('open-external', async (event, url) => {
  shell.openExternal(url);
});

// 显示错误对话框
ipcMain.handle('show-error', async (event, title, content) => {
  dialog.showErrorBox(title, content);
});

// 显示信息对话框
ipcMain.handle('show-message', async (event, title, content) => {
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: title,
    message: content
  });
});

// 保存文件
ipcMain.handle('save-file', async (event, content, defaultName) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName,
    filters: [
      { name: '文本文件', extensions: ['txt'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  });

  if (!result.canceled && result.filePath) {
    try {
      fs.writeFileSync(result.filePath, content, 'utf8');
      return { success: true, filePath: result.filePath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  
  return { success: false, error: '用户取消保存' };
});

// 窗口控制
ipcMain.handle('minimize-window', () => {
  mainWindow.minimize();
});

ipcMain.handle('close-window', () => {
  mainWindow.close();
});

ipcMain.handle('system-input:paste', async (_event, text) => {
  const normalized = typeof text === 'string' ? text : '';
  if (!normalized.trim()) {
    return { success: false, message: '没有可粘贴的内容' };
  }

  // 如果 2pass 替换正在进行，返回错误，让调用端知道粘贴被跳过
  if (isSelectAndReplaceInProgress) {
    console.log('[Paste] Skipped (2pass in progress):', normalized.slice(0, 30));
    return { success: false, message: '2pass替换进行中，跳过1pass粘贴', skipped: true };
  }

  let outcome = { success: true, copied: false, pasted: false };

  pasteOnceQueue = pasteOnceQueue
    .then(async () => {
      const result = await pasteTextToFocusedInputOnce(normalized);
      outcome = { ...result, success: true };
    })
    .catch((error) => {
      outcome = {
        success: false,
        message: error?.message || String(error),
        copied: false,
        pasted: false
      };
    });

  await pasteOnceQueue;
  return outcome;
});

// 选中并替换文本：用 2pass 内容替换外部输入框中的 1pass 增量内容
// 注意：此操作不使用 pasteOnceQueue，而是立即执行，因为 2pass 需要尽快替换 1pass
ipcMain.handle('system-input:select-and-replace', async (_event, payload) => {
  console.log('[system-input:select-and-replace] Received payload:', payload);
  const { selectLength, secondPassText } = payload || {};
  const normalizedLength = Number(selectLength) || 0;
  const normalizedSecond = typeof secondPassText === 'string' ? secondPassText : '';

  console.log('[system-input:select-and-replace] Normalized values:', {
    selectLength: normalizedLength,
    secondPassText: normalizedSecond.slice(0, 50) + (normalizedSecond.length > 50 ? '...' : '')
  });

  if (normalizedLength <= 0) {
    console.log('[system-input:select-and-replace] Invalid selectLength');
    return { success: false, message: '没有可替换的 1pass 内容' };
  }
  if (!normalizedSecond.trim()) {
    console.log('[system-input:select-and-replace] Empty secondPassText');
    return { success: false, message: '没有可替换的 2pass 内容' };
  }

  console.log('[system-input:select-and-replace] Calling selectAndReplaceText...');

  try {
    // 直接执行，不使用队列，避免与 1pass 粘贴队列冲突
    const result = await selectAndReplaceText(normalizedLength, normalizedSecond);
    console.log('[system-input:select-and-replace] Final outcome:', { success: true, replaced: true });
    return { success: true, replaced: true };
  } catch (error) {
    console.error('[system-input:select-and-replace] Error:', error);
    return {
      success: false,
      message: error?.message || String(error),
      replaced: false
    };
  }
});

ipcMain.handle('mic-permission-status', async () => {
  const status = getMicPermissionStatus();
  return { status, icon: getIconPath() };
});

ipcMain.handle('mic-permission-request', async () => {
  const status = await requestMicPermission();
  return { status, icon: getIconPath() };
});

// 新增：读取文件内容（用于API上传）
ipcMain.handle('read-file', async (event, filePath) => {
  try {
    return fs.readFileSync(filePath);
  } catch (error) {
    throw new Error(`读取文件失败: ${error.message}`);
  }
});

ipcMain.on('ptt-overlay:update', (_event, payload) => {
  if (!payload) return;
  const { state, message, hint, autoHideMs, lock } = payload;
  console.log('[ptt-overlay:update] Received:', { state, message, hint, overlayTimer: !!overlayTimer, overlayMessageCache });
  if (state === 'idle') {
    hideOverlay(true);
    return;
  }
  if (state === 'recording') {
    // If timer already running, update cached message only to avoid
    // restarting timer; otherwise start it.
    if (overlayTimer) {
      overlayMessageCache = message || overlayMessageCache || '';
      console.log('[ptt-overlay:update] Updated cache:', overlayMessageCache);
      // immediately send an update so overlay displays new message
      const formatted = formatDurationMs(Date.now() - overlayStartTime);
      const durationHint = `按键录音 ${formatted}`;
      sendOverlayPayload({ state: 'recording', message: overlayMessageCache || '', hint: durationHint, lock: Boolean(lock) });
      return;
    }
    startOverlayTimer(message, hint, Boolean(lock));
    return;
  }
  stopOverlayTimer();
  updateOverlay(state || 'recording', message, hint, {
    autoHideMs,
    lock: Boolean(lock)
  });
});

ipcMain.on('ptt-overlay:hide', () => hideOverlay());

ipcMain.on('ptt-overlay:arm', (_event, enabled) => {
  overlayArmed = Boolean(enabled);
  if (!overlayArmed) {
    overlayLocked = false;
    hideOverlay(true);
  }
});

// Debug: trigger overlay test payload (use from renderer devtools)
ipcMain.on('ptt-overlay:test', () => {
  try {
    const now = Date.now();
    const formatted = formatDurationMs(0);
    sendOverlayPayload({ state: 'recording', message: `测试 overlay ${now}`, hint: `按键录音 ${formatted}` });
  } catch (err) {
    console.warn('ptt-overlay:test failed', err);
  }
});

function buildLiveSessionRuntime(mode, payload = {}) {
  console.log('===== [main] buildLiveSessionRuntime START =====');
  console.log('[main] mode:', mode);
  console.log('[main] payload?.manualRealtime:', payload?.manualRealtime);
  console.log('[main] Boolean(payload?.manualRealtime):', Boolean(payload?.manualRealtime));

  if (!modelExists()) {
    return { success: false, message: 'SenseVoice 模型未就绪，请先下载' };
  }
  if (!streamingModelExists()) {
    return { success: false, message: '流式 ZipFormer 模型未就绪，请先下载' };
  }

  const pythonPath = resolveBundledPython();
  if (!pythonPath) {
    return { success: false, message: PYTHON_NOT_FOUND_MESSAGE };
  }

  const { modelDir } = getModelPaths();
  const senseVoice = resolveSenseVoiceFiles(modelDir);
  if (!senseVoice) {
    return { success: false, message: '未找到 SenseVoice 模型或 tokens.txt' };
  }

  const { modelDir: streamingDir } = getStreamingModelPaths();
  const streaming = resolveStreamingZipformerComponents(streamingDir);
  if (!streaming) {
    return { success: false, message: '未找到 ZipFormer 流式模型完整文件（encoder/decoder/joiner/tokens）' };
  }

  const punctuationReady = punctuationModelExists();
  const { modelPath: defaultVadModel } = getVadPaths();
  const vadModelPath = fs.existsSync(defaultVadModel) ? defaultVadModel : '';
  const vadOpt = payload?.vad || {};
  const vadDefaults = DEFAULT_OPTIONS.vad.silero;
  const sileroCfg = {
    threshold: typeof vadOpt.threshold === 'number' ? vadOpt.threshold : vadDefaults.threshold,
    minSilenceDuration:
      typeof vadOpt.minSilence === 'number' ? vadOpt.minSilence : vadDefaults.minSilenceDuration,
    minSpeechDuration:
      typeof vadOpt.minSpeech === 'number' ? vadOpt.minSpeech : vadDefaults.minSpeechDuration,
    maxSpeechDuration:
      typeof vadOpt.maxSpeech === 'number' ? vadOpt.maxSpeech : vadDefaults.maxSpeechDuration
  };

  const runtime = {
    device: payload?.micName,
    numThreads: payload?.numThreads || 2,
    numThreadsSecond: payload?.numThreadsSecond || payload?.numThreads || 4,
    sampleRate: payload?.sampleRate || speechAsr.activeOptions?.sampleRate || 16000,
    bufferSize: payload?.bufferSize || speechAsr.activeOptions?.bufferSize || 1600,
    pythonPath,
    manualRealtime: Boolean(payload?.manualRealtime),  // 实时 VAD+2pass 模式开关
    vadMode: vadModelPath ? 'silero' : 'off',
    vad: { silero: sileroCfg },
    modelPaths: {
      streaming,
      secondPass: senseVoice,
      vadModel: vadModelPath,
      workingDir: getResourceBase()
    }
  };

  console.log('[main] runtime.manualRealtime (final):', runtime.manualRealtime);
  console.log('[main] buildLiveSessionRuntime END =====');
  return { success: true, runtime, punctuationReady, vadReady: Boolean(vadModelPath) };
}

// 模型相关
ipcMain.handle('check-model', async () => {
  return modelExists();
});

ipcMain.handle('check-punctuation-model', async () => {
  return punctuationModelExists();
});

ipcMain.handle('check-streaming-model', async () => {
  return streamingModelExists();
});

ipcMain.handle('check-vad-model', async () => {
  return vadModelExists();
});

ipcMain.handle('download-model', async () => {
  try {
    await downloadModel();
    return { success: true };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle('download-punctuation-model', async () => {
  try {
    await downloadPunctuationModel();
    return { success: true };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle('download-streaming-model', async () => {
  try {
    await downloadStreamingModel();
    return { success: true };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle('download-vad-model', async () => {
  try {
    await downloadVadModel();
    return { success: true };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle('open-model-folder', async () => {
  try {
    const { downloadBase } = getModelPaths();
    if (!fs.existsSync(downloadBase)) {
      return { success: false, message: '模型下载目录不存在，请先下载模型' };
    }
    shell.showItemInFolder(downloadBase);
    return { success: true };
  } catch (error) {
    console.error('Failed to open model folder:', error);
    return { success: false, message: error.message };
  }
});

ipcMain.handle('open-punctuation-folder', async () => {
  try {
    const { downloadBase } = getPunctuationPaths();
    if (!fs.existsSync(downloadBase)) {
      return { success: false, message: '标点模型下载目录不存在，请先下载模型' };
    }
    shell.showItemInFolder(downloadBase);
    return { success: true };
  } catch (error) {
    console.error('Failed to open punctuation model folder:', error);
    return { success: false, message: error.message };
  }
});

ipcMain.handle('open-streaming-folder', async () => {
  try {
    const { downloadBase } = getStreamingModelPaths();
    if (!fs.existsSync(downloadBase)) {
      return { success: false, message: '流式模型下载目录不存在，请先下载模型' };
    }
    shell.showItemInFolder(downloadBase);
    return { success: true };
  } catch (error) {
    console.error('Failed to open streaming model folder:', error);
    return { success: false, message: error.message };
  }
});

ipcMain.handle('open-vad-folder', async () => {
  try {
    const { downloadBase } = getVadPaths();
    if (!fs.existsSync(downloadBase)) {
      return { success: false, message: 'VAD 模型下载目录不存在，请先下载模型' };
    }
    shell.showItemInFolder(downloadBase);
    return { success: true };
  } catch (error) {
    console.error('Failed to open VAD model folder:', error);
    return { success: false, message: error.message };
  }
});

// 实时转写：加载/释放模型（自动与按键模式）
ipcMain.handle('live-load-models', async (_event, payload = {}) => {
  const mode = payload?.mode === 'manual' ? 'manual' : 'auto';
  console.log('===== [main] live-load-models START =====');
  console.log('[main] payload.mode:', payload?.mode);
  console.log('[main] normalized mode:', mode);
  console.log('[main] payload.manualRealtime:', payload?.manualRealtime);
  console.log('[main] payload.micName:', payload?.micName);
  console.log('[main] payload.numThreads:', payload?.numThreads);

  const built = buildLiveSessionRuntime(mode, payload);
  if (!built.success) {
    console.log('[main] buildLiveSessionRuntime failed:', built.message);
    return built;
  }

  const { runtime, punctuationReady, vadReady } = built;
  console.log('[main] runtime.manualRealtime:', runtime.manualRealtime);
  console.log('[main] runtime.device:', runtime.device);
  console.log('[main] punctuationReady:', punctuationReady);
  console.log('[main] vadReady:', vadReady);

  if (speechAsr.isRunning()) {
    if (speechAsr.isManual() !== (mode === 'manual')) {
      const switched = await speechAsr.switchMode(mode);
      if (!switched?.success) {
        return { success: false, message: switched?.message || '切换模式失败' };
      }
    }
    liveSessionMode = mode;
    liveModelsLoaded = true;
    return { success: true, mode: liveSessionMode, punctuationReady, vadReady, reused: true };
  }

  try {
    if (!punctuationReady) {
      sendLiveResult({
        type: 'log',
        message: '未找到标点模型，将跳过标点增强。如需标点，请先下载标点模型'
      });
    } else {
      sendLiveResult({ type: 'log', message: '标点模型已就绪' });
    }

    if (!vadReady) {
      sendLiveResult({
        type: 'log',
        message: `未找到 VAD 模型，将仅使用端点检测。下载地址: ${VAD_MODEL_URL}`
      });
    }

    const startResult = await speechAsr.live({
      action: 'start',
      mode,
      startPaused: mode === 'auto',
      autoStart: false,
      ...runtime
    });

    if (!startResult?.success) {
      return { success: false, message: startResult?.message || '加载实时模型失败' };
    }

    liveSessionMode = mode;
    liveModelsLoaded = true;
    sendLiveResult({
      type: 'log',
      message: mode === 'manual' ? '按键模式模型已加载，等待按键开始录音' : '自动模式模型已加载，点击开始录音'
    });
    return {
      success: true,
      mode: liveSessionMode,
      punctuationReady,
      vadReady,
      reused: startResult.reused
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

ipcMain.handle('live-release-models', async () => {
  try {
    // 释放模型时重置粘贴队列
    resetPasteQueue();
    if (speechAsr.isRunning()) {
      if (speechAsr.isManual()) {
        await speechAsr.stopManualSession();
      } else {
        await speechAsr.stop();
      }
    }
    resetLiveSessionState();
    hideOverlay(true);
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

ipcMain.handle('live-start-capture', async (_event, payload = {}) => {
  const mode = payload?.mode === 'manual' ? 'manual' : 'auto';
  console.log('===== [main] live-start-capture START =====');
  console.log('[main] payload.mode:', payload?.mode);
  console.log('[main] normalized mode:', mode);
  console.log('[main] payload.manualRealtime:', payload?.manualRealtime);
  console.log('[main] payload.micName:', payload?.micName);

  const built = buildLiveSessionRuntime(mode, payload);
  if (!built.success) {
    console.log('[main] buildLiveSessionRuntime failed:', built.message);
    return built;
  }

  const { runtime, punctuationReady, vadReady } = built;
  console.log('[main] runtime.manualRealtime:', runtime.manualRealtime);
  console.log('[main] runtime.device:', runtime.device);
  console.log('[main] speechAsr.isRunning():', speechAsr.isRunning());
  console.log('[main] speechAsr.isManual():', speechAsr.isManual());

  if (speechAsr.isRunning()) {
    try {
      if (speechAsr.isManual() !== (mode === 'manual')) {
        const switched = await speechAsr.switchMode(mode);
        if (!switched?.success) {
          return { success: false, message: switched?.message || '切换模式失败' };
        }
      }
      // 确保 manualRealtime 参数和 modelPaths 都被传递（重启进程时需要完整的 runtime）
      const reuse = await speechAsr.live({ action: 'start', mode, autoStart: true, manualRealtime: runtime.manualRealtime, modelPaths: runtime.modelPaths });
      liveSessionMode = mode;
      liveModelsLoaded = true;
      return reuse;
    } catch (err) {
      return { success: false, message: err.message };
    }
  }

  try {
    if (!punctuationReady) {
      sendLiveResult({
        type: 'log',
        message: '未找到标点模型，将跳过标点增强。如需标点，请先下载标点模型'
      });
    } else {
      sendLiveResult({ type: 'log', message: '标点模型已就绪' });
    }
    if (!vadReady) {
      sendLiveResult({
        type: 'log',
        message: `未找到 VAD 模型，将仅使用端点检测。下载地址: ${VAD_MODEL_URL}`
      });
    }

    const startResult = await speechAsr.live({
      action: 'start',
      mode,
      autoStart: true,
      startPaused: false,
      ...runtime
    });

    if (!startResult?.success) {
      return { success: false, message: startResult?.message || '启动实时识别失败' };
    }
    liveSessionMode = mode;
    liveModelsLoaded = true;
    return startResult;
  } catch (err) {
    return { success: false, message: err.message };
  }
});

ipcMain.handle('live-stop-capture', async (_event, payload = {}) => {
  const mode = payload?.mode === 'manual' ? 'manual' : 'auto';
  if (!liveModelsLoaded || liveSessionMode !== mode) {
    return { success: false, message: '当前没有对应模式的实时会话' };
  }

  try {
    if (mode === 'manual' && payload?.source !== 'key-up') {
      return { success: false, message: '仅按键松开时可结束按键录音' };
    }
    // 停止时重置粘贴队列，避免等待队列中积压的粘贴任务
    resetPasteQueue();
    if (!speechAsr.isRunning()) {
      return { success: true };
    }
    return await speechAsr.live({ action: 'stop', mode });
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// 实时转写：切换麦克风设备（不重启进程）
ipcMain.handle('live-switch-device', async (_event, payload = {}) => {
  if (!speechAsr.isRunning()) {
    return { success: false, message: '当前没有实时会话在运行' };
  }
  try {
    const target = payload?.micName || payload?.device || payload?.index || '';
    const result = await speechAsr.switchDevice(target);
    if (!result?.success) {
      return { success: false, message: result?.message || '切换麦克风失败' };
    }
    sendLiveResult({ type: 'log', message: `已请求切换麦克风: ${target || '默认设备'}` });
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// 保存录音文件
ipcMain.handle('save-recording', async (_event, arrayBuffer, extension = 'webm') => {
  const recordingsDir = path.join(app.getPath('userData'), 'recordings');
  fs.mkdirSync(recordingsDir, { recursive: true });
  const ext = extension.startsWith('.') ? extension.slice(1) : extension;
  const filePath = path.join(recordingsDir, `record-${Date.now()}.${ext}`);
  try {
    const buffer = Buffer.from(arrayBuffer);
    fs.writeFileSync(filePath, buffer);
    return { success: true, filePath };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// Push-to-talk 单次转写
ipcMain.handle('push-to-talk-asr', async (_event, arrayBuffer, mimeType = 'audio/webm') => {
  try {
    if (!modelExists()) {
      return { success: false, message: 'SenseVoice 模型未就绪，请先下载' };
    }
    if (!streamingModelExists()) {
      return { success: false, message: '流式 ZipFormer 模型未就绪，请先下载' };
    }
    const pythonPath = resolveBundledPython();
    if (!pythonPath) {
      return { success: false, message: PYTHON_NOT_FOUND_MESSAGE };
    }
    const { modelDir } = getModelPaths();
    const { modelDir: streamingDir } = getStreamingModelPaths();
    const senseVoice = resolveSenseVoiceFiles(modelDir);
    const streaming = resolveStreamingZipformerComponents(streamingDir);
    if (!senseVoice || !streaming) {
      return { success: false, message: '模型文件不完整，请检查 SenseVoice 与 ZipFormer' };
    }

    const tmpDir = path.join(app.getPath('userData'), 'ptt-cache');
    fs.mkdirSync(tmpDir, { recursive: true });
    const rawExt = mimeType && mimeType.includes('wav') ? 'wav' : 'webm';
    const rawPath = path.join(tmpDir, `ptt-${Date.now()}.${rawExt}`);
    const wavPath = path.join(tmpDir, `ptt-${Date.now()}.wav`);
    fs.writeFileSync(rawPath, Buffer.from(arrayBuffer));

    let convertStderr = '';
    const convertCode = await new Promise((resolve) => {
      const ffmpegConvert = spawn(ffmpegInstaller.path, ['-y', '-i', rawPath, '-ar', '16000', '-ac', '1', wavPath], {
        env: withFfmpegPath()
      });
      ffmpegConvert.stderr.on('data', (d) => (convertStderr += d.toString()));
      ffmpegConvert.on('close', resolve);
    });
    if (convertCode !== 0) {
      return {
        success: false,
        message: '音频转换失败，检查 ffmpeg 是否可用',
        detail: convertStderr || `ffmpeg exit ${convertCode}`
      };
    }

    const { modelPath: defaultVadModel } = getVadPaths();
    const vadModelPath = fs.existsSync(defaultVadModel) ? defaultVadModel : '';

    const asrResult = await speechAsr.transcribeFile(wavPath, {
      modelPaths: {
        streaming,
        secondPass: senseVoice,
        vadModel: vadModelPath,
        workingDir: getResourceBase()
      },
      pythonPath
    });

    return asrResult;
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// Push-to-talk：SDK 录音（仅第二遍）
ipcMain.handle('ptt-start', async (_event, options = {}) => {
  try {
    if (!modelExists()) {
      return { success: false, message: 'SenseVoice 模型未就绪，请先下载' };
    }
    if (!streamingModelExists()) {
      return { success: false, message: '流式 ZipFormer 模型未就绪，请先下载' };
    }
    const pythonPath = resolveBundledPython();
    if (!pythonPath) {
      return { success: false, message: PYTHON_NOT_FOUND_MESSAGE };
    }
    const { modelDir } = getModelPaths();
    const { modelDir: streamingDir } = getStreamingModelPaths();
    const senseVoice = resolveSenseVoiceFiles(modelDir);
    const streaming = resolveStreamingZipformerComponents(streamingDir);
    if (!senseVoice || !streaming) {
      return { success: false, message: '模型文件不完整，请检查 SenseVoice 与 ZipFormer' };
    }
    const { modelPath: defaultVadModel } = getVadPaths();
    const vadModelPath = fs.existsSync(defaultVadModel) ? defaultVadModel : '';
    const start = await speechAsr.live({
      action: 'start',
      mode: 'manual',
      autoStart: true,
      device: options?.micName,
      modelPaths: {
        streaming,
        secondPass: senseVoice,
        vadModel: vadModelPath,
        workingDir: getResourceBase()
      },
      pythonPath
    });
    return start;
  } catch (err) {
    return { success: false, message: err.message };
  }
});

ipcMain.handle('ptt-stop', async () => {
  try {
    const stop = await speechAsr.live({ action: 'stop', mode: 'manual' });
    return stop;
  } catch (err) {
    return { success: false, message: err.message };
  }
});

ipcMain.handle('ptt-end', async () => {
  try {
    return await speechAsr.stopManualSession();
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// 实时转写：开始会话（Python 直接采集麦克风）
ipcMain.handle('start-live-transcribe', async (_event, options = {}) => {
  if (speechAsr.isRunning()) {
    return { success: false, message: '已有实时会话在运行' };
  }

  if (!modelExists()) {
    return { success: false, message: 'SenseVoice 模型未就绪，请先下载' };
  }
  if (!streamingModelExists()) {
    return { success: false, message: '流式 ZipFormer 模型未就绪，请先下载' };
  }

  const pythonPath = resolveBundledPython();
  if (!pythonPath) {
    return { success: false, message: PYTHON_NOT_FOUND_MESSAGE };
  }

  const { modelDir } = getModelPaths();
  const { modelDir: streamingDir } = getStreamingModelPaths();
  const senseVoice = resolveSenseVoiceFiles(modelDir);
  const streaming = resolveStreamingZipformerComponents(streamingDir);

  if (!senseVoice) {
    return { success: false, message: '未找到 SenseVoice 模型或 tokens.txt' };
  }
  if (!streaming) {
    return { success: false, message: '未找到 ZipFormer 流式模型完整文件（encoder/decoder/joiner/tokens）' };
  }

  const vadOpt = options?.vad || {};
  const { modelPath: defaultVadModel } = getVadPaths();
  const vadModelPath = vadOpt.model || (fs.existsSync(defaultVadModel) ? defaultVadModel : '');
  const vadDefaults = DEFAULT_OPTIONS.vad.silero;
  const sileroCfg = {
    threshold: typeof vadOpt.threshold === 'number' ? vadOpt.threshold : vadDefaults.threshold,
    minSilenceDuration:
      typeof vadOpt.minSilence === 'number' ? vadOpt.minSilence : vadDefaults.minSilenceDuration,
    minSpeechDuration:
      typeof vadOpt.minSpeech === 'number' ? vadOpt.minSpeech : vadDefaults.minSpeechDuration,
    maxSpeechDuration:
      typeof vadOpt.maxSpeech === 'number' ? vadOpt.maxSpeech : vadDefaults.maxSpeechDuration
  };

  if (!vadModelPath) {
    sendLiveResult({
      type: 'log',
      message: `未找到 VAD 模型，将使用端点检测。下载地址: ${VAD_MODEL_URL}`
    });
  }

  try {
    const startResult = await speechAsr.start({
      device: options?.micName,
      numThreads: options?.numThreads || 2,
      numThreadsSecond: options?.numThreadsSecond || options?.numThreads || 4,
      sampleRate: options?.sampleRate || speechAsr.activeOptions?.sampleRate || 16000,
      bufferSize: options?.bufferSize || speechAsr.activeOptions?.bufferSize || 1600,
      pythonPath,
      vadMode: vadModelPath ? 'silero' : 'off',
      vad: {
        silero: sileroCfg
      },
      modelPaths: {
        streaming,
        secondPass: senseVoice,
        vadModel: vadModelPath,
        workingDir: getResourceBase()
      }
    });

    if (!startResult?.success) {
      return { success: false, message: startResult?.message || '启动实时识别失败' };
    }
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// 实时转写：停止会话
ipcMain.handle('stop-live-transcribe', async () => {
  await speechAsr.stop();
  return { success: true };
});

// 实时转写：推送音频块（新模式不需要）
ipcMain.handle('push-live-chunk', async () => {
  return { success: false, message: 'Python 端麦克风模式无需推送音频块' };
});

async function handleLiveChunk(inputPath, wavPath, chunkIndex, mimeType = 'audio/webm') {
  if (!speechAsr.isRunning()) return;

  const isWebm = mimeType.includes('webm');

  // 不再拼接头，直接用当前块
  let effectiveInput = inputPath;

  // 转换为16k单声道wav
  let convertStderr = '';
  const convertCode = await new Promise((resolve) => {
    const ffmpegConvert = spawn(ffmpegInstaller.path, ['-y', '-i', effectiveInput, '-ar', '16000', '-ac', '1', wavPath], {
      env: withFfmpegPath()
    });
    ffmpegConvert.stderr.on('data', (d) => (convertStderr += d.toString()));
    ffmpegConvert.on('close', resolve);
  });
  if (convertCode !== 0) {
    sendLiveResult({
      type: 'error',
      message: '音频转换失败，检查 ffmpeg 是否可用',
      detail: convertStderr || `ffmpeg exit ${convertCode}`
    });
    // 清理临时文件
    try {
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath);
    } catch (err) {
      console.error('清理转换失败临时文件失败', err);
    }
    return;
  }

  // 使用 volumedetect 简易 VAD 过滤静音
  const volOutput = [];
  let volStderr = '';
  const volCode = await new Promise((resolve) => {
    const volProcess = spawn(ffmpegInstaller.path, ['-i', wavPath, '-af', 'volumedetect', '-f', 'null', '-'], {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: withFfmpegPath()
    });
    volProcess.stderr.on('data', (d) => {
      const s = d.toString();
      volOutput.push(s);
      volStderr += s;
    });
    volProcess.on('close', resolve);
  });
  if (volCode !== 0) {
    sendLiveResult({ type: 'error', message: 'VAD 检测失败', detail: volStderr || `ffmpeg exit ${volCode}` });
    // 清理临时文件
    try {
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath);
    } catch (err) {
      console.error('清理VAD失败临时文件失败', err);
    }
    return;
  }
  const meanVolumeLine = volOutput.join('\n').split('\n').find((l) => l.includes('mean_volume'));
  let meanVolume = -100;
  if (meanVolumeLine) {
    const match = meanVolumeLine.match(/mean_volume:\s*([-\d\.]+)/);
    if (match) {
      meanVolume = parseFloat(match[1]);
    }
  }
  if (meanVolume < -60) {
    sendLiveResult({ type: 'skip', message: `静音片段已跳过 (mean_volume=${meanVolume} dB)` });
    // 清理临时文件
    try {
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath);
    } catch (err) {
      console.error('清理静音片段临时文件失败', err);
    }
    return;
  }
  sendLiveResult({ type: 'log', message: `检测到语音片段，mean_volume=${meanVolume} dB` });

  // 调用 Python ASR（无说话人分离）
  const sherpaPath = getResourceBase();
  const pythonScript = path.join(sherpaPath, 'scripts', 'diarization_asr_electron_helper.py');
  const { modelDir } = getModelPaths();
  const args = [
    pythonScript,
    wavPath,
    'false', // 关闭分离
    2,       // 线程
    0.9,
    'null'
  ];

  const pythonPath = resolveBundledPython();
  if (!pythonPath) {
    sendLiveResult({ type: 'error', message: PYTHON_NOT_FOUND_MESSAGE });
    try {
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath);
    } catch (err) {
      console.error('清理缺少 Python 时的临时文件失败', err);
    }
    return;
  }

  const pythonProcess = spawn(pythonPath, args, {
    cwd: sherpaPath,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: withFfmpegPath({
      SENSE_VOICE_MODEL_DIR: modelDir,
      FFMPEG_BIN: ffmpegInstaller.path
    })
  });

  let stdout = '';
  let stderr = '';
  pythonProcess.stdout.on('data', (d) => (stdout += d.toString()));
  pythonProcess.stderr.on('data', (d) => (stderr += d.toString()));

  const exitCode = await new Promise((resolve) => pythonProcess.on('close', resolve));

  if (exitCode !== 0) {
    sendLiveResult({ type: 'error', message: `ASR 退出码 ${exitCode}: ${stderr || stdout}` });
    // 清理临时文件
    try {
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath);
    } catch (err) {
      console.error('清理错误片段临时文件失败', err);
    }
    return;
  }

  try {
    const result = parseProcessingResults(stdout);
    if (result?.results?.length) {
      sendLiveResult({ type: 'result', segments: result.results });
    } else {
      sendLiveResult({ type: 'log', message: '未从当前片段解析出文本' });
    }
  } catch (err) {
    console.error('实时转写解析失败', err, stderr);
    sendLiveResult({ type: 'error', message: `实时转写解析失败: ${err.message || err}`, detail: stderr || stdout });
  } finally {
    // 处理完成后清理临时文件
    try {
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath);
    } catch (err) {
      console.error('清理临时文件失败', err);
    }
  }
}

function sendLiveResult(payload) {
  if (mainWindow) {
    mainWindow.webContents.send('live-transcribe-result', payload);
  }
}

function getMicPermissionStatus() {
  try {
    const status = systemPreferences.getMediaAccessStatus('microphone');
    return status || 'unknown';
  } catch (err) {
    console.warn('Failed to read mic permission status', err);
    return 'unknown';
  }
}

async function requestMicPermission() {
  if (process.platform === 'darwin') {
    try {
      const granted = await systemPreferences.askForMediaAccess('microphone');
      return granted ? 'granted' : getMicPermissionStatus();
    } catch (err) {
      console.warn('askForMediaAccess failed', err);
      return getMicPermissionStatus();
    }
  }
  // Windows / Linux 无法在此主动弹窗，引导用户在系统设置中打开
  return getMicPermissionStatus();
}
