# Live Transcribe Module

实时转写功能模块，设计为可以独立打包成单独的 App。

## 目录结构

```
live-transcribe/
├── README.md                   # 本文件
├── index.js                    # 模块入口，注册所有功能
├── main/
│   ├── index.js                # 主进程入口
│   ├── overlay-manager.js      # Overlay 窗口管理
│   ├── ptt-manager.js          # PTT 按键管理
│   ├── speech-asr-wrapper.js   # SpeechASR 封装
│   └── handlers.js             # IPC Handlers
├── renderer/
│   ├── index.js                # 渲染进程入口
│   ├── live-ui.js              # 实时转写 UI 逻辑
│   ├── ptt-ui.js               # PTT UI 逻辑
│   └── waveform.js             # 波形显示
├── preload/
│   └── index.js                # 预加载脚本
└── assets/
    ├── ptt-overlay.html        # Overlay 窗口 HTML
    └── ptt-overlay.css         # Overlay 样式
```

## 模块接口

### 主进程 (main.js)

```javascript
const { LiveTranscribeModule } = require('./live-transcribe');

// 注册模块
LiveTranscribeModule.register({
  app,
  mainWindow,
  getResourceBase,
  getIconPath,
  getIconImage
});

// 启动模块
LiveTranscribeModule.start();
```

### 渲染进程

```javascript
// 加载实时转写 UI
const { LiveTranscribeUI } = require('./live-transcribe/renderer');
LiveTranscribeUI.mount(container);
```

## 状态

当前正在从主应用中分离代码...

## 待迁移内容

### 从 main.js 迁移
- [ ] Overlay 窗口管理 (行 79-217)
- [ ] PTT Hook 设置 (行 559-676)
- [ ] 实时转写核心函数 (行 741-744, 1710-1777)
- [ ] IPC Handlers (行 1659-2098, 2116-2328)
- [ ] 结果处理函数 (行 2330-2488)
- [ ] SpeechASR 实例配置 (行 884-920)

### 从 renderer.js 迁移
- [ ] 实时转写状态变量 (行 8-28)
- [ ] DOM 元素引用 (行 82-138)
- [ ] 核心函数 (行 1154-2647)
- [ ] 辅助函数

### 从 preload.js 迁移
- [ ] 实时转写 API (行 57-84)

### 从 index.html 迁移
- [ ] 实时转写视图 (行 28-32)
- [ ] 设置面板 (行 200-266)
- [ ] 结果显示区 (行 291-332)
- [ ] PTT Banner (行 503-511)

### 独立文件
- [ ] ptt-overlay.html → assets/ptt-overlay.html
- [ ] overlay-preload.js → preload/overlay.js
