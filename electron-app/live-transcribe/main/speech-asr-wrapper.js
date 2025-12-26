/**
 * SpeechASR Wrapper
 *
 * 封装 SpeechASR 实例，提供统一的实时转写 API
 * 从 main.js 迁移而来
 */

const { SpeechASR, DEFAULT_OPTIONS } = require('@sherpa-onnx/speech-asr');
const path = require('path');
const fs = require('fs');

// 模块状态
let speechAsr = null;
let liveSessionMode = null;
let liveModelsLoaded = false;

// 外部依赖（由主应用注入）
let config = {
  getResourceBase: null,
  resolveBundledPython: null,
  getPythonScriptPath: null,
  getModelPaths: null,
  getStreamingModelPaths: null,
  getPunctuationPaths: null,
  getVadPaths: null,
  // 结果回调
  onResult: null
};

// 常量
const PYTHON_NOT_FOUND_MESSAGE = '未找到 Python 环境，请确保已安装 Python 3.8+';

/**
 * 初始化配置
 */
function init(options) {
  config = { ...config, ...options };
}

/**
 * 初始化 SpeechASR 实例
 * 如果传入外部 SpeechASR 实例，使用它；否则创建新的
 */
function initSpeechAsr(options) {
  if (speechAsr) {
    console.warn('[LiveTranscribe] SpeechASR already initialized');
    return speechAsr;
  }

  // 如果传入了外部 SpeechASR 实例，直接使用它
  const externalAsr = options.externalSpeechAsr || config.externalSpeechAsr;
  if (externalAsr) {
    speechAsr = externalAsr;
    console.log('[LiveTranscribe] Using external SpeechASR instance');
    return speechAsr;
  }

  const {
    getResourceBase = config.getResourceBase,
    resolveBundledPython = config.resolveBundledPython,
    sampleRate = 16000,
    bufferSize = 1600
  } = options;

  speechAsr = new SpeechASR({
    twoPass: { enabled: true, backend: 'python' },
    assetBaseUrl: getResourceBase(),
    pythonPath: resolveBundledPython() || undefined,
    sampleRate,
    bufferSize,
    onTwoPassStart: () => sendResult({ type: 'log', message: '启动两段式实时识别 (ZipFormer -> SenseVoice)...' }),
    onReady: () => sendResult({ type: 'ready' }),
    onPartial: (text) => sendResult({ type: 'first-pass', text }),
    onTwoPassResult: (payload) => sendResult(payload),
    onResult: (payload) => {
      if (!payload?.stage) {
        sendResult(payload);
      }
    },
    onTwoPassError: (payload) =>
      sendResult({
        type: 'error',
        message: payload?.message || '实时转写出错',
        detail: payload?.detail
      }),
    onError: (payload) =>
      sendResult({
        type: 'error',
        message: payload?.message || '实时转写出错',
        detail: payload?.detail
      })
  });

  // 绑定事件监听器
  speechAsr.on('log', (payload) => sendResult(payload));
  speechAsr.on('devices', (payload) => sendResult(payload));
  speechAsr.on('complete', (payload) => {
    resetLiveSessionState();
    sendResult(payload);
  });
  speechAsr.on('error', (payload) => console.error('[LiveTranscribe] SpeechASR error event:', payload));

  console.log('[LiveTranscribe] SpeechASR initialized');
  return speechAsr;
}

/**
 * 设置结果回调
 */
function setResultCallbacks(callbacks) {
  if (callbacks.onResult) {
    config.onResult = callbacks.onResult;
  }
}

/**
 * 发送结果到回调
 */
function sendResult(payload) {
  if (config.onResult) {
    config.onResult(payload);
  }
}

/**
 * 重置实时会话状态
 */
function resetLiveSessionState() {
  liveSessionMode = null;
  liveModelsLoaded = false;
}

/**
 * 解析 SenseVoice 模型文件
 */
function resolveSenseVoiceFiles(modelDir) {
  if (!modelDir || !fs.existsSync(modelDir)) return null;
  const model = resolveSenseVoiceModel(modelDir);
  const tokens = path.join(modelDir, 'tokens.txt');
  if (!model || !fs.existsSync(tokens)) return null;
  return { model, tokens, modelDir };
}

