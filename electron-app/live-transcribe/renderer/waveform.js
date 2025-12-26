/**
 * Waveform Display
 *
 * 音频波形显示
 */

// 配置
const CONFIG = {
  maxPoints: 100,
  minDb: -60,
  maxDb: 0,
  color: '#4CAF50',
  bgColor: 'transparent',
  lineWidth: 2
};

// 状态
let canvas = null;
let ctx = null;
let rmsValues = [];
let animationFrame = null;

/**
 * 初始化波形显示
 */
function init(canvasElement) {
  canvas = canvasElement;
  ctx = canvas.getContext('2d');

  // 设置 Canvas 尺寸
  resize();
  window.addEventListener('resize', resize);

  // 开始渲染循环
  startRenderLoop();
}

/**
 * 调整尺寸
 */
function resize() {
  if (!canvas) return;

  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
}

/**
 * 开始渲染循环
 */
function startRenderLoop() {
  const render = () => {
    draw();
    animationFrame = requestAnimationFrame(render);
  };
  render();
}

/**
 * 停止渲染循环
 */
function stopRenderLoop() {
  if (animationFrame) {
    cancelAnimationFrame(animationFrame);
    animationFrame = null;
  }
}

/**
 * 添加 RMS 值
 */
function addRmsValue(db) {
  rmsValues.push(db);
  if (rmsValues.length > CONFIG.maxPoints) {
    rmsValues.shift();
  }
}

/**
 * 清空数据
 */
function clear() {
  rmsValues = [];
}

/**
 * 绘制波形
 */
function draw() {
  if (!ctx || !canvas) return;

  const width = canvas.width;
  const height = canvas.height;

  // 清空画布
  ctx.clearRect(0, 0, width, height);

  if (rmsValues.length < 2) return;

  // 绘制波形
  ctx.beginPath();
  ctx.strokeStyle = CONFIG.color;
  ctx.lineWidth = CONFIG.lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const stepX = width / (CONFIG.maxPoints - 1);

  rmsValues.forEach((db, i) => {
    const normalized = normalizeDb(db);
    const x = i * stepX;
    const y = height * (1 - normalized);

    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });

  ctx.stroke();
}

/**
 * 归一化 dB 值到 0-1
 */
function normalizeDb(db) {
  const range = CONFIG.maxDb - CONFIG.minDb;
  const clamped = Math.max(CONFIG.minDb, Math.min(CONFIG.maxDb, db));
  return (clamped - CONFIG.minDb) / range;
}

/**
 * 设置配置
 */
function setConfig(newConfig) {
  Object.assign(CONFIG, newConfig);
}

/**
 * 清理资源
 */
function cleanup() {
  stopRenderLoop();
  window.removeEventListener('resize', resize);
  clear();
  canvas = null;
  ctx = null;
}

module.exports = {
  init,
  addRmsValue,
  clear,
  setConfig,
  cleanup,
  getState: () => ({
    rmsValues: [...rmsValues],
    hasCanvas: canvas !== null
  })
};
