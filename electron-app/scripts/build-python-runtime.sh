#!/bin/bash
# 构建嵌入式 Python 运行环境
# 用法: ./scripts/build-python-runtime.sh

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PYTHON_RUNTIME_DIR="$PROJECT_ROOT/electron-app/python-runtime"

# 检测平台
OS="$(uname -s)"
case "$OS" in
    Darwin)
        PLATFORM="macos"
        ;;
    Linux)
        PLATFORM="linux"
        ;;
    MINGW*|MSYS*|CYGWIN*)
        PLATFORM="windows"
        ;;
    *)
        log_error "Unsupported platform: $OS"
        exit 1
        ;;
esac

log_info "Detected platform: $PLATFORM"

# 获取系统 Python 信息
PYTHON_BIN="$(which python3)"
PYTHON_VERSION="$($PYTHON_BIN --version | awk '{print $2}')"
PYTHON_MAJOR_MINOR="$($PYTHON_BIN -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"

log_info "System Python: $PYTHON_BIN (version $PYTHON_VERSION)"

# 步骤 1: 创建虚拟环境并安装依赖
log_info "Step 1: Creating Python virtual environment..."

VENV_DIR="$PROJECT_ROOT/electron-app/.venv-runtime"

# 清理旧的虚拟环境
rm -rf "$VENV_DIR"

# 使用系统 Python 创建虚拟环境
python3 -m venv "$VENV_DIR"

# 激活虚拟环境
source "$VENV_DIR/bin/activate"

log_info "Installing Python dependencies..."
pip install --upgrade pip setuptools wheel

# 安装项目依赖
pip install \
    sherpa-onnx \
    sounddevice \
    numpy

log_info "Dependencies installed successfully"

# 步骤 2: 创建运行时目录结构
log_info "Step 2: Creating Python runtime directory structure..."

rm -rf "$PYTHON_RUNTIME_DIR"
mkdir -p "$PYTHON_RUNTIME_DIR"

# 步骤 3: 复制虚拟环境到运行时目录
log_info "Step 3: Copying virtual environment to runtime directory..."

# 直接复制整个虚拟环境（确保包含所有必要文件）
cp -R "$VENV_DIR/"* "$PYTHON_RUNTIME_DIR/"

# 步骤 4: 复制项目 Python 脚本
log_info "Step 4: Copying project Python scripts..."

mkdir -p "$PYTHON_RUNTIME_DIR/scripts"
cp "$PROJECT_ROOT/speech-asr-sdk/two_pass_microphone_asr_electron.py" "$PYTHON_RUNTIME_DIR/scripts/"
cp "$PROJECT_ROOT/speech-asr-sdk/send_key_event.py" "$PYTHON_RUNTIME_DIR/scripts/"

# 步骤 5: 修正 lib/pythonX.Y/lib-dynload 路径问题
log_info "Step 5: Fixing lib-dynload paths..."