/**
 * 解析 SenseVoice 模型路径
 */
function resolveSenseVoiceModel(modelDir) {
  const int8Path = path.join(modelDir, 'model.int8.onnx');
  const fpPath = path.join(modelDir, 'model.onnx');
  if (fs.existsSync(fpPath)) return fpPath;
  if (fs.existsSync(int8Path)) return int8Path;
  return null;
}

/**
 * 解析标点模型路径
 */
function resolvePunctuationModel(modelDir) {
  const int8Path = path.join(modelDir, 'model.int8.onnx');
  const fpPath = path.join(modelDir, 'model.onnx');
  if (fs.existsSync(fpPath)) return fpPath;
  if (fs.existsSync(int8Path)) return int8Path;
  return null;
}

/**
 * 解析流式 ZipFormer 模型组件
 */
function resolveStreamingZipformerComponents(modelDir) {
  if (!modelDir || !fs.existsSync(modelDir)) return null;

  const candidates = (baseNames) => {
    for (const base of baseNames) {
      const int8Path = path.join(modelDir, `${base}.int8.onnx`);
      const fpPath = path.join(modelDir, `${base}.onnx`);
      if (fs.existsSync(fpPath)) return fpPath;
      if (fs.existsSync(int8Path)) return int8Path;
    }
    // fallback: scan for the first matching pattern
    const anyMatch = fs
      .readdirSync(modelDir)
      .filter((f) => f.endsWith('.onnx') && baseNames.some((b) => f.includes(b)))
      .map((f) => path.join(modelDir, f))[0];
    return anyMatch || null;
  };

  const encoder = candidates(['encoder-epoch-99-avg-1', 'encoder-epoch-12-avg-4', 'encoder']);
  const decoder = candidates(['decoder-epoch-99-avg-1', 'decoder-epoch-12-avg-4', 'decoder']);
  const joiner = candidates(['joiner-epoch-99-avg-1', 'joiner-epoch-12-avg-4', 'joiner']);
  const tokens = path.join(modelDir, 'tokens.txt');

  if (!encoder || !decoder || !joiner || !fs.existsSync(tokens)) {
    return null;
  }

  return { encoder, decoder, joiner, tokens };
}

/**
 * 检查模型是否存在
 */
function modelExists() {
  const { modelDir } = config.getModelPaths();
  return (
    fs.existsSync(path.join(modelDir, 'model.int8.onnx')) ||
    fs.existsSync(path.join(modelDir, 'model.onnx'))
  );
}

function streamingModelExists() {
  const { modelDir } = config.getStreamingModelPaths();
  return Boolean(resolveStreamingZipformerComponents(modelDir));
}

function punctuationModelExists() {
  const { modelDir } = config.getPunctuationPaths();
  return (
    fs.existsSync(path.join(modelDir, 'model.int8.onnx')) ||
    fs.existsSync(path.join(modelDir, 'model.onnx'))
  );
}

function vadModelExists() {
  const { modelPath } = config.getVadPaths();
  return fs.existsSync(modelPath);
}

/**
 * 构建实时转写运行时配置
 * 从 main.js 迁移
 */
