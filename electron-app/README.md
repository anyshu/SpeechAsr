# 说话人分离助手 - Electron桌面应用

这是基于 Sherpa-ONNX 的说话人分离和自动语音识别（ASR）桌面应用程序。

## 功能特色

- 🎯 **说话人分离**: 自动识别音频中的不同说话人
- 🎤 **语音识别**: 将每个说话人的语音转换为文字
- ⚡ **并行处理**: 多线程处理提高效率
- 🎨 **现代化界面**: 美观易用的 macOS 风格界面
- 📁 **拖放支持**: 支持拖放文件到应用
- 📊 **实时进度**: 显示处理进度和详细日志
- 📄 **结果导出**: 将识别结果导出为文本文件

## 支持的音频格式

- WAV
- MP3
- M4A
- MP4
- FLAC
- AAC

## 系统要求

- macOS 10.15 或更高版本
- Python 3.7+
- FFmpeg
- 已编译的 Sherpa-ONNX 二进制文件

## 安装和运行

### 1. 安装依赖

首先确保您在 sherpa-onnx 项目的根目录，然后：

```bash
# 进入 electron-app 目录
cd electron-app

# 安装 Node.js 依赖
npm install
```

### 2. 确保 Python 脚本可执行

```bash
# 回到 sherpa-onnx 根目录
cd ..

# 给 Python 脚本添加执行权限
chmod +x scripts/diarization_asr_electron_helper.py
```

### 3. 运行应用

#### 开发模式运行：
```bash
cd electron-app
npm run dev
```

#### 正常运行：
```bash
cd electron-app
npm start
```

### 4. 打包应用

本应用使用 PyInstaller 将 Python 后端打包为独立可执行文件，然后使用 electron-builder 创建完整的应用安装包。

#### 4.1 准备打包环境

首次打包前需要安装 Python 依赖：

```bash
# 进入 speech-asr-sdk 目录
cd ../speech-asr-sdk

# 安装 Python 依赖（包括 PyInstaller）
pip3 install -r requirements.txt --user
```

requirements.txt 包含：
- `sherpa-onnx` - 语音识别核心库
- `sounddevice` - 音频输入/输出
- `pyinstaller` - Python 打包工具

#### 4.2 一键打包

```bash
# 回到 electron-app 目录
cd ../electron-app

# 打包 macOS 应用（自动包含 Python 打包）
npm run build:mac
```

**打包流程说明：**

1. **自动 Python 打包**（prebuild 钩子）：
   - 检查 `python-dist/two_pass_asr` 是否存在
   - 如不存在，自动运行 PyInstaller 打包 Python 脚本
   - 生成约 24MB 的独立可执行文件

2. **Electron 应用打包**：
   - 打包所有 JavaScript 代码和资源
   - 包含 Python 可执行文件到 `Resources/python-dist/`
   - 包含 Node.js 依赖
   - 创建 DMG 安装包

3. **输出文件**：
   - `dist/西瓜说-1.0.0.dmg` (~160MB) - Intel x64 版本
   - `dist/西瓜说-1.0.0-arm64.dmg` (~155MB) - Apple Silicon 版本

#### 4.3 单独打包 Python（可选）

如果只需要重新打包 Python 部分：

```bash
npm run build-python
```

这会在 `python-dist/` 目录生成 `two_pass_asr` 可执行文件。

#### 4.4 跨平台打包

```bash
# Windows 版本
npm run build:win

# Linux 版本
npm run build:linux
```

**注意**：跨平台打包需要在对应平台上进行，或使用 Docker 容器。

#### 4.5 使用预编译的 Python 可执行文件

如果你已经有打包好的 `python-dist/two_pass_asr`，可以直接打包 Electron 应用，无需 speech-asr-sdk 源码：

```bash
# 确保 python-dist/two_pass_asr 存在
ls python-dist/two_pass_asr

# 直接打包（会自动跳过 Python 打包步骤）
npm run build:mac
```

#### 4.6 打包后的应用特性

打包后的应用：
- ✅ **完全独立** - 不依赖系统 Python 环境
- ✅ **内置所有依赖** - sherpa-onnx、sounddevice、numpy 等
- ✅ **即装即用** - 用户双击 DMG 安装后即可使用
- ✅ **体积优化** - Python 可执行文件仅 24MB
- ✅ **双架构支持** - 同时支持 Intel 和 Apple Silicon

