const state = {
  micStatus: 'unknown',
  models: {
    sense: false,
    streaming: false,
    punctuation: false,
    vad: false
  },
  modelProgressLabel: '',
  modelsLoaded: false,
  autoPaste: true,
  manualRealtime: false,
  enableLlm: false,
  autoLoadTriggered: false,
  isRecording: false,
  capturePromise: null,
  releasePromise: null,
  autopasteBuffer: '',
  lastFirstPassLength: 0
};

const el = {};
let cleanupFns = [];

function init() {
  cacheElements();
  bindEvents();
  wireProgressListeners();
  hydrateDefaults();
  refreshMicStatus();
  refreshDevices();
  refreshModelStatus().then(autoLoadModelsOnBoot);
  attachLiveListeners();
  reportApiAvailability();
  appendLog('小窗就绪：默认手动模式、自动粘贴开启');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

function cacheElements() {
  el.appModePill = document.getElementById('appModePill');
  el.micStatusBadge = document.getElementById('micStatusBadge');
  el.modelSummary = document.getElementById('modelSummary');
  el.modelProgressText = document.getElementById('modelProgressText');
  el.micSelect = document.getElementById('micSelect');
  el.refreshMicBtn = document.getElementById('refreshMicBtn');
  el.checkMicBtn = document.getElementById('checkMicBtn');
  el.requestMicBtn = document.getElementById('requestMicBtn');
  el.downloadAllBtn = document.getElementById('downloadAllBtn');
  el.loadModelsBtn = document.getElementById('loadModelsBtn');
  el.releaseModelsBtn = document.getElementById('releaseModelsBtn');
  el.autoPasteToggle = document.getElementById('autoPasteToggle');
  el.manualRealtimeToggle = document.getElementById('manualRealtimeToggle');
  el.llmToggle = document.getElementById('llmToggle');
  el.firstPassText = document.getElementById('firstPassText');
  el.secondPassText = document.getElementById('secondPassText');
  el.liveStatusBadge = document.getElementById('liveStatusBadge');
  el.logList = document.getElementById('logList');
  el.clearLogBtn = document.getElementById('clearLogBtn');
}

function bindEvents() {
  document.querySelectorAll('[data-download]').forEach((btn) => {
    btn.addEventListener('click', () => downloadModelByKey(btn.dataset.download));
  });

  el.downloadAllBtn?.addEventListener('click', downloadAllModels);
  el.refreshMicBtn?.addEventListener('click', refreshDevices);
  el.checkMicBtn?.addEventListener('click', refreshMicStatus);
  el.requestMicBtn?.addEventListener('click', requestMicPermission);
  el.loadModelsBtn?.addEventListener('click', loadLiveModels);
  el.releaseModelsBtn?.addEventListener('click', releaseLiveModels);
  el.clearLogBtn?.addEventListener('click', () => {
    if (el.logList) el.logList.innerHTML = '';
  });

  el.autoPasteToggle?.addEventListener('change', (e) => {
    state.autoPaste = e.target.checked;
  });
  el.manualRealtimeToggle?.addEventListener('change', (e) => {
    state.manualRealtime = e.target.checked;
  });
  el.llmToggle?.addEventListener('change', (e) => {
    state.enableLlm = e.target.checked;
  });
}

function wireProgressListeners() {
  cleanupFns.forEach((fn) => fn && fn());
  cleanupFns = [];

  if (window.liveApp?.onModelProgress) {
    cleanupFns.push(window.liveApp.onModelProgress((payload) => updateProgressText('SenseVoice', payload)));
  }
  if (window.liveApp?.onStreamingProgress) {
    cleanupFns.push(window.liveApp.onStreamingProgress((payload) => updateProgressText('流式', payload)));
  }
  if (window.liveApp?.onPunctuationProgress) {
    cleanupFns.push(window.liveApp.onPunctuationProgress((payload) => updateProgressText('标点', payload)));
  }
  if (window.liveApp?.onVadProgress) {
    cleanupFns.push(window.liveApp.onVadProgress((payload) => updateProgressText('VAD', payload)));
  }
}

function hydrateDefaults() {
  // 默认值从主进程配置读取，保证多个模式一致
  window.liveApp?.getModeDefaults?.().then((defaults) => {
    if (!defaults) return;
    state.autoPaste = defaults.autoPaste ?? true;
    state.manualRealtime = defaults.manualRealtime ?? false;
    state.enableLlm = defaults.enableLlm ?? false;

    if (el.autoPasteToggle) el.autoPasteToggle.checked = state.autoPaste;
    if (el.manualRealtimeToggle) el.manualRealtimeToggle.checked = state.manualRealtime;
    if (el.llmToggle) el.llmToggle.checked = state.enableLlm;
  });

  window.liveApp?.getAppMode?.().then((info) => {
    if (info?.appName && el.appModePill) {
      el.appModePill.textContent = info.appName;
    }
  });
}

async function refreshMicStatus() {
  try {
    const res = await window.liveApp?.getMicPermissionStatus?.();
    const status = res?.status || 'unknown';
    state.micStatus = status;
    setBadge(el.micStatusBadge, statusLabel(status), statusBadgeClass(status));
    appendLog(`麦克风权限：${statusLabel(status)}`);
  } catch (err) {
    setBadge(el.micStatusBadge, '读取失败', 'error');
    appendLog(`读取权限失败: ${err.message || err}`, 'error');
  }
}

async function requestMicPermission() {
  try {
    const res = await window.liveApp?.requestMicPermission?.();
    const status = res?.status || 'unknown';
    state.micStatus = status;
    setBadge(el.micStatusBadge, statusLabel(status), statusBadgeClass(status));
    appendLog(`请求权限：${statusLabel(status)}`);
  } catch (err) {
    setBadge(el.micStatusBadge, '请求失败', 'error');
    appendLog(`请求权限失败: ${err.message || err}`, 'error');
  }
}

async function refreshDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter((d) => d.kind === 'audioinput');
    applyMicOptions(inputs.map((d) => d.label || d.deviceId));
  } catch (err) {
    appendLog(`读取麦克风列表失败: ${err.message || err}`, 'error');
  }
}

