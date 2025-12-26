/**
 * Live Transcribe UI
 *
 * 实时转写 UI 逻辑
 */

// 全局状态
const state = {
  isLive: false,
  isLiveLogVisible: true,
  liveModelsLoaded: false,
  liveModelsMode: null,
  liveMode: 'auto',
  liveTranscriptSegments: [],
  latestPttFirstPassText: '',
  liveSegmentKeys: new Set(),
  enableLiveAutoPaste: false,
  lastAutoPasteKey: '',
  lastPastedCombinedText: '',
  micPermissionStatus: 'unknown',
  liveRmsHistory: []
};

// DOM 元素引用
let elements = {};

/**
 * 初始化 UI
 */
function initialize(container) {
  // 缓存 DOM 元素引用
  cacheElements(container);

  // 设置初始状态
  updateUI();

  // 绑定事件监听
  setupEventListeners();
}

/**
 * 缓存 DOM 元素引用
 */
function cacheElements(container) {
  elements = {
    // 设置相关
    liveSettings: container.querySelector('#liveSettings'),
    liveModeSelect: container.querySelector('#liveModeSelect'),
    manualRealtimeRow: container.querySelector('#manualRealtimeRow'),
    manualRealtimeCheckbox: container.querySelector('#manualRealtimeCheckbox'),
    enableLlmRow: container.querySelector('#enableLlmRow'),
    enableLlmCheckbox: container.querySelector('#enableLlmCheckbox'),
    micSelect: container.querySelector('#micSelect'),
    refreshMicBtn: container.querySelector('#refreshMicBtn'),
    loadLiveBtn: container.querySelector('#loadLiveBtn'),
    releaseLiveBtn: container.querySelector('#releaseLiveBtn'),
    liveModelStatus: container.querySelector('#liveModelStatus'),
    liveBtn: container.querySelector('#liveBtn'),
    liveWaveformCanvas: container.querySelector('#liveWaveformCanvas'),
    liveWaveformValue: container.querySelector('#liveWaveformValue'),

    // 转写结果相关
    liveTranscript: container.querySelector('#liveTranscript'),
    liveLogWrapper: container.querySelector('#liveLogWrapper'),
    liveLogToggleBtn: container.querySelector('#liveLogToggleBtn'),
    autoPasteLiveCheckbox: container.querySelector('#autoPasteLiveCheckbox'),
    livePasteBtn: container.querySelector('#livePasteBtn'),
    liveLog: container.querySelector('#liveLog'),
    liveTranscriptBody: container.querySelector('#liveTranscriptBody'),

    // Two Pass 状态
    twoPassStatus: container.querySelector('#twoPassStatus'),
    firstPassText: container.querySelector('#firstPassText'),
    secondPassText: container.querySelector('#secondPassText'),

    // PTT Banner
    pttBanner: container.querySelector('#pttBanner'),
    pttBannerState: container.querySelector('.ptt-banner-text'),
    pttBannerHint: container.querySelector('#pttBannerHint')
  };
}

/**
 * 绑定事件
 */
function bindEvents(container) {
  if (!elements.liveModeSelect) return;

  elements.liveModeSelect.addEventListener('change', (e) => {
    setLiveMode(e.target.value);
  });

  if (elements.liveBtn) {
    elements.liveBtn.addEventListener('click', toggleLiveTranscribe);
  }

  if (elements.loadLiveBtn) {
    elements.loadLiveBtn.addEventListener('click', loadLiveModels);
  }

  if (elements.releaseLiveBtn) {
    elements.releaseLiveBtn.addEventListener('click', releaseLiveModels);
  }

  if (elements.liveLogToggleBtn) {
    elements.liveLogToggleBtn.addEventListener('click', toggleLiveLog);
  }

  if (elements.livePasteBtn) {
    elements.livePasteBtn.addEventListener('click', pasteLiveTranscript);
  }

  if (elements.autoPasteLiveCheckbox) {
    elements.autoPasteLiveCheckbox.addEventListener('change', (e) => {
      state.enableLiveAutoPaste = e.target.checked;
    });
  }
}

/**
 * 设置事件监听器（与主进程通信）
 */
function setupEventListeners() {
  if (!window.liveTranscribe) {
    console.warn('[LiveTranscribe] API not available');
    return;
  }

  // 监听实时转写结果
  window.liveTranscribe.onLiveResult(handleLiveResult);

  // 监听全局 PTT 事件
  window.liveTranscribe.onGlobalPttStart(handleGlobalPttStart);
  window.liveTranscribe.onGlobalPttStop(handleGlobalPttStop);
}

