/**
 * Overlay Manager
 *
 * 管理 PTT 悬浮窗口，显示录音状态和实时结果
 * 从 main.js 迁移而来
 */

const { BrowserWindow, screen, nativeImage } = require('electron');
const path = require('path');

// Overlay 状态
let overlayWindow = null;
let overlayHideTimer = null;
let overlayPendingPayload = null;
let overlayArmed = false;
let overlayTimer = null;
let overlayStartTime = 0;
let overlayLocked = false;
let overlayMessageCache = '';

/**
 * 获取配置
 */
let config = {
  getIconPath: null,
  getIconImage: null
};

/**
 * 初始化配置
 */
function init(options) {
  config = { ...config, ...options };
}

/**
 * 获取图标路径
 */
function getIconPath() {
  return config.getIconPath ? config.getIconPath() : path.join(__dirname, '../assets/ok.png');
}

/**
 * 获取图标图片
 */
function getIconImage() {
  if (config.getIconImage) return config.getIconImage();

  const iconPath = getIconPath();
  return nativeImage.createFromPath(iconPath);
}

/**
 * 确保 Overlay 窗口存在
 */
function ensureOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    console.log('[LiveTranscribe] Reusing existing overlay window');
    return overlayWindow;
  }

  console.log('[LiveTranscribe] Creating new overlay window...');

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
      preload: path.join(__dirname, '../preload/overlay.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });

  const overlayHtmlPath = path.join(__dirname, '../assets/ptt-overlay.html');
  console.log('[LiveTranscribe] Loading overlay HTML from:', overlayHtmlPath);
  overlayWindow.loadFile(overlayHtmlPath).catch((err) => {
    console.error('[LiveTranscribe] Failed to load overlay window', err);
  });

  overlayWindow.webContents.on('did-finish-load', () => {
    console.log('[LiveTranscribe] Overlay window did-finish-load');
    positionOverlayWindow();
    if (overlayPendingPayload) {
      overlayWindow.webContents.send('overlay:update', overlayPendingPayload);
      overlayPendingPayload = null;
    }
  });

  // Forward renderer console logs to main process for debugging
  overlayWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    const levelName = ['info', 'warn', 'error', 'debug', 'log'][level] || 'info';
    console.log(`[Overlay Renderer ${levelName}]`, message);
  });

  overlayWindow.on('closed', () => {
    console.log('[LiveTranscribe] Overlay window closed');
    overlayWindow = null;
    overlayPendingPayload = null;
    clearTimeout(overlayHideTimer);
  });

  console.log('[LiveTranscribe] Overlay window created successfully');
  return overlayWindow;
}

/**
 * 定位 Overlay 窗口
 */
function positionOverlayWindow() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;

  const bounds = overlayWindow.getBounds();
  const display = screen.getPrimaryDisplay();
  const workArea = display?.workArea || display?.bounds;

  const x = Math.round(workArea.x + (workArea.width - bounds.width) / 2);
  const y = Math.round(workArea.y + workArea.height - bounds.height - 20);

  overlayWindow.setPosition(x, y);
}

/**
 * 发送 Overlay 消息
 */
function sendOverlayPayload(payload) {
  const win = ensureOverlayWindow();
  if (!win || win.isDestroyed()) return;

  if (win.webContents.isLoading()) {
    overlayPendingPayload = payload;
    return;
  }

  overlayPendingPayload = null;
  try {
    console.log('[LiveTranscribe] Sending overlay payload:', payload);
    win.webContents.send('overlay:update', payload);
  } catch (err) {
    console.warn('[LiveTranscribe] Failed to send overlay payload', err);
  }
}

/**
 * 更新 Overlay 状态
 */
function updateOverlay(state = 'recording', message, hint, options = {}) {
  const { autoHideMs, lock = false } = options || {};
  const win = ensureOverlayWindow();
  if (!win || win.isDestroyed()) {
    console.warn('[LiveTranscribe] updateOverlay: window not available');
    return;
  }

  console.log('[LiveTranscribe] updateOverlay:', { state, message, hint, options });

  overlayLocked = lock || overlayLocked;
  clearTimeout(overlayHideTimer);
  positionOverlayWindow();
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  sendOverlayPayload({ state, message, hint });
  win.showInactive();
  console.log('[LiveTranscribe] overlay window shown, bounds:', win.getBounds());

  if (autoHideMs && Number.isFinite(autoHideMs)) {
    overlayHideTimer = setTimeout(() => hideOverlay(), autoHideMs);
  }
}

/**
 * 隐藏 Overlay
 */
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

/**
 * 启动 Overlay 计时器
 */
function startOverlayTimer(message, hint, lock) {
  stopOverlayTimer();
  overlayLocked = lock || overlayLocked;
  overlayStartTime = Date.now();
  // Cache the message so renderer can update it while timer runs
  overlayMessageCache = message || '';
  console.log('[LiveTranscribe] startOverlayTimer initialized with:', { message, hint, overlayMessageCache });

  const tick = () => {
    const elapsed = Date.now() - overlayStartTime;
    const formatted = formatDurationMs(elapsed);
    const durationHint = `按键录音 ${formatted}`;
    // Send one-pass text in `message` and duration label in `hint`.
    console.log('[LiveTranscribe] tick sending:', { overlayMessageCache, durationHint });
    updateOverlay('recording', overlayMessageCache || '', durationHint, { lock: true });
  };

  tick();
  overlayTimer = setInterval(tick, 50);
}

/**
 * 停止 Overlay 计时器
 */
function stopOverlayTimer() {
  if (overlayTimer) {
    clearInterval(overlayTimer);
    overlayTimer = null;
  }
}

/**
 * 格式化持续时间
 */
function formatDurationMs(ms) {
  const clamped = Math.max(0, Math.floor(ms));
  const minutes = Math.floor(clamped / 60000);
  const seconds = Math.floor((clamped % 60000) / 1000);
  const millis = clamped % 1000;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

/**
 * 设置 Overlay 武装状态
 */
function setOverlayArmed(enabled) {
  overlayArmed = Boolean(enabled);
  if (!overlayArmed) {
    overlayLocked = false;
    if (overlayWindow) {
      hideOverlay(true);
    }
  }
}

/**
 * 清理资源
 */
function cleanup() {
  stopOverlayTimer();
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.destroy();
  }
  overlayWindow = null;
  overlayPendingPayload = null;
  overlayArmed = false;
  overlayLocked = false;
  overlayMessageCache = '';
}

module.exports = {
  init,
  ensureOverlayWindow,
  positionOverlayWindow,
  sendOverlayPayload,
  updateOverlay,
  hideOverlay,
  startOverlayTimer,
  stopOverlayTimer,
  setOverlayArmed,
  formatDurationMs,
  cleanup,
  // 导出状态供测试
  getState: () => ({
    hasWindow: overlayWindow !== null,
    isArmed: overlayArmed,
    isLocked: overlayLocked,
    hasTimer: overlayTimer !== null
  })
};