function applyMicOptions(list) {
  if (!el.micSelect || !Array.isArray(list)) return;
  el.micSelect.innerHTML = '';
  if (!list.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '未检测到麦克风';
    el.micSelect.appendChild(opt);
    return;
  }

  list.forEach((name) => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    el.micSelect.appendChild(opt);
  });
}

async function refreshModelStatus() {
  try {
    const [sense, streaming, punct, vad] = await Promise.all([
      window.liveApp?.checkModel?.(),
      window.liveApp?.checkStreamingModel?.(),
      window.liveApp?.checkPunctuationModel?.(),
      window.liveApp?.checkVadModel?.()
    ]);

    state.models.sense = Boolean(sense);
    state.models.streaming = Boolean(streaming);
    state.models.punctuation = Boolean(punct);
    state.models.vad = Boolean(vad);

    setModelRow('sense', sense);
    setModelRow('stream', streaming);
    setModelRow('punct', punct);
    setModelRow('vad', vad);
    updateModelSummary();
  } catch (err) {
    appendLog(`模型检测失败: ${err.message || err}`, 'error');
  }
}

async function autoLoadModelsOnBoot() {
  if (state.autoLoadTriggered) return;
  state.autoLoadTriggered = true;
  const ready = state.models.sense && state.models.streaming;
  if (!ready) {
    appendLog('自动加载跳过：必需模型未就绪', 'warn');
    return;
  }
  appendLog('检测到模型就绪，自动加载中...');
  await loadLiveModels();
}

function setModelRow(key, ok) {
  const dot = document.getElementById(`${key}StatusDot`);
  const text = document.getElementById(`${key}StatusText`);
  if (dot) {
    dot.classList.remove('ok', 'warn', 'error');
    if (ok) dot.classList.add('ok');
  }
  if (text) {
    text.textContent = ok ? '已就绪' : '未就绪';
    text.classList.toggle('log-error', !ok);
  }
}

function updateModelSummary() {
  const ready = state.models.sense && state.models.streaming;
  const message = ready ? '必需模型已就绪' : '缺少必需模型';
  setBadge(el.modelSummary, message, ready ? 'success' : 'warn');
}

function updateProgressText(label, payload) {
  if (!el.modelProgressText) return;
  if (!payload || payload.status === 'done' || payload.status === 'completed') {
    el.modelProgressText.textContent = `${label}: 完成`;
    return;
  }
  if (payload.status === 'error') {
    el.modelProgressText.textContent = `${label}: ${payload.message || '下载失败'}`;
    return;
  }
  const pct = payload.percent != null ? `${payload.percent}%` : '';
  const msg = payload.message || payload.status || '下载中';
  el.modelProgressText.textContent = `${label}: ${msg} ${pct}`;
}

