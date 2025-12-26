// 应用状态
let selectedFile = null;
let isProcessing = false;
let currentResults = null;
let mediaRecorder = null;
let isRecording = false;
let recordedChunks = [];
let isPttRecording = false;
let pttTimer = null;
let pttStartTime = 0;
let pttStartPromise = null;
let queuedPttStop = false;
let isLive = false;
let isLiveLogVisible = true;
let liveModelsLoaded = false;
let liveModelsMode = null;
let audioDevices = [];
let selectedMicId = null;
let liveMode = 'auto';
let liveTranscriptSegments = [];
let latestPttFirstPassText = '';
const liveSegmentKeys = new Set();
let enableLiveAutoPaste = false;
let lastAutoPasteKey = '';
let lastPastedCombinedText = '';
let micPermissionStatus = 'unknown';
const liveRmsHistory = [];
let liveRmsFrame = null;
const modelStates = {
    asr: 'checking',
    punctuation: 'checking',
    streaming: 'checking',
    vad: 'checking'
};
let currentView = 'process';

// 避免偶发的 dragEvent 未定义错误（部分环境会引用全局 dragEvent）
window.dragEvent = window.dragEvent || null;

// DOM 元素
const fileDropZone = document.getElementById('fileDropZone');
const selectedFileInfo = document.getElementById('selectedFileInfo');
const selectFileBtn = document.getElementById('selectFileBtn');
const removeFileBtn = document.getElementById('removeFileBtn');
const fileName = document.getElementById('fileName');
const processBtn = document.getElementById('processBtn');
const processingState = document.getElementById('processingState');
const resultsDisplay = document.getElementById('resultsDisplay');
const progressTextMain = document.getElementById('progressTextMain');
const progressFillMain = document.getElementById('progressFillMain');
const processingTitle = document.getElementById('processingTitle');
const processingStatus = document.getElementById('processingStatus');
const logToggleBtn = document.getElementById('logToggleBtn');
const logPanel = document.getElementById('logPanel');
const progressLog = document.getElementById('progressLog');
const resultsSummary = document.getElementById('resultsSummary');
const resultsContent = document.getElementById('resultsContent');
const statusText = document.getElementById('statusText');
const enableDiarization = document.getElementById('enableDiarization');
const maxWorkersSelect = document.getElementById('maxWorkers');
const clusterThreshold = document.getElementById('clusterThreshold');
const thresholdValue = document.getElementById('thresholdValue');
const speakerCount = document.getElementById('speakerCount');
const threadSetting = document.getElementById('threadSetting');
const thresholdSetting = document.getElementById('thresholdSetting');
const speakerCountSetting = document.getElementById('speakerCountSetting');
const exportBtn = document.getElementById('exportBtn');
const pasteToInputBtn = document.getElementById('pasteToInputBtn');
const clearBtn = document.getElementById('clearBtn');
const emptyState = document.getElementById('emptyState');
const progressCompact = document.getElementById('progressCompact');
const progressCompactText = document.getElementById('progressCompactText');
const progressCompactFill = document.getElementById('progressCompactFill');
const downloadModelBtn = document.getElementById('downloadModelBtn');
const openModelUrlBtn = document.getElementById('openModelUrlBtn');
const modelStatusText = document.getElementById('modelStatusText');
const modelProgress = document.getElementById('modelProgress');
const modelProgressFill = document.getElementById('modelProgressFill');
const modelProgressText = document.getElementById('modelProgressText');
const recordBtn = document.getElementById('recordBtn');
const recordStatus = document.getElementById('recordStatus');
const liveBtn = document.getElementById('liveBtn');
const liveStatus = document.getElementById('liveStatus');
const liveTranscript = document.getElementById('liveTranscript');
const liveTranscriptBody = document.getElementById('liveTranscriptBody');
const livePill = document.getElementById('livePill');
const liveLogWrapper = document.getElementById('liveLogWrapper');
const liveLogToggleBtn = document.getElementById('liveLogToggleBtn');
const autoPasteLiveCheckbox = document.getElementById('autoPasteLiveCheckbox');
const livePasteBtn = document.getElementById('livePasteBtn');
const liveLog = document.getElementById('liveLog');
const twoPassStatus = document.getElementById('twoPassStatus');
const firstPassText = document.getElementById('firstPassText');
const secondPassText = document.getElementById('secondPassText');
const liveWaveformCanvas = document.getElementById('liveWaveformCanvas');
const liveWaveformValue = document.getElementById('liveWaveformValue');
const micSelect = document.getElementById('micSelect');
const refreshMicBtn = document.getElementById('refreshMicBtn');
const modelDownloadView = document.getElementById('modelDownloadView');
const closeModelDownloadView = document.getElementById('closeModelDownloadView');
const modelListStatus = document.getElementById('modelListStatus');
const senseVoiceStatusText = document.getElementById('senseVoiceStatusText');
const senseVoiceProgress = document.getElementById('senseVoiceProgress');
const senseVoiceProgressFill = document.getElementById('senseVoiceProgressFill');
const senseVoiceProgressNumber = document.getElementById('senseVoiceProgressNumber');
const senseVoiceActionBtn = document.getElementById('senseVoiceActionBtn');
const punctStatusText = document.getElementById('punctStatusText');
const punctProgress = document.getElementById('punctProgress');
const punctProgressFill = document.getElementById('punctProgressFill');
const punctProgressNumber = document.getElementById('punctProgressNumber');
const punctActionBtn = document.getElementById('punctActionBtn');
const streamingStatusText = document.getElementById('streamingStatusText');
const streamingProgress = document.getElementById('streamingProgress');
const streamingProgressFill = document.getElementById('streamingProgressFill');
const streamingProgressNumber = document.getElementById('streamingProgressNumber');
const streamingActionBtn = document.getElementById('streamingActionBtn');
const vadStatusText = document.getElementById('vadStatusText');
const vadProgress = document.getElementById('vadProgress');
const vadProgressFill = document.getElementById('vadProgressFill');
const vadProgressNumber = document.getElementById('vadProgressNumber');
const vadActionBtn = document.getElementById('vadActionBtn');
const viewTabButtons = document.querySelectorAll('.view-tab-btn');
const fileSection = document.querySelector('.file-section');
const quickSettingsPanel = document.querySelector('.quick-settings');
const modelSection = document.querySelector('.model-section');
const recordSection = document.querySelector('.record-section');
const liveSettings = document.getElementById('liveSettings');
const liveModeSelect = document.getElementById('liveModeSelect');
const manualRealtimeRow = document.getElementById('manualRealtimeRow');
const manualRealtimeCheckbox = document.getElementById('manualRealtimeCheckbox');
const enableLlmRow = document.getElementById('enableLlmRow');
const enableLlmCheckbox = document.getElementById('enableLlmCheckbox');
const pttBanner = document.getElementById('pttBanner');
const pttBannerState = document.getElementById('pttBannerState');
const pttBannerHint = document.getElementById('pttBannerHint');
const loadLiveBtn = document.getElementById('loadLiveBtn');
const releaseLiveBtn = document.getElementById('releaseLiveBtn');
const liveModelStatus = document.getElementById('liveModelStatus');

// 新增：处理方式相关元素
const processingMode = document.getElementById('processingMode');
const apiSettings = document.getElementById('apiSettings');
const localSettings = document.getElementById('localSettings');
const apiProtocol = document.getElementById('apiProtocol');
const apiUrl = document.getElementById('apiUrl');
const requestId = document.getElementById('requestId');
const testApiBtn = document.getElementById('testApiBtn');

// 默认 VAD 设置（后续可接入 UI）
const defaultVadOptions = {
    model: '', // 留空则 main 进程尝试使用项目根目录下的 silero_vad.onnx
    threshold: 0.5,
    minSilence: 0.5,
    minSpeech: 0.25,
    maxSpeech: 8.0
};

// 新增：模式选择按钮
const diarizationModeBtn = document.getElementById('diarizationModeBtn');
const directModeBtn = document.getElementById('directModeBtn');

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    // 全局阻止默认拖拽行为，避免加载外部页面或未定义事件
    ['dragover', 'drop', 'dragenter', 'dragleave', 'dragstart'].forEach(evt => {
        window.addEventListener(evt, (event) => event.preventDefault());
    });

    initializeEventListeners();
    updateUI();
    toggleDiarizationSettings(); // 初始化说话人分离设置状态
    toggleProcessingMode(); // 初始化处理方式设置状态
    toggleLiveLog(true); // 初始化实时日志显示状态
    updateLiveModelUI();
    
    // 初始化识别模式按钮状态
    const initialMode = enableDiarization.checked ? 'diarization' : 'direct';
    setRecognitionMode(initialMode);
    
    // 初始化语言选择状态
    updateLanguageSelection();

    initModelSection();
    initMicDevices();
    setLiveMode(liveModeSelect?.value || 'auto');
    setView('process');
});

// 初始化事件监听器
function initializeEventListeners() {
    if (viewTabButtons && viewTabButtons.length) {
        viewTabButtons.forEach((btn) => {
            btn.addEventListener('click', () => setView(btn.dataset.view || 'process'));
        });
    }
    // 文件选择
    selectFileBtn.addEventListener('click', selectFile);
    removeFileBtn.addEventListener('click', removeFile);
    
    // 拖拽功能
    fileDropZone.addEventListener('dragover', handleDragOver);
    fileDropZone.addEventListener('dragleave', handleDragLeave);
    fileDropZone.addEventListener('drop', handleDrop);
    
    // 处理按钮
    processBtn.addEventListener('click', startProcessing);
    
    // 设置控件
    enableDiarization.addEventListener('change', toggleDiarizationSettings);
    clusterThreshold.addEventListener('input', (e) => {
        thresholdValue.textContent = e.target.value;
    });
    
    // 新增：处理方式切换
    processingMode.addEventListener('change', toggleProcessingMode);
    
    // 新增：模式选择按钮事件
    diarizationModeBtn.addEventListener('click', () => setRecognitionMode('diarization'));
    directModeBtn.addEventListener('click', () => setRecognitionMode('direct'));
    
    // 语言选择事件
    document.querySelectorAll('input[name="apiLanguage"]').forEach(radio => {
        radio.addEventListener('change', updateLanguageSelection);
    });
    
    // 自动生成请求ID
    requestId.addEventListener('focus', () => {
        if (!requestId.value) {
            requestId.value = `request-${Date.now()}`;
        }
    });
    
    // 测试API连接按钮
    testApiBtn.addEventListener('click', async () => {
        testApiBtn.disabled = true;
        testApiBtn.textContent = '测试中...';
        
        try {
            const success = await testAPIConnection();
            if (success) {
                testApiBtn.textContent = '连接成功';
                testApiBtn.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
            } else {
                testApiBtn.textContent = '连接失败';
                testApiBtn.style.background = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';
            }
        } catch (error) {
            testApiBtn.textContent = '连接失败';
            testApiBtn.style.background = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';
        }
        
        // 3秒后恢复按钮状态
        setTimeout(() => {
            testApiBtn.disabled = false;
            testApiBtn.textContent = '测试API连接';
            testApiBtn.style.background = '';
        }, 3000);
    });
    
    // 日志切换器
    logToggleBtn.addEventListener('click', toggleLogPanel);
    if (liveLogToggleBtn) {
        liveLogToggleBtn.addEventListener('click', () => toggleLiveLog());
    }
    if (autoPasteLiveCheckbox) {
        enableLiveAutoPaste = autoPasteLiveCheckbox.checked;
        autoPasteLiveCheckbox.addEventListener('change', (e) => {
            enableLiveAutoPaste = e.target.checked;
            lastAutoPasteKey = '';
            appendLiveLog(enableLiveAutoPaste ? '已开启实时结果自动粘贴' : '已关闭实时结果自动粘贴');
        });
    }
    // 监听 manualRealtimeCheckbox 的变化
    if (manualRealtimeCheckbox) {
        console.log('===== [renderer] manualRealtimeCheckbox event listener attached =====');
        console.log('[renderer] manualRealtimeCheckbox.checked (initial):', manualRealtimeCheckbox.checked);
        manualRealtimeCheckbox.addEventListener('change', (e) => {
            console.log('===== [renderer] manualRealtimeCheckbox CHANGED =====');
            console.log('[renderer] e.target.checked:', e.target.checked);
            console.log('[renderer] manualRealtimeCheckbox.checked:', manualRealtimeCheckbox.checked);
            appendLiveLog(e.target.checked ? '已开启实时分段识别 (VAD+2pass)' : '已关闭实时分段识别 (松手后统一处理)');
            console.log('===== [renderer] manualRealtimeCheckbox CHANGED END =====');
        });
    }
    if (livePasteBtn) {
        livePasteBtn.addEventListener('click', pasteLiveTranscriptToInput);
    }
    
    // 窗口控制
    document.getElementById('minimizeBtn').addEventListener('click', () => {
        window.electronAPI.minimizeWindow();
    });
    
    document.getElementById('closeBtn').addEventListener('click', () => {
        window.electronAPI.closeWindow();
    });
    
    // 结果操作
    exportBtn.addEventListener('click', exportResults);
    if (pasteToInputBtn) {
        pasteToInputBtn.addEventListener('click', pasteTranscriptionToInput);
    }
    clearBtn.addEventListener('click', clearResults);

    // 模型下载
    if (downloadModelBtn) {
        downloadModelBtn.addEventListener('click', showModelDownloadView);
    }
    if (openModelUrlBtn) {
        openModelUrlBtn.addEventListener('click', handleOpenModelUrl);
    }
    if (senseVoiceActionBtn) {
        senseVoiceActionBtn.addEventListener('click', handleModelDownload);
    }
    if (punctActionBtn) {
        punctActionBtn.addEventListener('click', handlePunctuationModelDownload);
    }
    if (streamingActionBtn) {
        streamingActionBtn.addEventListener('click', handleStreamingModelDownload);
    }
    if (vadActionBtn) {
        vadActionBtn.addEventListener('click', handleVadModelDownload);
    }
    if (closeModelDownloadView) {
        closeModelDownloadView.addEventListener('click', hideModelDownloadView);
    }

    // 麦克风录制
    if (recordBtn) {
        recordBtn.addEventListener('click', toggleRecording);
    }
    if (liveBtn) {
        liveBtn.addEventListener('click', toggleLiveTranscribe);
    }
    if (loadLiveBtn) {
        loadLiveBtn.addEventListener('click', loadLiveModels);
    }
    if (releaseLiveBtn) {
        releaseLiveBtn.addEventListener('click', releaseLiveModels);
    }
    if (micSelect) {
        micSelect.addEventListener('change', async (e) => {
            selectedMicId = e.target.value || null;
            const micLabel = micSelect.options[micSelect.selectedIndex]?.textContent || '';
            if (isLive || isPttRecording) {
                try {
                    const resp = await window.electronAPI.switchLiveDevice({ micName: micLabel });
                    if (!resp?.success) {
                        appendLiveLog(`切换麦克风失败: ${resp?.message || '未知错误'}`);
                    } else {
                        appendLiveLog(`已切换麦克风为: ${micLabel || '默认设备'}`);
                    }
                } catch (err) {
                    appendLiveLog(`切换麦克风异常: ${err.message || err}`);
                }
            }
        });
    }
    if (refreshMicBtn) {
        refreshMicBtn.addEventListener('click', initMicDevices);
    }
    if (liveModeSelect) {
        liveModeSelect.addEventListener('change', (e) => setLiveMode(e.target.value));
    }
    
    // 监听处理进度
    window.electronAPI.onProcessingProgress((event, data) => {
        updateProgress(data);
    });

    window.electronAPI.onProcessingError((event, error) => {
        appendLog(`错误: ${error}`, 'error');
    });
    window.electronAPI.onLiveResult((event, payload) => {
        console.log('[onLiveResult] RAW payload received:', JSON.stringify(payload));
        handleLiveResult(payload);
    });
    window.electronAPI.onModelDownloadProgress((event, data) => {
        handleModelProgress(data);
    });
    window.electronAPI.onPunctuationModelDownloadProgress?.((event, data) => {
        handlePunctuationModelProgress(data);
    });
    window.electronAPI.onStreamingModelDownloadProgress?.((event, data) => {
        handleStreamingModelProgress(data);
    });
    window.electronAPI.onVadModelDownloadProgress?.((event, data) => {
        handleVadModelProgress(data);
    });

    // 添加 Shift+Left 快捷键处理
    document.addEventListener('keydown', (event) => {
        // 检测 Shift+Left 组合键
        if (event.shiftKey && event.key === 'ArrowLeft') {
            event.preventDefault();
            console.log('[Shift+Left] Pressed, calling replaceFirstPassWithSecond...');
            appendLiveLog('[Shift+Left] 按键触发');
            replaceFirstPassWithSecond();
        }
    });

    const cleanupListeners = [];
    if (window.electronAPI?.onGlobalPttStart) {
        cleanupListeners.push(
            window.electronAPI.onGlobalPttStart((payload) => {
                if (
                    liveMode !== 'manual' ||
                    !liveModelsLoaded ||
                    isRecording ||
                    isLive
                )
                    return;
                // Toggle 模式：检查是否正在录音，如果是则忽略（由 stop 事件处理）
                const isToggleMode = payload?.manualRealtime === true;
                if (isToggleMode && isPttRecording) {
                    return; // 等待 stop 事件
                }
                // 传统模式：检查是否已经在录音
                if (!isToggleMode && (isPttRecording || pttStartPromise)) {
                    return;
                }
                setPttBannerState('recording', '正在录音...', isToggleMode ? '再次按键以结束' : '松开设定按键以结束');
                startPttRecording();
            })
        );
    }
    if (window.electronAPI?.onGlobalPttStop) {
        cleanupListeners.push(
            window.electronAPI.onGlobalPttStop((payload) => {
                if (liveMode !== 'manual') return;
                const isToggleMode = payload?.manualRealtime === true;
                // Toggle 模式：停止录音
                if (isToggleMode) {
                    stopPttRecording({ source: 'key-up' });
                } else {
                    // 传统模式：停止录音
                    stopPttRecording({ source: 'key-up' });
                }
            })
        );
    }

    window.addEventListener('beforeunload', () => {
        cleanupListeners.forEach((fn) => {
            try {
                fn && fn();
            } catch {
                // ignore
            }
        });
    });
}

