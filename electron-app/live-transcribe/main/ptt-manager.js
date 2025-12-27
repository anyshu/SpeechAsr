/**
 * PTT Manager
 *
 * 管理全局按键监听，处理 Push-to-Talk 功能
 * 从 main.js 迁移而来
 */

const SelectionHook = require('selection-hook');

// PTT 状态
let globalPttHook = null;
let isRecordingActive = false;
let lastTriggerDownTs = 0;
let recordingStartTs = 0;
let recordingWatchdog = null;

// 配置
const DEFAULT_TRIGGER_CONFIG = {
  uniKey: 'Alt', // 左侧 Option
  vkCodes: process.platform === 'darwin' ? [58] : [], // macOS 左侧 Option 键 vkCode = 58
  label: 'Option'
};
const MAX_RECORDING_MS = 8000; // 保护性超时，防止 key-up 丢失

// 外部依赖（由主应用注入）
let mainWindow = null;
let speechAsr = null;
let overlayManager = null;
let triggerConfig = { ...DEFAULT_TRIGGER_CONFIG };

function normalizeTriggerConfig(config = {}) {
  const normalizedVkCodes =
    Array.isArray(config.vkCodes) && config.vkCodes.length
      ? config.vkCodes.filter((code) => typeof code === 'number')
      : undefined;

  const normalizedUniKey =
    typeof config.uniKey === 'string' || config.uniKey === null ? config.uniKey : undefined;

  return {
    ...DEFAULT_TRIGGER_CONFIG,
    ...config,
    uniKey: normalizedUniKey !== undefined ? normalizedUniKey : DEFAULT_TRIGGER_CONFIG.uniKey,
    vkCodes: normalizedVkCodes !== undefined ? normalizedVkCodes : DEFAULT_TRIGGER_CONFIG.vkCodes
  };
}

/**
 * 初始化配置
 */
function init(options) {
  mainWindow = options.mainWindow;
  speechAsr = options.speechAsr;
  overlayManager = options.overlayManager;

  if (options?.triggerConfig || options?.pttConfig) {
    triggerConfig = normalizeTriggerConfig(options.triggerConfig || options.pttConfig);
  } else {
    triggerConfig = { ...DEFAULT_TRIGGER_CONFIG };
  }
}

function clearRecordingWatchdog() {
  if (recordingWatchdog) {
    clearTimeout(recordingWatchdog);
    recordingWatchdog = null;
  }
}

function startRecordingWatchdog(isToggleMode) {
  clearRecordingWatchdog();
  recordingWatchdog = setTimeout(() => {
    console.warn('[Push-to-Talk] Watchdog firing, forcing stop');
    safeStopRecording(isToggleMode ? { manualRealtime: true } : { manualRealtime: false, source: 'watchdog' });
  }, MAX_RECORDING_MS);
}

function safeStopRecording(payload = {}) {
  if (!isRecordingActive) return;
  isRecordingActive = false;
  clearRecordingWatchdog();
  if (overlayManager) {
    overlayManager.setOverlayArmed(false);
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('global-ptt:stop', payload);
  }
}

/**
 * 检查是否是触发键
 */
function isTriggerKey(event) {
  if (!event) return false;

  const matchUniKey =
    typeof triggerConfig.uniKey === 'string' && triggerConfig.uniKey
      ? event.uniKey === triggerConfig.uniKey
      : false;

  const matchVkCode =
    Array.isArray(triggerConfig.vkCodes) && triggerConfig.vkCodes.length && typeof event.vkCode === 'number'
      ? triggerConfig.vkCodes.includes(event.vkCode)
      : false;

  return matchUniKey || matchVkCode;
}

/**
 * 检查是否使用 toggle 模式
 */
function isToggleMode() {
  return speechAsr && speechAsr.isManual && speechAsr.isManual() && speechAsr.activeOptions?.manualRealtime === true;
}

/**
 * 设置全局 PTT Hook
 */
