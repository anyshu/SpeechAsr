/**
 * PTT UI
 *
 * Push-to-Talk UI 逻辑
 */

/**
 * 处理 PTT 按键事件
 */
function handlePttKeyDown(event) {
  if (event.key === 'Alt' || event.key === 'Option') {
    // 开始录音
    startPttRecording();
  }
}

/**
 * 处理 PTT 按键释放
 */
function handlePttKeyUp(event) {
  if (event.key === 'Alt' || event.key === 'Option') {
    // 停止录音
    stopPttRecording();
  }
}

/**
 * 启动 PTT 录音
 */
async function startPttRecording() {
  if (!window.liveTranscribe) return;

  const result = await window.liveTranscribe.startPushToTalk({
    mode: 'manual',
    manualRealtime: true
  });

  if (result.success) {
    console.log('[PTT] Recording started');
  }
}

/**
 * 停止 PTT 录音
 */
async function stopPttRecording() {
  if (!window.liveTranscribe) return;

  const result = await window.liveTranscribe.stopPushToTalk();

  if (result.success) {
    console.log('[PTT] Recording stopped');
  }
}

module.exports = {
  handlePttKeyDown,
  handlePttKeyUp,
  startPttRecording,
  stopPttRecording
};