// 文件选择
async function selectFile() {
    try {
        const filePath = await window.electronAPI.selectAudioFile();
        if (filePath) {
            setSelectedFile(filePath);
        }
    } catch (error) {
        showError('文件选择失败', error.message);
    }
}

// 设置选中的文件
function setSelectedFile(filePath) {
    selectedFile = filePath;
    const name = filePath.split('/').pop();
    fileName.textContent = name;
    
    selectedFileInfo.style.display = 'flex';
    fileDropZone.style.display = 'none';
    
    // 初始化音频播放器
    initAudioPlayer(filePath);
    
    updateUI();
    updateStatus(`已选择文件: ${name}`);
}

// 移除文件
function removeFile() {
    selectedFile = null;
    selectedFileInfo.style.display = 'none';
    fileDropZone.style.display = 'flex';
    
    // 隐藏音频播放器
    const audioPlayer = document.getElementById('audioPlayer');
    const audioElement = document.getElementById('audioElement');
    if (audioPlayer) {
        audioPlayer.style.display = 'none';
    }
    if (audioElement) {
        audioElement.pause();
        audioElement.src = '';
    }
    
    updateUI();
    updateStatus('就绪');
}

async function initModelSection() {
    setModelStatus('checking');
    setPunctuationModelStatus('checking');
    setStreamingModelStatus('checking');
    setVadModelStatus('checking');
    try {
        const exists = await window.electronAPI.checkModel();
        setModelStatus(exists ? 'ready' : 'missing');
    } catch (error) {
        setModelStatus('error', error.message);
    }
    try {
        const punctExists = await window.electronAPI.checkPunctuationModel();
        setPunctuationModelStatus(punctExists ? 'ready' : 'missing');
    } catch (error) {
        setPunctuationModelStatus('error', error.message);
    }
    try {
        const streamingExists = await window.electronAPI.checkStreamingModel();
        setStreamingModelStatus(streamingExists ? 'ready' : 'missing');
    } catch (error) {
        setStreamingModelStatus('error', error.message);
    }
    try {
        const vadExists = await window.electronAPI.checkVadModel();
        setVadModelStatus(vadExists ? 'ready' : 'missing');
    } catch (error) {
        setVadModelStatus('error', error.message);
    }
}

function setView(view = 'process') {
    currentView = view;
    if (viewTabButtons && viewTabButtons.length) {
        viewTabButtons.forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.view === view);
        });
    }
    renderViewLayout();
}

function renderProcessPanels() {
    if (!processingState || !resultsDisplay || !emptyState || !progressCompact) return;

    if (isProcessing) {
        processingState.style.display = 'flex';
        resultsDisplay.style.display = 'none';
        emptyState.style.display = 'none';
        progressCompact.style.display = 'block';
    } else if (currentResults) {
        processingState.style.display = 'none';
        resultsDisplay.style.display = 'flex';
        emptyState.style.display = 'none';
        progressCompact.style.display = 'none';
    } else {
        processingState.style.display = 'none';
        resultsDisplay.style.display = 'none';
        emptyState.style.display = 'flex';
        progressCompact.style.display = 'none';
    }

    // 仅在处理视图中显示实时转写面板
    if (liveTranscript) {
        liveTranscript.style.display = 'none';
    }
}

function renderViewLayout() {
    const showProcess = currentView === 'process';
    const showLive = currentView === 'live';
    const showModels = currentView === 'models';

    // 控制左侧面板各个区域的显示
    if (fileSection) fileSection.style.display = showProcess ? '' : 'none';
    if (quickSettingsPanel) quickSettingsPanel.style.display = showProcess ? '' : 'none';
    if (processBtn) processBtn.style.display = showProcess ? '' : 'none';
    if (recordSection) recordSection.style.display = showProcess ? '' : 'none';
    if (modelSection) modelSection.style.display = showProcess ? '' : 'none';
    
    // 实时转写设置
    if (liveSettings) {
        liveSettings.style.display = showLive ? 'block' : 'none';
        console.log('liveSettings display:', liveSettings.style.display, 'showLive:', showLive);
    } else {
        console.error('liveSettings element not found!');
    }

    if (showProcess) {
        if (modelDownloadView) modelDownloadView.style.display = 'none';
        renderProcessPanels();
    } else if (showLive) {
        if (liveTranscript) liveTranscript.style.display = 'block';
        if (processingState) processingState.style.display = 'none';
        if (resultsDisplay) resultsDisplay.style.display = 'none';
        if (emptyState) emptyState.style.display = 'none';
        if (progressCompact) progressCompact.style.display = 'none';
        if (modelDownloadView) modelDownloadView.style.display = 'none';
    } else if (showModels) {
        if (liveTranscript) liveTranscript.style.display = 'none';
        if (processingState) processingState.style.display = 'none';
        if (resultsDisplay) resultsDisplay.style.display = 'none';
        if (emptyState) emptyState.style.display = 'none';
        if (progressCompact) progressCompact.style.display = 'none';
        if (modelDownloadView) {
            modelDownloadView.style.display = 'flex';
            modelDownloadView.classList.add('fade-in');
        }
    }
}

function addLiveRmsValue(db) {
    if (Number.isNaN(db)) return;
    const clamped = Math.max(-90, Math.min(0, db));
    const now = Date.now();
    liveRmsHistory.push({ ts: now, db: clamped });
    const cutoff = now - 15000; // keep last 15s
    while (liveRmsHistory.length && liveRmsHistory[0].ts < cutoff) {
        liveRmsHistory.shift();
    }
    if (liveWaveformValue) {
        liveWaveformValue.textContent = `${clamped.toFixed(1)} dB`;
    }
    scheduleLiveWaveformRender();
}

function resetLiveWaveform() {
    liveRmsHistory.length = 0;
    if (liveWaveformValue) {
        liveWaveformValue.textContent = '-- dB';
    }
    if (liveWaveformCanvas?.getContext) {
        const ctx = liveWaveformCanvas.getContext('2d');
        if (ctx) {
            ctx.clearRect(0, 0, liveWaveformCanvas.width || 0, liveWaveformCanvas.height || 0);
        }
    }
}

function scheduleLiveWaveformRender() {
    if (liveRmsFrame) return;
    liveRmsFrame = requestAnimationFrame(drawLiveWaveform);
}

function drawLiveWaveform() {
    liveRmsFrame = null;
    if (!liveWaveformCanvas || !liveWaveformCanvas.getContext) return;
    const ctx = liveWaveformCanvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(200, Math.floor((liveWaveformCanvas.clientWidth || 320) * dpr));
    const height = Math.max(60, Math.floor((liveWaveformCanvas.clientHeight || 64) * dpr));
    if (liveWaveformCanvas.width !== width || liveWaveformCanvas.height !== height) {
        liveWaveformCanvas.width = width;
        liveWaveformCanvas.height = height;
    }
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(0, Math.floor(height / 2), width, 1);
    if (!liveRmsHistory.length) return;

    const samples = liveRmsHistory.slice(-200);
    const barWidth = Math.max(2, Math.floor(width / Math.max(samples.length, 50)));
    const baseHeight = height * 0.9;
    samples.forEach((s, idx) => {
        const x = width - (samples.length - idx) * barWidth;
        const norm = Math.max(0, Math.min(1, (s.db + 80) / 80)); // -80~0 dBFS -> 0~1
        const barH = Math.max(2, norm * baseHeight);
        const y = (height - barH) / 2;
        const gradient = ctx.createLinearGradient(x, y, x, y + barH);
        gradient.addColorStop(0, '#10b981');
        gradient.addColorStop(1, '#22c55e');
        ctx.fillStyle = gradient;
        ctx.fillRect(x, y, Math.max(1, barWidth - 1), barH);
    });
}

function showModelDownloadView() {
    if (!modelDownloadView) return;
    setView('models');
    modelDownloadView.classList.add('fade-in');
    updateModelListMessage();
    updateModelCardStatus('asr', modelStates.asr);
    updateModelCardStatus('punctuation', modelStates.punctuation);
    updateModelCardStatus('streaming', modelStates.streaming);
    updateModelCardStatus('vad', modelStates.vad);
}

function hideModelDownloadView() {
    if (!modelDownloadView) return;
    modelDownloadView.style.display = 'none';
    setView('process');
}

function updateModelListMessage(message = '') {
    if (!modelListStatus) return;
    if (message) {
        modelListStatus.textContent = message;
        return;
    }

    const asrState = modelStates.asr;
    const punctState = modelStates.punctuation;
    const streamingState = modelStates.streaming;
    const vadState = modelStates.vad;

    if (asrState === 'downloading') {
        modelListStatus.textContent = 'ASR模型下载中...';
        return;
    }
    if (asrState === 'extracting') {
        modelListStatus.textContent = 'ASR模型正在解压...';
        return;
    }
    if (punctState === 'downloading') {
        modelListStatus.textContent = '标点模型下载中...';
        return;
    }
    if (punctState === 'extracting') {
        modelListStatus.textContent = '标点模型正在解压...';
        return;
    }
    if (streamingState === 'downloading') {
        modelListStatus.textContent = '流式模型下载中...';
        return;
    }
    if (streamingState === 'extracting') {
        modelListStatus.textContent = '流式模型正在解压...';
        return;
    }
    if (vadState === 'downloading') {
        modelListStatus.textContent = 'VAD模型下载中...';
        return;
    }
    if (asrState === 'error' || punctState === 'error' || streamingState === 'error' || vadState === 'error') {
        modelListStatus.textContent = '模型下载失败，可重试或检查网络';
        return;
    }
    if (asrState === 'checking' || punctState === 'checking' || streamingState === 'checking' || vadState === 'checking') {
        modelListStatus.textContent = '正在检查模型...';
        return;
    }
    const readyCount = [asrState, punctState, streamingState, vadState].filter((s) => s === 'ready').length;
    if (readyCount === 4) {
        modelListStatus.textContent = '模型已下载，可直接开始处理';
        return;
    }
    if (readyCount > 0) {
        const parts = [];
        if (asrState === 'ready') parts.push('ASR');
        if (punctState === 'ready') parts.push('标点');
        if (streamingState === 'ready') parts.push('流式');
        if (vadState === 'ready') parts.push('VAD');
        modelListStatus.textContent = `${parts.join('、')}模型已就绪，其他模型未下载`;
        return;
    }
    modelListStatus.textContent = '选择需要下载的模型';
}

function getModelCardRefs(type) {
    if (type === 'punctuation') {
        return {
            statusText: punctStatusText,
            actionBtn: punctActionBtn,
            progress: punctProgress,
            progressFill: punctProgressFill,
            progressNumber: punctProgressNumber
        };
    }
    if (type === 'streaming') {
        return {
            statusText: streamingStatusText,
            actionBtn: streamingActionBtn,
            progress: streamingProgress,
            progressFill: streamingProgressFill,
            progressNumber: streamingProgressNumber
        };
    }
    if (type === 'vad') {
        return {
            statusText: vadStatusText,
            actionBtn: vadActionBtn,
            progress: vadProgress,
            progressFill: vadProgressFill,
            progressNumber: vadProgressNumber
        };
    }
    return {
        statusText: senseVoiceStatusText,
        actionBtn: senseVoiceActionBtn,
        progress: senseVoiceProgress,
        progressFill: senseVoiceProgressFill,
        progressNumber: senseVoiceProgressNumber
    };
}

function updateModelCardStatus(type, status, message = '') {
    const refs = getModelCardRefs(type);
    if (!refs.statusText || !refs.actionBtn) return;
    const statusMap = {
        ready: { text: '模型已就绪', action: '重新下载', cls: 'status-ready', disabled: false, showProgress: false },
        downloading: { text: '下载中...', action: '下载中...', cls: 'status-downloading', disabled: true, showProgress: true },
        extracting: { text: '正在解压...', action: '处理中...', cls: 'status-extracting', disabled: true, showProgress: true },
        error: { text: '下载失败', action: '重试下载', cls: 'status-error', disabled: false, showProgress: false },
        checking: { text: '正在检查...', action: '等待检查', cls: 'status-checking', disabled: true, showProgress: false },
        missing: { text: '未下载', action: '开始下载', cls: '', disabled: false, showProgress: false }
    };
    const info = statusMap[status] || statusMap.missing;
    let desc = info.text;
    if (message) {
        desc = (status === 'downloading' || status === 'extracting')
            ? message
            : `${info.text}：${message}`;
    }
    refs.statusText.textContent = desc;
    refs.statusText.className = `model-card-status ${info.cls}`.trim();
    refs.actionBtn.textContent = info.action;
    refs.actionBtn.disabled = info.disabled;
    if (refs.progress) {
        refs.progress.style.display = info.showProgress ? 'flex' : 'none';
    }
}