async function downloadModelByKey(key) {
  try {
    updateProgressText(keyLabel(key), { status: 'starting', percent: 0 });
    let result = { success: false };
    if (key === 'sense') {
      result = await window.liveApp?.downloadModel?.();
    } else if (key === 'stream') {
      result = await window.liveApp?.downloadStreamingModel?.();
    } else if (key === 'punct') {
      result = await window.liveApp?.downloadPunctuationModel?.();
    } else if (key === 'vad') {
      result = await window.liveApp?.downloadVadModel?.();
    }

    if (!result?.success) {
      appendLog(`${keyLabel(key)} 下载失败`, 'error');
    } else {
      appendLog(`${keyLabel(key)} 下载完成`, 'success');
    }
  } catch (err) {
    appendLog(`${keyLabel(key)} 下载异常: ${err.message || err}`, 'error');
  } finally {
    await refreshModelStatus();
  }
}

async function downloadAllModels() {
  if (!window.liveApp) return;
  disableModelButtons(true);
  const queue = [];
  if (!state.models.sense) queue.push(() => downloadModelByKey('sense'));
  if (!state.models.streaming) queue.push(() => downloadModelByKey('stream'));
  if (!state.models.punctuation) queue.push(() => downloadModelByKey('punct'));
  if (!state.models.vad) queue.push(() => downloadModelByKey('vad'));

  for (const task of queue) {
    await task();
  }
  disableModelButtons(false);
  updateProgressText('全部', { status: 'done' });
}

function disableModelButtons(disabled) {
  document.querySelectorAll('[data-download]').forEach((btn) => {
    btn.disabled = disabled;
  });
  if (el.downloadAllBtn) el.downloadAllBtn.disabled = disabled;
}

function attachLiveListeners() {
  if (!window.liveTranscribe) {
    appendLog('liveTranscribe API 不可用', 'error');
    return;
  }

  window.liveTranscribe.onLiveResult((payload) => handleLiveResult(payload));

  if (window.liveTranscribe.onGlobalPttStart) {
    window.liveTranscribe.onGlobalPttStart((payload) => handleGlobalPttStart(payload));
  }
  if (window.liveTranscribe.onGlobalPttStop) {
    window.liveTranscribe.onGlobalPttStop((payload) => handleGlobalPttStop(payload));
  }
}

function handleLiveResult(payload) {
  switch (payload?.type) {
    case 'log':
      appendLog(payload.message || '');
      break;
    case 'devices':
      applyMicOptions((payload.devices || []).map((d) => d.name));
      break;
    case 'first-pass':
      updateFirstPass(payload.text || '');
      break;
    case 'result':
      if (payload.stage === 'second-pass') {
        updateSecondPass(payload);
      }
      break;
    case 'ready':
      appendLog('模型已就绪');
      break;
    case 'error':
      appendLog(payload.message || '实时转写出错', 'error');
      setBadge(el.liveStatusBadge, '错误', 'error');
      break;
    case 'complete':
      state.isRecording = false;
      setBadge(el.liveStatusBadge, '等待按键', 'muted');
      resetSessionTexts();
      break;
    default:
      break;
  }
}

function reportApiAvailability() {
  const liveAppReady = Boolean(window.liveApp);
  const liveApiReady = Boolean(window.liveTranscribe);
  appendLog(liveAppReady ? 'liveApp API 就绪' : 'liveApp API 不可用', liveAppReady ? 'success' : 'error');
  appendLog(liveApiReady ? 'liveTranscribe API 就绪' : 'liveTranscribe API 不可用', liveApiReady ? 'success' : 'error');
}

async function handleGlobalPttStart(payload) {
  if (!state.modelsLoaded) {
    appendLog('模型未加载，按键录音被忽略', 'error');
    return;
  }
  // 重置粘贴缓冲区，确保每次录音都是独立的
  state.autopasteBuffer = '';
  state.lastFirstPassLength = 0;
  sendOverlayRecording('正在录音...', '松开 Option/Alt 结束');
  await startLiveCapture();
}

async function handleGlobalPttStop(payload) {
  sendOverlayState('processing', '正在识别...', '稍等片刻', { lock: false, autoHideMs: 1200 });
  await stopLiveCapture(payload?.source || 'key-up');
}

async function loadLiveModels() {
  if (!window.liveTranscribe) {
    appendLog('liveTranscribe API 不可用，无法加载模型', 'error');
    return;
  }
  const micName = el.micSelect?.value || undefined;
  const payload = {
    mode: 'manual',
    micName,
    manualRealtime: state.manualRealtime,
    numThreads: 2,
    bufferSize: 1600
  };

  setBadge(el.liveStatusBadge, '加载中', 'warn');
  try {
    const res = await window.liveTranscribe.loadLiveModels(payload);
    if (!res?.success) {
      appendLog(res?.message || '加载模型失败', 'error');
      setBadge(el.liveStatusBadge, '未加载', 'error');
      return;
    }
    state.modelsLoaded = true;
    appendLog('实时模型已加载，可按住 Option 键开始录音', 'success');
    setBadge(el.liveStatusBadge, '已加载（手动）', 'success');
  } catch (err) {
    appendLog(`加载失败: ${err.message || err}`, 'error');
    setBadge(el.liveStatusBadge, '未加载', 'error');
  }
}

