/**
 * IPC Handlers
 *
 * 注册所有实时转写相关的 IPC handlers
 * 从 main.js 迁移而来
 */

const { ipcMain } = require('electron');

// 外部依赖（从其他模块导入）
let speechAsrWrapper = null;
let overlayManager = null;
let mainWindow = null;

/**
 * 初始化配置
 */
function init(options) {
  speechAsrWrapper = options.speechAsrWrapper;
  overlayManager = options.overlayManager;
  mainWindow = options.mainWindow;
}

/**
 * 发送实时转写结果到渲染进程
 */
function sendLiveResult(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('live-transcribe-result', payload);
  }
}

/**
 * 注册实时模型相关 handlers
 */
function registerLiveModelHandlers() {
  const VAD_MODEL_URL = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad_v5.onnx';

  // 延迟导入以避免循环依赖
  const speechAsrWrapper = require('./speech-asr-wrapper');
  const overlayManager = require('./overlay-manager');

  ipcMain.handle('live-load-models', async (_event, payload = {}) => {
    const mode = payload?.mode === 'manual' ? 'manual' : 'auto';
    console.log('===== [LiveTranscribe] live-load-models START =====');
    console.log('[LiveTranscribe] payload.mode:', payload?.mode);
    console.log('[LiveTranscribe] normalized mode:', mode);
    console.log('[LiveTranscribe] payload.manualRealtime:', payload?.manualRealtime);
    console.log('[LiveTranscribe] payload.micName:', payload?.micName);
    console.log('[LiveTranscribe] payload.numThreads:', payload?.numThreads);

    const loadResult = await speechAsrWrapper.loadLiveModels(payload);
    if (!loadResult.success) {
      console.log('[LiveTranscribe] loadLiveModels failed:', loadResult.message);
      return loadResult;
    }

    const { mode: loadedMode, punctuationReady, vadReady } = loadResult;
    sendLiveResult({ type: 'log', message: `模式: ${loadedMode}` });

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

    sendLiveResult({
      type: 'log',
      message: mode === 'manual' ? '按键模式模型已加载，等待按键开始录音' : '自动模式模型已加载，点击开始录音'
    });

    return loadResult;
  });

  ipcMain.handle('live-release-models', async () => {
    try {
      const result = await speechAsrWrapper.releaseLiveModels();
      overlayManager.hideOverlay(true);
      return result;
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('live-start-capture', async (_event, payload = {}) => {
    const mode = payload?.mode === 'manual' ? 'manual' : 'auto';
    console.log('===== [LiveTranscribe] live-start-capture START =====');
    console.log('[LiveTranscribe] payload.mode:', payload?.mode);
    console.log('[LiveTranscribe] normalized mode:', mode);
    console.log('[LiveTranscribe] payload.manualRealtime:', payload?.manualRealtime);
    console.log('[LiveTranscribe] payload.micName:', payload?.micName);

    const startResult = await speechAsrWrapper.startLiveCapture(payload);
    return startResult;
  });

  ipcMain.handle('live-stop-capture', async (_event, payload = {}) => {
    return await speechAsrWrapper.stopLiveCapture(payload);
  });

  ipcMain.handle('live-switch-device', async (_event, payload) => {
    const target = payload?.micName || payload?.device || payload?.index || '';
    return await speechAsrWrapper.switchDevice(target);
  });
}

/**
 * 注册 PTT 相关 handlers
 */
function registerPttHandlers() {
  // 延迟导入
  const speechAsrWrapper = require('./speech-asr-wrapper');

  // PTT 单次转写（音频文件）
  ipcMain.handle('push-to-talk-asr', async (_event, arrayBuffer, mimeType) => {
    return await speechAsrWrapper.pushToTalkAsr(arrayBuffer, mimeType);
  });

  // PTT 启动（按键录音模式）
  ipcMain.handle('ptt-start', async (_event, options) => {
    const mode = 'manual';
    const payload = {
      mode,
      manualRealtime: options?.manualRealtime || false,
      micName: options?.micName,
      vad: options?.vad
    };

    const result = await speechAsrWrapper.startLiveCapture(payload);
    return result;
  });

  // PTT 停止
  ipcMain.handle('ptt-stop', async (_event, payload) => {
    const stopPayload = {
      mode: 'manual',
      source: payload?.source || 'key-up'
    };
    return await speechAsrWrapper.stopLiveCapture(stopPayload);
  });

  // PTT 结束会话
  ipcMain.handle('ptt-end', async () => {
    try {
      const speechAsr = speechAsrWrapper.getSpeechAsr();
      if (speechAsr) {
        return await speechAsr.stopManualSession();
      }
      return { success: false, message: 'SpeechASR 未初始化' };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });
}

/**
 * 注册 Overlay 相关 handlers
 */
function registerOverlayHandlers() {
  // 延迟导入
  const overlayManager = require('./overlay-manager');

  ipcMain.on('ptt-overlay:update', (_event, payload) => {
    if (!payload) return;
    const { state, message, hint, autoHideMs, lock } = payload;

    if (state === 'idle') {
      overlayManager.hideOverlay(true);
      return;
    }

    if (state === 'recording') {
      // 如果已有计时器在运行，只更新消息缓存
      const stateInfo = overlayManager.getState();
      if (stateInfo.hasTimer) {
        // 只更新缓存的消息（通过重新调用 startOverlayTimer）
        overlayManager.startOverlayTimer(message, hint, Boolean(lock));
        return;
      }

      // 启动新计时器
      overlayManager.startOverlayTimer(message, hint, Boolean(lock));
      return;
    }

    overlayManager.updateOverlay(state || 'recording', message, hint, {
      autoHideMs,
      lock: Boolean(lock)
    });
  });

  ipcMain.on('ptt-overlay:hide', () => {
    overlayManager.hideOverlay();
  });

  ipcMain.on('ptt-overlay:arm', (_event, enabled) => {
    overlayManager.setOverlayArmed(Boolean(enabled));
  });

  ipcMain.on('ptt-overlay:test', () => {
    const now = Date.now();
    const formatted = overlayManager.formatDurationMs(0);
    overlayManager.sendOverlayPayload({
      state: 'recording',
      message: `测试 overlay ${now}`,
      hint: `按键录音 ${formatted}`
    });
  });
}

/**
 * 注册所有 handlers
 */
function registerAll() {
  registerLiveModelHandlers();
  registerPttHandlers();
  registerOverlayHandlers();
  console.log('[LiveTranscribe] All IPC handlers registered');
}

module.exports = {
  init,
  registerLiveModelHandlers,
  registerPttHandlers,
  registerOverlayHandlers,
  registerAll
};
