const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  clipboard,
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

// ============== App 模式检测 ==============
// 支持两种模式：full (完整版) 和 lite (简化版)
// 通过环境变量 APP_MODE 或命令行参数 --lite/--live 指定
const argvMode = process.argv.includes('--live')
  ? 'live'
  : process.argv.includes('--lite')
    ? 'lite'
    : null;
const APP_MODE = process.env.APP_MODE || argvMode || 'full';

// 模式相关配置
const MODE_CONFIG = {
  lite: {
    appName: '西瓜说 Lite',
    htmlFile: 'lite-app/index-lite.html',
    preloadFile: 'lite-app/preload-lite.js',
    windowConfig: {
      width: 500,
      height: 400,
      minWidth: 400,
      minHeight: 300
    },
    defaults: {
      autoPaste: true,
      enableLlm: false,
      manualRealtime: false
    }
  },
  live: {
    appName: '西瓜说 · 实时转写',
    htmlFile: 'live-transcribe-app/index.html',
    preloadFile: 'live-transcribe-app/preload.js',
    windowConfig: {
      width: 520,
      height: 640,
      minWidth: 440,
      minHeight: 520,
      resizable: true
    },
    defaults: {
      autoPaste: true,
      enableLlm: false,
      manualRealtime: false
    }
  },
  full: {
    appName: '西瓜说',
    htmlFile: 'index.html',
    preloadFile: 'preload.js',
    windowConfig: {
      width: 1200,
      height: 800
    },
    defaults: {
      autoPaste: false,
      enableLlm: true,
      manualRealtime: false
    }
  }
};

const currentConfig = MODE_CONFIG[APP_MODE] || MODE_CONFIG.full;

// 实时转写模块
const LiveTranscribeModule = require('./live-transcribe');

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
const APP_NAME = currentConfig.appName;

// LLM 配置
const LLM_CONFIG = {
  apiKey: 'sk-Frhn6R8bKvV54qDFOx4S7U2YT7tMTB4yFHHSkHIKuASSPrCk',
  apiUrl: 'https://next-api.fazhiplus.com/v1',
  model: 'deepseek-v3.1',
  systemPrompt: '你是一个AI语音助手，帮助用户处理输入的内容。输出用户的需求结果，不要包含任何多余的说明文字。'
};
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
let tray = null;
let forceQuit = false;
const PYTHON_NOT_FOUND_MESSAGE =
  '未找到可用的 Python3，请安装 Python3 或将 SPEECH_ASR_PYTHON 指向可执行文件';

function getResourceBase() {
  // 开发环境使用项目根目录，打包后使用资源目录
  return app.isPackaged ? process.resourcesPath : path.join(__dirname, '..');
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

  // 优先使用新的 Python 运行时（直接使用虚拟环境的 python3，不使用包装脚本）
  const runtimePython = app.isPackaged
    ? path.join(process.resourcesPath, 'python-runtime', 'bin', 'python3')
    : path.join(base, 'electron-app', 'python-runtime', 'bin', 'python3');

  if (fs.existsSync(runtimePython)) {
    cachedPythonPath = runtimePython;
    return runtimePython;
  }

  // 回退到旧的方式：PyInstaller 打包的单个可执行文件
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
    path.join(base, 'python-runtime', 'bin', 'python3'),
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

// 获取 Python ASR 脚本路径
function getPythonScriptPath() {
  const base = getResourceBase();
  return app.isPackaged
    ? path.join(process.resourcesPath, 'python-runtime', 'scripts', 'two_pass_microphone_asr_electron.py')
    : path.join(base, 'electron-app', 'python-runtime', 'scripts', 'two_pass_microphone_asr_electron.py');
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
  const wc = currentConfig.windowConfig;
  const preloadPath = path.join(__dirname, currentConfig.preloadFile);
  try {
    const exists = fs.existsSync(preloadPath);
    console.log(`[MainWindow] APP_MODE=${APP_MODE} preload: ${preloadPath} exists=${exists}`);
  } catch {
    // ignore
  }

  mainWindow = new BrowserWindow({
    width: wc.width || 1200,
    height: wc.height || 800,
    minWidth: wc.minWidth,
    minHeight: wc.minHeight,
    icon: getIconPath(),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: preloadPath
    },
    frame: false, // 无边框窗口
    titleBarStyle: 'customButtonsOnHover',
    title: APP_NAME,
    resizable: typeof wc.resizable === 'boolean' ? wc.resizable : APP_MODE === 'full'
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

  mainWindow.loadFile(currentConfig.htmlFile);

  // Forward renderer console logs to main process for debugging
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    const levelName = ['info', 'warn', 'error', 'debug', 'log'][level] || 'info';
    console.log(`[Renderer ${levelName}]`, message);
  });

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
  ensureTray();

  // 注册并启动实时转写模块
  LiveTranscribeModule.register({
    app,
    mainWindow,
    speechAsr,
    getResourceBase,
    getIconPath,
    getIconImage,
    resolveBundledPython,
    getPythonScriptPath,
    getModelPaths,
    getStreamingModelPaths,
    getPunctuationPaths,
    getVadPaths,
    onResult: (payload) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('live-transcribe-result', payload);
      }
    }
  });

  LiveTranscribeModule.start({ app });
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
  // 停止实时转写模块
  LiveTranscribeModule.stop();
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

