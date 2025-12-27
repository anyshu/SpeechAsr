const state = {
  micStatus: 'unknown',
  models: {
    sense: false,
    streaming: false,
    punctuation: false,
    vad: false
  },
  modelsLoaded: false,
  autoPaste: true,
  manualRealtime: false,
  enableLlm: false,
  isRecording: false,
  capturePromise: null,
  releasePromise: null,
  autopasteBuffer: '',
  lastFirstPassLength: 0,
  autoLoadTriggered: false,
  stats: {
    totalChars: 0,
    sessions: 0,
    lastText: '',
    lastPersona: '',
    lastTime: null
  },
  history: []
};

const personaState = {
  personas: [],
  activeId: '',
  icons: ['🌐', '🗒️', '💻', '✨', '🎧', '📚', '💡', '🧠', '🎯', '🛠️', '💬', '🪄'],
  storageKey: 'xigua-lite-personas',
  activeKey: 'xigua-lite-active-persona'
};

const historyState = {
  storageKey: 'xigua-lite-history'
};

const defaultPersonas = [
  {
    id: 'default',
    name: '默认风格',
    icon: '🎙️',
    description: '保持客观简洁，直给结果。'
  },
  {
    id: 'translator',
    name: '自动翻译',
    icon: '🌐',
    description: '如果文本为中文，请翻译成自然流畅的英文；如已是英文则仅做清理，不改变语言。专有名词保持原样。'
  },
  {
    id: 'cmd-master',
    name: '命令行大神',
    icon: '💻',
    description: '将语音转为命令/代码，谨慎补全参数并简述作用。'
  },
  {
    id: 'office',
    name: '职场大佬',
    icon: '🧳',
    description: '正式、稳重、条理清晰，适合职场沟通。'
  },
  {
    id: 'wild',
    name: '发疯文学',
    icon: '🔥',
    description: '夸张有趣，节奏快，保持核心信息但更抓眼。'
  }
];

const el = {};
let cleanupFns = [];