function buildLiveSessionRuntime(mode, payload = {}) {
  console.log('===== [LiveTranscribe] buildLiveSessionRuntime START =====');
  console.log('[LiveTranscribe] mode:', mode);
  console.log('[LiveTranscribe] payload?.manualRealtime:', payload?.manualRealtime);
  console.log('[LiveTranscribe] Boolean(payload?.manualRealtime):', Boolean(payload?.manualRealtime));

  if (!modelExists()) {
    return { success: false, message: 'SenseVoice 模型未就绪，请先下载' };
  }
  if (!streamingModelExists()) {
    return { success: false, message: '流式 ZipFormer 模型未就绪，请先下载' };
  }

  const pythonPath = config.resolveBundledPython();
  if (!pythonPath) {
    return { success: false, message: PYTHON_NOT_FOUND_MESSAGE };
  }

  const { modelDir } = config.getModelPaths();
  const senseVoice = resolveSenseVoiceFiles(modelDir);
  if (!senseVoice) {
    return { success: false, message: '未找到 SenseVoice 模型或 tokens.txt' };
  }

  const { modelDir: streamingDir } = config.getStreamingModelPaths();
  const streaming = resolveStreamingZipformerComponents(streamingDir);
  if (!streaming) {
    return { success: false, message: '未找到 ZipFormer 流式模型完整文件（encoder/decoder/joiner/tokens）' };
  }

  const punctuationReady = punctuationModelExists();
  const { modelPath: defaultVadModel } = config.getVadPaths();
  const vadModelPath = fs.existsSync(defaultVadModel) ? defaultVadModel : '';
  const vadOpt = payload?.vad || {};
  const vadDefaults = DEFAULT_OPTIONS.vad.silero;
  const sileroCfg = {
    threshold: typeof vadOpt.threshold === 'number' ? vadOpt.threshold : vadDefaults.threshold,
    minSilenceDuration:
      typeof vadOpt.minSilence === 'number' ? vadOpt.minSilence : vadDefaults.minSilenceDuration,
    minSpeechDuration:
      typeof vadOpt.minSpeech === 'number' ? vadOpt.minSpeech : vadDefaults.minSpeechDuration,
    maxSpeechDuration:
      typeof vadOpt.maxSpeech === 'number' ? vadOpt.maxSpeech : vadDefaults.maxSpeechDuration
  };

  const runtime = {
    device: payload?.micName,
    numThreads: payload?.numThreads || 2,
    numThreadsSecond: payload?.numThreadsSecond || payload?.numThreads || 4,
    sampleRate: payload?.sampleRate || speechAsr?.activeOptions?.sampleRate || 16000,
    bufferSize: payload?.bufferSize || speechAsr?.activeOptions?.bufferSize || 1600,
    pythonPath,
    manualRealtime: Boolean(payload?.manualRealtime),
    vadMode: vadModelPath ? 'silero' : 'off',
    vad: { silero: sileroCfg },
    modelPaths: {
      streaming,
      secondPass: senseVoice,
      vadModel: vadModelPath,
      workingDir: config.getResourceBase(),
      scriptPath: config.getPythonScriptPath ? config.getPythonScriptPath() : null
    }
  };

  console.log('[LiveTranscribe] runtime.manualRealtime (final):', runtime.manualRealtime);
  console.log('[LiveTranscribe] buildLiveSessionRuntime END =====');
  return { success: true, runtime, punctuationReady, vadReady: Boolean(vadModelPath) };
}

/**
 * 加载实时模型
 */
