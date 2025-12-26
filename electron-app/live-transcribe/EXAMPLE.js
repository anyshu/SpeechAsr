/**
 * Live Transcribe Module - Integration Example
 *
 * 这个文件展示了如何在主应用中集成实时转写模块
 */

// ============================================
// 主进程 (main.js) 集成示例
// ============================================

const { app, BrowserWindow } = require('electron');
const path = require('path');

// 1. 导入实时转写模块
const { LiveTranscribeModule } = require('./live-transcribe');

// 2. 定义辅助函数（从主应用提供）
function getResourceBase() {
  // 返回资源目录路径
  return app.isPackaged
    ? path.join(process.resourcesPath)
    : path.join(__dirname, '..');
}

function getIconPath() {
  return path.join(getResourceBase(), 'ok.png');
}

function getIconImage() {
  return require('native-image').createFromPath(getIconPath());
}

function resolveBundledPython() {
  // Python 路径解析逻辑
  return 'python3';
}

// 3. 创建主窗口
let mainWindow = null;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // 同时加载实时转写的预加载脚本
      additionalArguments: [
        '--load-live-transcribe-preload=' +
        path.join(__dirname, 'live-transcribe', 'preload', 'index.js')
      ]
    }
  });

  mainWindow.loadFile('index.html');
}

// 4. 应用启动时初始化模块
app.whenReady().then(() => {
  createMainWindow();

  // 注册并启动实时转写模块
  LiveTranscribeModule.register({
    app,
    mainWindow,
    getResourceBase,
    getIconPath,
    getIconImage
  });

  LiveTranscribeModule.start();
});

// 5. 应用退出时清理模块
app.on('before-quit', () => {
  LiveTranscribeModule.stop();
});

// ============================================
// 渲染进程 (renderer.js) 集成示例
// ============================================

// 方式 1: 使用模块提供的 mount 函数
import { LiveTranscribeUI } from './live-transcribe/renderer';

const container = document.getElementById('liveTranscribeContainer');
LiveTranscribeUI.mount(container);

// 方式 2: 手动集成到现有页面
function setupLiveTranscribe() {
  // 获取现有元素
  const liveBtn = document.getElementById('liveBtn');
  const liveTranscript = document.getElementById('liveTranscript');

  // 绑定事件
  liveBtn.addEventListener('click', async () => {
    if (window.liveTranscribe) {
      const result = await window.liveTranscribe.startLiveCapture({
        mode: 'auto',
        micName: 'default'
      });
      console.log('Live capture started:', result);
    }
  });

  // 监听结果
  if (window.liveTranscribe) {
    window.liveTranscribe.onLiveResult((payload) => {
      console.log('Live result:', payload);
      // 更新 UI...
    });
  }
}

// 初始化
document.addEventListener('DOMContentLoaded', setupLiveTranscribe);

// ============================================
// 预加载脚本 (preload.js) 集成示例
// ============================================

const { contextBridge, ipcRenderer } = require('electron');

// 导入主应用的 API
const mainApi = {
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  saveFile: (content) => ipcRenderer.invoke('dialog:saveFile', content),
  // ... 其他 API
};

// 导入实时转写模块的预加载脚本
require('../live-transcribe/preload/index.js');

// 将主应用的 API 也暴露出去
contextBridge.exposeInMainWorld('mainApp', mainApi);

// ============================================
// 独立 App 模式
// ============================================

// 如果要将实时转写作为独立 App 打包：
// 1. 创建独立的入口文件 live-transcribe-app/main.js
// 2. 在 package.json 中添加新的 build 配置

const liveAppPackage = {
  "name": "live-transcribe-app",
  "main": "live-transcribe-app/main.js",
  "build": {
    "appId": "com.example.livetranscribe",
    "productName": "实时转写",
    "files": [
      "live-transcribe/**/*",
      "node_modules/**/*"
    ],
    "mac": {
      "target": "dmg"
    },
    "win": {
      "target": "nsis"
    }
  }
};
