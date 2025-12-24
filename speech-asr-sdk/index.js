const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');

const DEFAULT_SCRIPT = path.join(__dirname, 'two_pass_microphone_asr_electron.py');
const DEFAULT_PYTHON_ENV_VAR = 'SPEECH_ASR_PYTHON';

const DEFAULT_OPTIONS = {
  vadMode: 'off',
  onlineModel: 'zipformer',
  modelPaths: {},
  twoPass: {
    enabled: false,
    backend: 'wasm'
  },
  manualRealtime: false,
  punctuation: {
    enabled: false,
    modelPath: ''
  },
  vad: {
    silero: {
      threshold: 0.5,
      minSilenceDuration: 0.3,
      minSpeechDuration: 0.25,
      maxSpeechDuration: 20,
      windowSize: 512
    },
    bufferSizeInSeconds: 60
  },
  sampleRate: 16000,
  bufferSize: 4096,
  onResult: null,
  onPunctuated: null,
  onPartial: null,
  onTwoPassResult: null,
  onTwoPassError: null,
  onTwoPassStart: null,
  onError: null,
  onReady: null,
  assetBaseUrl: '',
  pythonPath: 'python'
};

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function mergeOptions(base, override) {
  const output = { ...base };
  Object.keys(override || {}).forEach((key) => {
    const b = base ? base[key] : undefined;
    const o = override[key];
    if (isPlainObject(b) && isPlainObject(o)) {
      output[key] = mergeOptions(b, o);
    } else {
      output[key] = o;
    }
  });
  return output;
}

function ensureFileExists(filePath, label) {
  if (!filePath) {
    throw new Error(`${label} is required`);
  }
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`${label} not found: ${resolved}`);
  }
  return resolved;
}

