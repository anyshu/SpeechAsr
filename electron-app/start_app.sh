#!/bin/bash

# 说话人分离助手启动脚本

echo "🎤 说话人分离助手 - 启动中..."

# 检查是否在正确的目录
if [ ! -f "package.json" ]; then
    echo "❌ 错误: 请确保在 electron-app 目录中运行此脚本"
    exit 1
fi

# 检查 Node.js 依赖
if [ ! -d "node_modules" ]; then
    echo "📦 安装 Node.js 依赖..."
    npm install
    if [ $? -ne 0 ]; then
        echo "❌ 依赖安装失败"
        exit 1
    fi
fi

# 检查 Python 脚本
if [ ! -f "../scripts/diarization_asr_electron_helper.py" ]; then
    echo "❌ 错误: 找不到 Python 处理脚本"
    echo "请确保在 sherpa-onnx 项目根目录运行此脚本"
    exit 1
fi

# 检查 sherpa-onnx 二进制文件
if [ ! -f "../build/bin/sherpa-onnx-offline-speaker-diarization" ]; then
    echo "❌ 错误: 找不到 sherpa-onnx 二进制文件"
    echo "请先编译 sherpa-onnx 项目"
    exit 1
fi

# 检查模型文件
if [ ! -d "../sherpa-onnx-pyannote-segmentation-3-0" ]; then
    echo "⚠️  警告: 未找到分离模型，请确保已下载相关模型文件"
fi

if [ ! -d "../sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17" ]; then
    echo "⚠️  警告: 未找到 ASR 模型，请确保已下载相关模型文件"
fi

echo "✅ 准备就绪，启动应用..."

# 启动应用
if [ "$1" = "--dev" ]; then
    echo "🔧 开发模式启动"
    npm run dev
else
    echo "🚀 正常模式启动"
    npm start
fi 