/**
 * 切换实时转写
 */
async function toggleLiveTranscribe() {
  if (state.isLive) {
    await stopLiveTranscribe();
  } else {
    await startLiveTranscribe();
  }
}

/**
 * 开始实时转写
 */
async function startLiveTranscribe() {
  if (state.isLive) return;

  const payload = {
    mode: state.liveMode,
    micName: elements.micSelect?.value,
    manualRealtime: elements.manualRealtimeCheckbox?.checked,
    numThreads: 2,
    sampleRate: 16000,
    bufferSize: 1600
  };

  const result = await window.liveTranscribe.startLiveCapture(payload);

  if (result.success) {
    state.isLive = true;
    updateUI();
    appendLiveLog('实时转写已启动');
  } else {
    appendLiveLog(`启动失败: ${result.message}`);
  }
}

/**
 * 停止实时转写
 */
async function stopLiveTranscribe() {
  if (!state.isLive) return;

  const result = await window.liveTranscribe.stopLiveCapture({
    mode: state.liveMode
  });

  if (result.success) {
    state.isLive = false;
    updateUI();
    appendLiveLog('实时转写已停止');
  }
}

/**
 * 加载实时模型
 */
async function loadLiveModels() {
  const payload = {
    mode: state.liveMode,
    micName: elements.micSelect?.value,
    manualRealtime: elements.manualRealtimeCheckbox?.checked
  };

  const result = await window.liveTranscribe.loadLiveModels(payload);

  if (result.success) {
    state.liveModelsLoaded = true;
    state.liveModelsMode = payload.mode;
    updateUI();
    appendLiveLog('实时模型已加载');
  } else {
    appendLiveLog(`加载模型失败: ${result.message}`);
  }
}

/**
 * 释放实时模型
 */
async function releaseLiveModels() {
  const result = await window.liveTranscribe.releaseLiveModels();

  if (result.success) {
    state.liveModelsLoaded = false;
    state.liveModelsMode = null;
    updateUI();
    appendLiveLog('实时模型已释放');
  }
}

/**
 * 设置实时模式
 */
function setLiveMode(mode) {
  state.liveMode = mode;

  // 显示/隐藏相关选项
  if (elements.manualRealtimeRow) {
    elements.manualRealtimeRow.style.display = mode === 'manual' ? 'flex' : 'none';
  }

  if (elements.enableLlmRow) {
    elements.enableLlmRow.style.display = mode === 'manual' ? 'flex' : 'none';
  }

  updateUI();
}

/**
 * 更新 UI
 */
function updateUI() {
  // 更新按钮状态
  if (elements.liveBtn) {
    elements.liveBtn.textContent = state.isLive ? '停止实时转写' : '开始实时转写';
    elements.liveBtn.disabled = !state.liveModelsLoaded;
  }

  if (elements.loadLiveBtn) {
    elements.loadLiveBtn.disabled = state.isLive;
  }

  if (elements.releaseLiveBtn) {
    elements.releaseLiveBtn.disabled = !state.liveModelsLoaded;
  }

  // 更新模型状态
  if (elements.liveModelStatus) {
    elements.liveModelStatus.textContent = state.liveModelsLoaded
      ? `已加载 (${state.liveModelsMode})`
      : '';
  }
}

/**
 * 处理实时转写结果
 */
function handleLiveResult(payload) {
  switch (payload.type) {
    case 'log':
      appendLiveLog(payload.message);
      break;
    case 'devices':
      updateMicList(payload.devices);
      break;
    case 'first-pass':
      updateFirstPass(payload.text);
      break;
    case 'result':
      if (payload.stage === 'second-pass') {
        updateSecondPass(payload);
        appendLiveTranscript(payload);
      }
      break;
    case 'ready':
      appendLiveLog('模型已就绪');
      break;
    case 'error':
      appendLiveLog(`错误: ${payload.message}`);
      break;
    case 'complete':
      appendLiveLog('转写完成');
      break;
  }
}

/**
 * 更新第一遍结果
 */
function updateFirstPass(text) {
  if (elements.firstPassText) {
    elements.firstPassText.textContent = text || '-';
  }
  state.latestPttFirstPassText = text;

  // 自动粘贴（如果启用）
  if (state.enableLiveAutoPaste && text) {
    autoPasteLive(text);
  }
}

/**
 * 更新第二遍结果
 */