## 使用方法

1. **选择音频文件**：
   - 点击"浏览文件"按钮选择音频文件
   - 或者直接拖拽音频文件到应用窗口

2. **调整设置**：
   - **并行线程数**：控制处理速度（推荐 4-8 线程）
   - **聚类阈值**：控制说话人分离的敏感度（0.5-1.0）

3. **开始处理**：
   - 点击"开始处理"按钮
   - 观察实时进度和日志输出

4. **查看结果**：
   - 查看识别统计信息
   - 浏览按时间顺序排列的说话人识别结果

5. **导出结果**：
   - 点击"导出结果"按钮保存为文本文件

## 使用 Python API 进行麦克风实时 ASR

在集成 Electron 之前，如果想直接用 Python API 验证麦克风收音和实时识别，可复用 `python-api-examples` 中的示例脚本。

1. 安装依赖（建议使用虚拟环境）：
   ```bash
   pip install -U pip
   pip install -U sherpa-onnx sounddevice numpy
   ```

2. 使用仓库内现成模型运行示例（SenseVoice + Silero VAD）：
   ```bash
   python ./python-api-examples/simulate-streaming-sense-voice-microphone.py \
     --silero-vad-model=./silero_vad.onnx \
     --sense-voice=./sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/model.onnx \
     --tokens=./sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/tokens.txt \
     --num-threads=4
   ```
   - 运行后脚本会枚举声卡并自动选择默认麦克风，直接说话即可在终端看到实时转写；`Ctrl + C` 退出。
   - 如需低延迟可切换 `model.int8.onnx`，或通过 `sd.default.device` 选择其他输入设备。
   - Electron 界面的“开始实时转写”按钮也调用同样的 Python 流程（`scripts/live_microphone_asr.py`），请确保已安装 `sounddevice/numpy/sherpa-onnx`，并放置好 `silero_vad.onnx` 和 SenseVoice 模型。开始后实时日志会输出 Python 侧设备列表和实际使用的麦克风（含 index），可据此确认是否命中期望设备。

## 项目结构

```
electron-app/
├── package.json          # 项目配置和依赖
├── main.js               # Electron 主进程
├── preload.js           # 预加载脚本
├── index.html           # 主界面 HTML
├── styles.css           # 样式文件
├── renderer.js          # 渲染进程 JavaScript
└── README.md           # 说明文档
```

## 配置说明

### 处理设置

- **并行线程数**: 
  - 2 线程：低 CPU 使用，处理较慢
  - 4 线程：推荐设置，平衡速度和资源
  - 6-8 线程：高性能处理，适合强劲 CPU

- **聚类阈值**:
  - 0.5-0.7：更细致的说话人分离
  - 0.8-0.9：平衡设置（推荐）
  - 0.9-1.0：更宽松的分离，减少误分

## 故障排除

### 常见问题

1. **应用无法启动**：
   - 检查 Node.js 是否正确安装
   - 确保在正确的目录运行命令

2. **处理失败**：
   - 确保 Sherpa-ONNX 已正确编译
   - 检查模型文件是否存在
   - 确保 Python 和 FFmpeg 在系统 PATH 中

3. **音频格式不支持**：
   - 使用 FFmpeg 预先转换音频格式
   - 确保音频文件没有损坏

### 日志查看

应用运行时会在界面显示详细的处理日志，包括：
- 文件转换状态
- 说话人分离进度
- ASR 识别进度
- 错误信息

## 技术栈

- **前端**: HTML, CSS, JavaScript
- **桌面框架**: Electron
- **后端处理**: Python
- **音频处理**: FFmpeg
- **AI 模型**: Sherpa-ONNX

## 开发说明

如果您想修改或扩展此应用：

1. 修改 UI: 编辑 `index.html`, `styles.css`, `renderer.js`
2. 修改后端逻辑: 编辑 `../scripts/diarization_asr_electron_helper.py`
3. 修改主进程: 编辑 `main.js`

## 许可证

此项目遵循与 Sherpa-ONNX 相同的许可证。 
