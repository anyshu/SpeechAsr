const { contextBridge, ipcRenderer } = require('electron');

console.log('[live-preload] start');

// 暴露实时转写 API（来自 live-transcribe 模块）
let liveTranscribeApi = null;
try {
  const mod = require('../live-transcribe/preload/index.js');
  liveTranscribeApi = mod?.liveTranscribeApi || null;
  console.log('[live-preload] liveTranscribeApi loaded', Boolean(liveTranscribeApi));
} catch (err) {
  console.error('[live-preload] failed to load liveTranscribe preload', err);
}

// 如果未能加载模块，使用本地后备实现，避免渲染层拿不到 API
if (!liveTranscribeApi) {
  console.warn('[live-preload] using local fallback liveTranscribeApi');
  liveTranscribeApi = {
    loadLiveModels: (payload) => ipcRenderer.invoke('live-load-models', payload),
    releaseLiveModels: () => ipcRenderer.invoke('live-release-models'),
    startLiveCapture: (payload) => ipcRenderer.invoke('live-start-capture', payload),
    stopLiveCapture: (payload) => ipcRenderer.invoke('live-stop-capture', payload),
    switchLiveDevice: (payload) => ipcRenderer.invoke('live-switch-device', payload),
    pushToTalkAsr: (arrayBuffer, mimeType) => ipcRenderer.invoke('push-to-talk-asr', arrayBuffer, mimeType),
    startPushToTalk: (options) => ipcRenderer.invoke('ptt-start', options),
    stopPushToTalk: () => ipcRenderer.invoke('ptt-stop'),
    endPushToTalkSession: () => ipcRenderer.invoke('ptt-end'),
    onLiveResult: (callback) => {
      ipcRenderer.on('live-transcribe-result', (_event, payload) => callback(payload));
    },
    onGlobalPttStart: (callback) => {
      ipcRenderer.on('global-ptt:start', (_event, payload) => callback(payload));
    },
    onGlobalPttStop: (callback) => {
      ipcRenderer.on('global-ptt:stop', (_event, payload) => callback(payload));
    },
    updatePttOverlay: (payload) => ipcRenderer.send('ptt-overlay:update', payload),
    hidePttOverlay: () => ipcRenderer.send('ptt-overlay:hide'),
    armPttOverlay: (enabled) => ipcRenderer.send('ptt-overlay:arm', enabled),
    removeAllListeners: (channel) => {
      ipcRenderer.removeAllListeners(channel);
    }
  };
}

// 再显式暴露一次，避免 require 被 Tree-Shake 时遗漏
contextBridge.exposeInMainWorld('liveTranscribe', liveTranscribeApi);

const liveAppApi = {
  // 权限
  getMicPermissionStatus: () => ipcRenderer.invoke('mic-permission-status'),
  requestMicPermission: () => ipcRenderer.invoke('mic-permission-request'),

  // 模型检测
  checkModel: () => ipcRenderer.invoke('check-model'),
  checkStreamingModel: () => ipcRenderer.invoke('check-streaming-model'),
  checkPunctuationModel: () => ipcRenderer.invoke('check-punctuation-model'),
  checkVadModel: () => ipcRenderer.invoke('check-vad-model'),

  // 模型下载
  downloadModel: () => ipcRenderer.invoke('download-model'),
  downloadStreamingModel: () => ipcRenderer.invoke('download-streaming-model'),
  downloadPunctuationModel: () => ipcRenderer.invoke('download-punctuation-model'),
  downloadVadModel: () => ipcRenderer.invoke('download-vad-model'),

  // 下载进度
  onModelProgress: (callback) => {
    const handler = (_event, payload) => callback(payload || {});
    ipcRenderer.on('model-download-progress', handler);
    return () => ipcRenderer.removeListener('model-download-progress', handler);
  },
  onPunctuationProgress: (callback) => {
    const handler = (_event, payload) => callback(payload || {});
    ipcRenderer.on('punctuation-download-progress', handler);
    return () => ipcRenderer.removeListener('punctuation-download-progress', handler);
  },
  onStreamingProgress: (callback) => {
    const handler = (_event, payload) => callback(payload || {});
    ipcRenderer.on('streaming-download-progress', handler);
    return () => ipcRenderer.removeListener('streaming-download-progress', handler);
  },
  onVadProgress: (callback) => {
    const handler = (_event, payload) => callback(payload || {});
    ipcRenderer.on('vad-download-progress', handler);
    return () => ipcRenderer.removeListener('vad-download-progress', handler);
  },

  // 系统输入
  pasteTextToFocusedInput: (text) => ipcRenderer.invoke('system-input:paste', text),
  replaceFirstPassWithSecond: (payload) => ipcRenderer.invoke('system-input:select-and-replace', payload),

  // 其他状态
  getModeDefaults: () => ipcRenderer.invoke('get-mode-defaults'),
  getAppMode: () => ipcRenderer.invoke('get-app-mode'),
  getCurrentSelection: () => ipcRenderer.invoke('get-current-selection')
};

contextBridge.exposeInMainWorld('liveApp', liveAppApi);

console.log('[live-preload] ready');

process.on('uncaughtException', (err) => {
  console.error('[live-preload] uncaughtException', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[live-preload] unhandledRejection', reason);
});

module.exports = { liveAppApi };
