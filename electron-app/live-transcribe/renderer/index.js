/**
 * Live Transcribe Renderer Module
 *
 * 实时转写渲染进程入口，导出 UI 组件和工具函数
 */

// 模块状态
let isMounted = false;
let currentContainer = null;

/**
 * 挂载实时转写 UI 到指定容器
 */
function mount(container) {
  if (isMounted) {
    console.warn('[LiveTranscribe] UI already mounted');
    return;
  }

  currentContainer = container;
  isMounted = true;

  // 初始化 UI
  initializeUI(container);

  console.log('[LiveTranscribe] UI mounted');
}

/**
 * 卸载实时转写 UI
 */
function unmount() {
  if (!isMounted) return;

  // 清理事件监听
  cleanup();

  // 清空容器
  if (currentContainer) {
    currentContainer.innerHTML = '';
  }

  currentContainer = null;
  isMounted = false;

  console.log('[LiveTranscribe] UI unmounted');
}

/**
 * 初始化 UI
 */
function initializeUI(container) {
  // 这里将渲染实时转写的 HTML 结构
  container.innerHTML = getLiveTranscribeHTML();

  // 绑定事件
  bindEvents(container);

  // 初始化组件
  initializeComponents(container);
}

/**
 * 获取实时转写 HTML
 */
function getLiveTranscribeHTML() {
  return `
    <div class="live-transcribe-container" id="liveTranscribeContainer">
      <!-- 设置面板 -->
      <div class="live-settings" id="liveSettings">
        <div class="live-mode-row">
          <label>转写模式</label>
          <select id="liveModeSelect">
            <option value="auto">自动模式</option>
            <option value="manual">按键模式</option>
          </select>
        </div>

        <div class="live-option-row" id="manualRealtimeRow" style="display: none;">
          <label>实时分段</label>
          <input type="checkbox" id="manualRealtimeCheckbox">
        </div>

        <div class="live-option-row" id="enableLlmRow" style="display: none;">
          <label>启用 LLM</label>
          <input type="checkbox" id="enableLlmCheckbox">
        </div>

        <div class="live-mic-row">
          <label>麦克风</label>
          <select id="micSelect"></select>
          <button id="refreshMicBtn">刷新</button>
        </div>

        <div class="live-model-row">
          <button id="loadLiveBtn">加载实时模型</button>
          <button id="releaseLiveBtn">释放模型</button>
          <span id="liveModelStatus"></span>
        </div>

        <button id="liveBtn">开始两遍实时转写</button>

        <div class="live-waveform">
          <canvas id="liveWaveformCanvas"></canvas>
          <span id="liveWaveformValue"></span>
        </div>
      </div>

      <!-- 转写结果 -->
      <div class="live-transcript" id="liveTranscript">
        <div class="live-transcript-top">
          <div class="live-transcript-header">
            <button id="liveLogToggleBtn">隐藏日志</button>
            <label>
              <input type="checkbox" id="autoPasteLiveCheckbox">
              自动粘贴
            </label>
            <button id="livePasteBtn">粘贴全部</button>
          </div>

          <div class="live-log-wrapper" id="liveLogWrapper">
            <div class="live-log" id="liveLog"></div>
          </div>

          <div class="live-transcript-body" id="liveTranscriptBody"></div>
        </div>

        <div class="live-transcript-bottom">
          <div class="live-two-pass" id="twoPassStatus">
            <div class="pass-card">
              <div class="pass-title">第一遍 · ZipFormer</div>
              <div class="pass-text" id="firstPassText">-</div>
            </div>
            <div class="pass-card">
              <div class="pass-title">第二遍 · SenseVoice</div>
              <div class="pass-text final-pass" id="secondPassText">-</div>
            </div>
          </div>
        </div>
      </div>

      <!-- PTT Banner -->
      <div class="ptt-banner" id="pttBanner">
        <div class="ptt-indicator"></div>
        <div class="ptt-banner-text">按住 Option 键开始录音</div>
        <div class="ptt-banner-hint" id="pttBannerHint"></div>
      </div>
    </div>
  `;
}

/**
 * 绑定事件
 */
function bindEvents(container) {
  const { LiveUI } = require('./live-ui');
  LiveUI.bindEvents(container);
}

/**
 * 初始化组件
 */
function initializeComponents(container) {
  const { LiveUI } = require('./live-ui');
  LiveUI.initialize(container);
}

/**
 * 清理资源
 */
function cleanup() {
  const { LiveUI } = require('./live-ui');
  LiveUI.cleanup();
}

/**
 * 导出模块
 */
module.exports = {
  mount,
  unmount,
  isMounted: () => isMounted,
  getContainer: () => currentContainer,

  // 导出子模块
  LiveUI: require('./live-ui'),
  PttUI: require('./ptt-ui'),
  Waveform: require('./waveform')
};