function updateModelCardProgress(type, percent) {
    const refs = getModelCardRefs(type);
    if (!refs.progressFill || !refs.progressNumber || !refs.progress) return;
    const clamped = Math.min(100, Math.max(0, percent || 0));
    refs.progressFill.style.width = `${clamped}%`;
    refs.progressNumber.textContent = `${clamped}%`;
    refs.progress.style.display = 'flex';
}

function setModelStatus(status, message = '') {
    modelStates.asr = status;
    updateModelCardStatus('asr', status, message);
    updateModelListMessage(message);

    if (!modelStatusText || !downloadModelBtn || !modelProgress || !modelProgressFill || !modelProgressText) return;

    if (status === 'ready') {
        modelStatusText.textContent = '模型已就绪';
        downloadModelBtn.textContent = '重新下载模型';
        downloadModelBtn.disabled = false;
        modelProgress.style.display = 'none';
    } else if (status === 'downloading') {
        modelStatusText.textContent = '下载中...';
        downloadModelBtn.textContent = '下载中...';
        downloadModelBtn.disabled = true;
        modelProgress.style.display = 'block';
    } else if (status === 'extracting') {
        modelStatusText.textContent = '正在解压...';
        downloadModelBtn.textContent = '处理中...';
        downloadModelBtn.disabled = true;
        modelProgress.style.display = 'block';
    } else if (status === 'error') {
        modelStatusText.textContent = `下载失败: ${message}`;
        downloadModelBtn.textContent = '重新下载模型';
        downloadModelBtn.disabled = false;
        modelProgress.style.display = 'none';
    } else if (status === 'checking') {
        modelStatusText.textContent = '正在检查模型...';
        downloadModelBtn.disabled = true;
        modelProgress.style.display = 'none';
    } else {
        modelStatusText.textContent = '模型未下载';
        downloadModelBtn.textContent = '下载模型';
        downloadModelBtn.disabled = false;
        modelProgress.style.display = 'none';
    }
}

function setPunctuationModelStatus(status, message = '') {
    modelStates.punctuation = status;
    updateModelCardStatus('punctuation', status, message);
    updateModelListMessage(message);
}

function setStreamingModelStatus(status, message = '') {
    modelStates.streaming = status;
    updateModelCardStatus('streaming', status, message);
    updateModelListMessage(message);
}

function setVadModelStatus(status, message = '') {
    modelStates.vad = status;
    updateModelCardStatus('vad', status, message);
    updateModelListMessage(message);
}

async function handleOpenModelUrl() {
    try {
        const result = await window.electronAPI.openModelFolder();
        if (result && !result.success) {
            updateStatus(result.message || '无法打开模型文件夹');
        }
    } catch (error) {
        console.error('Failed to open model folder:', error);
        updateStatus('打开模型文件夹失败');
    }
}

async function handleModelDownload() {
    showModelDownloadView();
    setModelStatus('downloading');
    updateModelProgress(0);
    updateModelCardProgress('asr', 0);
    updateModelListMessage('正在下载模型，请保持窗口打开');
    try {
        const result = await window.electronAPI.downloadModel();
        if (result?.success) {
            setModelStatus('ready');
            updateStatus('模型下载完成');
            updateModelListMessage('模型已下载，可直接开始处理');
        } else {
            setModelStatus('error', result?.message || '未知错误');
            updateModelListMessage(result?.message ? `下载失败：${result.message}` : '下载失败，请重试');
        }
    } catch (error) {
        setModelStatus('error', error.message);
        updateModelListMessage(`下载失败：${error.message}`);
    }
}

function handleModelProgress(data) {
    if (!data) return;
    if (data.status === 'starting') {
        setModelStatus('downloading', data.message || '准备下载模型...');
        updateModelProgress(0);
        updateModelListMessage(data.message || '准备下载模型...');
        if (modelStatusText) {
            modelStatusText.textContent = data.message || '准备下载模型...';
        }
    } else if (data.status === 'downloading') {
        let progressText = '下载中...';
        if (data.percent >= 0) {
            updateModelProgress(data.percent);
        }
        if (data.downloaded && data.total) {
            const mbDownloaded = (data.downloaded / 1024 / 1024).toFixed(1);
            const mbTotal = (data.total / 1024 / 1024).toFixed(1);
            progressText = `下载中... ${mbDownloaded} / ${mbTotal} MB`;
        }
        setModelStatus('downloading', progressText);
        updateModelListMessage(progressText);
        if (modelStatusText) {
            modelStatusText.textContent = progressText;
        }
    } else if (data.status === 'extracting') {
        setModelStatus('extracting', data.message || '正在解压...');
        updateModelProgress(data.percent || 95);
        updateModelListMessage(data.message || '正在解压...');
    } else if (data.status === 'done') {
        updateModelProgress(100);
        setModelStatus('ready');
        updateModelListMessage('模型已下载，可直接开始处理');
    } else if (data.status === 'error') {
        setModelStatus('error', data.message || '下载失败');
        updateModelListMessage(data.message || '下载失败');
    }
}

function updateModelProgress(percent) {
    const clamped = Math.min(100, Math.max(0, percent || 0));
    if (modelProgressFill) {
        modelProgressFill.style.width = `${clamped}%`;
    }
    if (modelProgressText) {
        modelProgressText.textContent = `${clamped}%`;
    }
    updateModelCardProgress('asr', clamped);
}

async function handlePunctuationModelDownload() {
    setView('models');
    showModelDownloadView();
    setPunctuationModelStatus('downloading');
    updateModelCardProgress('punctuation', 0);
    updateModelListMessage('正在下载标点模型，请保持窗口打开');
    try {
        const result = await window.electronAPI.downloadPunctuationModel();
        if (result?.success) {
            setPunctuationModelStatus('ready');
            updateStatus('标点模型下载完成');
            updateModelListMessage('标点模型下载完成');
        } else {
            setPunctuationModelStatus('error', result?.message || '未知错误');
            updateModelListMessage(result?.message ? `标点模型下载失败：${result.message}` : '标点模型下载失败，请重试');
        }
    } catch (error) {
        setPunctuationModelStatus('error', error.message);
        updateModelListMessage(`标点模型下载失败：${error.message}`);
    }
}

function handlePunctuationModelProgress(data) {
    if (!data) return;
    if (data.status === 'starting') {
        setPunctuationModelStatus('downloading', data.message || '准备下载标点模型...');
        updateModelCardProgress('punctuation', 0);
        updateModelListMessage(data.message || '准备下载标点模型...');
    } else if (data.status === 'downloading') {
        let progressText = '标点模型下载中...';
        if (data.percent >= 0) {
            updateModelCardProgress('punctuation', data.percent);
        }
        if (data.downloaded && data.total) {
            const mbDownloaded = (data.downloaded / 1024 / 1024).toFixed(1);
            const mbTotal = (data.total / 1024 / 1024).toFixed(1);
            progressText = `标点模型下载中... ${mbDownloaded} / ${mbTotal} MB`;
        }
        setPunctuationModelStatus('downloading', progressText);
        updateModelListMessage(progressText);
    } else if (data.status === 'extracting') {
        setPunctuationModelStatus('extracting', data.message || '标点模型解压中...');
        updateModelCardProgress('punctuation', data.percent || 95);
        updateModelListMessage(data.message || '标点模型解压中...');
    } else if (data.status === 'done') {
        updateModelCardProgress('punctuation', 100);
        setPunctuationModelStatus('ready');
        updateModelListMessage('标点模型下载完成');
    } else if (data.status === 'error') {
        setPunctuationModelStatus('error', data.message || '标点模型下载失败');
        updateModelListMessage(data.message || '标点模型下载失败');
    }
}

async function handleStreamingModelDownload() {
    setView('models');
    showModelDownloadView();
    setStreamingModelStatus('downloading');
    updateModelCardProgress('streaming', 0);
    updateModelListMessage('正在下载流式模型，请保持窗口打开');
    try {
        const result = await window.electronAPI.downloadStreamingModel();
        if (result?.success) {
            setStreamingModelStatus('ready');
            updateStatus('流式模型下载完成');
            updateModelListMessage('流式模型下载完成');
        } else {
            setStreamingModelStatus('error', result?.message || '未知错误');
            updateModelListMessage(result?.message ? `流式模型下载失败：${result.message}` : '流式模型下载失败，请重试');
        }
    } catch (error) {
        setStreamingModelStatus('error', error.message);
        updateModelListMessage(`流式模型下载失败：${error.message}`);
    }
}

function handleStreamingModelProgress(data) {
    if (!data) return;
    if (data.status === 'starting') {
        setStreamingModelStatus('downloading', data.message || '准备下载流式模型...');
        updateModelCardProgress('streaming', 0);
        updateModelListMessage(data.message || '准备下载流式模型...');
    } else if (data.status === 'downloading') {
        let progressText = '流式模型下载中...';
        if (data.percent >= 0) {
            updateModelCardProgress('streaming', data.percent);
        }
        if (data.downloaded && data.total) {
            const mbDownloaded = (data.downloaded / 1024 / 1024).toFixed(1);
            const mbTotal = (data.total / 1024 / 1024).toFixed(1);
            progressText = `流式模型下载中... ${mbDownloaded} / ${mbTotal} MB`;
        }
        setStreamingModelStatus('downloading', progressText);
        updateModelListMessage(progressText);
    } else if (data.status === 'extracting') {
        setStreamingModelStatus('extracting', data.message || '流式模型解压中...');
        updateModelCardProgress('streaming', data.percent || 95);
        updateModelListMessage(data.message || '流式模型解压中...');
    } else if (data.status === 'done') {
        updateModelCardProgress('streaming', 100);
        setStreamingModelStatus('ready');
        updateModelListMessage('流式模型下载完成');
    } else if (data.status === 'error') {
        setStreamingModelStatus('error', data.message || '流式模型下载失败');
        updateModelListMessage(data.message || '流式模型下载失败');
    }
}

async function handleVadModelDownload() {
    setView('models');
    showModelDownloadView();
    setVadModelStatus('downloading');
    updateModelCardProgress('vad', 0);
    updateModelListMessage('正在下载 VAD 模型，请保持窗口打开');
    try {
        const result = await window.electronAPI.downloadVadModel();
        if (result?.success) {
            setVadModelStatus('ready');
            updateStatus('VAD 模型下载完成');
            updateModelListMessage('VAD 模型下载完成');
        } else {
            setVadModelStatus('error', result?.message || '未知错误');
            updateModelListMessage(result?.message ? `VAD 模型下载失败：${result.message}` : 'VAD 模型下载失败，请重试');
        }
    } catch (error) {
        setVadModelStatus('error', error.message);
        updateModelListMessage(`VAD 模型下载失败：${error.message}`);
    }
}

function handleVadModelProgress(data) {
    if (!data) return;
    if (data.status === 'starting') {
        setVadModelStatus('downloading', data.message || '准备下载 VAD 模型...');
        updateModelCardProgress('vad', 0);
        updateModelListMessage(data.message || '准备下载 VAD 模型...');
    } else if (data.status === 'downloading') {
        if (data.percent >= 0) {
            updateModelCardProgress('vad', data.percent);
        }
        setVadModelStatus('downloading', data.message || 'VAD 模型下载中...');
        updateModelListMessage(data.message || 'VAD 模型下载中...');
    } else if (data.status === 'completed' || data.status === 'done') {
        updateModelCardProgress('vad', 100);
        setVadModelStatus('ready');
        updateModelListMessage('VAD 模型下载完成');
    } else if (data.status === 'error') {
        setVadModelStatus('error', data.message || 'VAD 模型下载失败');
        updateModelListMessage(data.message || 'VAD 模型下载失败');
    }
}

// 拖拽处理
function handleDragOver(e) {
    e.preventDefault();
    fileDropZone.classList.add('dragover');
}

function handleDragLeave(e) {
    e.preventDefault();
    fileDropZone.classList.remove('dragover');
}

function handleDrop(e) {
    e.preventDefault();
    fileDropZone.classList.remove('dragover');
    
    const files = Array.from(e.dataTransfer.files);
    const mediaFile = files.find(file => {
        const ext = file.name.toLowerCase().split('.').pop();
        return ['wav', 'mp3', 'm4a', 'flac', 'aac', 'mp4', 'avi', 'mov', 'mkv', 'wmv', 'flv', 'm4v'].includes(ext);
    });
    
    if (mediaFile) {
        setSelectedFile(mediaFile.path);
    } else {
        showError('文件格式不支持', '请选择支持的音频或视频文件格式');
    }
}

// 实时转写
async function toggleLiveTranscribe() {
    if (liveMode === 'manual') {
        await toggleManualLive();
        return;
    }
    if (isLive) {
        stopLiveTranscribe();
        return;
    }

    setView('live');
    if (!liveModelsLoaded) {
        showError('模型未加载', '请先点击“加载实时模型”，并确保模型已就绪');
        return;
    }
    appendLog('准备启动两段式实时转写...', 'log');
    if (liveTranscriptBody) {
        liveTranscriptBody.innerHTML = '';
    }

    try {
        const granted = await ensureMicPermission(true);
        if (!granted) {
            showError('未获得麦克风权限', '请在系统设置中授权麦克风访问后重试');
            return;
        }
        await initMicDevices(); // 更新带名称的设备列表
        const micLabel = micSelect ? micSelect.options[micSelect.selectedIndex]?.textContent : '';
        resetTwoPassTexts();
        const start = await window.electronAPI.startLiveCapture({ mode: 'auto', micName: micLabel });
        if (!start?.success) {
            showError('启动失败', start?.message || '未知错误');
            return;
        }
        appendLog('两段式实时转写会话已启动 (ZipFormer -> SenseVoice)', 'info');
        appendLiveLog('会话已启动');
        setLiveUI(true);
        updateStatus('两段式实时转写中');
    } catch (error) {
        showError('无法启动实时转写', error.message);
        setLiveUI(false);
    }
}

async function stopLiveTranscribe() {
    isLive = false;
    if (!liveModelsLoaded) {
        setLiveUI(false, { preserveResults: true });
        return;
    }
    try {
        await window.electronAPI.stopLiveCapture({ mode: 'auto' });
    } catch (e) {
        // ignore
    }
    setLiveUI(false, { preserveResults: true });
    appendLiveLog('实时转写已停止');
    updateStatus('就绪');
}