async function releaseLiveModels() {
  if (!window.liveTranscribe) {
    appendLog('liveTranscribe API 不可用，无法释放模型', 'error');
    return;
  }
  if (state.releasePromise) return;
  state.releasePromise = window.liveTranscribe.releaseLiveModels();
  try {
    await state.releasePromise;
  } finally {
    state.releasePromise = null;
    state.modelsLoaded = false;
    state.isRecording = false;
    resetSessionTexts();
    setBadge(el.liveStatusBadge, '未加载', 'muted');
    appendLog('模型已释放');
  }
}

async function startLiveCapture() {
  if (!window.liveTranscribe) {
    appendLog('liveTranscribe API 不可用，无法开始录音', 'error');
    return;
  }
  if (state.isRecording || state.capturePromise) return state.capturePromise;
  const micName = el.micSelect?.value || undefined;
  const payload = {
    mode: 'manual',
    micName,
    manualRealtime: state.manualRealtime,
    numThreads: 2,
    bufferSize: 1600
  };
  appendLog('开始录音...');
  setBadge(el.liveStatusBadge, '录音中', 'warn');

  state.capturePromise = window.liveTranscribe.startLiveCapture(payload);
  const res = await state.capturePromise;
  state.capturePromise = null;

  if (!res?.success) {
    appendLog(res?.message || '录音启动失败', 'error');
    setBadge(el.liveStatusBadge, '未加载', 'error');
    return res;
  }

  state.isRecording = true;
  state.autopasteBuffer = '';
  state.lastFirstPassLength = 0;
  updateFirstPass('录音中...');
  updateSecondPassText('等待二次精修...');
  return res;
}

async function stopLiveCapture(source = 'key-up') {
  if (!window.liveTranscribe || !state.isRecording) return;
  try {
    await window.liveTranscribe.stopLiveCapture({ mode: 'manual', source });
    appendLog('录音结束，等待输出');
  } catch (err) {
    appendLog(`停止录音失败: ${err.message || err}`, 'error');
  } finally {
    state.isRecording = false;
  }
}

function updateFirstPass(text) {
  if (el.firstPassText) {
    el.firstPassText.textContent = text || '...';
  }
  // 手动模式下不进行 first-pass 实时粘贴，只更新 UI
  if (text && state.isRecording) {
    sendOverlayRecording(text);
  }
}

async function updateSecondPass(payload) {
  const text = payload?.segments?.[0]?.text || '';
  updateSecondPassText(text || '无结果');

  if (!text) {
    sendOverlayState('done', text, '识别完成', { autoHideMs: 1500 });
    return;
  }

  // 手动模式：如果启用 LLM，先调用 LLM 处理
  if (state.enableLlm) {
    appendLog('[LLM] 正在调用 AI 助手处理...');

    try {
      // 获取用户当前选中的文本作为 prefix
      const prefixResult = await window.liveApp?.getCurrentSelection?.();
      const prefix = prefixResult?.success ? prefixResult.text : null;

      if (prefix) {
        appendLog(`[LLM] 检测到选中文本: "${prefix.slice(0, 50)}${prefix.length > 50 ? '...' : ''}"`);
      }

      // 调用 LLM 处理
      const llmResult = await window.liveApp?.llmProcess?.(text, prefix);

      if (llmResult?.success && llmResult?.text) {
        const processedText = llmResult.text;
        appendLog(`[LLM] AI 助手处理结果: ${processedText}`);
        updateSecondPassText(processedText);
        // 使用 LLM 处理后的结果进行粘贴
        await pasteSecondPassResult(processedText);
      } else {
        // LLM 处理失败，使用原始结果
        appendLog('[LLM] 处理失败，使用原始识别结果', 'warn');
        await pasteSecondPassResult(text);
      }
    } catch (err) {
      appendLog(`[LLM] 处理异常: ${err.message || err}`, 'error');
      // 出错时使用原始结果
      await pasteSecondPassResult(text);
    }
  } else {
    // 未启用 LLM，直接粘贴 second-pass 结果
    await pasteSecondPassResult(text);
  }

  sendOverlayState('done', text, '识别完成', { autoHideMs: 1500 });
}