// LLM API 调用
async function callLlmApi(text, prefix = null) {
  const url = new URL(`${LLM_CONFIG.apiUrl}/chat/completions`);

  // 获取当前时间
  const now = new Date();
  const timeString = now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

  // 在 system prompt 后面追加当前时间
  const systemPromptWithTime = `${LLM_CONFIG.systemPrompt}\n\n当前时间：${timeString}`;

  // 构建用户消息：如果有 prefix，将其作为上下文信息
  let userContent = text;
  if (prefix && prefix.trim()) {
    userContent = `【用户当前选中的文本】\n${prefix}\n\n【语音识别内容】\n${text}\n\n请根据上下文理解语音内容，并给出合适的回复。`;
  }

  const payload = {
    model: LLM_CONFIG.model,
    messages: [
      { role: 'system', content: systemPromptWithTime },
      { role: 'user', content: userContent }
    ]
  };

  console.log('[LLM] Calling API with text:', text.slice(0, 100));
  if (prefix) {
    console.log('[LLM] With prefix (selected text):', prefix.slice(0, 100));
  }

  return new Promise((resolve, reject) => {
    const https = require('https');
    const urlOptions = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LLM_CONFIG.apiKey}`
      }
    };

    const req = https.request(urlOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`LLM API 返回错误: ${res.statusCode} - ${data}`));
          return;
        }
        try {
          const json = JSON.parse(data);
          const content = json?.choices?.[0]?.message?.content || text;
          console.log('[LLM] Response:', content.slice(0, 100));
          resolve({ success: true, text: content });
        } catch (err) {
          reject(new Error(`LLM API 响应解析失败: ${err.message}`));
        }
      });
    });

    req.on('error', (err) => {
      reject(new Error(`LLM API 请求失败: ${err.message}`));
    });

    req.write(JSON.stringify(payload));
    req.end();
  });
}

// 处理 LLM 请求的 IPC
ipcMain.handle('llm-process', async (event, text, prefix = null) => {
  if (!text || !text.trim()) {
    return { success: false, message: '输入内容为空' };
  }

  try {
    const result = await callLlmApi(text, prefix);
    return result;
  } catch (error) {
    console.error('[LLM] Error:', error);
    return { success: false, message: error.message };
  }
});

// 获取当前选择的文本
ipcMain.handle('get-current-selection', async () => {
  const LiveTranscribeModule = require('./live-transcribe');
  const pttManager = LiveTranscribeModule.PttManager;
  const getCurrentSelection = pttManager && pttManager.getCurrentSelection;

  if (!getCurrentSelection) {
    console.log('[Selection] PTT Manager not available');
    return { success: false, message: 'PTT Manager 未初始化' };
  }

  try {
    console.log('[Selection] Attempting to get current selection...');
    const result = getCurrentSelection();
    console.log('[Selection] Result:', result);
    return result;
  } catch (error) {
    console.error('[Selection] Error:', error);
    return { success: false, message: error.message };
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
      workingDir: getResourceBase(),
      scriptPath: getPythonScriptPath()
    }
  };

  console.log('[main] runtime.manualRealtime (final):', runtime.manualRealtime);
  console.log('[main] buildLiveSessionRuntime END =====');
  return { success: true, runtime, punctuationReady, vadReady: Boolean(vadModelPath) };
}

// 获取当前模式的默认配置
ipcMain.handle('get-mode-defaults', async () => {
  return currentConfig.defaults;
});

// 获取当前应用模式
ipcMain.handle('get-app-mode', async () => {
  return { mode: APP_MODE, appName: currentConfig.appName };
});

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

// 实时转写相关函数现在由 live-transcribe 模块处理
// 这些旧的 handlers 已被移除到 live-transcribe/main/handlers.js

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