async function loadLiveModels() {
    if (liveModelsLoaded) {
        console.log('[renderer] loadLiveModels: skipped (already loaded)');
        return;
    }
    const micLabel = micSelect ? micSelect.options[micSelect.selectedIndex]?.textContent : '';
    const manualRealtime = manualRealtimeCheckbox?.checked || false;
    console.log('===== [renderer] loadLiveModels START =====');
    console.log('[renderer] manualRealtimeCheckbox element:', manualRealtimeCheckbox);
    console.log('[renderer] manualRealtimeCheckbox.checked:', manualRealtimeCheckbox?.checked);
    console.log('[renderer] manualRealtimeCheckbox.display:', manualRealtimeCheckbox ? window.getComputedStyle(manualRealtimeRow).display : 'N/A');
    console.log('[renderer] liveMode:', liveMode);
    console.log('[renderer] manualRealtime (final value):', manualRealtime);
    console.log('[renderer] micLabel:', micLabel);
    console.log('[renderer] numThreads:', parseInt(maxWorkersSelect?.value || '2', 10) || 2);
    console.log('===== [renderer] loadLiveModels sending IPC =====');
    try {
        const resp = await window.electronAPI.loadLiveModels({
            mode: liveMode,
            micName: micLabel,
            manualRealtime,
            vad: defaultVadOptions,
            numThreads: parseInt(maxWorkersSelect?.value || '2', 10) || 2
        });
        console.log('===== [renderer] loadLiveModels IPC response =====');
        console.log('[renderer] resp.success:', resp?.success);
        console.log('[renderer] resp.mode:', resp?.mode);
        console.log('[renderer] resp.reused:', resp?.reused);
        console.log('===== [renderer] loadLiveModels END =====');
        if (!resp?.success) {
            showError('加载实时模型失败', resp?.message || '未知错误');
            return;
        }
        liveModelsLoaded = true;
        liveModelsMode = resp?.mode || 'shared';
        updateLiveModelUI();
        appendLiveLog('实时模型已加载，可在自动/按键模式间切换');
        updateStatus('实时模型已加载（共享在线/VAD/标点/离线模型）');
        setLiveUI(false, { preserveResults: true });
    } catch (err) {
        showError('加载实时模型失败', err.message);
    }
}

async function releaseLiveModels() {
    try {
        const resp = await window.electronAPI.releaseLiveModels();
        if (!resp?.success) {
            showError('释放实时模型失败', resp?.message || '未知错误');
            return;
        }
    } catch (err) {
        showError('释放实时模型失败', err.message);
        return;
    }
    liveModelsLoaded = false;
    liveModelsMode = null;
    isLive = false;
    isPttRecording = false;
    setPttUI('idle');
    setLiveUI(false, { preserveResults: true });
    resetLiveWaveform();
    updateLiveModelUI();
    updateStatus('实时模型已释放');
    appendLiveLog('已释放实时模型');
}

async function toggleManualLive() {
    if (isPttRecording || pttStartPromise) {
        await stopPttRecording();
        return;
    }
    await startPttRecording();
}

// 请求一次麦克风权限以便获取设备名称/录音
async function ensureMicPermission(interactive = true) {
    try {
        const statusResp = await window.electronAPI.getMicPermissionStatus?.();
        if (statusResp?.status) {
            micPermissionStatus = statusResp.status;
        }
        if (micPermissionStatus === 'granted') {
            return true;
        }
        if (interactive && window.electronAPI.requestMicPermission) {
            const req = await window.electronAPI.requestMicPermission();
            if (req?.status) {
                micPermissionStatus = req.status;
            }
            if (micPermissionStatus === 'granted') {
                return true;
            }
        }
        if (interactive && navigator.mediaDevices?.getUserMedia) {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            micPermissionStatus = 'granted';
            stream.getTracks().forEach((t) => t.stop());
            return true;
        }
    } catch (err) {
        console.warn('获取麦克风权限失败', err);
    }
    return micPermissionStatus === 'granted';
}

function updateLiveModelUI() {
    if (loadLiveBtn) {
        loadLiveBtn.disabled = liveModelsLoaded;
    }
    if (releaseLiveBtn) {
        releaseLiveBtn.disabled = !liveModelsLoaded;
    }
    if (liveBtn) {
        liveBtn.disabled = !liveModelsLoaded;
    }
    if (liveModelStatus) {
        if (liveModelsLoaded) {
            liveModelStatus.textContent = '已加载（自动/按键共用模型）';
        } else {
            liveModelStatus.textContent = '模型未加载';
        }
    }
}

function setLiveUI(status, options = {}) {
    const { preserveResults = false } = options;
    isLive = status;
    if (!liveBtn || !liveStatus || !livePill || !liveTranscript) return;
    const btnTextAuto = status ? '停止两遍实时转写' : '开始两遍实时转写';
    const btnTextManual = status ? '停止按键录音' : '开始按键录音（两段式）';
    liveBtn.querySelector('.live-btn-text').textContent = liveMode === 'manual' ? btnTextManual : btnTextAuto;
    liveBtn.classList.toggle('recording', status && liveMode === 'auto');
    const notLoaded = !liveModelsLoaded;
    liveStatus.textContent = status
        ? '两段式转写中...'
        : notLoaded
            ? '模型未加载'
            : '模型已加载，未开始';
    livePill.textContent = status ? '转写中' : notLoaded ? '未加载' : '已加载';
    livePill.style.background = status ? '#dcfce7' : notLoaded ? '#ffe4e6' : '#e2e8f0';
    livePill.style.color = status ? '#166534' : notLoaded ? '#9f1239' : '#334155';
    liveTranscript.style.display = 'block';
    if (status) {
        resetLiveTranscriptStore();
        resetLiveWaveform();
        if (!preserveResults && liveTranscriptBody) {
            liveTranscriptBody.innerHTML = '';
        }
    }
    if (!status) {
        if (!preserveResults) {
            resetLiveTranscriptStore();
            resetLiveWaveform();
            if (liveTranscriptBody) {
                liveTranscriptBody.innerHTML = '';
            }
            resetTwoPassTexts();
        }
    } else {
        updateFirstPassDisplay('等待语音...');
        updateSecondPassDisplay('等待二次精修...');
    }
    renderViewLayout();
    updateLiveModelUI();
}

function resetPttOverlayText() {
    latestPttFirstPassText = '';
}

function updatePttOverlayText(text) {
    latestPttFirstPassText = text || '';
    // 在按键录音模式下（isPttRecording 或手动模式）更新小窗
    if (liveMode !== 'manual' && !isPttRecording) {
        return;
    }
    try {
        window.electronAPI?.updatePttOverlay?.({
            state: 'recording',
            message: latestPttFirstPassText,
            lock: true
        });
    } catch (err) {
        // 忽略小窗更新失败，避免打断录音流程
    }
}

function setPttBannerState(state = 'idle', message, hint) {
    // 不再显示内嵌的小窗，仅驱动外部全局小窗
    if (pttBanner) {
        pttBanner.style.display = 'none';
    }
    if (state !== 'recording') {
        stopPttTimer();
    }
    const presets = {
        recording: { message: '正在录音...', hint: '松开设定按键以结束', lock: true },
        processing: { message: '正在识别...', hint: '稍等片刻', lock: false },
        done: { message: '识别完成', hint: '即将关闭', lock: false },
        error: { message: '录音失败', hint: '请重试', lock: false }
    };
    const preset = presets[state] || presets.recording;
    const finalMessage = message || preset.message;
    const finalHint = hint ?? preset.hint;
    const overlayMessage = latestPttFirstPassText || finalMessage;

    if (state === 'idle') {
        resetPttOverlayText();
        window.electronAPI?.hidePttOverlay?.();
        window.electronAPI?.armPttOverlay?.(false);
        return;
    }

    if (state === 'recording') {
        window.electronAPI?.armPttOverlay?.(true);
        startPttTimer(finalHint, overlayMessage);
    } else {
        window.electronAPI?.updatePttOverlay?.({
            state,
            message: overlayMessage,
            hint: finalHint,
            lock: Boolean(preset.lock),
            autoHideMs: preset.autoHideMs
        });
    }
}

function startPttTimer(hint = 'hgjhgh松开设定按键以结束', baseMessage = '正在录音...') {
    // 交给主进程计时，渲染层仅发送一次开始指令
    window.electronAPI?.updatePttOverlay?.({
        state: 'recording',
        message: baseMessage,
        hint,
        lock: true
    });
}

function stopPttTimer() {
    if (pttTimer) {
        clearInterval(pttTimer);
        pttTimer = null;
    }
}