function updateSecondPass(payload) {
  if (!payload || !payload.segments) return;

  const segment = payload.segments[0];
  if (segment && elements.secondPassText) {
    elements.secondPassText.textContent = segment.text || '-';
  }

  // 如果启用自动粘贴且有第一遍结果，执行替换
  if (state.enableLiveAutoPaste && state.latestPttFirstPassText) {
    replaceFirstPassWithSecond(state.latestPttFirstPassText, segment.text);
  }
}

/**
 * 追加转写结果
 */
function appendLiveTranscript(payload) {
  if (!payload || !payload.segments) return;

  payload.segments.forEach(segment => {
    const key = `${segment.start_time}-${segment.end_time}`;
    if (!state.liveSegmentKeys.has(key)) {
      state.liveSegmentKeys.add(key);
      state.liveTranscriptSegments.push(segment);
      renderLiveTranscript();
    }
  });
}

/**
 * 渲染转写结果
 */
function renderLiveTranscript() {
  if (!elements.liveTranscriptBody) return;

  const html = state.liveTranscriptSegments.map(seg => `
    <div class="live-segment" data-start="${seg.start_time}" data-end="${seg.end_time}">
      <span class="live-segment-time">[${seg.start_time}s - ${seg.end_time}s]</span>
      <span class="live-segment-text">${seg.text}</span>
    </div>
  `).join('');

  elements.liveTranscriptBody.innerHTML = html;
}

/**
 * 更新麦克风列表
 */
function updateMicList(devices) {
  if (!elements.micSelect) return;

  const currentValue = elements.micSelect.value;
  elements.micSelect.innerHTML = devices.map(dev =>
    `<option value="${dev.name}">${dev.name}</option>`
  ).join('');

  // 保持当前选择
  if (currentValue) {
    elements.micSelect.value = currentValue;
  }
}

/**
 * 自动粘贴
 */
async function autoPasteLive(text) {
  // 自动粘贴逻辑
  // 需要调用系统输入 API
}

/**
 * 替换第一遍为第二遍
 */
async function replaceFirstPassWithSecond(firstPass, secondPass) {
  // 替换逻辑
  // 需要调用系统输入 API
}

/**
 * 追加日志
 */
function appendLiveLog(message) {
  if (!elements.liveLog) return;

  const time = new Date().toLocaleTimeString();
  const logEntry = document.createElement('div');
  logEntry.className = 'live-log-entry';
  logEntry.textContent = `[${time}] ${message}`;

  elements.liveLog.appendChild(logEntry);
  elements.liveLog.scrollTop = elements.liveLog.scrollHeight;
}

/**
 * 切换日志显示
 */
function toggleLiveLog() {
  state.isLiveLogVisible = !state.isLiveLogVisible;

  if (elements.liveLogWrapper) {
    elements.liveLogWrapper.style.display = state.isLiveLogVisible ? 'block' : 'none';
  }

  if (elements.liveLogToggleBtn) {
    elements.liveLogToggleBtn.textContent = state.isLiveLogVisible ? '隐藏日志' : '显示日志';
  }
}

/**
 * 粘贴转写结果
 */
async function pasteLiveTranscript() {
  const text = buildNewLiveTranscriptText();
  // 调用粘贴 API
}

/**
 * 构建新的转写文本
 */
function buildNewLiveTranscriptText() {
  return state.liveTranscriptSegments
    .map(seg => seg.text)
    .join('\n');
}

/**
 * 处理全局 PTT 开始
 */
function handleGlobalPttStart(payload) {
  if (elements.pttBannerState) {
    elements.pttBannerState.textContent = '正在录音...';
  }

  if (elements.pttBanner) {
    elements.pttBanner.classList.add('active');
  }
}

/**
 * 处理全局 PTT 停止
 */
function handleGlobalPttStop(payload) {
  if (elements.pttBannerState) {
    elements.pttBannerState.textContent = '按住 Option 键开始录音';
  }

  if (elements.pttBanner) {
    elements.pttBanner.classList.remove('active');
  }
}

/**
 * 清理资源
 */
function cleanup() {
  if (window.liveTranscribe) {
    window.liveTranscribe.removeAllListeners('live-transcribe-result');
    window.liveTranscribe.removeAllListeners('global-ptt:start');
    window.liveTranscribe.removeAllListeners('global-ptt:stop');
  }

  state.liveTranscriptSegments = [];
  state.liveSegmentKeys.clear();
}

module.exports = {
  initialize,
  bindEvents,
  cleanup,
  toggleLiveTranscribe,
  loadLiveModels,
  releaseLiveModels,
  setLiveMode,
  getState: () => state
};