# 在虚拟环境中，lib-dynload 可能在不同位置，确保 Python 能找到它
# 检查并创建必要的符号链接或复制文件
PYTHON_LIB_DIR="$PYTHON_RUNTIME_DIR/lib"
if [ -d "$PYTHON_LIB_DIR" ]; then
    # 找到 python 版本目录
    PY_VER_DIR=$(find "$PYTHON_LIB_DIR" -maxdepth 1 -type d -name "python*.*" | head -1)
    if [ -n "$PY_VER_DIR" ]; then
        log_info "Found Python lib dir: $PY_VER_DIR"
        # 确保 lib-dynload 存在
        if [ ! -d "$PY_VER_DIR/lib-dynload" ]; then
            # 从系统 Python 复制
            SYS_PYTHON_PREFIX="$(python3 -c 'import sys; print(sys.prefix)')"
            SYS_DYNLOAD="$SYS_PYTHON_PREFIX/lib/python$PYTHON_MAJOR_MINOR/lib-dynload"
            if [ -d "$SYS_DYNLOAD" ]; then
                mkdir -p "$PY_VER_DIR/lib-dynload"
                cp -R "$SYS_DYNLOAD"/*.so "$PY_VER_DIR/lib-dynload/" 2>/dev/null || true
                log_info "Copied lib-dynload from system Python"
            fi
        fi
    fi
fi

# 步骤 6: 创建启动脚本
log_info "Step 6: Creating launch scripts..."

# 创建主 Python 启动脚本（不设置 PYTHONHOME，使用虚拟环境的默认配置）
cat > "$PYTHON_RUNTIME_DIR/bin/python3-runtime" << 'EOF'
#!/bin/bash
# Python 运行时启动脚本

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_DIR="$(dirname "$SCRIPT_DIR")"

# 设置环境变量（不设置 PYTHONHOME，让 Python 使用虚拟环境配置）
# 只设置 PYTHONPATH 添加 site-packages
export PYTHONPATH="$RUNTIME_DIR/lib/python3.12/site-packages:$PYTHONPATH"

# 执行 Python
exec "$RUNTIME_DIR/bin/python3" "$@"
EOF
chmod +x "$PYTHON_RUNTIME_DIR/bin/python3-runtime"

# 创建用于运行 ASR 脚本的包装脚本
cat > "$PYTHON_RUNTIME_DIR/bin/run-asr" << 'EOF'
#!/bin/bash
# ASR 脚本启动包装

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_DIR="$(dirname "$SCRIPT_DIR")"

export PYTHONPATH="$RUNTIME_DIR/lib/python3.12/site-packages:$PYTHONPATH"

exec "$RUNTIME_DIR/bin/python3" "$RUNTIME_DIR/scripts/two_pass_microphone_asr_electron.py" "$@"
EOF
chmod +x "$PYTHON_RUNTIME_DIR/bin/run-asr"

# 步骤 7: 创建版本信息
log_info "Step 7: Creating version info..."

cat > "$PYTHON_RUNTIME_DIR/VERSION.txt" << EOF
Python Runtime for Electron App
=================================
Platform: $PLATFORM
Build Date: $(date)
Python Version: $PYTHON_VERSION
Built by: $(whoami)@$(hostname)
EOF

# 步骤 8: 清理
log_info "Step 8: Cleaning up..."

# 删除 __pycache__ 和测试文件
find "$PYTHON_RUNTIME_DIR" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
find "$PYTHON_RUNTIME_DIR" -type f -name "*.pyc" -delete 2>/dev/null || true
find "$PYTHON_RUNTIME_DIR" -type d -name "*.egg-info" -exec rm -rf {} + 2>/dev/null || true
find "$PYTHON_RUNTIME_DIR" -type d -name "tests" -exec rm -rf {} + 2>/dev/null || true
find "$PYTHON_RUNTIME_DIR" -type d -name "test" -exec rm -rf {} + 2>/dev/null || true

# 步骤 9: 测试
log_info "Step 9: Testing runtime..."

# 测试基本导入
"$PYTHON_RUNTIME_DIR/bin/python3" -c "import sys; print('Python version:', sys.version)" || {
    log_error "Python executable test failed!"
    exit 1
}

# 测试 encodings 模块
"$PYTHON_RUNTIME_DIR/bin/python3" -c "import encodings; print('encodings module OK')" || {
    log_error "encodings module test failed!"
    exit 1
}

# 测试项目依赖
"$PYTHON_RUNTIME_DIR/bin/python3" -c "import sherpa_onnx; import sounddevice; import numpy; print('All imports successful!')" || {
    log_warn "Import test failed, but build completed"
    "$PYTHON_RUNTIME_DIR/bin/python3" -c "import sys; print('sys.path:', sys.path)" || true
}

# 显示摘要
log_info "Build complete!"
echo ""
echo "Python runtime created at: $PYTHON_RUNTIME_DIR"
echo ""
echo "Directory structure:"
ls -la "$PYTHON_RUNTIME_DIR"
echo ""
echo "Size breakdown:"
du -sh "$PYTHON_RUNTIME_DIR"/{bin,lib,scripts} 2>/dev/null || true
TOTAL_SIZE=$(du -sh "$PYTHON_RUNTIME_DIR" 2>/dev/null | cut -f1)
echo "Total size: $TOTAL_SIZE"
echo ""
echo "To test: $PYTHON_RUNTIME_DIR/bin/python3-runtime -c 'import sherpa_onnx; print(sherpa_onnx.__version__)'"
echo ""