function formatDurationMs(ms) {
    const clamped = Math.max(0, Math.floor(ms));
    const minutes = Math.floor(clamped / 60000);
    const seconds = Math.floor((clamped % 60000) / 1000);
    const millis = clamped % 1000;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

function setPttUI(state) {
    if (!livePill || !liveStatus || !liveTranscript) return;
    if (state === 'recording') {
        livePill.textContent = '按键录音中';
        livePill.style.background = '#dbeafe';
        livePill.style.color = '#1d4ed8';
        liveStatus.textContent = '按住设定按键录音中（两段式）';
        liveTranscript.style.display = 'block';
        liveBtn?.classList.add('recording');
        // 更新按钮文本
        if (liveBtn) {
            const btnText = liveBtn.querySelector('.live-btn-text');
            if (btnText) btnText.textContent = '停止按键录音';
        }
        setPttBannerState('recording');
    } else if (state === 'processing') {
        livePill.textContent = '按键识别中';
        livePill.style.background = '#fff7ed';
        livePill.style.color = '#c2410c';
        liveStatus.textContent = '按键录音结束，正在识别...';
        liveTranscript.style.display = 'block';
        liveBtn?.classList.remove('recording');
        // 更新按钮文本
        if (liveBtn) {
            const btnText = liveBtn.querySelector('.live-btn-text');
            if (btnText) btnText.textContent = '开始按键录音（两段式）';
        }
        setPttBannerState('processing');
    } else if (state === 'done') {
        livePill.textContent = '按键完成';
        livePill.style.background = '#dcfce7';
        livePill.style.color = '#166534';
        liveStatus.textContent = '按键识别完成';
        liveBtn?.classList.remove('recording');
        // 更新按钮文本
        if (liveBtn) {
            const btnText = liveBtn.querySelector('.live-btn-text');
            if (btnText) btnText.textContent = '开始按键录音（两段式）';
        }
        lastAutoPasteKey = '';
        setPttBannerState('done');
        setTimeout(() => setPttBannerState('idle'), 1600);
    } else {
        livePill.textContent = '未开始';
        livePill.style.background = '#e2e8f0';
        livePill.style.color = '#334155';
        liveStatus.textContent = '未开始';
        liveBtn?.classList.remove('recording');
        // 更新按钮文本
        if (liveBtn) {
            const btnText = liveBtn.querySelector('.live-btn-text');
            if (btnText) btnText.textContent = '开始按键录音（两段式）';
        }
        setPttBannerState('idle');
    }
}

function handleLiveResult(payload) {
    console.log('[handleLiveResult] ENTER', JSON.stringify(payload));
    console.log('[handleLiveResult] payload.type=', payload?.type, 'payload.stage=', payload?.stage);
    if (!payload || !liveTranscriptBody) return;
    if (payload.type === 'ready') {
        appendLog('两段式实时识别已就绪', 'info');
        appendLiveLog('模型加载完成，等待语音...');
        updateStatus('两段式实时识别已就绪');
        return;
    }
    if (payload.type === 'first-pass') {
        // 直接替换显示当前识别结果（不追加）
        const text = payload.text || '';
        updateFirstPassDisplay(text);
        updatePttOverlayText(text);

        // 自动模式下，1pass 结果也自动粘贴并记录（用于后续 2pass 替换）
        if (liveMode === 'auto' && enableLiveAutoPaste && text) {
            // 计算增量：只粘贴新增的部分
            let deltaText = text;
            if (lastPastedFirstPassText && text.startsWith(lastPastedFirstPassText)) {
                // 如果当前文本以之前粘贴的文本开头，只粘贴新增部分
                deltaText = text.slice(lastPastedFirstPassText.length);
            }

            if (deltaText) {
                const key = `auto-first-pass:${text.length}`;
                if (key !== lastAutoPasteKey) {
                    appendLiveLog(`[1pass] 完整文本: "${text}", 增量: "${deltaText}" (${deltaText.length} 字符)`);
                    pasteLiveText(deltaText, {
                        silent: true,
                        context: '1pass 实时',
                        key,
                        source: 'auto-first-pass',
                        combined: text
                    });
                    // 记录完整粘贴的 1pass 内容和增量长度，用于后续 2pass 替换
                    lastPastedFirstPassText = text;
                    lastPastedFirstPassDeltaLength = deltaText.length;
                }
            }
        }
        return;
    }
    if (payload.type === 'skip') {
        appendLog(payload.message || '静音片段跳过', 'log');
        appendLiveLog(payload.message || '静音片段跳过');
        return;
    }
    if (payload.type === 'devices' && Array.isArray(payload.devices)) {
        appendLog('可用麦克风列表（Python侧）:', 'info');
        payload.devices.forEach((d) => {
            appendLog(`index ${d.index}: ${d.name} (inputs=${d.inputs})`, 'info');
        });
        appendLiveLog('已获取 Python 侧设备列表，查看日志以确定索引');
        return;
    }
    if (payload.type === 'log') {
        appendLog(payload.message || '实时日志', 'log');
        appendLiveLog(payload.message || '实时日志');
        const msg = payload.message || '';
        const rmsMatch = msg.match(/Mic RMS\s+([-\d\.]+)\s*dBFS/i);
        if (rmsMatch) {
            addLiveRmsValue(parseFloat(rmsMatch[1]));
        }
        return;
    }
    if (payload.type === 'error') {
        appendLog(payload.message || '实时转写出错', 'error');
        if (payload.detail) {
            appendLog(payload.detail, 'error');
        }
        setLiveUI(false);
        liveModelsLoaded = false;
        liveModelsMode = null;
        updateLiveModelUI();
        appendLiveLog(payload.message || '实时转写出错');
        if (payload.detail) {
            appendLiveLog(payload.detail);
        }
        updateStatus('实时转写出错');
        if (liveMode === 'manual') {
            setPttBannerState('error', payload.message || '实时转写出错');
            setTimeout(() => setPttBannerState('idle'), 1600);
        }
        return;
    }
    if (payload.type === 'complete') {
        appendLog(payload.message || '实时转写结束', 'info');
        setLiveUI(false, { preserveResults: true });
        liveModelsLoaded = false;
        liveModelsMode = null;
        updateLiveModelUI();
        appendLiveLog(payload.message || '实时转写结束');
        updateStatus('实时转写结束');
        if (liveMode === 'manual') {
            // Toggle 模式：如果录音仍在进行，保持 recording 状态
            // 传统模式：设置为 done 状态
            if (isPttRecording) {
                setPttUI('recording');
            } else {
                setPttUI('done');
            }
        }
        return;
    }
    if (payload.type === 'result' && Array.isArray(payload.segments)) {
        if (payload.stage === 'second-pass') {
            const combinedText = payload.segments.map((seg) => seg.text || '').join(' ').trim();
            updateSecondPassDisplay(combinedText);
            appendLiveLog(`第二遍完成: ${combinedText}`);

            // 手动模式下，如果启用了 LLM，先调用 LLM 处理
            if (liveMode === 'manual' && enableLlmCheckbox?.checked && combinedText) {
                appendLiveLog(`[LLM] 正在调用 AI 助手处理...`);

                // 先尝试获取用户当前选中的文本作为 prefix
                window.electronAPI?.getCurrentSelection?.().then(selectionResult => {
                    const prefix = selectionResult?.success ? selectionResult.text : null;
                    if (prefix) {
                        appendLiveLog(`[LLM] 检测到选中文本: "${prefix.slice(0, 50)}${prefix.length > 50 ? '...' : ''}"`);
                    }

                    return window.electronAPI?.llmProcess?.(combinedText, prefix);
                }).then(result => {
                    if (result?.success && result?.text) {
                        const processedText = result.text;
                        appendLiveLog(`[LLM] AI 助手处理结果: ${processedText}`);
                        updateSecondPassDisplay(processedText);
                        // 使用 LLM 处理后的结果进行粘贴
                        return pasteLiveText(processedText, {
                            silent: true,
                            context: 'LLM 助手',
                            key: `llm-processed:${processedText.length}`,
                            source: 'llm-processed',
                            combined: processedText
                        });
                    } else {
                        appendLiveLog(`[LLM] 处理失败: ${result?.message || '未知错误'}`);
                        // LLM 失败时，仍然使用原始 2pass 结果
                        return pasteLiveText(combinedText, {
                            silent: true,
                            context: '2pass 结果',
                            key: `second-pass:${combinedText.length}`,
                            source: 'second-pass',
                            combined: combinedText
                        });
                    }
                }).catch(err => {
                    console.error('[LLM] Error:', err);
                    appendLiveLog(`[LLM] 调用错误: ${err?.message || err}`);
                    // 出错时，仍然使用原始 2pass 结果
                    return pasteLiveText(combinedText, {
                        silent: true,
                        context: '2pass 结果',
                        key: `second-pass:${combinedText.length}`,
                        source: 'second-pass',
                        combined: combinedText
                    });
                }).then(() => {
                    // 粘贴完成后，设置 UI 状态为 done，隐藏小窗
                    if (!isPttRecording) {
                        setPttUI('done');
                        updateStatus('按键识别完成');
                    }
                });
                return; // 等待 LLM 处理完成
            }

            // 自动模式下启用自动粘贴
            if (liveMode === 'auto' && enableLiveAutoPaste && combinedText) {
                const key = `auto-second-pass:${combinedText.length}`;
                if (key !== lastAutoPasteKey) {
                    // 策略：选中整个 1pass 文本长度，用完整的 2pass 文本替换
                    // 因为 1pass 是增量粘贴的，所以需要选中整个 1pass 来替换
                    const selectLength = lastPastedFirstPassText.length;

                    // 给 2pass 内容加上标签以便观察
                    const taggedSecondPassText = `<2pass>${combinedText}</2pass>`;

                    appendLiveLog(`[2pass] 选中整个1pass (${selectLength}字): "${lastPastedFirstPassText}"`);
                    appendLiveLog(`[2pass] 替换为: "${taggedSecondPassText}"`);

                    if (selectLength > 0 && window.electronAPI?.replaceFirstPassWithSecond) {
                        window.electronAPI.replaceFirstPassWithSecond({
                            selectLength: selectLength,
                            secondPassText: taggedSecondPassText
                        }).then(result => {
                            console.log('[2pass auto-replace] Result:', result);
                            if (result?.success) {
                                // 替换成功，本轮结束，重置状态以便下一轮重新开始
                                lastPastedFirstPassText = '';
                                lastPastedFirstPassDeltaLength = 0;
                                lastPastedCombinedText = '';
                                lastAutoPasteKey = '';
                                appendLiveLog(`[2pass] 替换成功，状态已重置`);
                            } else {
                                appendLiveLog(`[2pass 替换失败] ${result?.message || '未知错误'}`);
                            }
                        }).catch(err => {
                            console.error('[2pass auto-replace] Error:', err);
                            appendLiveLog(`[2pass 替换错误] ${err?.message || err}`);
                        });
                    } else {
                        // 没有 1pass 可替换，直接粘贴 2pass（这种情况通常意味着这轮刚开始）
                        appendLiveLog(`[2pass] 直接粘贴: "${combinedText}"`);
                        pasteLiveText(combinedText, {
                            silent: true,
                            context: '自动转写',
                            key,
                            source: 'auto-second-pass',
                            combined: combinedText
                        });
                        // 粘贴后重置状态（pasteLiveText 会更新 lastPastedCombinedText 和 lastAutoPasteKey）
                        lastPastedFirstPassText = '';
                        lastPastedFirstPassDeltaLength = 0;
                    }
                }
            }

            latestPttFirstPassText = combinedText || latestPttFirstPassText;
        }
        addLiveSegments(payload.segments);
        let lastLine = null;
        payload.segments.forEach((seg) => {
            const line = document.createElement('div');
            line.className = 'live-line';
            line.textContent = `${formatTime(seg.start_time || 0)} - ${formatTime(seg.end_time || 0)}：${seg.text || ''}`;
            liveTranscriptBody.appendChild(line);
            lastLine = line;
        });
        // 滚动到最后一行
        if (lastLine) {
            setTimeout(() => {
                lastLine.scrollIntoView({ behavior: 'smooth', block: 'end' });
            }, 10);
        }
        appendLog(`收到实时结果，段数 ${payload.segments.length}`, 'info');
        appendLiveLog(`收到实时结果，段数 ${payload.segments.length}`);
        // auto 模式的 2pass 替换已在 handleLiveResult 中处理，不需要再调用 autoPasteLiveIfEnabled
        // manual realtime 模式：直接粘贴当前段落的文本（每个 VAD 段落独立粘贴）
        console.log(`[DEBUG result] payload.stage=${payload.stage}, liveMode=${liveMode}, isLive=${isLive}`);
        appendLiveLog(`[DEBUG] payload.stage=${payload.stage}, liveMode=${liveMode}, isLive=${isLive}`);
        if (liveMode !== 'auto') {
          const newText = payload.segments.map((seg) => seg.text || '').join(' ').trim();
          appendLiveLog(`[DEBUG] newText="${newText}" (length=${newText.length})`);
          if (newText) {
            appendLiveLog(`[manual realtime] 粘贴: "${newText}"`);
            void pasteLiveText(newText, {
              silent: true,
              context: '按键录音实时',
              key: `manual-realtime:${Date.now()}:${newText.length}`,
              source: 'manual-realtime',
              combined: newText
            });
          }
        }
        if (liveMode === 'manual' && !isLive) {
            // Toggle 模式：如果录音仍在进行，保持 recording 状态
            // 传统模式：设置为 done 状态
            if (isPttRecording) {
                // Toggle 模式（实时自动分段）：录音仍在继续，保持 recording 状态
                setPttUI('recording');
            } else {
                // 传统模式：录音已结束，设置为 done 状态
                setPttUI('done');
            }
        }
    }
}

function appendLiveLog(message) {
    if (!liveLog) return;
    const div = document.createElement('div');
    div.className = 'live-log-entry';
    const timestamp = new Date().toLocaleTimeString();
    div.textContent = `[${timestamp}] ${message}`;
    liveLog.appendChild(div);
    liveLog.scrollTop = liveLog.scrollHeight;
}

function resetLiveTranscriptStore(options = {}) {
    const { preserveResults = false } = options;
    if (preserveResults) return;
    liveTranscriptSegments = [];
    liveSegmentKeys.clear();
    lastAutoPasteKey = '';
    lastPastedCombinedText = '';
    lastPastedFirstPassText = '';
    lastPastedFirstPassDeltaLength = 0;
    lastPastedSecondPassText = '';
}

function addLiveSegments(segments = []) {
    segments.forEach((seg) => {
        const start = Number(seg.start_time) || 0;
        const end = Number(seg.end_time) || 0;
        const text = seg.text || '';
        const speaker = seg.speaker || '';
        const key = `${start}-${end}-${text}-${speaker}`;
        if (liveSegmentKeys.has(key)) return;
        liveSegmentKeys.add(key);
        liveTranscriptSegments.push({ start, end, text, speaker });
    });
}

function resetTwoPassTexts() {
    if (firstPassText) firstPassText.textContent = '等待开始';
    if (secondPassText) secondPassText.textContent = '等待开始';
}

function updateFirstPassDisplay(text) {
    if (!firstPassText) return;
    // 直接替换显示，不追加（streaming模式的partial本身就是完整结果）
    // 如果是空文本，表示新一轮识别开始，显示等待提示
    firstPassText.textContent = text || '等待语音...';
    // 清除 2pass 标记（表示这是新的 1pass 临时结果）
    delete firstPassText.dataset.passType;
}

function updateSecondPassDisplay(text) {
    if (!secondPassText) return;
    secondPassText.textContent = text || '...';
    // 2pass 结果返回时，同步更新 1pass 显示（实现完全替换效果）
    if (firstPassText && text) {
        firstPassText.textContent = text;
        firstPassText.dataset.passType = 'second'; // 标记当前是2pass结果
    }
}

// 记录最后一次粘贴的 1pass 内容（用于外部输入框中的替换操作）
let lastPastedFirstPassText = '';
// 记录最后一次粘贴的 1pass 增量长度（用于 Shift+Left 选中）
let lastPastedFirstPassDeltaLength = 0;
// 记录最后一次粘贴的 2pass 完整内容（用于计算 2pass 增量）
let lastPastedSecondPassText = '';

function replaceFirstPassWithSecond() {
    console.log('[replaceFirstPassWithSecond] Called, secondPassText:', secondPassText?.textContent);
    appendLiveLog('[replaceFirstPassWithSecond] 函数被调用');

    if (!secondPassText) {
        console.log('[replaceFirstPassWithSecond] No secondPassText element');
        appendLiveLog('[replaceFirstPassWithSecond] 没有找到 2pass 文本元素');
        return;
    }

    const secondPassTextContent = secondPassText.textContent || '';
    console.log('[replaceFirstPassWithSecond] secondPassTextContent:', secondPassTextContent);
    // 检查是否是占位符文本
    const isPlaceholder =
        !secondPassTextContent ||
        ['等待开始', '等待语音...', '等待二次精修...', '...'].includes(secondPassTextContent.trim());

    if (isPlaceholder) {
        console.log('[replaceFirstPassWithSecond] Is placeholder:', isPlaceholder);
        appendLiveLog('没有可用的 2pass 结果用于替换');
        return;
    }

    // 检查是否有之前粘贴的 1pass 增量
    console.log('[replaceFirstPassWithSecond] lastPastedFirstPassDeltaLength:', lastPastedFirstPassDeltaLength);
    appendLiveLog(`[调试] lastPastedFirstPassDeltaLength = ${lastPastedFirstPassDeltaLength}`);

    if (lastPastedFirstPassDeltaLength <= 0) {
        appendLiveLog('没有可替换的 1pass 内容，直接粘贴 2pass 结果');
        // 直接粘贴 2pass 结果
        pasteLiveText(secondPassTextContent, {
            silent: false,
            context: '2pass 结果',
            key: `replace-first-pass:${secondPassTextContent.length}`,
            source: 'replace-first-pass',
            combined: secondPassTextContent
        });
        return;
    }

    // 需要在主进程中处理：选中 1pass 增量并用 2pass 替换
    appendLiveLog(`正在选中并替换 1pass 增量 (${lastPastedFirstPassDeltaLength} 字符) -> "${secondPassTextContent}"`);

    // 通过 IPC 调用主进程的替换功能
    if (window.electronAPI?.replaceFirstPassWithSecond) {
        console.log('[replaceFirstPassWithSecond] Calling IPC with:', {
            selectLength: lastPastedFirstPassDeltaLength,
            secondPassText: secondPassTextContent
        });
        window.electronAPI.replaceFirstPassWithSecond({
            // 传递需要选中的字符数（1pass 最后一次增量的长度）
            selectLength: lastPastedFirstPassDeltaLength,
            secondPassText: secondPassTextContent
        }).then(result => {
            console.log('[replaceFirstPassWithSecond] IPC result:', result);
            appendLiveLog(`[替换结果] success=${result?.success}, message=${result?.message || '无'}`);
        }).catch(err => {
            console.error('[replaceFirstPassWithSecond] IPC error:', err);
            appendLiveLog(`[替换错误] ${err?.message || err}`);
        });
    } else {
        appendLiveLog('当前环境不支持自动替换功能');
        console.log('[replaceFirstPassWithSecond] No electronAPI.replaceFirstPassWithSecond');
    }
}
// 麦克风录制
async function toggleRecording() {
    if (isRecording) {
        stopRecording();
        return;
    }

    try {
        // 请求麦克风权限并开始录制
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                deviceId: selectedMicId ? { exact: selectedMicId } : undefined
            }
        });
        recordedChunks = [];
        mediaRecorder = new MediaRecorder(stream);

        mediaRecorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) {
                recordedChunks.push(e.data);
            }
        };

        mediaRecorder.onstop = async () => {
            const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
            const arrayBuffer = await blob.arrayBuffer();
            const extension = (blob.type && blob.type.includes('webm')) ? 'webm' : 'wav';
            const result = await window.electronAPI.saveRecording(arrayBuffer, extension);
            if (result?.success) {
                setSelectedFile(result.filePath);
                updateStatus('录制完成并已选择该文件');
                appendLog(`录制完成: ${result.filePath}`, 'success');
            } else {
                showError('录制保存失败', result?.message || '未知错误');
            }
            setRecordingUI(false);
            mediaRecorder = null;
        };

        mediaRecorder.start();
        setRecordingUI(true);
        appendLog('开始录制麦克风输入...', 'info');
    } catch (error) {
        showError('无法开始录制', error.message);
        setRecordingUI(false);
    }
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach((t) => t.stop());
    }
}

function isTypingTarget(target) {
    if (!target) return false;
    const tag = (target.tagName || '').toLowerCase();
    const editable = target.getAttribute && target.getAttribute('contenteditable');
    return ['input', 'textarea', 'select'].includes(tag) || editable === '' || editable === 'true';
}

function handleGlobalKeyDown(e) {
    if ((e.code === 'AltLeft' || e.key === 'Alt') && !e.repeat) {
        if (isTypingTarget(e.target)) return;
        startPttRecording();
        e.preventDefault();
    }
}

function handleGlobalKeyUp(e) {
    if (e.code === 'AltLeft' || e.key === 'Alt') {
        if (isTypingTarget(e.target)) return;
        stopPttRecording();
        e.preventDefault();
    }
}

