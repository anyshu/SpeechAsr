# @sherpa-onnx/speech-asr

两段式麦克风实时转写的 Node/Electron SDK，包装 `two_pass_microphone_asr_electron.py`（ZipFormer 1st pass + SenseVoice 2nd pass）。

## 快速使用

```bash
npm install @sherpa-onnx/speech-asr
```

```js
const { SpeechASR } = require('@sherpa-onnx/speech-asr');

const asr = new SpeechASR({
  twoPass: { enabled: true },
  assetBaseUrl: __dirname,
  modelPaths: {
    streaming: {
      encoder: '/path/to/encoder.onnx',
      decoder: '/path/to/decoder.onnx',
      joiner: '/path/to/joiner.onnx',
      tokens: '/path/to/tokens.txt'
    },
    secondPass: {
      model: '/path/to/sensevoice/model.onnx',
      tokens: '/path/to/sensevoice/tokens.txt'
    },
    vadModel: '/path/to/silero_vad.onnx' // 可选
  },
  onReady: () => console.log('ready'),
  onPartial: (p) => console.log('partial', p),
  onTwoPassResult: (r) => console.log('result', r)
});

asr.start();
```

## Python 依赖

SDK 只包含 JS 与 Python 脚本，不内置 Python 解释器或依赖。运行时需要：

- Python 3.8+ 在 PATH 或通过 `pythonPath` 指定。
- 已安装 Python 依赖：`pip install sounddevice sherpa-onnx`。

### Python 脚本主要参数（`two_pass_microphone_asr_electron.py`）

- 第一遍（流式 ZipFormer）
  - `--first-encoder/--first-decoder/--first-joiner/--first-tokens` 必填
  - `--first-decoding-method` 默认 `greedy_search`，可选 `modified_beam_search`
  - `--first-max-active-paths`（beam search 时有效）
  - `--num-threads-first`，`--provider-first`（默认 cpu）
- 第二遍（SenseVoice）
  - `--second-model/--second-tokens` 必填
  - `--num-threads-second`，`--provider-second`（默认 cpu）
- 音频与分段
  - `--sample-rate` 仅支持 16000
  - `--chunk-duration` 每次读取时长（秒），默认 0.1
  - `--tail-padding` 右侧上下文保留样本数，供下一段衔接
  - `--device`（按名称模糊匹配），`--device-index`
  - `--disable-endpoint` 关闭端点检测（需 VAD）
- VAD（可选 Silero）
  - `--silero-vad-model` 指向 `silero_vad.onnx`
  - `--vad-threshold`（默认 0.5），`--vad-min-silence`（0.5s），`--vad-min-speech`（0.25s），`--vad-max-speech`（8s）

SDK 会根据传入的 `modelPaths`/VAD 配置自动拼接这些参数并调用脚本，通常无需手动传递。

### 免安装方案（打包内置 Python）

如果不希望用户手动安装，可将 Python 运行时和依赖打包进应用：

1) 准备一个独立的 Python 目录（例如 `python/`），包含可执行文件和 `site-packages`，并在其中运行：
   ```bash
   ./python -m pip install sounddevice sherpa-onnx
   ```
2) 将该目录放在应用资源目录（如 Electron 打包后的 `resources/python`）。
3) 启动 SDK 时可不传 `pythonPath`，SDK 会按以下顺序自动寻找：
   - 显式传入的 `pythonPath`
   - 环境变量 `SPEECH_ASR_PYTHON`
   - `${assetBaseUrl}/python/bin/python3`、`${assetBaseUrl}/python/bin/python`、`${assetBaseUrl}/python/python.exe`

若未找到则回退到系统 `python`。

## 关键选项

- `modelPaths.streaming`：第一遍 ZipFormer encoder/decoder/joiner/tokens。
- `modelPaths.secondPass`：第二遍 SenseVoice model/tokens。
- `modelPaths.vadModel`：可选 Silero VAD 模型。
- `pythonPath`：指定 Python 解释器，未指定时会按上面顺序自动探测。
- 回调：`onReady`、`onPartial`、`onTwoPassResult`、`onTwoPassError`、`onError`、`onTwoPassStart`、`onLog`（事件名同 emit）。
- 文件模式（push-to-talk）：可直接调用 `await asr.transcribeFile('/tmp/audio.wav', { modelPaths: {...} })` 对单个 16k 单声道 WAV 做一次两段式识别。

## 事件

`SpeechASR` 继承 `EventEmitter`，会 emit `ready`、`partial`、`two-pass-result`、`error`、`log`、`devices`、`complete` 等，与回调并行。
