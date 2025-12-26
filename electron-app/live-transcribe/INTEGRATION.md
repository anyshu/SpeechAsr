# 实时转写模块集成指南

## 概述

实时转写模块已经创建完成，包含以下子模块：

- **overlay-manager.js**: 管理 PTT 悬浮窗口
- **ptt-manager.js**: 管理全局按键监听
- **speech-asr-wrapper.js**: 封装 SpeechASR 实例
- **handlers.js**: IPC Handlers
- **preload/index.js**: 预加载脚本
- **renderer/**: 渲染进程 UI 模块

## 快速集成

### 1. 主进程集成 (main.js)

```javascript
const { LiveTranscribeModule } = require('./live-transcribe');

// 在 app.whenReady() 中
app.whenReady().then(() => {
  createMainWindow();

  // 注册实时转写模块
  LiveTranscribeModule.register({
    app,
    mainWindow,
    getResourceBase,
    resolveBundledPython,
    getIconPath,
    getIconImage
  });

  // 启动模块
  LiveTranscribeModule.start();
});

// 在 app.on('before-quit') 中
app.on('before-quit', () => {
  LiveTranscribeModule.stop();
});
```

### 2. 预加载脚本 (preload.js)

```javascript
// 导入实时转写模块的预加载脚本
require('./live-transcribe/preload/index.js');
```

### 3. 渲染进程 (renderer.js)

```javascript
// 使用暴露的 API
if (window.liveTranscribe) {
  // 加载模型
  await window.liveTranscribe.loadLiveModels({
    mode: 'auto',
    micName: 'default'
  });

  // 监听结果
  window.liveTranscribe.onLiveResult((payload) => {
    console.log('Live result:', payload);
  });
}
```

## 当前状态

### 已完成
- [x] 模块目录结构
- [x] overlay-manager.js (完整迁移)
- [x] ptt-manager.js (完整迁移)
- [x] 模块入口文件框架
- [x] 预加载脚本框架
- [x] 渲染进程 UI 框架
- [x] Overlay 窗口 HTML

### 待完成
- [ ] speech-asr-wrapper.js (需要迁移 buildLiveSessionRuntime 等函数)
- [ ] handlers.js (需要迁移所有 IPC handlers)
- [ ] renderer/live-ui.js (需要迁移完整的 UI 逻辑)
- [ ] 更新 main.js 删除已迁移的代码
- [ ] 更新 renderer.js 使用新模块
- [ ] 测试所有功能

## 下一步

要完成迁移，需要：

1. 将 main.js 中的以下内容迁移到 speech-asr-wrapper.js:
   - buildLiveSessionRuntime() 函数
   - resetLiveSessionState() 函数
   - 模型路径解析函数

2. 将 main.js 中的 IPC handlers 迁移到 handlers.js:
   - live-load-models
   - live-release-models
   - live-start-capture
   - live-stop-capture
   - push-to-talk-asr
   - ptt-start/stop/end
   - start-live-transcribe (旧版)
   - stop-live-transcribe (旧版)

3. 更新 main.js:
   - 删除已迁移的函数
   - 删除全局变量 (overlayWindow, globalPttHook 等)
   - 使用模块替换

## 模块结构

```
live-transcribe/
├── index.js                    # 主入口
├── README.md                   # 说明文档
├── EXAMPLE.js                  # 集成示例
├── main/
│   ├── overlay-manager.js      # ✅ 完整
│   ├── ptt-manager.js          # ✅ 完整
│   ├── speech-asr-wrapper.js   # ⚠️ 框架，需要填充
│   └── handlers.js             # ⚠️ 框架，需要填充
├── renderer/
│   ├── index.js                # ⚠️ 框架，需要填充
│   ├── live-ui.js              # ⚠️ 框架，需要填充
│   ├── ptt-ui.js               # ✅ 完整
│   └── waveform.js             # ✅ 完整
├── preload/
│   ├── index.js                # ✅ 完整
│   └── overlay.js              # ⚠️ 需要从 overlay-preload.js 迁移
└── assets/
    └── ptt-overlay.html        # ✅ 完整
```

## 注意事项

1. **依赖注入**: 模块通过 `init()` 函数接收主应用的配置和依赖
2. **状态共享**: overlay-manager 和 ptt-manager 需要互相访问，通过依赖注入解决
3. **事件通信**: 使用 Electron 的 IPC 进行进程间通信
4. **清理资源**: 模块提供 `cleanup()` 和 `stop()` 方法用于清理资源