async function startPttRecording() {
    console.log('===== [renderer] startPttRecording START =====');
    console.log('[renderer] liveMode:', liveMode);
    console.log('[renderer] liveModelsLoaded:', liveModelsLoaded);
    console.log('[renderer] isPttRecording:', isPttRecording);
    console.log('[renderer] isRecording:', isRecording);
    console.log('[renderer] isLive:', isLive);
    console.log('[renderer] pttStartPromise:', !!pttStartPromise);

    if (liveMode !== 'manual') {
        console.log('[renderer] startPttRecording: skipped (not manual mode)');
        return;
    }
    if (!liveModelsLoaded) {
        console.log('[renderer] startPttRecording: error (models not loaded)');
        showError('模型未加载', '请先加载实时模型');
        return;
    }
    if (isPttRecording || isRecording || isLive || pttStartPromise) {
        console.log('[renderer] startPttRecording: skipped (already recording)');
        return;
    }
    try {
        const granted = await ensureMicPermission(true);
        if (!granted) {
            console.log('[renderer] startPttRecording: error (mic permission denied)');
            showError('未获得麦克风权限', '请在系统设置中授权麦克风访问后重试');
            return;
        }
        await initMicDevices();
        resetPttOverlayText();
        setView('live');
        resetLiveTranscriptStore();
        if (liveTranscriptBody) {
            liveTranscriptBody.innerHTML = '';
        }
        resetTwoPassTexts();
        const micLabel = micSelect ? micSelect.options[micSelect.selectedIndex]?.textContent : '';
        const manualRealtime = manualRealtimeCheckbox?.checked || false;
        console.log('===== [renderer] startPttRecording checkbox state =====');
        console.log('[renderer] manualRealtimeCheckbox element:', manualRealtimeCheckbox);
        console.log('[renderer] manualRealtimeCheckbox.checked:', manualRealtimeCheckbox?.checked);
        console.log('[renderer] manualRealtimeCheckbox.display:', manualRealtimeCheckbox ? window.getComputedStyle(manualRealtimeRow).display : 'N/A');
        console.log('[renderer] manualRealtime (final value):', manualRealtime);
        console.log('[renderer] micLabel:', micLabel);
        console.log('===== [renderer] startPttRecording sending IPC =====');
        queuedPttStop = false;
        pttStartPromise = window.electronAPI.startLiveCapture({ mode: 'manual', micName: micLabel, manualRealtime });
        const resp = await pttStartPromise;
        if (!resp?.success) {
            showError('无法开始按键录音', resp?.message || '未知错误');
            setPttBannerState('error', resp?.message || '录音启动失败');
            queuedPttStop = false;
            setTimeout(() => setPttBannerState('idle'), 1500);
            return;
        }
        isPttRecording = true;
        updateStatus('按住设定按键录音中（SDK）...');
        appendLiveLog('按住设定按键开始录音（SDK 内部录制）');
        updateFirstPassDisplay('录音中...');
        updateSecondPassDisplay('等待松开设定按键后识别');
        setPttUI('recording');
        if (queuedPttStop) {
            queuedPttStop = false;
            await stopPttRecording();
        }
    } catch (err) {
        showError('无法开始录音', err.message);
        isPttRecording = false;
        queuedPttStop = false;
        setPttBannerState('error', err.message || '录音启动失败');
        setTimeout(() => setPttBannerState('idle'), 1500);
    } finally {
        pttStartPromise = null;
    }
}

async function stopPttRecording(options = {}) {
    if (liveMode !== 'manual') return;
    if (!liveModelsLoaded) return;
    if (pttStartPromise && !isPttRecording) {
        queuedPttStop = true;
        try {
            await pttStartPromise;
        } catch {
            queuedPttStop = false;
        }
        return;
    }
    if (!isPttRecording) return;
    let stopFailed = false;
    try {
        const resp = await window.electronAPI.stopLiveCapture({ mode: 'manual', source: options?.source || 'key-up' });
        if (!resp?.success) {
            showError('停止录音失败', resp?.message || '未知错误');
            stopFailed = true;
            setPttBannerState('error', resp?.message || '停止录音失败');
        }
    } catch (err) {
        showError('停止录音失败', err.message);
        stopFailed = true;
        setPttBannerState('error', err.message || '停止录音失败');
    } finally {
        isPttRecording = false;
        queuedPttStop = false;
        updateStatus(stopFailed ? '按键录音停止失败' : '识别中...');
        if (stopFailed) {
            setTimeout(() => setPttBannerState('idle'), 1500);
            setPttUI('idle');
        } else {
            setPttUI('processing');
        }
    }
}

function handlePttResult(resultPayload) {
    if (!resultPayload) return;
    const payload = resultPayload;
    if (payload.type === 'result' && Array.isArray(payload.segments)) {
        const combinedText = payload.segments.map((seg) => seg.text || '').join(' ').trim();
        updateSecondPassDisplay(combinedText);
        appendLiveLog(`PTT 识别完成: ${combinedText}`);
        addLiveSegments(payload.segments);
        let lastLine = null;
        payload.segments.forEach((seg) => {
            const line = document.createElement('div');
            line.className = 'live-line';
            line.textContent = `${formatTime(seg.start_time || 0)} - ${formatTime(seg.end_time || 0)}：${seg.text || ''}`;
            liveTranscriptBody.appendChild(line);
            lastLine = line;
        });
        if (lastLine) {
            setTimeout(() => lastLine.scrollIntoView({ behavior: 'smooth', block: 'end' }), 10);
        }
        // Toggle 模式：如果录音仍在进行，保持 recording 状态
        // 传统模式：设置为 done 状态
        if (isPttRecording) {
            setPttUI('recording');
        } else {
            setPttUI('done');
        }
        updateStatus('按键识别完成');
        void autoPasteLiveIfEnabled('ptt-result');
    }
}

function setLiveMode(mode = 'auto') {
    const next = mode === 'manual' ? 'manual' : 'auto';
    if (next === liveMode) {
        if (liveModeSelect) liveModeSelect.value = liveMode;
        window.electronAPI?.armPttOverlay?.(liveMode === 'manual');
        return;
    }
    liveMode = next;
    if (liveModeSelect) {
        liveModeSelect.value = liveMode;
    }
    // 控制实时分段识别选项的显示（仅在 manual 模式下显示）
    if (manualRealtimeRow) {
        manualRealtimeRow.style.display = liveMode === 'manual' ? 'flex' : 'none';
    }
    // 控制 LLM 选项的显示（仅在 manual 模式下显示）
    if (enableLlmRow) {
        enableLlmRow.style.display = liveMode === 'manual' ? 'flex' : 'none';
    }
    window.electronAPI?.armPttOverlay?.(liveMode === 'manual');
    if (isLive) {
        stopLiveTranscribe();
    }
    if (isPttRecording) {
        stopPttRecording();
    }
    setPttUI('idle');
    setLiveUI(false, { preserveResults: true });
    if (liveBtn) {
        const btnTextAuto = '开始两遍实时转写';
        const btnTextManual = '开始按键录音（两段式）';
        liveBtn.querySelector('.live-btn-text').textContent = liveMode === 'manual' ? btnTextManual : btnTextAuto;
    }
    appendLiveLog(`已切换模式：${liveMode === 'manual' ? '按键录音（共享两段式模型）' : '自动两段式实时转写'}`);
    updateLiveModelUI();
}

function setRecordingUI(recording) {
    isRecording = recording;
    if (!recordBtn || !recordStatus) return;

    if (recording) {
        recordBtn.classList.add('recording');
        recordBtn.querySelector('.record-btn-text').textContent = '停止录制';
        recordStatus.textContent = '录制中...';
    } else {
        recordBtn.classList.remove('recording');
        recordBtn.querySelector('.record-btn-text').textContent = '开始录制';
        recordStatus.textContent = '等待开始';
    }
}

// 麦克风设备
async function initMicDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) {
        if (micSelect) {
            micSelect.innerHTML = '<option>不支持获取设备</option>';
        }
        return;
    }

    try {
        await ensureMicPermission(false);
        const devices = await navigator.mediaDevices.enumerateDevices();
        audioDevices = devices.filter((d) => d.kind === 'audioinput');
        if (!audioDevices.length) {
            micSelect.innerHTML = '<option>无可用麦克风</option>';
            selectedMicId = null;
            return;
        }
        micSelect.innerHTML = '';
        audioDevices.forEach((dev, idx) => {
            const opt = document.createElement('option');
            opt.value = dev.deviceId;
            opt.textContent = dev.label && dev.label.trim() ? dev.label : `麦克风 ${idx + 1}`;
            opt.dataset.index = idx;
            micSelect.appendChild(opt);
        });
        if (selectedMicId) {
            const found = audioDevices.find((d) => d.deviceId === selectedMicId);
            micSelect.value = found ? selectedMicId : audioDevices[0].deviceId;
        } else {
            selectedMicId = audioDevices[0].deviceId;
            micSelect.value = selectedMicId;
        }
    } catch (err) {
        micSelect.innerHTML = '<option>无法获取设备</option>';
        selectedMicId = null;
    }
}

// 开始处理
async function startProcessing() {
    if (!selectedFile || isProcessing) return;

    setView('process');
    const modelReady = await window.electronAPI.checkModel();
    if (!modelReady) {
        showError('模型未就绪', '请先下载模型后再运行');
        return;
    }
    
    isProcessing = true;
    updateUI();
    
    // 记录处理开始时间
    const processingStartTime = Date.now();
    
    // 显示处理状态
    progressCompact.style.display = 'block';
    processingState.style.display = 'flex';
    processingState.classList.add('fade-in');
    emptyState.style.display = 'none';
    resultsDisplay.style.display = 'none';
    
    // 重置进度
    resetProgress();
    
    try {
        let results;
        const isApiMode = processingMode.value === 'api';
        
        if (isApiMode) {
            // API处理模式
            processingTitle.textContent = '正在通过API处理...';
            results = await processWithAPI(selectedFile);
        } else {
            // 本地处理模式
            processingTitle.textContent = '正在分析音频...';
            const options = {
                enableDiarization: enableDiarization.checked,
                maxWorkers: parseInt(maxWorkersSelect.value),
                clusterThreshold: parseFloat(clusterThreshold.value),
                numClusters: speakerCount.value ? parseInt(speakerCount.value) : null
            };
            
            updateStatus('正在处理音频文件...');
            appendLog('开始本地处理音频文件...', 'info');
            
            results = await window.electronAPI.processAudio(selectedFile, options);
        }
        
        if (results.success) {
            // 计算处理耗时
            const processingEndTime = Date.now();
            const processingDuration = (processingEndTime - processingStartTime) / 1000; // 转换为秒
            
            // 将处理耗时添加到结果中（如果API没有返回处理时间，使用本地计算的时间）
            if (!results.processingDuration) {
                results.processingDuration = processingDuration;
            }
            
            currentResults = results;
            displayResults(results);
            
            const modeText = isApiMode ? 'API' : '本地';
            updateStatus(`${modeText}处理完成，识别到 ${results.processed_segments} 个语音片段，耗时 ${formatDuration(results.processingDuration)}`);
            appendLog(`${modeText}处理完成！总耗时: ${formatDuration(results.processingDuration)}`, 'success');
            
            // 显示结果
            processingState.style.display = 'none';
            resultsDisplay.style.display = 'flex';
            resultsDisplay.classList.add('fade-in');
        } else {
            throw new Error('处理失败');
        }
    } catch (error) {
        showError('处理失败', error.message);
        updateStatus('处理失败');
        appendLog(`处理失败: ${error.message}`, 'error');
    } finally {
        isProcessing = false;
        updateUI();
        renderViewLayout();
    }
}

// 更新进度
function updateProgress(data) {
    const lines = data.split('\n').filter(line => line.trim());
    
    lines.forEach(line => {
        if (line.includes('PROGRESS:')) {
            const match = line.match(/PROGRESS:\s*(\d+)%/);
            if (match) {
                const progress = parseInt(match[1]);
                // 更新两个进度条
                progressFillMain.style.width = `${progress}%`;
                progressCompactFill.style.width = `${progress}%`;
                progressTextMain.textContent = `${progress}%`;
                progressCompactText.textContent = `${progress}%`;
            }
        } else if (line.includes('INFO:')) {
            const info = line.replace('INFO:', '').trim();
            processingStatus.textContent = info;
            appendLog(info, 'info');
        } else if (line.includes('ERROR:')) {
            const error = line.replace('ERROR:', '').trim();
            appendLog(error, 'error');
        } else if (line.trim()) {
            appendLog(line.trim(), 'log');
        }
    });
}

// 新增：API模式下的进度更新
function updateAPIProgress(percentage, message) {
    progressFillMain.style.width = `${percentage}%`;
    progressCompactFill.style.width = `${percentage}%`;
    progressTextMain.textContent = `${percentage}%`;
    progressCompactText.textContent = `${percentage}%`;
    if (message) {
        processingStatus.textContent = message;
    }
}

// 重置进度
function resetProgress() {
    progressFillMain.style.width = '0%';
    progressCompactFill.style.width = '0%';
    progressTextMain.textContent = '0%';
    progressCompactText.textContent = '0%';
    processingStatus.textContent = '准备中...';
    processingTitle.textContent = '正在分析音频...';
}

// 添加日志
function appendLog(message, type = 'log') {
    const logElement = document.createElement('div');
    logElement.className = `log-entry log-${type}`;
    
    const timestamp = new Date().toLocaleTimeString();
    logElement.innerHTML = `<span class="log-time">[${timestamp}]</span> ${message}`;
    
    progressLog.appendChild(logElement);
    progressLog.scrollTop = progressLog.scrollHeight;
}

// 显示结果
function displayResults(results) {
    // 显示汇总信息
    const speakerCount = new Set(results.results.map(r => r.speaker)).size;
    const processingDuration = results.processingDuration || 0;
    
    let summaryText;
    if (results.enable_diarization) {
        summaryText = `
            识别到 <strong>${speakerCount}</strong> 位说话人，
            共 <strong>${results.processed_segments}</strong> 个语音片段，
            总耗时 <strong>${formatDuration(processingDuration)}</strong>
        `;
    } else {
        summaryText = `
            <strong>直接识别模式</strong>，
            共 <strong>${results.processed_segments}</strong> 个时间段，
            总耗时 <strong>${formatDuration(processingDuration)}</strong>
        `;
    }
    
    resultsSummary.innerHTML = summaryText;
    
    // 显示结果时间线
    resultsContent.innerHTML = '';
    results.results.forEach((result, index) => {
        const resultElement = createResultElement(result, index, results.enable_diarization);
        resultsContent.appendChild(resultElement);
    });
}

// 创建结果元素
function createResultElement(result, index, enableDiarization = true) {
    const element = document.createElement('div');
    element.className = 'result-item';
    element.style.animationDelay = `${index * 0.1}s`;
    element.setAttribute('data-start-time', result.start_time);
    element.setAttribute('data-end-time', result.end_time);
    element.setAttribute('data-index', index);
    
    let timeDisplay, speakerDisplay, resultText;
    
    if (enableDiarization) {
        // 说话人分离模式：显示时间范围和说话人
        const timeRange = `${formatTime(result.start_time)} - ${formatTime(result.end_time)}`;
        const duration = formatDuration(result.end_time - result.start_time);
        timeDisplay = `${timeRange} (${duration})`;
        speakerDisplay = result.speaker;
    } else {
        // 直接识别模式：显示时间范围，不显示说话人
        if (result.start_time > 0 || result.end_time > 0) {
            // 有时间信息时显示时间范围
            const timeRange = `${formatTime(result.start_time)} - ${formatTime(result.end_time)}`;
            const duration = formatDuration(result.end_time - result.start_time);
            timeDisplay = `${timeRange} (${duration})`;
        } else {
            // 没有时间信息时显示全文识别
            timeDisplay = '全文识别';
        }
        speakerDisplay = '';  // 不显示说话人
    }
    
    resultText = result.text || '无识别结果';
    
    // 新的一行显示格式：speaker、时间、识别内容
    if (enableDiarization && speakerDisplay) {
        element.innerHTML = `
            <div class="result-content-inline">
                <span class="result-speaker-inline">${speakerDisplay}</span>
                <span class="result-time-inline clickable-time" data-start="${result.start_time}">${timeDisplay}</span>
                <span class="result-text-inline">${resultText}</span>
            </div>
        `;
    } else {
        // 直接识别模式或无说话人信息时
        element.innerHTML = `
            <div class="result-content-inline">
                <span class="result-time-inline clickable-time" data-start="${result.start_time}">${timeDisplay}</span>
                <span class="result-text-inline">${resultText}</span>
            </div>
        `;
    }
    
    // 添加点击事件，跳转到对应时间
    const timeElement = element.querySelector('.clickable-time');
    if (timeElement && (result.start_time > 0 || result.end_time > 0)) {
        timeElement.addEventListener('click', () => {
            seekToTime(result.start_time);
        });
    }
    
    element.classList.add('fade-in');
    return element;
}