function setupGlobalPttHook(app) {
  // 如果已经初始化，直接返回
  if (globalPttHook) {
    console.log('[Push-to-Talk] Hook already initialized, returning existing');
    return globalPttHook;
  }

  console.log('[Push-to-Talk] Initializing SelectionHook...');

  try {
    globalPttHook = new SelectionHook();
  } catch (err) {
    console.warn('[Push-to-Talk] Failed to init selection-hook:', err?.message || err);
    return null;
  }

  const started = globalPttHook.start({
    enableClipboard: false  // 实时转写模式不需要获取其他应用选中文本，设为 false 避免 clipboard 操作干扰按键事件
  });

  if (!started) {
    console.warn('[Push-to-Talk] selection-hook failed to start');
    globalPttHook = null;
    return null;
  }

  console.log('[Push-to-Talk] SelectionHook started successfully');

  // 按键按下处理
  globalPttHook.on('key-down', (event) => {
    if (!isTriggerKey(event)) return;

    console.log('[Push-to-Talk] key-down event detected');
    const toggleMode = isToggleMode();
    if (toggleMode) {
      // Toggle 模式：在 key-up 时处理（完整的 down & up 算一次点击）
      // 这里只记录时间，不执行任何操作
      lastTriggerDownTs = Date.now();
      return;
    }

    // 传统模式：down 时开始录音；如果已在录音，视为补偿性的 stop
    if (isRecordingActive) {
      console.warn('[Push-to-Talk] key-down while already recording, forcing stop');
      safeStopRecording({ manualRealtime: false, source: 'double-down' });
      return;
    }
    lastTriggerDownTs = Date.now();
    isRecordingActive = true;
    recordingStartTs = Date.now();
    //用来做保护性超时，防止 key-up 丢失，内置是8秒钟
    //有待优化为可配置
    //startRecordingWatchdog(false);

    console.log('[Push-to-Talk] Calling updateOverlay with recording state');
    if (overlayManager) {
      overlayManager.updateOverlay('recording', '正在录音...', '松开设定按键以结束', { lock: true });
    } else {
      console.warn('[Push-to-Talk] overlayManager is not available!');
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('global-ptt:start', { manualRealtime: false });
    }
  });

  // 按键抬起处理
  globalPttHook.on('key-up', (event) => {
    if (!isTriggerKey(event)) return;

    console.log('[Push-to-Talk] key-up event detected');
    const toggleMode = isToggleMode();
    const elapsed = Date.now() - lastTriggerDownTs;

    if (toggleMode) {
      // Toggle 模式：完整的 down & up 算一次点击
      // 切换录音状态：如果正在录音则停止，如果未录音则开始
      if (isRecordingActive) {
        safeStopRecording({ manualRealtime: true });
      } else {
        isRecordingActive = true;
        recordingStartTs = Date.now();
        // 不启动 Watchdog，允许无限录音
        if (overlayManager) {
          overlayManager.updateOverlay('recording', '正在录音...', '再次按键以结束', { lock: true });
        }
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('global-ptt:start', { manualRealtime: true });
        }
      }
      return;
    }

    // 传统模式：up 时停止录音
    if (!isRecordingActive) return;

    safeStopRecording({ manualRealtime: false, source: 'key-up' });
  });

  const triggerLabel = triggerConfig.label || triggerConfig.uniKey || 'configured';
  console.log(`[Push-to-Talk] Listening for ${triggerLabel} key globally`);

  return globalPttHook;
}

/**
 * 获取当前选中的文本
 */
function getCurrentSelection() {
  if (!globalPttHook) {
    return { success: false, message: 'PTT Hook 未初始化' };
  }

  try {
    const selection = globalPttHook.getCurrentSelection();

    if (selection && selection.text && selection.text.trim()) {
      return { success: true, text: selection.text };
    }

    return { success: false, message: '没有选中的文本' };
  } catch (error) {
    console.error('[Push-to-Talk] Error getting selection:', error);
    return { success: false, message: error.message };
  }
}

/**
 * 清理资源
 */
function cleanup() {
  if (globalPttHook) {
    try {
      globalPttHook.stop();
      globalPttHook.cleanup();
    } catch (err) {
      console.warn('[Push-to-Talk] Failed to cleanup PTT hook:', err);
    }
    globalPttHook = null;
  }
  isRecordingActive = false;
   clearRecordingWatchdog();
}

module.exports = {
  init,
  setupGlobalPttHook,
  getCurrentSelection,
  isRecordingActive: () => isRecordingActive,
  cleanup,
  // 导出状态供测试
  getState: () => ({
    hasHook: globalPttHook !== null,
    isRecordingActive
  })
};
