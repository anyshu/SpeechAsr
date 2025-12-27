/**
 * Live Transcribe Module - Main Entry Point
 *
 * 实时转写模块入口，负责：
 * 1. 注册所有 IPC Handlers
 * 2. 初始化 Overlay 窗口
 * 3. 设置全局 PTT Hook
 * 4. 管理 SpeechASR 实例
 */

const { screen } = require('electron');

// 模块状态
let isInitialized = false;
let isStarted = false;

// 配置
let config = {
  getResourceBase: null,
  getIconPath: null,
  getIconImage: null,
  resolveBundledPython: null,
  getPythonScriptPath: null,
  getModelPaths: null,
  getStreamingModelPaths: null,
  getPunctuationPaths: null,
  getVadPaths: null,
  // PTT 配置
  ptt: {
    uniKey: 'Alt',        // 触发键
    vkCodes: process.platform === 'darwin' ? [58] : [], // 默认监听左侧 Option
    minHoldMs: 180,       // 最小按住时间
    label: 'Option'
  }
};

/**
 * 初始化模块
 */
function init(options) {
  if (isInitialized) {
    console.warn('[LiveTranscribe] Already initialized');
    return;
  }

  // 保存外部 SpeechASR 实例到 config
  const optionsWithExternalAsr = {
    ...options,
    externalSpeechAsr: options.speechAsr
  };

  config = { ...config, ...optionsWithExternalAsr };

  // 初始化各个子模块
  const overlayManager = require('./main/overlay-manager');
  overlayManager.init({
    getIconPath: config.getIconPath,
    getIconImage: config.getIconImage
  });

  const pttManager = require('./main/ptt-manager');
  pttManager.init({
    mainWindow: options.mainWindow,
    speechAsr: options.speechAsr,
    overlayManager,
    triggerConfig: config.ptt
  });

  const speechAsrWrapper = require('./main/speech-asr-wrapper');
  speechAsrWrapper.init(config);

  // 设置结果回调
  speechAsrWrapper.setResultCallbacks({
    onResult: options.onResult || ((payload) => {
      if (options.mainWindow && !options.mainWindow.isDestroyed()) {
        options.mainWindow.webContents.send('live-transcribe-result', payload);
      }
    })
  });

  // 如果 SpeechASR 已存在（从 main.js 传入），使用它
  if (options.speechAsr) {
    speechAsrWrapper.initSpeechAsr({
      getResourceBase: config.getResourceBase,
      resolveBundledPython: config.resolveBundledPython,
      sampleRate: options.sampleRate || 16000,
      bufferSize: options.bufferSize || 1600
    });
  }

  isInitialized = true;
  console.log('[LiveTranscribe] Module initialized');
}

/**
 * 注册 IPC Handlers
 */
function registerHandlers() {
  if (!isInitialized) {
    throw new Error('[LiveTranscribe] Module not initialized');
  }

  // 获取子模块
  const speechAsrWrapper = require('./main/speech-asr-wrapper');
  const overlayManager = require('./main/overlay-manager');
  const pttManager = require('./main/ptt-manager');

  // 导入并初始化 handlers
  const { registerAll } = require('./main/handlers');
  registerAll();

  console.log('[LiveTranscribe] IPC handlers registered');
}

/**
 * 启动模块
 */
function start(options = {}) {
  if (!isInitialized) {
    throw new Error('[LiveTranscribe] Module not initialized');
  }
  if (isStarted) {
    console.warn('[LiveTranscribe] Already started');
    return;
  }

  const overlayManager = require('./main/overlay-manager');
  const pttManager = require('./main/ptt-manager');

  // 确保 Overlay 窗口存在
  overlayManager.ensureOverlayWindow();

  // 设置全局 PTT Hook
  pttManager.setupGlobalPttHook(options.app);

  // 监听屏幕变化，重新定位 Overlay
  screen.on('display-metrics-changed', () => {
    overlayManager.positionOverlayWindow();
  });
  screen.on('display-added', () => {
    overlayManager.positionOverlayWindow();
  });
  screen.on('display-removed', () => {
    overlayManager.positionOverlayWindow();
  });

  isStarted = true;
  console.log('[LiveTranscribe] Module started');
}

/**
 * 停止模块
 */
function stop() {
  const pttManager = require('./main/ptt-manager');
  const overlayManager = require('./main/overlay-manager');

  // 清理 PTT Hook
  pttManager.cleanup();

  // 隐藏并清理 Overlay
  overlayManager.cleanup();

  isStarted = false;
  console.log('[LiveTranscribe] Module stopped');
}

/**
 * 注册模块（主进程调用）
 */
function register(options) {
  init(options);
  registerHandlers();
  return { start, stop };
}

/**
 * 获取模块状态
 */
function getState() {
  const overlayManager = require('./main/overlay-manager');
  const pttManager = require('./main/ptt-manager');
  const speechAsrWrapper = require('./main/speech-asr-wrapper');

  const overlayState = overlayManager.getState();
  const pttState = pttManager.getState();

  return {
    isInitialized,
    isStarted,
    hasOverlay: overlayState.hasWindow,
    overlayLocked: overlayState.isLocked,
    hasPttHook: pttState.hasHook,
    isRecordingActive: pttState.isRecordingActive,
    hasSpeechAsr: speechAsrWrapper.getSpeechAsr() !== null
  };
}

module.exports = {
  register,
  init,
  start,
  stop,
  getState,
  // 导出内部模块供高级使用
  OverlayManager: require('./main/overlay-manager'),
  PttManager: require('./main/ptt-manager'),
  SpeechAsrWrapper: require('./main/speech-asr-wrapper')
};