function buildPlainTranscript(results) {
    if (!results?.results?.length) return '';
    const includeSpeaker = Boolean(results.enable_diarization);
    const lines = results.results.map((result) => {
        const text = result.text || '';
        const hasTime = result.start_time > 0 || result.end_time > 0;
        const timeRange = hasTime ? `${formatTime(result.start_time)} - ${formatTime(result.end_time)}` : '';

        if (includeSpeaker && result.speaker) {
            return [result.speaker, timeRange, text].filter(Boolean).join(' ');
        }

        if (timeRange) {
            return `${timeRange} ${text}`.trim();
        }

        return text;
    });

    return lines.join('\n').trim();
}

async function pasteTranscriptionToInput() {
    if (!currentResults || !currentResults.results?.length) {
        await showError('粘贴失败', '没有可粘贴的转写结果');
        return;
    }
    if (!window.electronAPI?.pasteTextToFocusedInput) {
        await showError('粘贴失败', '当前环境不支持自动粘贴');
        return;
    }

    const text = buildPlainTranscript(currentResults);
    if (!text) {
        await showError('粘贴失败', '没有可粘贴的文本内容');
        return;
    }

    try {
        const result = await window.electronAPI.pasteTextToFocusedInput(text);
        if (!result?.success) {
            throw new Error(result?.message || '自动粘贴失败');
        }

        if (result.pasted) {
            updateStatus('已粘贴到当前输入框');
            appendLog('已将转写内容粘贴到当前输入框', 'success');
        } else {
            updateStatus('已复制转写内容，可手动粘贴');
            appendLog('已复制转写内容，请手动粘贴', 'info');
        }
    } catch (error) {
        console.warn('[PasteToInput] Failed', error);
        await showError('粘贴失败', error?.message || '请检查辅助功能或自动化权限');
    }
}

function buildNewLiveTranscriptText() {
    const sorted = [...liveTranscriptSegments].sort((a, b) => {
        if (a.start === b.start) return a.end - b.end;
        return a.start - b.start;
    });

    const combinedText = sorted
        .map((seg) => {
            const text = seg.text || '';
            return text;
        })
        .join(' ')
        .trim();

    if (combinedText && combinedText !== lastPastedCombinedText) {
        let delta = combinedText;
        if (combinedText.startsWith(lastPastedCombinedText)) {
            delta = combinedText.slice(lastPastedCombinedText.length);
        }
        return {
            text: delta.trim(),
            key: `segments:${combinedText.length}`,
            source: 'segments',
            combined: combinedText
        };
    }

    const fallback = (secondPassText?.textContent || '').trim();
    const isPlaceholder =
        !fallback ||
        ['等待开始', '等待语音...', '等待二次精修...', '...'].includes(fallback.trim());
    if (!isPlaceholder && fallback !== lastPastedCombinedText) {
        let delta = fallback;
        if (fallback.startsWith(lastPastedCombinedText)) {
            delta = fallback.slice(lastPastedCombinedText.length);
        }
        return { text: delta.trim(), key: `fallback:${fallback.length}`, source: 'fallback', combined: fallback };
    }

    return { text: '', key: '', source: 'none' };
}

async function autoPasteLiveIfEnabled(reason = 'live') {
    if (!enableLiveAutoPaste) return;
    const payload = buildNewLiveTranscriptText();
    if (!payload.text) return;
    const key = payload.key || `${reason}:${payload.text}`;
    if (key === lastAutoPasteKey) return;
    await pasteLiveText(payload.text, {
        silent: true,
        context: '实时转写',
        key,
        source: payload.source,
        combined: payload.combined
    });
}

async function pasteLiveText(text, { silent = false, context = '实时转写', key = '', source = 'segments', combined = '' } = {}) {
    if (!text) {
        if (!silent) {
            await showError('粘贴失败', '当前没有可粘贴的实时转写内容');
        }
        return false;
    }
    if (!window.electronAPI?.pasteTextToFocusedInput) {
        if (!silent) {
            await showError('粘贴失败', '当前环境不支持自动粘贴');
        }
        return false;
    }
    try {
        const result = await window.electronAPI.pasteTextToFocusedInput(text);
        if (!result?.success) {
            throw new Error(result?.message || '自动粘贴失败');
        }
        if (result.pasted) {
            updateStatus(`已粘贴${context}到当前输入框`);
            appendLiveLog(`已将${context}粘贴到当前输入框`);
        } else {
            updateStatus(`${context}已复制，可手动粘贴`);
            appendLiveLog(`${context}已复制到剪贴板，请手动粘贴`);
        }
        if (combined) {
            lastPastedCombinedText = combined;
        } else if (source === 'segments') {
            lastPastedCombinedText = text;
        } else if (source === 'fallback') {
            lastPastedCombinedText = text;
        }
        if (key) {
            lastAutoPasteKey = key;
        }
        return true;
    } catch (error) {
        console.warn('[PasteLiveToInput] Failed', error);
        if (!silent) {
            await showError('粘贴失败', error?.message || '请检查辅助功能或自动化权限');
        }
        return false;
    }
}

async function pasteLiveTranscriptToInput() {
    const payload = buildNewLiveTranscriptText();
    if (!payload.text) {
        await showError('粘贴失败', '当前没有可粘贴的实时转写内容');
        return;
    }
    await pasteLiveText(payload.text, {
        context: '实时转写',
        key: payload.key,
        source: payload.source,
        combined: payload.combined
    });
}

// 导出结果
async function exportResults() {
    if (!currentResults) {
        showError('导出失败', '没有可导出的结果');
        return;
    }
    
    try {
        const content = generateExportContent(currentResults);
        const defaultName = `说话人识别结果_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;
        
        const result = await window.electronAPI.saveFile(content, defaultName);
        
        if (result.success) {
            updateStatus(`结果已导出到: ${result.filePath}`);
            await window.electronAPI.showMessage('导出成功', `文件已保存到:\n${result.filePath}`);
        } else {
            if (result.error !== '用户取消保存') {
                throw new Error(result.error);
            }
        }
    } catch (error) {
        console.error('导出失败:', error);
        showError('导出失败', error.message);
    }
}

// 生成导出内容
function generateExportContent(results) {
    const modeText = results.enable_diarization ? '说话人分离和ASR识别结果' : '语音识别结果';
    let content = `${modeText}\n`;
    content += '='.repeat(50) + '\n\n';
    content += `处理时间: ${new Date().toLocaleString()}\n`;
    content += `处理模式: ${results.enable_diarization ? '说话人分离' : '直接识别'}\n`;
    content += `总片段数: ${results.total_segments}\n`;
    content += `处理成功: ${results.processed_segments}\n`;
    content += `处理耗时: ${formatDuration(results.processingDuration || 0)}\n`;
    
    if (results.enable_diarization) {
        content += `说话人数: ${new Set(results.results.map(r => r.speaker)).size}\n`;
    }
    content += '\n';
    
    content += '详细结果:\n';
    content += '-'.repeat(30) + '\n\n';
    
    results.results.forEach((result, index) => {
        if (results.enable_diarization) {
            const timeRange = `${formatTime(result.start_time)} - ${formatTime(result.end_time)}`;
            content += `${index + 1}. ${timeRange}: ${result.speaker}\n`;
        } else {
            // 直接识别模式，检查是否有时间信息
            if (result.start_time > 0 || result.end_time > 0) {
                const timeRange = `${formatTime(result.start_time)} - ${formatTime(result.end_time)}`;
                content += `${index + 1}. ${timeRange}\n`;
            } else {
                content += `${index + 1}. 全文识别\n`;
            }
        }
        content += `   ${result.text || '无识别结果'}\n\n`;
    });
    
    return content;
}

// 清除结果
function clearResults() {
    currentResults = null;
    processingState.style.display = 'none';
    resultsDisplay.style.display = 'none';
    progressCompact.style.display = 'none';
    emptyState.style.display = 'flex';
    updateStatus('就绪');
    renderViewLayout();
}

// 切换说话人分离设置
function toggleDiarizationSettings() {
    const isEnabled = enableDiarization.checked;
    
    if (isEnabled) {
        threadSetting.classList.remove('disabled');
        thresholdSetting.classList.remove('disabled');
        speakerCountSetting.classList.remove('disabled');
    } else {
        threadSetting.classList.add('disabled');
        thresholdSetting.classList.add('disabled');
        speakerCountSetting.classList.add('disabled');
    }
    
    // 同步更新模式按钮状态
    diarizationModeBtn.classList.toggle('active', isEnabled);
    directModeBtn.classList.toggle('active', !isEnabled);
}

// 新增：切换处理方式
function toggleProcessingMode() {
    const isApiMode = processingMode.value === 'api';
    
    if (isApiMode) {
        apiSettings.style.display = 'block';
        localSettings.style.display = 'none';
    } else {
        apiSettings.style.display = 'none';
        localSettings.style.display = 'block';
    }
}

// 新增：设置识别模式
function setRecognitionMode(mode) {
    // 更新按钮状态
    diarizationModeBtn.classList.toggle('active', mode === 'diarization');
    directModeBtn.classList.toggle('active', mode === 'direct');
    
    // 同步更新复选框状态
    const isDiarization = mode === 'diarization';
    enableDiarization.checked = isDiarization;
    
    // 触发设置变更事件
    toggleDiarizationSettings();
    
    // 更新状态文本
    const modeText = isDiarization ? '说话人分离模式' : '直接识别模式';
    updateStatus(`已切换到${modeText}`);
    
    // 添加视觉反馈
    const activeBtn = isDiarization ? diarizationModeBtn : directModeBtn;
    activeBtn.style.transform = 'scale(0.95)';
    setTimeout(() => {
        activeBtn.style.transform = '';
    }, 150);
}

// 新增：更新语言选择状态
function updateLanguageSelection() {
    // 为兼容性添加 .selected 类
    document.querySelectorAll('.language-option').forEach(option => {
        const radio = option.querySelector('input[type="radio"]');
        if (radio.checked) {
            option.classList.add('selected');
        } else {
            option.classList.remove('selected');
        }
    });
    
    // 更新状态显示
    const selectedLanguage = document.querySelector('input[name="apiLanguage"]:checked')?.value;
    const languageNames = {
        'zh': '中文',
        'en': '英文', 
        'jp': '日文',
        'yue': '粤语',
        'auto': '中英混合'
    };
    
    if (selectedLanguage && languageNames[selectedLanguage]) {
        updateStatus(`已选择识别语言: ${languageNames[selectedLanguage]}`);
    }
}

// 新增：获取完整的API URL
function getFullApiUrl() {
    const protocol = apiProtocol.value;
    const url = apiUrl.value || 'ragflow.qwenkimi.com/speakerdiarization';
    
    // 如果URL已经包含协议，使用原URL
    if (url.startsWith('http://') || url.startsWith('https://')) {
        return url;
    }
    
    // 否则添加选择的协议
    return `${protocol}://${url}`;
}

// 新增：测试API连接
async function testAPIConnection() {
    const url = getFullApiUrl();
    const apiHost = new URL(url).hostname;
    
    try {
        appendLog('开始API连接诊断...', 'info');
        appendLog(`目标地址: ${url}`, 'info');
        appendLog(`主机名: ${apiHost}`, 'info');
        
        // 1. 基础DNS解析测试
        appendLog('步骤1: 检查DNS解析...', 'info');
        const dnsTestUrl = `https://dns.google/resolve?name=${apiHost}&type=A`;
        try {
            const dnsResponse = await fetch(dnsTestUrl);
            const dnsData = await dnsResponse.json();
            if (dnsData.Answer && dnsData.Answer.length > 0) {
                const ips = dnsData.Answer.map(a => a.data).join(', ');
                appendLog(`DNS解析成功: ${apiHost} -> ${ips}`, 'success');
            } else {
                appendLog(`DNS解析失败或无记录: ${apiHost}`, 'warning');
            }
        } catch (dnsError) {
            appendLog(`DNS检查失败: ${dnsError.message}`, 'warning');
        }
        
        // 2. 测试基础HTTP连接
        appendLog('步骤2: 测试基础HTTP连接...', 'info');
        const httpUrl = `http://${apiHost}`;
        try {
            const controller1 = new AbortController();
            const timeoutId1 = setTimeout(() => controller1.abort(), 10000);
            
            const httpResponse = await fetch(httpUrl, {
                method: 'GET',
                signal: controller1.signal,
                mode: 'no-cors',
                cache: 'no-cache'
            });
            
            clearTimeout(timeoutId1);
            appendLog(`HTTP连接测试: ${httpResponse.status || '无响应'} ${httpResponse.statusText || ''}`, 'info');
        } catch (httpError) {
            appendLog(`HTTP连接失败: ${httpError.message}`, 'warning');
            
            if (httpError.message.includes('502')) {
                appendLog('502错误表明服务器不可用或配置错误', 'error');
            }
        }
        
        // 3. 测试HTTPS连接
        appendLog('步骤3: 测试HTTPS连接...', 'info');
        const httpsUrl = `https://${apiHost}`;
        try {
            const controller2 = new AbortController();
            const timeoutId2 = setTimeout(() => controller2.abort(), 10000);
            
            const httpsResponse = await fetch(httpsUrl, {
                method: 'GET',
                signal: controller2.signal,
                mode: 'no-cors',
                cache: 'no-cache'
            });
            
            clearTimeout(timeoutId2);
            appendLog(`HTTPS连接测试: ${httpsResponse.status || '无响应'} ${httpsResponse.statusText || ''}`, 'info');
        } catch (httpsError) {
            appendLog(`HTTPS连接失败: ${httpsError.message}`, 'warning');
            
            if (httpsError.message.includes('SSL') || httpsError.message.includes('ERR_SSL_PROTOCOL_ERROR')) {
                appendLog('SSL协议错误，可能原因：', 'error');
                appendLog('- 服务器不支持HTTPS', 'error');
                appendLog('- SSL证书配置错误', 'error');
                appendLog('- SSL协议版本不兼容', 'error');
            }
        }
        
        // 4. 测试目标API端点（使用POST方法，因为API不支持HEAD）
        appendLog('步骤4: 测试目标API端点...', 'info');
        try {
            const controller3 = new AbortController();
            const timeoutId3 = setTimeout(() => controller3.abort(), 15000);
            
            // 创建一个简单的测试FormData
            const testFormData = new FormData();
            testFormData.append('requestid', 'connection-test');
            // 注意：不添加file字段，这样API会返回错误但能证明连接正常
            
            const response = await fetch(url, {
                method: 'POST',
                body: testFormData,
                signal: controller3.signal,
                mode: 'cors',
                cache: 'no-cache',
                credentials: 'omit'
            });
            
            clearTimeout(timeoutId3);
            
            appendLog(`API端点测试结果: ${response.status} ${response.statusText}`, 'info');
            
            // 对于API测试，即使返回4xx错误也表明连接成功（因为我们没有发送完整的请求）
            if (response.status === 405) {
                appendLog('❌ API不支持HEAD方法，这是正常的', 'warning');
                appendLog('✅ API连接正常，服务器可达', 'success');
                return true;
            } else if (response.status >= 400 && response.status < 500) {
                // 4xx错误通常表明请求格式问题，但连接是成功的
                appendLog('✅ API连接成功（服务器返回客户端错误，这是正常的测试响应）', 'success');
                appendLog('这表明API服务器可达且正在运行', 'info');
                return true;
            } else if (response.ok) {
                appendLog('✅ API连接测试成功！', 'success');
                return true;
            } else {
                appendLog(`❌ API返回服务器错误: ${response.status}`, 'error');
                return false;
            }
            
        } catch (apiError) {
            appendLog(`API端点测试失败: ${apiError.message}`, 'error');
            
            // 详细错误分析
            if (apiError.name === 'AbortError') {
                appendLog('请求超时，服务器响应缓慢或不可达', 'error');
            } else if (apiError.message.includes('ERR_SSL_PROTOCOL_ERROR')) {
                appendLog('SSL协议错误，服务器可能不支持HTTPS', 'error');
                appendLog('建议：尝试使用HTTP协议', 'info');
            } else if (apiError.message.includes('502') || apiError.message.includes('Bad Gateway')) {
                appendLog('502错误：服务器网关错误，上游服务器不可用', 'error');
                appendLog('这通常表明API服务器当前不可用', 'error');
            } else if (apiError.message.includes('Failed to fetch')) {
                appendLog('网络连接完全失败，可能原因：', 'error');
                appendLog('- 网络连接问题', 'error');
                appendLog('- 防火墙阻止', 'error');
                appendLog('- CORS跨域限制', 'error');
                appendLog('- 代理服务器问题', 'error');
            }
            
            return false;
        }
        
    } catch (error) {
        appendLog(`连接诊断过程出错: ${error.message}`, 'error');
        return false;
    }
}

// 新增：测试简单的网络连通性
async function testBasicConnectivity() {
    appendLog('开始基础网络连通性测试...', 'info');
    
    // 测试到知名网站的连接
    const testSites = [
        'https://www.baidu.com',
        'https://www.google.com',
        'https://httpbin.org/get'
    ];
    
    for (const site of testSites) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            
            const response = await fetch(site, {
                method: 'GET',
                signal: controller.signal,
                mode: 'no-cors',
                cache: 'no-cache'
            });
            
            clearTimeout(timeoutId);
            appendLog(`✅ ${site} 连接正常`, 'success');
            return true;
        } catch (error) {
            appendLog(`❌ ${site} 连接失败: ${error.message}`, 'warning');
        }
    }
    
    appendLog('基础网络连通性测试失败，请检查网络连接', 'error');
    return false;
}

