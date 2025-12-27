const models = {
  sense: { name: 'SenseVoice 2pass', desc: '二次精修，提升准确率', label: 'SenseVoice' },
  stream: { name: 'ZipFormer Streaming', desc: '实时一遍，保持流畅', label: '流式' },
  punct: { name: '标点模型', desc: '补全标点、格式', label: '标点' },
  vad: { name: 'VAD (Silero)', desc: '语音活动检测', label: 'VAD' }
};

const state = {
  progress: {
    sense: { status: 'idle', percent: 0, message: '等待下载' },
    stream: { status: 'idle', percent: 0, message: '等待下载' },
    punct: { status: 'idle', percent: 0, message: '等待下载' },
    vad: { status: 'idle', percent: 0, message: '等待下载' }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  renderList();
  wireEvents();
  attachProgressListeners();
  startCheck();
});

function renderList() {
  const list = document.getElementById('modelList');
  list.innerHTML = '';
  Object.entries(models).forEach(([key, meta]) => {
    const row = document.createElement('div');
    row.className = 'model-row';
    row.innerHTML = `
      <div class="model-head">
        <div>
          <div class="model-name">${meta.name}</div>
          <div class="model-desc">${meta.desc}</div>
        </div>
        <div class="pill" id="${key}StatusPill">待检测</div>
      </div>
      <div class="model-progress">
        <div class="bar" id="${key}Bar"></div>
        <div class="status" id="${key}StatusText">等待下载</div>
      </div>
    `;
    list.appendChild(row);
  });
}

function wireEvents() {
  document.getElementById('retryBtn')?.addEventListener('click', startCheck);
  document.getElementById('enterBtn')?.addEventListener('click', () => {
    window.liveApp?.startupComplete?.();
  });
}

function attachProgressListeners() {
  window.liveApp?.onModelProgress?.((payload) => handleProgress('sense', payload));
  window.liveApp?.onStreamingProgress?.((payload) => handleProgress('stream', payload));
  window.liveApp?.onPunctuationProgress?.((payload) => handleProgress('punct', payload));
  window.liveApp?.onVadProgress?.((payload) => handleProgress('vad', payload));
}

async function startCheck() {
  updateOverall('检测模型状态...', '准备检测');
  setEnterEnabled(false);
  try {
    const [sense, stream, punct, vad] = await Promise.all([
      window.liveApp?.checkModel?.(),
      window.liveApp?.checkStreamingModel?.(),
      window.liveApp?.checkPunctuationModel?.(),
      window.liveApp?.checkVadModel?.()
    ]);

    const missing = [];
    if (sense) markDone('sense', '已就绪');
    else missing.push(downloadModel('sense'));
    if (stream) markDone('stream', '已就绪');
    else missing.push(downloadModel('stream'));
    if (punct) markDone('punct', '已就绪');
    else missing.push(downloadModel('punct'));
    if (vad) markDone('vad', '已就绪');
    else missing.push(downloadModel('vad'));

    if (!missing.length) {
      updateOverall('全部模型已就绪，即将进入应用', '全部就绪');
      setEnterEnabled(true);
      window.liveApp?.startupComplete?.();
      return;
    }
    updateOverall('缺失模型，正在自动下载...', '下载中');
    await Promise.allSettled(missing);
    const allReady = await recheck();
    if (allReady) {
      updateOverall('全部模型已就绪，即将进入应用', '全部就绪');
      setEnterEnabled(true);
      window.liveApp?.startupComplete?.();
    } else {
      updateOverall('部分模型下载失败，请重试', '下载失败', true);
    }
  } catch (err) {
    console.error(err);
    updateOverall(`检测异常：${err?.message || err}`, '下载失败', true);
  }
}

async function recheck() {
  const [sense, stream, punct, vad] = await Promise.all([
    window.liveApp?.checkModel?.(),
    window.liveApp?.checkStreamingModel?.(),
    window.liveApp?.checkPunctuationModel?.(),
    window.liveApp?.checkVadModel?.()
  ]);
  if (sense) markDone('sense', '已就绪');
  if (stream) markDone('stream', '已就绪');
  if (punct) markDone('punct', '已就绪');
  if (vad) markDone('vad', '已就绪');
  return sense && stream && punct && vad;
}

function handleProgress(key, payload) {
  const percent = typeof payload?.percent === 'number' ? Math.max(0, Math.min(100, Math.round(payload.percent))) : state.progress[key]?.percent || 0;
  const status = payload?.status || 'downloading';
  const message = payload?.message || status;
  state.progress[key] = { status, percent, message };
  const bar = document.getElementById(`${key}Bar`);
  const text = document.getElementById(`${key}StatusText`);
  const pill = document.getElementById(`${key}StatusPill`);
  if (bar) {
    bar.style.setProperty('--pct', `${percent}%`);
    bar.classList.toggle('done', status === 'done' || status === 'completed');
    bar.classList.toggle('error', status === 'error');
  }
  if (text) {
    const pctText = payload?.percent != null ? ` ${percent}%` : '';
    text.textContent = `${models[key].label}: ${message}${pctText}`;
    text.classList.toggle('error', status === 'error');
    text.classList.toggle('done', status === 'done' || status === 'completed');
  }
  if (pill) {
    pill.textContent = statusText(status);
    pill.style.background = pillBg(status);
    pill.style.color = pillColor(status);
  }
}

function markDone(key, message = '已就绪') {
  handleProgress(key, { status: 'done', percent: 100, message });
}

function statusText(status) {
  if (status === 'done' || status === 'completed') return '已就绪';
  if (status === 'error') return '下载失败';
  if (status === 'extracting') return '解压中';
  if (status === 'starting') return '准备中';
  return '下载中';
}

function pillBg(status) {
  if (status === 'done' || status === 'completed') return '#e9f8f0';
  if (status === 'error') return '#fff1eb';
  return '#fff6ed';
}

function pillColor(status) {
  if (status === 'done' || status === 'completed') return '#15803d';
  if (status === 'error') return '#c2410c';
  return '#c8641b';
}

async function downloadModel(key) {
  try {
    handleProgress(key, { status: 'starting', percent: 0, message: '开始下载' });
    if (key === 'sense') return await window.liveApp?.downloadModel?.();
    if (key === 'stream') return await window.liveApp?.downloadStreamingModel?.();
    if (key === 'punct') return await window.liveApp?.downloadPunctuationModel?.();
    if (key === 'vad') return await window.liveApp?.downloadVadModel?.();
  } catch (err) {
    handleProgress(key, { status: 'error', message: err?.message || err });
    throw err;
  }
}

function updateOverall(message, pillText, isError = false) {
  const hint = document.getElementById('hintText');
  const pill = document.getElementById('overallStatus');
  if (hint) hint.textContent = message;
  if (pill) {
    pill.textContent = pillText || '状态';
    pill.style.background = isError ? '#fff1eb' : '#fff6ed';
    pill.style.color = isError ? '#c2410c' : '#c8641b';
  }
}

function setEnterEnabled(enabled) {
  const btn = document.getElementById('enterBtn');
  if (btn) btn.disabled = !enabled;
}
