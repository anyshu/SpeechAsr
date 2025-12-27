// 复用实时转写小窗的 preload，确保 API 一致
try {
  // 直接执行 live-transcribe 的 preload，以便暴露相同的 API
  // eslint-disable-next-line import/no-unresolved
  module.exports = require('../live-transcribe-app/preload.js');
  console.log('[lite-preload] live-transcribe preload 已复用');
} catch (err) {
  console.warn('[lite-preload] 复用 live-preload 失败，使用回退实现', err);
  const { contextBridge, ipcRenderer } = require('electron');

  const liveTranscribeApi = {
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

  contextBridge.exposeInMainWorld('liveTranscribe', liveTranscribeApi);

  const liveAppApi = {
    getMicPermissionStatus: () => ipcRenderer.invoke('mic-permission-status'),
    requestMicPermission: () => ipcRenderer.invoke('mic-permission-request'),
    openPrivacySettings: (kind) => ipcRenderer.invoke('open-privacy-settings', kind),
    checkModel: () => ipcRenderer.invoke('check-model'),
    checkStreamingModel: () => ipcRenderer.invoke('check-streaming-model'),
    checkPunctuationModel: () => ipcRenderer.invoke('check-punctuation-model'),
    checkVadModel: () => ipcRenderer.invoke('check-vad-model'),
    downloadModel: () => ipcRenderer.invoke('download-model'),
    downloadStreamingModel: () => ipcRenderer.invoke('download-streaming-model'),
    downloadPunctuationModel: () => ipcRenderer.invoke('download-punctuation-model'),
    downloadVadModel: () => ipcRenderer.invoke('download-vad-model'),
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
    pasteTextToFocusedInput: (text) => ipcRenderer.invoke('system-input:paste', text),
    replaceFirstPassWithSecond: (payload) => ipcRenderer.invoke('system-input:select-and-replace', payload),
    llmProcess: (text, prefix) => ipcRenderer.invoke('llm-process', text, prefix),
    getModeDefaults: () => ipcRenderer.invoke('get-mode-defaults'),
    getAppMode: () => ipcRenderer.invoke('get-app-mode'),
    getCurrentSelection: () => ipcRenderer.invoke('get-current-selection'),
    getHistory: (limit) => ipcRenderer.invoke('history:list', limit),
    addHistory: (entry) => ipcRenderer.invoke('history:add', entry),
    getUsageStats: () => ipcRenderer.invoke('usage:get'),
    setUsageStats: (stats) => ipcRenderer.invoke('usage:set', stats),
    openModelFolder: () => ipcRenderer.invoke('model:open-folder'),
    startupComplete: () => ipcRenderer.invoke('startup:complete'),

    // Personas
    getPersonas: () => ipcRenderer.invoke('persona:list'),
    savePersonas: (payload) => ipcRenderer.invoke('persona:set', payload),
    setActivePersona: (id) => ipcRenderer.invoke('persona:set-active', id),
    onPersonaUpdated: (callback) => {
      const handler = (_event, payload) => callback(payload || {});
      ipcRenderer.on('persona-updated', handler);
      return () => ipcRenderer.removeListener('persona-updated', handler);
    }
  };

  contextBridge.exposeInMainWorld('liveApp', liveAppApi);

  module.exports = { liveAppApi };
}