async function loadLiveModels(payload) {
  const mode = payload?.mode === 'manual' ? 'manual' : 'auto';
  const runtime = buildLiveSessionRuntime(mode, payload);

  if (!runtime.success) {
    return runtime;
  }

  const { runtime: rt, punctuationReady, vadReady } = runtime;

  if (speechAsr && speechAsr.isRunning()) {
    if (speechAsr.isManual() !== (mode === 'manual')) {
      const switched = await speechAsr.switchMode(mode);
      if (!switched?.success) {
        return { success: false, message: switched?.message || '切换模式失败' };
      }
    }
    liveSessionMode = mode;
    liveModelsLoaded = true;
    return { success: true, mode: liveSessionMode, punctuationReady, vadReady, reused: true };
  }

  try {
    const startResult = await speechAsr.live({
      action: 'start',
      mode,
      startPaused: mode === 'auto',
      autoStart: false,
      ...rt
    });

    if (!startResult?.success) {
      return { success: false, message: startResult?.message || '加载实时模型失败' };
    }

    liveSessionMode = mode;
    liveModelsLoaded = true;

    return {
      success: true,
      mode: liveSessionMode,
      punctuationReady,
      vadReady,
      reused: startResult.reused
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

/**
 * 释放实时模型
 */
async function releaseLiveModels() {
  try {
    if (speechAsr && speechAsr.isRunning()) {
      if (speechAsr.isManual()) {
        await speechAsr.stopManualSession();
      } else {
        await speechAsr.stop();
      }
    }
    resetLiveSessionState();
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

/**
 * 启动实时采集
 */
async function startLiveCapture(payload) {
  const mode = payload?.mode === 'manual' ? 'manual' : 'auto';
  const runtime = buildLiveSessionRuntime(mode, payload);

  if (!runtime.success) {
    return runtime;
  }

  const { runtime: rt } = runtime;

  if (speechAsr && speechAsr.isRunning()) {
    try {
      if (speechAsr.isManual() !== (mode === 'manual')) {
        const switched = await speechAsr.switchMode(mode);
        if (!switched?.success) {
          return { success: false, message: switched?.message || '切换模式失败' };
        }
      }
      const reuse = await speechAsr.live({
        action: 'start',
        mode,
        autoStart: true,
        manualRealtime: rt.manualRealtime,
        modelPaths: rt.modelPaths
      });
      liveSessionMode = mode;
      liveModelsLoaded = true;
      return reuse;
    } catch (err) {
      return { success: false, message: err.message };
    }
  }

  try {
    const startResult = await speechAsr.live({
      action: 'start',
      mode,
      autoStart: true,
      startPaused: false,
      ...rt
    });

    if (!startResult?.success) {
      return { success: false, message: startResult?.message || '启动实时识别失败' };
    }

    liveSessionMode = mode;
    liveModelsLoaded = true;
    return startResult;
  } catch (err) {
    return { success: false, message: err.message };
  }
}

/**
 * 停止实时采集
 */
async function stopLiveCapture(payload) {
  const mode = payload?.mode === 'manual' ? 'manual' : 'auto';

  if (!liveModelsLoaded || liveSessionMode !== mode) {
    return { success: false, message: '当前没有对应模式的实时会话' };
  }

  try {
    if (mode === 'manual' && payload?.source !== 'key-up') {
      return { success: false, message: '仅按键松开时可结束按键录音' };
    }

    if (!speechAsr || !speechAsr.isRunning()) {
      return { success: true };
    }

    return await speechAsr.live({ action: 'stop', mode });
  } catch (err) {
    return { success: false, message: err.message };
  }
}

/**
 * 切换麦克风设备
 */
async function switchDevice(target) {
  if (!speechAsr || !speechAsr.isRunning()) {
    return { success: false, message: '当前没有实时会话在运行' };
  }

  try {
    const result = await speechAsr.switchDevice(target);
    if (!result?.success) {
      return { success: false, message: result?.message || '切换麦克风失败' };
    }
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

/**
 * Push-to-Talk 单次转写
 */
async function pushToTalkAsr(arrayBuffer, mimeType, options) {
  if (!speechAsr) {
    return { success: false, message: 'SpeechASR 未初始化' };
  }

  try {
    return await speechAsr.transcribeAudio(arrayBuffer, {
      mimeType: mimeType || 'audio/wav',
      ...options
    });
  } catch (err) {
    return { success: false, message: err.message };
  }
}

/**
 * 清理资源
 */
function cleanup() {
  if (speechAsr) {
    speechAsr.stop();
  }
  speechAsr = null;
  resetLiveSessionState();
}

module.exports = {
  init,
  initSpeechAsr,
  setResultCallbacks,
  loadLiveModels,
  releaseLiveModels,
  startLiveCapture,
  stopLiveCapture,
  switchDevice,
  pushToTalkAsr,
  buildLiveSessionRuntime,
  resolveSenseVoiceModel,
  resolvePunctuationModel,
  resolveStreamingZipformerComponents,
  resolveSenseVoiceFiles,
  modelExists,
  streamingModelExists,
  punctuationModelExists,
  vadModelExists,
  cleanup,
  // 状态访问
  getSpeechAsr: () => speechAsr,
  isRunning: () => speechAsr?.isRunning() || false,
  isManual: () => speechAsr?.isManual() || false,
  getSessionMode: () => liveSessionMode,
  isModelsLoaded: () => liveModelsLoaded
};