// 修改API处理函数，先测试连接
async function processWithAPI(filePath) {
    const url = getFullApiUrl();
    const reqId = requestId.value || `request-${Date.now()}`;
    
    try {
        // 先测试API连接
        appendLog('正在测试API连接...', 'info');
        const connectionOk = await testAPIConnection();
        
        if (!connectionOk) {
            throw new Error('API连接测试失败，请检查网络连接和API地址，或尝试切换协议');
        }
        
        updateStatus('正在上传文件到API...');
        updateAPIProgress(10, '正在上传文件到API...');
        appendLog('开始API处理...', 'info');
        appendLog(`API地址: ${url}`, 'info');
        appendLog(`请求ID: ${reqId}`, 'info');
        
        // 创建FormData
        const formData = new FormData();
        
        // 读取文件
        updateAPIProgress(20, '正在读取文件...');
        appendLog('正在读取文件...', 'info');
        const fileBuffer = await window.electronAPI.readFile(filePath);
        appendLog(`文件读取完成，大小: ${fileBuffer.byteLength} 字节`, 'info');
        
        const fileName = filePath.split('/').pop();
        const blob = new Blob([fileBuffer], { type: 'audio/wav' });
        formData.append('file', blob, fileName);
        formData.append('requestid', reqId);
        
        // 根据用户设置决定是否启用说话人分离
        const needDiarization = enableDiarization.checked;
        formData.append('need_diarization', needDiarization);
        
        // 添加语言参数
        const selectedLanguage = document.querySelector('input[name="apiLanguage"]:checked')?.value || 'zh';
        formData.append('language', selectedLanguage);
        
        const languageNames = {
            'zh': '中文',
            'en': '英文', 
            'jp': '日文',
            'yue': '粤语',
            'auto': '中英混合'
        };
        
        appendLog(`说话人分离设置: ${needDiarization ? '启用' : '禁用'}`, 'info');
        appendLog(`识别语言: ${languageNames[selectedLanguage]}`, 'info');

        updateStatus('正在进行语音识别...');
        updateAPIProgress(30, '文件上传完成，开始处理...');
        appendLog('文件准备完成，开始API调用...', 'info');
        
        // 添加调试信息
        appendLog(`准备调用API: ${url}`, 'info');
        appendLog(`文件名: ${fileName}`, 'info');
        appendLog(`文件类型: ${blob.type}`, 'info');
        appendLog(`文件大小: ${blob.size} 字节`, 'info');
        
        // 调用API
        updateAPIProgress(50, '正在调用API进行处理...');
        
        // 添加更详细的fetch配置
        const fetchOptions = {
            method: 'POST',
            body: formData,
            // 不要设置Content-Type，让浏览器自动设置
            headers: {
                // 移除可能冲突的headers
            }
        };
        
        appendLog('开始发送API请求...', 'info');
        const response = await fetch(url, fetchOptions);
        
        appendLog(`API响应状态: ${response.status} ${response.statusText}`, 'info');
        
        if (!response.ok) {
            const errorText = await response.text();
            appendLog(`API错误响应内容: ${errorText}`, 'error');
            throw new Error(`API请求失败: ${response.status} ${response.statusText}`);
        }
        
        updateAPIProgress(80, '正在解析API响应...');
        const result = await response.json();
        appendLog(`API响应成功`, 'info');
        appendLog(`响应内容: ${JSON.stringify(result, null, 2)}`, 'info');
        
        if (result.code !== 0) {
            throw new Error(`API返回错误: ${result.message}`);
        }
        
        // 解析结果
        updateAPIProgress(90, '正在转换结果格式...');
        const apiData = JSON.parse(result.data);
        const convertedResults = convertApiResultsToLocalFormat(apiData);
        
        updateAPIProgress(100, '处理完成');
        appendLog(`成功处理 ${convertedResults.length} 个语音片段`, 'success');
        
        return {
            success: true,
            enable_diarization: true,
            total_segments: convertedResults.length,
            processed_segments: convertedResults.length,
            results: convertedResults,
            processingDuration: result.duration
        };
        
    } catch (error) {
        appendLog(`API处理失败: ${error.message}`, 'error');
        appendLog(`错误类型: ${error.name}`, 'error');
        appendLog(`错误详情: ${error.stack}`, 'error');
        
        // 检查是否是网络错误
        if (error instanceof TypeError && error.message === 'Failed to fetch') {
            appendLog('这是一个网络连接错误，可能的原因：', 'error');
            appendLog('1. API地址无法访问', 'error');
            appendLog('2. 网络连接问题', 'error');
            appendLog('3. CORS跨域问题', 'error');
            appendLog('4. 防火墙或代理阻止了请求', 'error');
            appendLog('5. SSL证书问题（如果使用HTTPS）', 'error');
            appendLog('建议：尝试切换协议或检查网络设置', 'error');
        }
        
        throw error;
    }
}

// 新增：将API结果转换为本地格式
function convertApiResultsToLocalFormat(apiData) {
    return apiData.map((item, index) => {
        return {
            segment_id: index,
            start_time: item.original_start,
            end_time: item.original_end,
            speaker: item.speaker,
            text: item.txt
        };
    });
}

// 切换日志面板
function toggleLogPanel() {
    logPanel.classList.toggle('open');
    logToggleBtn.classList.toggle('active');
}

function toggleLiveLog(forceState) {
    if (!liveLogWrapper || !liveLogToggleBtn) return;
    if (typeof forceState === 'boolean') {
        isLiveLogVisible = forceState;
    } else {
        isLiveLogVisible = !isLiveLogVisible;
    }
    liveLogWrapper.classList.toggle('collapsed', !isLiveLogVisible);
    liveLogToggleBtn.classList.toggle('collapsed', !isLiveLogVisible);
    const textEl = liveLogToggleBtn.querySelector('.live-log-toggle-text');
    if (textEl) {
        textEl.textContent = isLiveLogVisible ? '隐藏日志' : '显示日志';
    }
}

// 更新UI状态
function updateUI() {
    processBtn.disabled = !selectedFile || isProcessing;
    
    if (isProcessing) {
            processBtn.classList.add('processing');
            processBtn.innerHTML = `
                <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 6v6l4 2"/>
                </svg>
                处理中...
            `;
        } else {
            processBtn.classList.remove('processing');
        processBtn.innerHTML = `
            <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
            开始处理
        `;
    }
}

// 更新状态栏
function updateStatus(message) {
    statusText.textContent = message;
}

// 显示错误
async function showError(title, message) {
    await window.electronAPI.showError(title, message);
}

// 时间格式化函数
function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

function formatDuration(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    if (mins > 0) {
        return `${mins}分${secs}秒`;
    } else {
        return `${secs}秒`;
    }
}

function getTotalDuration(results) {
    return results.reduce((total, result) => {
        return total + (result.end_time - result.start_time);
    }, 0);
}

// CSS样式补充
const additionalStyles = `
.log-entry {
    margin-bottom: 4px;
    word-wrap: break-word;
}

.log-time {
    color: #9ca3af;
    font-size: 11px;
}

.log-info {
    color: #059669;
}

.log-error {
    color: #dc2626;
}

.log-success {
    color: #059669;
    font-weight: 600;
}

.log-log {
    color: #374151;
}
`;

// 添加样式到页面
const styleSheet = document.createElement('style');
styleSheet.textContent = additionalStyles;
document.head.appendChild(styleSheet);

// 音频播放器功能
function initAudioPlayer(filePath) {
    const audioPlayer = document.getElementById('audioPlayer');
    const audioElement = document.getElementById('audioElement');
    
    // 检查是否为音频文件或视频文件
    const ext = filePath.toLowerCase().split('.').pop();
    const audioExtensions = ['wav', 'mp3', 'm4a', 'flac', 'aac'];
    const videoExtensions = ['mp4', 'avi', 'mov', 'mkv', 'wmv', 'flv', 'm4v'];
    
    if (audioExtensions.includes(ext) || videoExtensions.includes(ext)) {
        // 设置音频源
        audioElement.src = `file://${filePath}`;
        audioPlayer.style.display = 'block';
        
        // 设置音频事件监听器
        setupAudioEvents();
    } else {
        audioPlayer.style.display = 'none';
    }
}

function setupAudioEvents() {
    const audioElement = document.getElementById('audioElement');
    const playBtn = document.getElementById('playBtn');
    const pauseBtn = document.getElementById('pauseBtn');
    const currentTime = document.getElementById('currentTime');
    const totalTime = document.getElementById('totalTime');
    const progressBarAudio = document.getElementById('progressBarAudio');
    const progressFillAudio = document.getElementById('progressFillAudio');
    const progressHandle = document.getElementById('progressHandle');
    
    // 格式化时间（播放器用）
    function formatTimeForPlayer(seconds) {
        const minutes = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    
    // 更新进度
    function updateProgress() {
        const progress = (audioElement.currentTime / audioElement.duration) * 100;
        progressFillAudio.style.width = `${progress}%`;
        progressHandle.style.left = `${progress}%`;
        currentTime.textContent = formatTimeForPlayer(audioElement.currentTime);
        
        // 同步高亮结果
        highlightCurrentResult(audioElement.currentTime);
    }
    
    // 播放按钮
    playBtn.addEventListener('click', () => {
        audioElement.play();
        playBtn.style.display = 'none';
        pauseBtn.style.display = 'flex';
    });
    
    // 暂停按钮
    pauseBtn.addEventListener('click', () => {
        audioElement.pause();
        pauseBtn.style.display = 'none';
        playBtn.style.display = 'flex';
    });
    
    // 音频事件
    audioElement.addEventListener('loadedmetadata', () => {
        totalTime.textContent = formatTimeForPlayer(audioElement.duration);
        currentTime.textContent = '00:00';
        progressFillAudio.style.width = '0%';
        progressHandle.style.left = '0%';
    });
    
    audioElement.addEventListener('timeupdate', updateProgress);
    
    audioElement.addEventListener('ended', () => {
        pauseBtn.style.display = 'none';
        playBtn.style.display = 'flex';
        progressFillAudio.style.width = '0%';
        progressHandle.style.left = '0%';
        audioElement.currentTime = 0;
    });
    
    // 进度条点击
    progressBarAudio.addEventListener('click', (e) => {
        const rect = progressBarAudio.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const width = rect.width;
        const clickRatio = clickX / width;
        const newTime = clickRatio * audioElement.duration;
        audioElement.currentTime = newTime;
    });
    
    // 进度条拖拽
    let isDragging = false;
    
    progressHandle.addEventListener('mousedown', (e) => {
        isDragging = true;
        e.preventDefault();
    });
    
    document.addEventListener('mousemove', (e) => {
        if (isDragging) {
            const rect = progressBarAudio.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const width = rect.width;
            const ratio = Math.max(0, Math.min(1, x / width));
            const newTime = ratio * audioElement.duration;
            audioElement.currentTime = newTime;
        }
    });
    
    document.addEventListener('mouseup', () => {
        isDragging = false;
    });
}

// 跳转到指定时间
function seekToTime(time) {
    const audioElement = document.getElementById('audioElement');
    if (audioElement && audioElement.src) {
        audioElement.currentTime = time;
        // 立即更新高亮
        highlightCurrentResult(time);
    }
}

// 高亮当前播放位置对应的结果
function highlightCurrentResult(currentTime) {
    const resultItems = document.querySelectorAll('.result-item');
    
    resultItems.forEach(item => {
        const startTime = parseFloat(item.getAttribute('data-start-time'));
        const endTime = parseFloat(item.getAttribute('data-end-time'));
        
        // 检查当前时间是否在这个结果的时间范围内
        if (currentTime >= startTime && currentTime <= endTime) {
            item.classList.add('current-playing');
            // 滚动到当前项
            scrollToCurrentItem(item);
        } else {
            item.classList.remove('current-playing');
        }
    });
}

// 滚动到当前播放的结果项
function scrollToCurrentItem(item) {
    const resultsContainer = document.getElementById('resultsContent');
    if (resultsContainer) {
        const containerRect = resultsContainer.getBoundingClientRect();
        const itemRect = item.getBoundingClientRect();
        
        // 如果项目不在可视区域内，则滚动到它
        if (itemRect.top < containerRect.top || itemRect.bottom > containerRect.bottom) {
            item.scrollIntoView({
                behavior: 'smooth',
                block: 'center'
            });
        }
    }
} 