async function init() {
  cacheElements();
  wireNavigation();
  setActivePage('homePage');
  await initPersonas();
  hydrateHistory();
  bindEvents();
  wireProgressListeners();
  hydrateDefaults();
  updateHomeStatuses();
  updateStatsDisplay();
  listenPersonaUpdates();
  refreshMicStatus();
  refreshDevices();
  refreshModelStatus().then(autoLoadModelsOnBoot);
  attachLiveListeners();
  reportApiAvailability();
  appendLog('Lite 界面就绪：人设与实时转写功能保持一致');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

function cacheElements() {
  el.appModePill = document.getElementById('appModePill');
  el.activePersonaName = document.getElementById('activePersonaName');
  el.personaList = document.getElementById('personaList');
  el.personaNameInput = document.getElementById('personaNameInput');
  el.personaDescription = document.getElementById('personaDescription');
  el.personaIconGrid = document.getElementById('personaIconGrid');
  el.newPersonaInline = document.getElementById('newPersonaInline');
  el.savePersonaBtn = document.getElementById('savePersonaBtn');
  el.deletePersonaBtn = document.getElementById('deletePersonaBtn');
  el.personaHeroName = document.getElementById('personaHeroName');
  el.personaHeroDesc = document.getElementById('personaHeroDesc');
  el.personaHeroType = document.getElementById('personaHeroType');
  el.navItems = document.querySelectorAll('.nav-item');
  el.pages = document.querySelectorAll('.page');
  el.statChars = document.getElementById('statChars');
  el.statSessions = document.getElementById('statSessions');
  el.statSessionsSub = document.getElementById('statSessionsSub');
  el.statWords = document.getElementById('statWords');
  el.statTimeSaved = document.getElementById('statTimeSaved');
  el.heroCollabCount = document.getElementById('heroCollabCount');
  el.statAutoPaste = document.getElementById('statAutoPaste');
  el.statPersona = document.getElementById('statPersona');
  el.homeModelStatus = document.getElementById('homeModelStatus');
  el.homeMicStatus = document.getElementById('homeMicStatus');
  el.homeLlmStatus = document.getElementById('homeLlmStatus');
  el.homePersonaPill = document.getElementById('homePersonaPill');
  el.homeLatestPersona = document.getElementById('homeLatestPersona');
  el.homeLatestTime = document.getElementById('homeLatestTime');
  el.homeLatestLength = document.getElementById('homeLatestLength');
  el.homeTimelineStatus = document.getElementById('homeTimelineStatus');
  el.homeHistoryList = document.getElementById('homeHistoryList');
  el.lastTranscriptionText = document.getElementById('lastTranscriptionText');

  el.micStatusBadge = document.getElementById('micStatusBadge');
  el.modelSummary = document.getElementById('modelSummary');
  el.modelSummarySecondary = document.getElementById('modelSummarySecondary');
  el.modelProgressTextHero = document.getElementById('modelProgressTextHero');
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

function wireNavigation() {
  if (!el.navItems) return;
  el.navItems.forEach((btn) => {
    btn.addEventListener('click', () => {
      setActivePage(btn.dataset.target);
    });
  });
}

function setActivePage(pageId) {
  if (!pageId) return;
  el.navItems?.forEach((b) => b.classList.toggle('active', b.dataset.target === pageId));
  el.pages?.forEach((section) => section.classList.toggle('active', section.dataset.page === pageId));
  window.scrollTo({ top: 0, behavior: 'smooth' });
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
    updateHomeStatuses();
    updateStatsDisplay();
  });
  el.manualRealtimeToggle?.addEventListener('change', (e) => {
    state.manualRealtime = e.target.checked;
  });
  el.llmToggle?.addEventListener('change', (e) => {
    state.enableLlm = e.target.checked;
    updateHomeStatuses();
  });

  el.newPersonaInline?.addEventListener('click', () => createPersona());
  el.savePersonaBtn?.addEventListener('click', savePersonaForm);
  el.personaNameInput?.addEventListener('input', handlePersonaDraftChange);
  el.personaDescription?.addEventListener('input', handlePersonaDraftChange);
  el.deletePersonaBtn?.addEventListener('click', () => {
    const persona = getActivePersona();
    if (persona) deletePersona(persona.id);
  });
}

async function initPersonas() {
  let remote = null;
  try {
    remote = await window.liveApp?.getPersonas?.();
  } catch {
    // ignore
  }
  const personas = Array.isArray(remote?.personas) && remote.personas.length ? remote.personas : defaultPersonas.slice();
  const fallbackId = personas[0]?.id || defaultPersonas[0]?.id;
  const active = remote?.activeId && personas.some((p) => p.id === remote.activeId) ? remote.activeId : fallbackId;

  personaState.personas = personas;
  personaState.activeId = active;

  const activePersona = getActivePersona();
  if (activePersona) {
    state.stats.lastPersona = activePersona.name || '';
  }
  renderPersonaList();
  renderPersonaDetail();
}

function getActivePersona() {
  return personaState.personas.find((p) => p.id === personaState.activeId) || personaState.personas[0] || null;
}

function isBuiltinPersona(id) {
  return defaultPersonas.some((p) => p.id === id);
}

