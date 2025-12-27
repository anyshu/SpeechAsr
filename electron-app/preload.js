const { contextBridge, ipcRenderer } = require('electron');

// 暴露API给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 文件操作
  selectAudioFile: () => ipcRenderer.invoke('select-audio-file'),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  
  // 音频处理
  processAudio: (audioFilePath, options) => ipcRenderer.invoke('process-audio', audioFilePath, options),
  
  // 事件监听
  onProcessingProgress: (callback) => ipcRenderer.on('processing-progress', callback),
  onProcessingError: (callback) => ipcRenderer.on('processing-error', callback),
  onModelDownloadProgress: (callback) => ipcRenderer.on('model-download-progress', callback),
  
  // 移除事件监听
  removeProcessingListeners: () => {
    ipcRenderer.removeAllListeners('processing-progress');
    ipcRenderer.removeAllListeners('processing-error');
  },
  removeModelListeners: () => {
    ipcRenderer.removeAllListeners('model-download-progress');
  },
  
  // 系统操作
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  showError: (title, content) => ipcRenderer.invoke('show-error', title, content),
  showMessage: (title, content) => ipcRenderer.invoke('show-message', title, content),
  pasteTextToFocusedInput: (text) => ipcRenderer.invoke('system-input:paste', text),
  replaceFirstPassWithSecond: (payload) => ipcRenderer.invoke('system-input:select-and-replace', payload),
  
  // 文件保存
  saveFile: (content, defaultName) => ipcRenderer.invoke('save-file', content, defaultName),
  
  // 窗口控制
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  closeWindow: () => ipcRenderer.invoke('close-window'),

  // 模型下载
  checkModel: () => ipcRenderer.invoke('check-model'),
  downloadModel: () => ipcRenderer.invoke('download-model'),
  openModelFolder: () => ipcRenderer.invoke('open-model-folder'),
  checkPunctuationModel: () => ipcRenderer.invoke('check-punctuation-model'),
  downloadPunctuationModel: () => ipcRenderer.invoke('download-punctuation-model'),
  openPunctuationFolder: () => ipcRenderer.invoke('open-punctuation-folder'),
  checkStreamingModel: () => ipcRenderer.invoke('check-streaming-model'),
  downloadStreamingModel: () => ipcRenderer.invoke('download-streaming-model'),
  openStreamingFolder: () => ipcRenderer.invoke('open-streaming-folder'),
  checkVadModel: () => ipcRenderer.invoke('check-vad-model'),
  downloadVadModel: () => ipcRenderer.invoke('download-vad-model'),
  openVadFolder: () => ipcRenderer.invoke('open-vad-folder'),

  // 录音保存
  saveRecording: (arrayBuffer, extension) => ipcRenderer.invoke('save-recording', arrayBuffer, extension),

  // 实时转写
  startLiveTranscribe: (options) => ipcRenderer.invoke('start-live-transcribe', options),
  stopLiveTranscribe: () => ipcRenderer.invoke('stop-live-transcribe'),
  pushLiveChunk: (arrayBuffer, mimeType) => ipcRenderer.invoke('push-live-chunk', arrayBuffer, mimeType),
  pushToTalkAsr: (arrayBuffer, mimeType) => ipcRenderer.invoke('push-to-talk-asr', arrayBuffer, mimeType),
  startPushToTalk: (options) => ipcRenderer.invoke('ptt-start', options),
  stopPushToTalk: () => ipcRenderer.invoke('ptt-stop'),
  endPushToTalkSession: () => ipcRenderer.invoke('ptt-end'),
  loadLiveModels: (payload) => ipcRenderer.invoke('live-load-models', payload),
  releaseLiveModels: () => ipcRenderer.invoke('live-release-models'),
  startLiveCapture: (payload) => ipcRenderer.invoke('live-start-capture', payload),
  stopLiveCapture: (payload) => ipcRenderer.invoke('live-stop-capture', payload),
  switchLiveDevice: (payload) => ipcRenderer.invoke('live-switch-device', payload),
  onLiveResult: (callback) => ipcRenderer.on('live-transcribe-result', callback),
  onGlobalPttStart: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('global-ptt:start', listener);
    return () => ipcRenderer.removeListener('global-ptt:start', listener);
  },
  onGlobalPttStop: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('global-ptt:stop', listener);
    return () => ipcRenderer.removeListener('global-ptt:stop', listener);
  },
  updatePttOverlay: (payload) => ipcRenderer.send('ptt-overlay:update', payload),
  hidePttOverlay: () => ipcRenderer.send('ptt-overlay:hide'),
  armPttOverlay: (enabled) => ipcRenderer.send('ptt-overlay:arm', enabled),
  onPunctuationModelDownloadProgress: (callback) => ipcRenderer.on('punctuation-download-progress', callback),
  onStreamingModelDownloadProgress: (callback) => ipcRenderer.on('streaming-download-progress', callback),
  onVadModelDownloadProgress: (callback) => ipcRenderer.on('vad-download-progress', callback),
  getMicPermissionStatus: () => ipcRenderer.invoke('mic-permission-status'),
  requestMicPermission: () => ipcRenderer.invoke('mic-permission-request'),

  // LLM API
  llmProcess: (text, prefix) => ipcRenderer.invoke('llm-process', text, prefix),
  getCurrentSelection: () => ipcRenderer.invoke('get-current-selection'),

  // Personas
  getPersonas: () => ipcRenderer.invoke('persona:list'),
  savePersonas: (payload) => ipcRenderer.invoke('persona:set', payload),
  setActivePersona: (id) => ipcRenderer.invoke('persona:set-active', id),
  onPersonaUpdated: (callback) => {
    const handler = (_event, payload) => callback(payload || {});
    ipcRenderer.on('persona-updated', handler);
    return () => ipcRenderer.removeListener('persona-updated', handler);
  }
}); 