class SpeechASR extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = mergeOptions(DEFAULT_OPTIONS, options);
    this.activeOptions = this.options;
    this.child = null;
    this.stdoutBuffer = '';
    this.manualMode = false;
    this.controlled = false;
  }

  isRunning() {
    return Boolean(this.child);
  }

  isManual() {
    return Boolean(this.manualMode);
  }

  isControlled() {
    return Boolean(this.controlled);
  }

  async start(sessionOptions = {}) {
    if (this.child) {
      return { success: false, message: 'SpeechASR session is already running' };
    }

    const runtime = mergeOptions(this.options, sessionOptions);
    runtime.modelPaths = mergeOptions(this.options.modelPaths || {}, sessionOptions.modelPaths || {});
    runtime.vad = mergeOptions(this.options.vad || {}, sessionOptions.vad || {});
    runtime.twoPass = mergeOptions(this.options.twoPass || {}, sessionOptions.twoPass || {});
    runtime.punctuation = mergeOptions(this.options.punctuation || {}, sessionOptions.punctuation || {});
    this.activeOptions = runtime;
    const needsControl = Boolean(runtime.startPaused || runtime.controlled);
    this.controlled = needsControl;
    this.manualMode = false;

    if (runtime.twoPass && runtime.twoPass.enabled === false) {
      return { success: false, message: 'Two-pass ASR is disabled via options' };
    }

    let resolvedPaths;
    try {
      resolvedPaths = this._resolveModelPaths(runtime.modelPaths, runtime);
    } catch (err) {
      return { success: false, message: err.message };
    }

    const args = this._buildArgs(runtime, resolvedPaths);
    const env = this._buildEnv(runtime, resolvedPaths);

    const pythonBin = this._resolvePythonPath(runtime);

    try {
      this.child = spawn(pythonBin, args, {
        cwd: resolvedPaths.workingDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env
      });
    } catch (err) {
      this.controlled = false;
      return { success: false, message: err.message };
    }

    this.stdoutBuffer = '';
    this._emitEvent('two-pass-start', { type: 'log', message: 'Starting two-pass ASR session' });

    this.child.stdout.on('data', (data) => this._handleStdout(data));
    this.child.stderr.on('data', (data) => this._handleStderr(data));

    this.child.on('close', (code) => {
      this.child = null;
      this.manualMode = false;
      this.controlled = false;
      if (code && code !== 0) {
        const payload = { type: 'error', message: `ASR process exited with code ${code}` };
        this._emitEvent('two-pass-error', payload);
        this._emitEvent('error', payload);
      }
      this._emitEvent('complete', {
        type: 'complete',
        code,
        message: code ? `ASR exited with code ${code}` : 'ASR session completed'
      });
    });

    this.child.on('error', (err) => {
      const payload = { type: 'error', message: err.message };
      this._emitEvent('two-pass-error', payload);
      this._emitEvent('error', payload);
    });

    return { success: true };
  }

  async startManualRecording(sessionOptions = {}) {
    const autoStart = sessionOptions?.autoStart !== false;

    console.log('===== [SpeechASR] startManualRecording START =====');
    console.log('[SpeechASR] sessionOptions:', JSON.stringify(sessionOptions, null, 2));
    console.log('[SpeechASR] this.child:', !!this.child);
    console.log('[SpeechASR] this.manualMode:', this.manualMode);

    if (this.child && this.manualMode) {
      // 进程已经存在，直接复用（不检查 manualRealtime 变化）
      // manualRealtime 只在进程首次启动时生效，运行时修改需要重新加载模型
      console.log('[SpeechASR] startManualRecording: reusing existing process');
      console.log('[SpeechASR] Note: manualRealtime is locked to initial value, requires model reload to change');
      if (autoStart) {
        this._sendCommand('start');
      }
      return { success: true, reused: true };
    }

    const runtime = mergeOptions(this.options, sessionOptions);
    runtime.manualMode = true;
    runtime.twoPass = { enabled: true };
    runtime.modelPaths = mergeOptions(this.options.modelPaths || {}, sessionOptions.modelPaths || {});
    runtime.vad = mergeOptions(this.options.vad || {}, sessionOptions.vad || {});
    runtime.punctuation = mergeOptions(this.options.punctuation || {}, sessionOptions.punctuation || {});
    this.activeOptions = runtime;
    console.log('[SpeechASR] startManualRecording: runtime.manualRealtime=', runtime.manualRealtime);
    console.log('[SpeechASR] startManualRecording: runtime.device=', runtime.device);
    this.controlled = false;

    let resolvedPaths;
    try {
      resolvedPaths = this._resolveModelPaths(runtime.modelPaths, runtime);
    } catch (err) {
      return { success: false, message: err.message };
    }

    const args = this._buildArgs(runtime, resolvedPaths);
    // Note: --manual-mode is already added by _buildArgs() if runtime.manualMode is true
    const env = this._buildEnv(runtime, resolvedPaths);
    const pythonBin = this._resolvePythonPath(runtime);

    console.log('[SpeechASR] startManualRecording: Spawning Python process...');
    console.log('[SpeechASR] pythonBin:', pythonBin);
    console.log('[SpeechASR] args:', JSON.stringify(args, null, 2));
    console.log('[SpeechASR] cwd:', resolvedPaths.workingDir);

    try {
      this.child = spawn(pythonBin, args, {
        cwd: resolvedPaths.workingDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env
      });
      this.manualMode = true;
      this.controlled = false;
    } catch (err) {
      return { success: false, message: err.message };
    }

    this.stdoutBuffer = '';
    this._emitEvent('two-pass-start', { type: 'log', message: '启动按键录音模式（仅二次识别）' });

    this.child.stdout.on('data', (data) => this._handleStdout(data));
    this.child.stderr.on('data', (data) => this._handleStderr(data));
    this.child.on('close', (code) => {
      this.child = null;
      this.manualMode = false;
      this.controlled = false;
      if (code && code !== 0) {
        const payload = { type: 'error', message: `ASR process exited with code ${code}` };
        this._emitEvent('two-pass-error', payload);
        this._emitEvent('error', payload);
      }
      this._emitEvent('complete', {
        type: 'complete',
        code,
        message: code ? `ASR exited with code ${code}` : 'ASR session completed'
      });
    });
    this.child.on('error', (err) => {
      const payload = { type: 'error', message: err.message };
      this._emitEvent('two-pass-error', payload);
      this._emitEvent('error', payload);
    });

    // 开始录音命令
    if (autoStart) {
      this._sendCommand('start');
    }
    return { success: true, reused: false };
  }

  async stopManualRecording() {
    if (!this.child || !this.manualMode) {
      return { success: false, message: 'Manual recording not running' };
    }
    try {
      this._sendCommand('stop');
    } catch (err) {
      return { success: false, message: err.message };
    }
    return { success: true };
  }

  async stopManualSession() {
    if (this.child && this.manualMode) {
      this.child.kill();
      this.child = null;
      this.manualMode = false;
      this.controlled = false;
      return { success: true };
    }
    return { success: false, message: 'Manual session not running' };
  }

  async startCapture() {
    if (!this.child) {
      return { success: false, message: 'No ASR session is running' };
    }
    if (!(this.controlled || this.manualMode)) {
      return { success: false, message: 'Current session is not controllable; start with startPaused to enable start/stop' };
    }
    try {
      this._sendCommand('start');
      return { success: true, reused: true };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }

  async stopCapture() {
    if (!this.child) {
      return { success: false, message: 'No ASR session is running' };
    }
    if (this.manualMode) {
      return this.stopManualRecording();
    }
    if (this.controlled) {
      try {
        this._sendCommand('stop');
        return { success: true, reused: true };
      } catch (err) {
        return { success: false, message: err.message };
      }
    }
    return this.stop();
  }

  _switchMode(targetMode) {
    if (!this.child) {
      return { success: false, message: 'No ASR session is running' };
    }
    const mode = targetMode === 'manual' ? 'manual' : 'auto';
    // If we weren't controllable, temporarily enable control so we can send the command
    const tempEnable = !this.manualMode && !this.controlled;
    if (tempEnable) {
      this.controlled = true;
    }
    try {
      this._sendCommand(mode);
      this.manualMode = mode === 'manual';
      if (mode === 'auto') {
        this.controlled = true;
      }
      return { success: true };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }

  _switchDevice(target) {
    if (!this.child) {
      return { success: false, message: 'No ASR session is running' };
    }
    const tempEnable = !this.manualMode && !this.controlled;
    if (tempEnable) {
      this.controlled = true;
    }
    const payload = target === undefined || target === null ? '' : String(target);
    try {
      this._sendCommand(`device ${payload}`.trim());
      if (payload) {
        this.activeOptions = { ...this.activeOptions, device: payload };
      }
      return { success: true };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }

  _resolvePythonPath(runtime) {
    const provided = runtime.pythonPath;
    const envPython = process.env[DEFAULT_PYTHON_ENV_VAR];
    const base = runtime.assetBaseUrl || process.cwd();
    const candidates = [
      provided,
      envPython,
      path.join(base, 'python', process.platform === 'win32' ? 'python.exe' : 'bin/python3'),
      path.join(base, 'python', process.platform === 'win32' ? 'python.exe' : 'bin/python')
    ].filter(Boolean);

    const hit = candidates.find((p) => fs.existsSync(p));
    return hit || 'python';
  }

  _isBundledExecutable(pythonPath) {
    // 检查是否是打包的可执行文件（不是 python/python3 解释器）
    const basename = path.basename(pythonPath);
    return !basename.startsWith('python') && (basename === 'two_pass_asr' || basename === 'two_pass_asr.exe');
  }

  async stop() {
    if (this.child) {
      // Always try to send quit command if stdin is available, even in auto mode
      // This allows Python to clean up gracefully (close audio streams, join decoder thread, etc.)
      if (this.child.stdin) {
        try {
          this._sendCommand('quit');
          // Give Python a short time to clean up gracefully
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch {
          // Best effort; fall back to kill
        }
      }
      this.child.kill();
      this.child = null;
      this.manualMode = false;
      this.controlled = false;
    }
    return { success: true };
  }

  _handleStdout(data) {
    this.stdoutBuffer += data.toString();
    let newlineIndex = this.stdoutBuffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (line) {
        try {
          const payload = JSON.parse(line);
          this._routePayload(payload);
        } catch {
          this._emitEvent('log', { type: 'log', message: line });
        }
      }
      newlineIndex = this.stdoutBuffer.indexOf('\n');
    }
  }

  _handleStderr(data) {
    const message = data.toString();
    console.error('[SpeechASR] STDERR:', message);
    this._emitEvent('log', { type: 'log', message });
  }

  /**
   * Unified live control. options.action: 'start' | 'stop'
   * mode: 'manual' or 'auto'
   */
  async live(options = {}) {
    const action = options.action === 'stop' ? 'stop' : 'start';
    const mode = options.mode === 'manual' ? 'manual' : 'auto';
    console.log('===== [SpeechASR] live START =====');
    console.log('[SpeechASR] live options.action:', action);
    console.log('[SpeechASR] live options.mode:', mode);
    console.log('[SpeechASR] live options.manualRealtime:', options.manualRealtime);
    console.log('[SpeechASR] live this.child:', !!this.child);
    console.log('[SpeechASR] live this.manualMode:', this.manualMode);
    console.log('[SpeechASR] live this.activeOptions.manualRealtime:', this.activeOptions.manualRealtime);

    if (action === 'stop') {
      if (!this.child) return { success: true };
      if (this.manualMode) return this.stopManualRecording();
      if (this.controlled) return this.stopCapture();
      return this.stop();
    }

    // start
    if (this.child) {
      if (this.manualMode !== (mode === 'manual')) {
        const switched = this._switchMode(mode);
        if (!switched.success) return switched;
      }
      // 注意：不在录音过程中检测 manualRealtime 的变化
      // 这个参数只在进程首次启动时生效，录音过程中改变它会导致录音中断
      // 用户需要重新加载模型才能应用新的 manualRealtime 设置
      console.log('[SpeechASR] live: reusing existing process, manualRealtime is locked to:', this.activeOptions.manualRealtime);
      console.log('[SpeechASR] live: Note: to change manualRealtime, release and reload models');
      return this.startCapture();
    }
    if (mode === 'manual') {
      return this.startManualRecording({ autoStart: options.autoStart !== false, ...options });
    }
    return this.start({ ...options });
  }

  // 语义化别名：开始/停止录音，不区分模式，内部仍由 live 路由
  async startRecording(options = {}) {
    return this.live({ action: 'start', ...options });
  }

  async stopRecording(options = {}) {
    return this.live({ action: 'stop', ...options });
  }

  async switchMode(mode = 'auto') {
    return this._switchMode(mode);
  }

  async switchDevice(device) {
    return this._switchDevice(device);
  }

  _sendCommand(cmd) {
    if (this.child && this.child.stdin && (this.manualMode || this.controlled)) {
      this.child.stdin.write(`${cmd}\n`);
    }
  }

  _routePayload(payload) {
    console.log('[SDK _routePayload] payload.type=', payload?.type, 'payload.stage=', payload?.stage);
    switch (payload?.type) {
      case 'ready':
        this._emitEvent('ready', payload);
        break;
      case 'first-pass':
        this._emitEvent('partial', { type: 'first-pass', text: payload.text || '' });
        break;
      case 'result':
        console.log('[SDK _routePayload] RESULT payload:', JSON.stringify(payload));
        this._emitEvent('two-pass-result', payload);
        this._emitEvent('result', payload);
        break;
      case 'error':
        this._emitEvent('two-pass-error', payload);
        this._emitEvent('error', payload);
        break;
      case 'log':
        this._emitEvent('log', payload);
        break;
      case 'devices':
        this._emitEvent('devices', payload);
        break;
      case 'complete':
        this._emitEvent('complete', payload);
        break;
      case 'punctuated':
        this._emitEvent('punctuated', payload);
        break;
      default:
        this._emitEvent(payload?.type || 'message', payload);
    }
  }

  _emitEvent(event, payload) {
    this.emit(event, payload);
    const callbacks = {
      ready: 'onReady',
      partial: 'onPartial',
      result: 'onResult',
      'two-pass-result': 'onTwoPassResult',
      'two-pass-error': 'onTwoPassError',
      'two-pass-start': 'onTwoPassStart',
      punctuated: 'onPunctuated',
      error: 'onError'
    };
    const cbName = callbacks[event];
    const fn = cbName ? this.activeOptions?.[cbName] : null;
    if (typeof fn === 'function') {
      fn(payload?.text ?? payload, payload);
    }
  }

  _resolveModelPaths(modelPaths, runtime) {
    const workingDir = modelPaths.workingDir || modelPaths.baseDir || runtime.assetBaseUrl || process.cwd();
    const candidateScript =
      modelPaths.scriptPath ||
      (fs.existsSync(DEFAULT_SCRIPT)
        ? DEFAULT_SCRIPT
        : path.join(workingDir, 'scripts', 'two_pass_microphone_asr_electron.py'));
    const scriptPath = ensureFileExists(candidateScript, 'Two-pass microphone helper');

    const streaming = modelPaths.streaming || modelPaths.firstPass || modelPaths.online || {};
    const secondPass = modelPaths.secondPass || modelPaths.offline || modelPaths.senseVoice || {};
    const vadModel = modelPaths.vadModel || (modelPaths.vad && modelPaths.vad.model) || '';

    const resolved = {
      workingDir: path.resolve(workingDir),
      scriptPath,
      streaming: null,
      secondPass: {
        model: ensureFileExists(secondPass.model, 'Second-pass model'),
        tokens: ensureFileExists(secondPass.tokens, 'Second-pass tokens')
      },
      vadModel: ''
    };

    // 支持手动模式下也传入 streaming，用于按键时提供第一遍
    if (streaming && streaming.encoder) {
      resolved.streaming = {
        encoder: ensureFileExists(streaming.encoder, 'Streaming encoder'),
        decoder: ensureFileExists(streaming.decoder, 'Streaming decoder'),
        joiner: ensureFileExists(streaming.joiner, 'Streaming joiner'),
        tokens: ensureFileExists(streaming.tokens, 'Streaming tokens')
      };
    } else if (!runtime.manualMode) {
      // 自动模式必须有 streaming
      throw new Error('Streaming model paths are required for live ASR');
    }

    if (vadModel && fs.existsSync(vadModel)) {
      resolved.vadModel = path.resolve(vadModel);
    }

    return resolved;
  }

  _buildArgs(runtime, resolved) {
    const pythonBin = this._resolvePythonPath(runtime);
    const isBundled = this._isBundledExecutable(pythonBin);
    
    // 如果是打包的可执行文件，不需要传递脚本路径
    const args = isBundled ? [] : [resolved.scriptPath];
    
    if (resolved.streaming) {
      args.push(
        '--first-encoder',
        resolved.streaming.encoder,
        '--first-decoder',
        resolved.streaming.decoder,
        '--first-joiner',
        resolved.streaming.joiner,
        '--first-tokens',
        resolved.streaming.tokens
      );
    }
    args.push(
      '--second-model',
      resolved.secondPass.model,
      '--second-tokens',
      resolved.secondPass.tokens,
      '--num-threads-first',
      String(runtime.numThreadsFirst || runtime.numThreads || 2),
      '--num-threads-second',
      String(runtime.numThreadsSecond || runtime.numThreads || 4)
    );

    if (runtime.manualMode) {
      args.push('--manual-mode');
      if (runtime.manualRealtime) {
        args.push('--manual-realtime');
        console.log('[SpeechASR] _buildArgs: manualRealtime enabled, adding --manual-realtime flag');
      } else {
        console.log('[SpeechASR] _buildArgs: manualRealtime disabled (legacy mode)');
      }
    } else if (runtime.firstDecodingMethod) {
      args.push('--first-decoding-method', runtime.firstDecodingMethod);
    }
    if (runtime.firstMaxActivePaths) {
      args.push('--first-max-active-paths', String(runtime.firstMaxActivePaths));
    }
    if (runtime.providerFirst) {
      args.push('--provider-first', runtime.providerFirst);
    }
    if (runtime.providerSecond) {
      args.push('--provider-second', runtime.providerSecond);
    }
    const chunkDuration = Math.max(
      0.02,
      Number(runtime.chunkDuration) || runtime.bufferSize / runtime.sampleRate || 0.1
    );
    if (Number.isFinite(chunkDuration)) {
      args.push('--chunk-duration', String(chunkDuration));
    }
    if (runtime.sampleRate) {
      args.push('--sample-rate', String(runtime.sampleRate));
    }
    if (runtime.startPaused) {
      args.push('--start-paused');
    }
    if (runtime.tailPadding) {
      args.push('--tail-padding', String(runtime.tailPadding));
    }
    if (runtime.device) {
      args.push('--device', runtime.device);
    }
    if (Number.isInteger(runtime.deviceIndex) && runtime.deviceIndex >= 0) {
      args.push('--device-index', String(runtime.deviceIndex));
    }
    if (resolved.vadModel && runtime.vadMode !== 'off') {
      args.push('--silero-vad-model', resolved.vadModel);
      const vadCfg = runtime.vad?.silero || {};
      if (typeof vadCfg.threshold === 'number') {
        args.push('--vad-threshold', String(vadCfg.threshold));
      }
      if (typeof vadCfg.minSilenceDuration === 'number') {
        args.push('--vad-min-silence', String(vadCfg.minSilenceDuration));
      }
      if (typeof vadCfg.minSpeechDuration === 'number') {
        args.push('--vad-min-speech', String(vadCfg.minSpeechDuration));
      }
      if (typeof vadCfg.maxSpeechDuration === 'number') {
        args.push('--vad-max-speech', String(vadCfg.maxSpeechDuration));
      }
    }

    return args;
  }

  _buildEnv(runtime, resolved) {
    const env = {
      ...process.env,
      SENSE_VOICE_MODEL_DIR: path.dirname(resolved.secondPass.model),
      ...runtime.env
    };
    if (resolved.streaming?.encoder) {
      env.STREAMING_MODEL_DIR = path.dirname(resolved.streaming.encoder);
    }
    return env;
  }

  async transcribeFile(wavPath, sessionOptions = {}) {
    const runtime = mergeOptions(this.options, sessionOptions);
    runtime.modelPaths = mergeOptions(this.options.modelPaths || {}, sessionOptions.modelPaths || {});
    runtime.vad = mergeOptions(this.options.vad || {}, sessionOptions.vad || {});
    runtime.twoPass = mergeOptions(this.options.twoPass || {}, sessionOptions.twoPass || {});

    let resolvedPaths;
    try {
      resolvedPaths = this._resolveModelPaths(runtime.modelPaths, runtime);
    } catch (err) {
      return { success: false, message: err.message };
    }

    const args = this._buildArgs(runtime, resolvedPaths);
    args.push('--wav-input', path.resolve(wavPath));
    const env = this._buildEnv(runtime, resolvedPaths);
    const pythonBin = this._resolvePythonPath(runtime);

    return new Promise((resolve) => {
      const payloads = [];
      let stderr = '';
      const child = spawn(pythonBin, args, {
        cwd: resolvedPaths.workingDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env
      });

      child.stdout.on('data', (data) => {
        data
          .toString()
          .split('\n')
          .filter(Boolean)
          .forEach((line) => {
            try {
              payloads.push(JSON.parse(line));
            } catch {
              payloads.push({ type: 'log', message: line });
            }
          });
      });

      child.stderr.on('data', (d) => {
        stderr += d.toString();
      });

      child.on('close', (code) => {
        const errorPayload = payloads.find((p) => p?.type === 'error');
        const resultPayload = payloads
          .slice()
          .reverse()
          .find((p) => p?.type === 'result');
        if (code && code !== 0) {
          resolve({
            success: false,
            message: errorPayload?.message || `ASR exited with code ${code}`,
            detail: stderr || JSON.stringify(errorPayload || {})
          });
          return;
        }
        if (errorPayload) {
          resolve({ success: false, message: errorPayload.message, detail: errorPayload.detail });
          return;
        }
        resolve({ success: true, result: resultPayload, logs: payloads, stderr });
      });
    });
  }
}

module.exports = {
  SpeechASR,
  DEFAULT_OPTIONS
};