function updateSecondPassText(text) {
  if (el.secondPassText) {
    el.secondPassText.textContent = text;
  }
}

// 手动模式：直接粘贴 second-pass 结果，不需要选择替换
async function pasteSecondPassResult(text) {
  if (!state.autoPaste || !window.liveApp) return;
  try {
    const res = await window.liveApp.pasteTextToFocusedInput(text);
    if (!res?.success) {
      appendLog(res?.message || '粘贴失败', 'error');
    }
  } catch (err) {
    appendLog(`粘贴失败: ${err.message || err}`, 'error');
  }
}

async function handleAutoPasteFirstPass(text) {
  if (!state.autoPaste || !window.liveApp) return;
  const previous = state.autopasteBuffer || '';
  const delta = text.startsWith(previous) ? text.slice(previous.length) : text;
  if (!delta.trim()) return;

  try {
    const res = await window.liveApp.pasteTextToFocusedInput(delta);
    if (!res?.success) {
      appendLog(res?.message || '自动粘贴失败', 'error');
      return;
    }
    state.autopasteBuffer = text;
    state.lastFirstPassLength = state.autopasteBuffer.length;
  } catch (err) {
    appendLog(`自动粘贴失败: ${err.message || err}`, 'error');
  }
}

async function handleSecondPassReplace(secondText) {
  if (!state.autoPaste || !window.liveApp) return;
  const lengthToReplace = state.autopasteBuffer.length || state.lastFirstPassLength;
  if (lengthToReplace <= 0) return;

  try {
    const res = await window.liveApp.replaceFirstPassWithSecond({
      selectLength: lengthToReplace,
      secondPassText: secondText
    });
    if (!res?.success) {
      appendLog(res?.message || '二次替换失败', 'error');
      return;
    }
    // 2pass 替换后清空缓冲区，避免影响下次录音
    // 因为 2pass 文本可能包含额外的标点符号，导致下次录音时增量计算出错
    state.autopasteBuffer = '';
    state.lastFirstPassLength = 0;
  } catch (err) {
    appendLog(`二次替换失败: ${err.message || err}`, 'error');
  }
}

function resetSessionTexts() {
  updateFirstPass('等待开始');
  updateSecondPassText('等待开始');
  state.autopasteBuffer = '';
  state.lastFirstPassLength = 0;
  sendOverlayState('idle');
}

function setBadge(node, text, level = 'muted') {
  if (!node) return;
  node.classList.remove('success', 'warn', 'error', 'muted');
  node.classList.add(level);
  node.textContent = text;
}

function statusLabel(status) {
  if (status === 'granted') return '已授权';
  if (status === 'denied') return '已拒绝';
  if (status === 'restricted') return '受限';
  return '未知';
}

function statusBadgeClass(status) {
  if (status === 'granted') return 'success';
  if (status === 'denied') return 'error';
  if (status === 'restricted') return 'warn';
  return 'muted';
}

function keyLabel(key) {
  switch (key) {
    case 'sense':
      return 'SenseVoice';
    case 'stream':
      return '流式模型';
    case 'punct':
      return '标点模型';
    case 'vad':
      return 'VAD 模型';
    default:
      return key;
  }
}

function appendLog(message, level = 'info') {
  if (!message || !el.logList) return;
  const line = document.createElement('div');
  line.className = 'log-line';
  if (level === 'error') line.classList.add('log-error');
  if (level === 'success') line.classList.add('log-success');
  const time = new Date().toLocaleTimeString();
  line.innerHTML = `<span class="log-time">${time}</span>${escapeHtml(message)}`;
  el.logList.appendChild(line);
  el.logList.scrollTop = el.logList.scrollHeight;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function sendOverlayRecording(message, hint = '按键录音') {
  try {
    window.liveTranscribe?.armPttOverlay?.(true);
    window.liveTranscribe?.updatePttOverlay?.({
      state: 'recording',
      message,
      hint,
      lock: true
    });
  } catch (err) {
    // silent; overlay best-effort
  }
}

function sendOverlayState(state, message, hint, opts = {}) {
  try {
    if (state === 'idle') {
      window.liveTranscribe?.hidePttOverlay?.();
      window.liveTranscribe?.armPttOverlay?.(false);
      return;
    }
    window.liveTranscribe?.updatePttOverlay?.({
      state,
      message,
      hint,
      lock: Boolean(opts.lock),
      autoHideMs: opts.autoHideMs
    });
  } catch (err) {
    // silent
  }
}
