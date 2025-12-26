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

// 配置
const TRIGGER_UNI_KEY = 'Alt'; // 左侧 Option
const TRIGGER_MIN_HOLD_MS = 180; // 忽略过短的抬起抖动（ms）

// 外部依赖（由主应用注入）
let mainWindow = null;
let speechAsr = null;
let overlayManager = null;

/**
 * 初始化配置
 */
function init(options) {
  mainWindow = options.mainWindow;
  speechAsr = options.speechAsr;
  overlayManager = options.overlayManager;
}

/**
 * 检查是否是触发键
 */
function isTriggerKey(event) {
  if (!event || event.uniKey !== TRIGGER_UNI_KEY) return false;

  // macOS 左侧 Option 键 vkCode = 58
  if (process.platform === 'darwin' && typeof event.vkCode === 'number') {
    return event.vkCode === 58;
  }

  return true;
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
    enableClipboard: true,  // 启用 clipboard 回退以获取其他应用的选中文本
    selectionPassiveMode: true
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

    // 传统模式：down 时开始录音
    if (isRecordingActive) return;
    lastTriggerDownTs = Date.now();
    isRecordingActive = true;

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
      // 忽略过短的按键（防抖）
      if (elapsed < TRIGGER_MIN_HOLD_MS) {
        return;
      }

      // 切换录音状态：如果正在录音则停止，如果未录音则开始
      if (isRecordingActive) {
        isRecordingActive = false;
        if (overlayManager) {
          overlayManager.setOverlayArmed(false);
        }
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('global-ptt:stop', { manualRealtime: true });
        }
      } else {
        isRecordingActive = true;
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
    if (elapsed < TRIGGER_MIN_HOLD_MS) {
      // 忽略过短的抬起抖动，避免误触 stop
      return;
    }

    isRecordingActive = false;
    if (overlayManager) {
      overlayManager.setOverlayArmed(false);
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('global-ptt:stop', { manualRealtime: false });
    }
  });

  console.log('[Push-to-Talk] Listening for Left Option key globally');

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
