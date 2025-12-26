/**
 * Live Transcribe Preload Script
 *
 * 向渲染进程暴露实时转写相关的 API
 */

const { contextBridge, ipcRenderer } = require('electron');

/**
 * 实时转写 API
 */
const liveTranscribeApi = {
  // === 模型管理 ===
  loadLiveModels: (payload) => ipcRenderer.invoke('live-load-models', payload),
  releaseLiveModels: () => ipcRenderer.invoke('live-release-models'),

  // === 实时采集控制 ===
  startLiveCapture: (payload) => ipcRenderer.invoke('live-start-capture', payload),
  stopLiveCapture: (payload) => ipcRenderer.invoke('live-stop-capture', payload),
  switchLiveDevice: (payload) => ipcRenderer.invoke('live-switch-device', payload),

  // === Push-to-Talk ===
  pushToTalkAsr: (arrayBuffer, mimeType) => ipcRenderer.invoke('push-to-talk-asr', arrayBuffer, mimeType),
  startPushToTalk: (options) => ipcRenderer.invoke('ptt-start', options),
  stopPushToTalk: () => ipcRenderer.invoke('ptt-stop'),
  endPushToTalkSession: () => ipcRenderer.invoke('ptt-end'),

  // === 事件监听 ===
  onLiveResult: (callback) => {
    ipcRenderer.on('live-transcribe-result', (event, payload) => callback(payload));
  },

  onGlobalPttStart: (callback) => {
    ipcRenderer.on('global-ptt:start', (event, payload) => callback(payload));
  },

  onGlobalPttStop: (callback) => {
    ipcRenderer.on('global-ptt:stop', (event, payload) => callback(payload));
  },

  // === Overlay 控制 ===
  updatePttOverlay: (payload) => ipcRenderer.send('ptt-overlay:update', payload),
  hidePttOverlay: () => ipcRenderer.send('ptt-overlay:hide'),
  armPttOverlay: (enabled) => ipcRenderer.send('ptt-overlay:arm', enabled),
  testPttOverlay: () => ipcRenderer.send('ptt-overlay:test'),

  // === 移除监听器 ===
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  }
};

/**
 * 将 API 暴露给渲染进程
 */
contextBridge.exposeInMainWorld('liveTranscribe', liveTranscribeApi);

/**
 * 导出供测试使用
 */
module.exports = { liveTranscribeApi };