function personaPreview(text, max = 72) {
  const cleaned = (text || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '点击编辑人设，写下希望 AI 遵守的语气、格式或约束';
  return cleaned.length > max ? `${cleaned.slice(0, max)}...` : cleaned;
}

function renderPersonaList() {
  if (!el.personaList) return;
  el.personaList.innerHTML = '';
  personaState.personas.forEach((persona) => {
    const item = document.createElement('button');
    const isActive = persona.id === personaState.activeId;
    item.className = `persona-item${isActive ? ' active' : ''}`;
    const typeLabel = isBuiltinPersona(persona.id) ? '内置' : '自定义';
    const descPreview = personaPreview(persona.description, 68);
    item.innerHTML = `
      <div class="persona-main">
        <div class="persona-icon">${escapeHtml(persona.icon || '🧩')}</div>
        <div class="persona-info">
          <div class="persona-line">
            <div class="persona-name">${escapeHtml(persona.name || '未命名人设')}</div>
            <span class="persona-tag ${isBuiltinPersona(persona.id) ? 'muted' : 'accent'}">${escapeHtml(typeLabel)}</span>
          </div>
          <div class="persona-desc">${escapeHtml(descPreview)}</div>
        </div>
        <div class="persona-active-dot">${isActive ? '✓' : '>'}</div>
      </div>
    `;
    item.addEventListener('click', () => setActivePersona(persona.id));
    el.personaList.appendChild(item);
  });
}

function renderPersonaDetail() {
  const persona = getActivePersona();
  if (!persona) return;
  if (el.personaNameInput) el.personaNameInput.value = persona.name || '';
  if (el.personaDescription) el.personaDescription.value = persona.description || '';
  renderIconGrid(persona.icon || '');
  updateHeroPersona(persona);
  updatePersonaActions(persona);
}

function updatePersonaActions(persona) {
  const canDelete = Boolean(persona) && !isBuiltinPersona(persona?.id);
  if (el.deletePersonaBtn) {
    el.deletePersonaBtn.disabled = !canDelete;
    el.deletePersonaBtn.title = canDelete ? '删除当前人设' : '内置人设不可删除';
    el.deletePersonaBtn.classList.toggle('disabled', !canDelete);
  }
}

function renderIconGrid(selected) {
  if (!el.personaIconGrid) return;
  el.personaIconGrid.innerHTML = '';
  personaState.icons.forEach((icon) => {
    const btn = document.createElement('button');
    btn.className = `icon-btn${icon === selected ? ' active' : ''}`;
    btn.textContent = icon;
    btn.addEventListener('click', () => {
      const persona = getActivePersona();
      if (persona) {
        persona.icon = icon;
        persistPersonas();
        renderPersonaList();
        renderIconGrid(icon);
        updateHeroPersona(persona);
      }
    });
    el.personaIconGrid.appendChild(btn);
  });
}

function setActivePersona(id) {
  if (!id) return;
  personaState.activeId = id;
  renderPersonaList();
  renderPersonaDetail();
  appendLog(`人设切换为：${getActivePersona()?.name || id}`);
  persistPersonas();
  window.liveApp?.setActivePersona?.(id);
}

function persistPersonas() {
  const payload = { personas: personaState.personas, activeId: personaState.activeId };
  window.liveApp?.savePersonas?.(payload);
}

function handlePersonaDraftChange() {
  const persona = getActivePersona();
  if (!persona) return;
  persona.name = el.personaNameInput?.value || persona.name;
  persona.description = el.personaDescription?.value || persona.description;
  renderPersonaList();
  updateHeroPersona(persona);
}

function savePersonaForm() {
  const persona = getActivePersona();
  if (!persona) return;
  persona.name = (el.personaNameInput?.value || persona.name || '未命名人设').trim();
  persona.description = (el.personaDescription?.value || persona.description || '').trim();
  persistPersonas();
  renderPersonaList();
  renderPersonaDetail();
  appendLog(`已保存人设：${persona.name}`);
}

function createPersona() {
  const newPersona = {
    id: `persona-${Date.now()}`,
    name: '新建人设',
    icon: '💬',
    description: '写下希望 AI 遵守的语气、格式或约束。'
  };
  personaState.personas.unshift(newPersona);
  persistPersonas();
  setActivePersona(newPersona.id);
}

function duplicatePersona() {
  const current = getActivePersona();
  if (!current) {
    createPersona();
    return;
  }
  const clone = {
    ...current,
    id: `persona-${Date.now()}`,
    name: `${current.name} 副本`
  };
  personaState.personas.unshift(clone);
  persistPersonas();
  setActivePersona(clone.id);
}

function deletePersona(personaId) {
  if (isBuiltinPersona(personaId)) {
    appendLog('不能删除内置人设');
    return;
  }
  const idx = personaState.personas.findIndex(p => p.id === personaId);
  if (idx === -1) return;
  const deleted = personaState.personas.splice(idx, 1)[0];
  persistPersonas();
  appendLog(`已删除人设：${deleted.name}`);
  // 如果删除的是当前激活的人设，切换到第一个
  if (personaState.activeId === personaId) {
    const nextId = personaState.personas[0]?.id || defaultPersonas[0].id;
    setActivePersona(nextId);
  } else {
    renderPersonaList();
  }
}

function updateHeroPersona(persona) {
  const name = persona?.name || '人设';
  const desc = personaPreview(persona?.description, 180) || '写下希望 AI 遵守的语气、格式或约束。';
  const builtin = isBuiltinPersona(persona?.id);

  if (el.activePersonaName) el.activePersonaName.textContent = name;
  if (el.statPersona) el.statPersona.textContent = name;
  if (el.homePersonaPill) el.homePersonaPill.textContent = name;
  if (el.homeLatestPersona) el.homeLatestPersona.textContent = name;
  if (el.personaHeroName) el.personaHeroName.textContent = name;
  if (el.personaHeroDesc) el.personaHeroDesc.textContent = desc;
  if (el.personaHeroType) {
    el.personaHeroType.textContent = builtin ? '内置' : '自定义';
    el.personaHeroType.classList.toggle('custom', !builtin);
  }
  state.stats.lastPersona = name || state.stats.lastPersona;
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
  window.liveApp?.getModeDefaults?.().then((defaults) => {
    if (!defaults) return;
    state.autoPaste = defaults.autoPaste ?? true;
    state.manualRealtime = defaults.manualRealtime ?? false;
    state.enableLlm = defaults.enableLlm ?? false;

    if (el.autoPasteToggle) el.autoPasteToggle.checked = state.autoPaste;
    if (el.manualRealtimeToggle) el.manualRealtimeToggle.checked = state.manualRealtime;
    if (el.llmToggle) el.llmToggle.checked = state.enableLlm;
    updateHomeStatuses();
    updateStatsDisplay();
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
    updateHomeStatuses();
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
    updateHomeStatuses();
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
    updateHomeStatuses();
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
  const message = ready ? '模型已就绪' : '缺少必需模型';
  setBadge(el.modelSummary, message, ready ? 'success' : 'warn');
  if (el.modelSummarySecondary) {
    setBadge(el.modelSummarySecondary, message, ready ? 'success' : 'warn');
  }
  setPill(el.homeModelStatus, ready ? '已就绪' : '缺少模型', ready ? 'success' : 'warn');
}

function updateProgressText(label, payload) {
  const setText = (text) => {
    if (el.modelProgressText) el.modelProgressText.textContent = text;
    if (el.modelProgressTextHero) el.modelProgressTextHero.textContent = text;
  };

  if (!payload || payload.status === 'done' || payload.status === 'completed') {
    setText(`${label}: 完成`);
    return;
  }
  if (payload.status === 'error') {
    setText(`${label}: ${payload.message || '下载失败'}`);
    return;
  }
  const pct = payload.percent != null ? `${payload.percent}%` : '';
  const msg = payload.message || payload.status || '下载中';
  setText(`${label}: ${msg} ${pct}`);
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

function listenPersonaUpdates() {
  if (!window.liveApp?.onPersonaUpdated) return;
  window.liveApp.onPersonaUpdated((payload) => {
    if (!payload || !Array.isArray(payload.personas)) return;
    personaState.personas = payload.personas;
    const fallbackId = personaState.personas[0]?.id || personaState.activeId;
    personaState.activeId =
      payload.activeId && personaState.personas.some((p) => p.id === payload.activeId)
        ? payload.activeId
        : fallbackId;
    renderPersonaList();
    renderPersonaDetail();
    updateStatsDisplay();
  });
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
  if (text && state.isRecording) {
    sendOverlayRecording(text);
  }
}

async function updateSecondPass(payload) {
  const text = payload?.segments?.[0]?.text || '';
  let finalText = text || '';
  updateSecondPassText(finalText || '无结果');

  if (!finalText) {
    recordTranscription(finalText);
    sendOverlayState('done', finalText, '识别完成', { autoHideMs: 1500 });
    return;
  }

  if (state.enableLlm) {
    appendLog('[LLM] 正在调用 AI 助手处理...');

    try {
      const prefixResult = await window.liveApp?.getCurrentSelection?.();
      const selectionText = prefixResult?.success ? prefixResult.text : null;
      const persona = getActivePersona();
      const personaPrompt = persona?.description ? `【人设：${persona.name}】${persona.description}` : '';
      const combinedPrefix = [personaPrompt, selectionText].filter(Boolean).join('\n');

      if (selectionText) {
        appendLog(`[LLM] 检测到选中文本: "${selectionText.slice(0, 50)}${selectionText.length > 50 ? '...' : ''}"`);
      }

      const llmResult = await window.liveApp?.llmProcess?.(text, combinedPrefix || null);

      if (llmResult?.success && llmResult?.text) {
        const processedText = llmResult.text;
        finalText = processedText;
        appendLog(`[LLM] AI 助手处理结果: ${processedText}`);
        updateSecondPassText(processedText);
        await pasteSecondPassResult(processedText);
      } else {
        appendLog('[LLM] 处理失败，使用原始识别结果', 'warn');
        await pasteSecondPassResult(text);
      }
    } catch (err) {
      appendLog(`[LLM] 处理异常: ${err.message || err}`, 'error');
      await pasteSecondPassResult(text);
    }
  } else {
    await pasteSecondPassResult(finalText);
  }

  recordTranscription(finalText);
  sendOverlayState('done', finalText, '识别完成', { autoHideMs: 1500 });
}

function updateSecondPassText(text) {
  if (el.secondPassText) {
    el.secondPassText.textContent = text;
  }
}

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

function setPill(node, text, level = 'muted') {
  if (!node) return;
  node.classList.remove('success', 'warn', 'error', 'muted');
  node.classList.add(level);
  node.textContent = text;
}

function formatNumber(num) {
  const safe = Number.isFinite(num) ? num : 0;
  return safe.toLocaleString('zh-CN');
}

function updateHomeStatuses() {
  setPill(el.homeMicStatus, statusLabel(state.micStatus), statusBadgeClass(state.micStatus));
  const ready = state.models.sense && state.models.streaming;
  setPill(el.homeModelStatus, ready ? '已就绪' : '缺少模型', ready ? 'success' : 'warn');
  setPill(el.homeLlmStatus, state.enableLlm ? '开启' : '关闭', state.enableLlm ? 'success' : 'muted');
  if (el.statAutoPaste) {
    el.statAutoPaste.textContent = state.autoPaste ? '开启' : '关闭';
  }
  if (el.homeTimelineStatus) {
    el.homeTimelineStatus.textContent = state.enableLlm ? 'LLM 精修开启' : '转写就绪';
    el.homeTimelineStatus.className = `timeline-status ${state.enableLlm ? 'ready' : 'muted'}`;
  }
}

function updateStatsDisplay(lastLength = null) {
  const words = Math.max(0, Math.round(state.stats.totalChars / 2));
  const timeSaved = Math.max(0, Math.round(words / 40));
  if (el.statChars) el.statChars.textContent = formatNumber(words);
  if (el.statWords) el.statWords.textContent = formatNumber(words);
  if (el.statTimeSaved) el.statTimeSaved.textContent = formatNumber(timeSaved);
  if (el.statSessions) el.statSessions.textContent = formatNumber(state.stats.sessions);
  if (el.statSessionsSub) el.statSessionsSub.textContent = formatNumber(state.stats.sessions);
  if (el.heroCollabCount) el.heroCollabCount.textContent = formatNumber(state.stats.sessions);
  if (el.statPersona) el.statPersona.textContent = state.stats.lastPersona || getActivePersona()?.name || '人设';
  if (el.homeLatestPersona) el.homeLatestPersona.textContent = state.stats.lastPersona || getActivePersona()?.name || '人设';
  if (el.homePersonaPill) el.homePersonaPill.textContent = state.stats.lastPersona || getActivePersona()?.name || '人设';
  if (el.statAutoPaste) el.statAutoPaste.textContent = state.autoPaste ? '开启' : '关闭';

  const latestLen = lastLength != null ? lastLength : (state.stats.lastText || '').length;
  if (el.homeLatestLength) el.homeLatestLength.textContent = `${latestLen} 字`;
  if (el.homeLatestTime) {
    const timeText = state.stats.lastTime ? new Date(state.stats.lastTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
    el.homeLatestTime.textContent = timeText;
  }
  if (el.lastTranscriptionText) {
    el.lastTranscriptionText.textContent = state.stats.lastText || '等待开始';
  }
  renderHistoryList();
}

function recordTranscription(text) {
  const content = text || '';
  const personaName = getActivePersona()?.name || '人设';
  state.stats.lastPersona = personaName;
  state.stats.lastText = content || '等待开始';
  state.stats.lastTime = Date.now();
  const trimmed = content.trim();
  const hasContent = Boolean(trimmed);
  if (hasContent) {
    state.stats.totalChars += content.length;
    state.stats.sessions += 1;
  }
  addHistoryEntry({
    text: hasContent ? content : '转写失败',
    persona: personaName,
    time: state.stats.lastTime,
    length: content.length,
    status: hasContent ? 'ok' : 'error'
  });
  updateStatsDisplay(content.length);
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

function addHistoryEntry(entry) {
  state.history.unshift({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    ...entry
  });
  state.history = state.history.slice(0, 50);
  persistHistory();
}

function renderHistoryList() {
  if (!el.homeHistoryList) return;
  el.homeHistoryList.innerHTML = '';
  if (!state.history.length) {
    const empty = document.createElement('div');
    empty.className = 'history-empty';
    empty.textContent = '暂无历史记录';
    el.homeHistoryList.appendChild(empty);
    return;
  }

  state.history.forEach((item) => {
    const node = document.createElement('div');
    node.className = `history-row ${item.status || 'ok'}`;
    const timeText = item.time ? new Date(item.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
    const statusText = item.status === 'error' ? '⚠️ 转写失败' : '✓ 转写完成';
    node.innerHTML = `
      <div class="timeline-time">${escapeHtml(timeText)}</div>
      <div class="history-card">
        <div class="timeline-head">
          <div class="timeline-meta">
            <span class="pill">${escapeHtml(item.persona || '人设')}</span>
            <span class="pill hollow">${formatNumber(Math.max(0, item.length || 0))} 字</span>
          </div>
          <div class="timeline-status ${item.status === 'error' ? 'error' : 'ready'}">
            ${escapeHtml(statusText)}
          </div>
        </div>
        <div class="timeline-text">${escapeHtml(item.text || '无结果')}</div>
      </div>
    `;
    el.homeHistoryList.appendChild(node);
  });
}

function hydrateHistory() {
  try {
    const raw = window.localStorage?.getItem?.(historyState.storageKey);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      state.history = parsed.slice(0, 50);
    }
  } catch (err) {
    // ignore parse errors
  }
}

function persistHistory() {
  try {
    window.localStorage?.setItem?.(historyState.storageKey, JSON.stringify(state.history));
  } catch (err) {
    // ignore write errors
  }
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
  return (text || '')
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
