// ===== 应用状态 =====
let appState = 'welcome'; // welcome | idle | listening | thinking | speaking | followup | goodbye
let isFirstLaunch = true;
let isRecording = false;
let isProcessing = false;
let isSpeaking = false;
let audioStream = null;
let audioContext = null;
let audioWorkletNode = null;
let audioPlayer = null;
let followupTimer = null;
let bubbleHideTimer = null;
let auraAnimator = null;
let executeTimer = null;
let accumulatedTranscript = '';
let lastAIResponse = ''; // 缓存最近一次 AI 回复，用于打断后查看
let countdownInterval = null;

// ===== 角色系统 =====
const CHARACTER_PROFILES = {
  lobster: {
    id: 'lobster',
    name: '小虾米',
    desc: '活泼可爱的龙虾助手',
    icon: 'mdi:fish',
    welcomeText: '大家好，我是你的AI助手小虾米，我可以帮你做一切事儿，有什么可以帮到你的？',
    thinkingPrompts: [
      '请稍等，我帮您查询一下~',
      '让我想想怎么帮您...',
      '正在努力思考中...',
      '马上就好，稍等片刻~',
      '让我看看能帮您做什么...',
      '收到！正在处理中...',
      '好的，我来帮您搞定~',
      '稍等一下，马上给您答案！'
    ],
    videos: {
      welcome: 'lobster-welcome.mp4',
      idle: 'lobster-listening.mp4',
      listening: 'lobster-listening.mp4',
      thinking: 'lobster-thinking.mp4',
      speaking: 'lobster-speaking.mp4',
      followup: 'lobster-listening.mp4',
      goodbye: 'lobster-idle.mp4'
    },
    auraColors: {
      idle: { r: 102, g: 126, b: 234 },
      listening: { r: 239, g: 68, b: 68 },
      thinking: { r: 245, g: 158, b: 11 },
      speaking: { r: 118, g: 75, b: 162 }
    },
    defaultVoice: 'Kore'
  },
  amy: {
    id: 'amy',
    name: 'Amy',
    desc: '温柔知性的女助手',
    icon: 'mdi:account-heart',
    welcomeText: '你好，我是Amy，很高兴为你服务！有什么我可以帮助你的吗？',
    thinkingPrompts: [
      '请稍等，让我想想...',
      '正在为你查找...',
      '稍等片刻~',
      '让我看看...',
      '好的，马上处理...',
      '正在思考中...',
    ],
    // 查询前的提示语（先播放这个再执行查询）
    preQueryPrompts: [
      '好的，Amy马上帮哥哥去查询',
      '收到，Amy这就去查',
      '好的哥哥，Amy这就去看看',
      '明白了，Amy马上处理',
    ],
    videos: {
      welcome: 'amy-welcome.mp4',
      idle: 'amy-listening.mp4',
      listening: 'amy-listening.mp4',
      thinking: 'amy-listening.mp4',
      speaking: 'amy-speaking.mp4',
      followup: 'amy-listening.mp4',
      goodbye: 'amy-listening.mp4'
    },
    auraColors: {
      idle: { r: 255, g: 154, b: 162 },
      listening: { r: 255, g: 107, b: 157 },
      thinking: { r: 255, g: 183, b: 178 },
      speaking: { r: 255, g: 134, b: 154 }
    },
    defaultVoice: 'Aoede'
  },
  cat: {
    id: 'cat',
    name: '喵助理',
    desc: '优雅慵懒的猫咪助手',
    icon: 'mdi:cat',
    welcomeText: '喵～我是喵助理，有什么需要帮忙的喵？',
    thinkingPrompts: [
      '喵～让我想想...',
      '正在思考喵～',
      '稍等一下喵～',
      '让喵查查看...',
      '喵在努力思考了～',
      '马上就好喵！',
    ],
    videos: {
      welcome: 'cat-welcome.mp4',
      idle: 'cat-idle.mp4',
      listening: 'cat-listening.mp4',
      thinking: 'cat-thinking.mp4',
      speaking: 'cat-speaking.mp4',
      followup: 'cat-listening.mp4',
      goodbye: 'cat-idle.mp4'
    },
    auraColors: {
      idle: { r: 255, g: 183, b: 77 },
      listening: { r: 255, g: 107, b: 107 },
      thinking: { r: 255, g: 213, b: 79 },
      speaking: { r: 171, g: 130, b: 255 }
    },
    defaultVoice: 'Dione'
  },
  robot: {
    id: 'robot',
    name: '机甲助手',
    desc: '高效精准的机器人助手',
    icon: 'mdi:robot',
    welcomeText: '系统已就绪。我是机甲助手，随时为您效劳。',
    thinkingPrompts: [
      '正在分析数据...',
      '运算处理中...',
      '检索信息中...',
      '系统处理中，请稍候...',
      '正在执行分析...',
      '数据处理中...',
    ],
    videos: {
      welcome: 'robot-welcome.mp4',
      idle: 'robot-idle.mp4',
      listening: 'robot-listening.mp4',
      thinking: 'robot-thinking.mp4',
      speaking: 'robot-speaking.mp4',
      followup: 'robot-listening.mp4',
      goodbye: 'robot-idle.mp4'
    },
    auraColors: {
      idle: { r: 0, g: 200, b: 255 },
      listening: { r: 0, g: 255, b: 150 },
      thinking: { r: 255, g: 200, b: 0 },
      speaking: { r: 0, g: 150, b: 255 }
    },
    defaultVoice: 'Sao'
  }
};

let currentCharacter = CHARACTER_PROFILES.lobster;

// 当前角色的视频状态映射（动态切换）
let VIDEO_SOURCES = { ...currentCharacter.videos };

// 追问后等待用户回复的超时（30秒无响应回到idle）
const FOLLOWUP_TIMEOUT = 30000;
// 气泡自动隐藏时间
const BUBBLE_AUTO_HIDE = 12000;
// 延迟执行时间（用户停顿后等待的时间，从10秒优化为3秒）
const EXECUTE_DELAY = 3000;

// 处理中的提示语从当前角色配置获取
function getThinkingPrompts() {
  return currentCharacter.thinkingPrompts;
}

// ===== DOM 元素 =====
const speechBubble = document.getElementById('speech-bubble');
const bubbleText = document.getElementById('bubble-text');
const statusHint = document.getElementById('status-hint');
const lobsterArea = document.getElementById('lobster-area');
const lobsterChar = document.getElementById('lobster-char');
const stateIndicator = document.getElementById('state-indicator');
const stateDot = stateIndicator.querySelector('.state-dot');
const stateText = document.getElementById('state-text');
const minimizeBtn = document.getElementById('minimize-btn');
const closeBtn = document.getElementById('close-btn');
const textInput = document.getElementById('text-input');
const sendBtn = document.getElementById('send-btn');
const tapHint = document.getElementById('tap-hint');
const listeningPulseRing = document.getElementById('listening-pulse-ring');

// ===== 初始化光环动画 =====
document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('aura-canvas');
  if (canvas && window.OrbAnimator) {
    auraAnimator = new OrbAnimator(canvas);
  }
  initDeepgramListeners();
  initVoice();
  initTaskListeners();
  initMiniMode();
  initStreamingTTS();  // 初始化流式 TTS 监听
  initFilePathClickHandler();  // 初始化文件路径点击处理

  // 首次启动播放欢迎视频
  if (isFirstLaunch) {
    playWelcomeVideo();
  }

  console.log('[龙虾助手] 已初始化');
});

// ===== 初始化任务监听器 =====
function initTaskListeners() {
  // 监听任务完成
  window.electronAPI.task.onCompleted((data) => {
    console.log('[龙虾助手] 任务完成:', data.taskId);

    const cleanResult = cleanMarkdown(data.result);

    // 显示完成通知气泡
    showBubble(`✅ 任务完成！${cleanResult}`);

    // 播放完成语音
    playTextToSpeech(`任务完成了！${cleanResult}`).catch(err => {
      console.warn('[龙虾助手] 任务完成语音播放失败:', err);
    });

    // 切换到 speaking 状态
    setAppState('speaking');

    // 语音播放完后回到 idle
    setTimeout(() => {
      if (appState === 'speaking') {
        setAppState('idle');
      }
    }, 5000);
  });

  // 监听任务失败
  window.electronAPI.task.onFailed((data) => {
    console.error('[龙虾助手] 任务失败:', data.taskId, data.error);

    const cleanError = cleanMarkdown(data.error);

    // 显示失败通知
    showBubble(`❌ 任务失败：${cleanError}`);

    // 播放失败语音
    playTextToSpeech(`抱歉，任务执行失败了：${cleanError}`).catch(err => {
      console.warn('[龙虾助手] 任务失败语音播放失败:', err);
    });
  });
}

// ===== 状态管理 =====
function setAppState(newState) {
  appState = newState;
  clearTimeout(followupTimer);

  // 更新龙虾动画class
  lobsterChar.className = 'lobster-character';
  stateDot.className = 'state-dot';
  statusHint.className = 'status-hint';

  // 控制点击引导和脉冲环
  if (newState === 'idle') {
    tapHint.classList.remove('hidden');
  } else {
    tapHint.classList.add('hidden');
  }
  if (newState === 'listening' || newState === 'followup') {
    listeningPulseRing.classList.remove('hidden');
  } else {
    listeningPulseRing.classList.add('hidden');
  }

  // 切换视频源
  switchVideo(newState);

  switch (newState) {
    case 'welcome':
      tapHint.classList.add('hidden');
      stateText.textContent = `欢迎使用${currentCharacter.name}`;
      statusHint.textContent = '';
      break;
    case 'idle':
      stateText.textContent = '点击我开始对话';
      statusHint.textContent = '';
      break;
    case 'listening':
      lobsterChar.classList.add('listening');
      stateDot.classList.add('listening');
      statusHint.classList.add('listening');
      stateText.textContent = '聆听中...';
      statusHint.textContent = '请说话...';
      break;
    case 'thinking':
      lobsterChar.classList.add('thinking');
      stateDot.classList.add('thinking');
      statusHint.classList.add('thinking');
      stateText.textContent = '思考中...';
      statusHint.textContent = '🤔 正在分析您的问题';
      showBubble('<div class="thinking-dots"><span></span><span></span><span></span></div>', false);
      break;
    case 'speaking':
      lobsterChar.classList.add('speaking');
      stateDot.classList.add('speaking');
      statusHint.classList.add('speaking');
      stateText.textContent = '回复中...';
      statusHint.textContent = '💬 正在为您解答';
      break;
    case 'followup':
      // TTS播完后等待用户继续说话
      lobsterChar.classList.add('listening');
      stateDot.classList.add('listening');
      statusHint.classList.add('listening');
      stateText.textContent = '继续说话，我在听...';
      statusHint.textContent = '💬 可以继续提问';
      // 超时回到idle
      followupTimer = setTimeout(() => {
        console.log('[龙虾助手] 追问超时，回到待机');
        stopRecording().then(() => {
          setAppState('idle');
          hideBubble(2000);
        });
      }, FOLLOWUP_TIMEOUT);
      break;
    case 'goodbye':
      stateText.textContent = '再见！';
      statusHint.textContent = '👋 期待下次见面';
      break;
  }

  // 同步光环动画状态
  if (auraAnimator) {
    const orbState = newState === 'followup' ? 'listening' : newState;
    auraAnimator.setState(orbState);
  }

  // 同步悬浮球状态
  if (isMiniMode) {
    setMiniOrbState(newState);
  }
}

// 需要播放视频自带音频的状态
const VIDEO_WITH_AUDIO = ['welcome', 'thinking'];

// ===== 视频切换功能 =====
function switchVideo(state) {
  const videoSource = VIDEO_SOURCES[state] || VIDEO_SOURCES.idle;
  const videoElement = document.getElementById('lobster-char');

  if (videoElement && videoElement.tagName === 'VIDEO') {
    const sourceElement = videoElement.querySelector('source');
    const currentSrc = sourceElement ? sourceElement.src : '';
    const newSrc = videoSource;

    // 只在视频源不同时才切换
    if (!currentSrc.endsWith(newSrc)) {
      console.log(`[视频切换] ${state} -> ${videoSource}`);

      // 添加过渡动画
      videoElement.classList.add('video-transition');
      setTimeout(() => videoElement.classList.remove('video-transition'), 400);

      // 保存当前播放状态
      const wasPlaying = !videoElement.paused;

      // 更新视频源
      if (sourceElement) {
        sourceElement.src = newSrc;
      }

      // 根据状态决定是否启用视频音频
      const useVideoAudio = VIDEO_WITH_AUDIO.includes(state);
      videoElement.muted = !useVideoAudio;

      // 重新加载并播放
      videoElement.load();
      if (wasPlaying || useVideoAudio) {
        videoElement.play().catch(err => {
          console.warn('[视频播放] 自动播放失败:', err);
          // 如果有声播放失败，降级为静音播放
          if (useVideoAudio) {
            videoElement.muted = true;
            videoElement.play().catch(() => {});
          }
        });
      }
    } else {
      // 视频源相同，但可能需要更新音频状态
      const useVideoAudio = VIDEO_WITH_AUDIO.includes(state);
      videoElement.muted = !useVideoAudio;
    }
  }
}

// ===== 播放欢迎视频 =====
function playWelcomeVideo() {
  console.log('[龙虾助手] 播放欢迎视频');
  setAppState('welcome');

  const videoElement = document.getElementById('lobster-char');
  if (videoElement && videoElement.tagName === 'VIDEO') {
    // 移除 loop 属性，让欢迎视频只播放一次
    videoElement.loop = false;
    // 使用视频自带音频（取消静音）
    videoElement.muted = false;

    // 监听视频播放结束
    videoElement.onended = () => {
      console.log('[龙虾助手] 欢迎视频播放完毕，切换到待机状态');
      videoElement.loop = true; // 恢复循环播放
      videoElement.muted = true; // 恢复静音（其他状态视频不需要声音）
      videoElement.onended = null; // 移除事件监听
      isFirstLaunch = false;
      setAppState('idle');
    };

    // 确保视频播放（先尝试有声播放，失败则静音播放+TTS兜底）
    videoElement.play().catch(err => {
      console.warn('[视频播放] 欢迎视频有声播放失败，尝试静音播放+TTS兜底:', err);
      videoElement.muted = true;
      videoElement.play().catch(err2 => {
        console.warn('[视频播放] 欢迎视频自动播放完全失败:', err2);
        videoElement.loop = true;
        isFirstLaunch = false;
        setAppState('idle');
      });
      // 静音播放成功时，用TTS兜底欢迎语音
      playWelcomeAudioFallback();
    });
  }
}

// ===== 播放欢迎语音（兜底：视频无法有声播放时使用TTS） =====
async function playWelcomeAudioFallback() {
  try {
    await playTextToSpeech(currentCharacter.welcomeText);
  } catch (error) {
    console.warn('[龙虾助手] 欢迎语音TTS兜底播放失败:', error);
  }
}

// ===== 气泡显示 =====
function showBubble(content, isUserSpeech = false) {
  clearTimeout(bubbleHideTimer);
  speechBubble.style.display = 'block';

  if (isUserSpeech) {
    speechBubble.className = 'speech-bubble user-speech';
    bubbleText.innerHTML = content;
  } else {
    speechBubble.className = 'speech-bubble ai-response';
    // 检测文件路径并转换为可点击链接
    bubbleText.innerHTML = linkifyFilePaths(content);
  }

  // 自动隐藏
  bubbleHideTimer = setTimeout(() => {
    hideBubble();
  }, BUBBLE_AUTO_HIDE);
}

// 打字机效果显示 AI 回复
function showBubbleWithTyping(content) {
  clearTimeout(bubbleHideTimer);
  speechBubble.style.display = 'block';
  speechBubble.className = 'speech-bubble ai-response';
  bubbleText.innerHTML = '';

  let index = 0;
  const typingSpeed = 30; // 每个字符的延迟（毫秒）

  function typeNextChar() {
    if (index < content.length) {
      bubbleText.innerHTML += content.charAt(index);
      index++;
      setTimeout(typeNextChar, typingSpeed);
    } else {
      // 打字完成后追加查看全文按钮
      appendViewTextBtn(content);
      // 自动隐藏
      bubbleHideTimer = setTimeout(() => {
        hideBubble();
      }, BUBBLE_AUTO_HIDE);
    }
  }

  typeNextChar();
}

// 带查看文本按钮的气泡（用于打断后展示）
function showBubbleWithViewBtn(fullText, isInterrupted = false) {
  clearTimeout(bubbleHideTimer);
  speechBubble.style.display = 'block';
  speechBubble.className = 'speech-bubble ai-response';

  const preview = fullText.length > 40 ? fullText.substring(0, 40) + '...' : fullText;
  const label = isInterrupted ? '已打断，点击查看完整回复' : '点击查看完整回复';

  bubbleText.innerHTML = `<span class="bubble-preview">${escapeHtml(preview)}</span>`;
  appendViewTextBtn(fullText, label);

  bubbleHideTimer = setTimeout(() => {
    hideBubble();
  }, BUBBLE_AUTO_HIDE * 2); // 打断后给更长的展示时间
}

// 追加"查看全文"按钮到气泡底部
function appendViewTextBtn(fullText, label) {
  if (!fullText || fullText.length < 20) return; // 短文本不需要按钮

  const btnWrap = document.createElement('div');
  btnWrap.className = 'view-text-btn-wrap';
  btnWrap.innerHTML = `<button class="view-text-btn">${label || '查看完整文本'}</button>`;
  bubbleText.appendChild(btnWrap);

  btnWrap.querySelector('.view-text-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    openTextViewer(fullText);
  });
}

// 全文查看浮层
function openTextViewer(text) {
  // 移除已有的浮层
  const existing = document.getElementById('text-viewer');
  if (existing) existing.remove();

  const viewer = document.createElement('div');
  viewer.id = 'text-viewer';
  viewer.className = 'text-viewer';
  viewer.innerHTML = `
    <div class="text-viewer-header">
      <span class="text-viewer-title">完整回复</span>
      <button class="text-viewer-close" id="text-viewer-close">×</button>
    </div>
    <div class="text-viewer-body">${escapeHtml(text)}</div>
  `;

  document.querySelector('.widget-container').appendChild(viewer);

  viewer.querySelector('#text-viewer-close').addEventListener('click', (e) => {
    e.stopPropagation();
    viewer.classList.add('closing');
    setTimeout(() => viewer.remove(), 250);
  });
}

function hideBubble(delay) {
  if (delay) {
    clearTimeout(bubbleHideTimer);
    bubbleHideTimer = setTimeout(() => {
      fadeOutBubble();
    }, delay);
  } else {
    fadeOutBubble();
  }
}

function fadeOutBubble() {
  speechBubble.style.transition = 'opacity 0.3s ease-out';
  speechBubble.style.opacity = '0';
  setTimeout(() => {
    speechBubble.style.display = 'none';
    speechBubble.style.opacity = '1';
    speechBubble.style.transition = '';
  }, 300);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 清理 markdown 格式符号（**加粗**、*斜体*、~~删除线~~ 等）
function cleanMarkdown(text) {
  if (!text) return text;
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')  // **加粗**
    .replace(/\*(.+?)\*/g, '$1')      // *斜体*
    .replace(/~~(.+?)~~/g, '$1')      // ~~删除线~~
    .replace(/`(.+?)`/g, '$1');       // `代码`
}

// 检测文本中的文件路径并转换为可点击链接
function linkifyFilePaths(text) {
  if (!text) return text;

  // 文件路径正则表达式（更宽松的匹配）
  // 匹配: ~/xxx, /Users/xxx, /home/xxx 等
  // 支持中文、空格、各种特殊字符
  const filePathRegex = /(~\/[^\s`'"<>|]+|\/(?:Users|home|System|Applications|Library|tmp|var|etc)[^\s`'"<>|]*)/g;

  return text.replace(filePathRegex, (match) => {
    // 清理末尾的标点符号
    let cleanPath = match.replace(/[。，,；;！!？?）)\]]+$/g, '');

    // 创建可点击的链接
    return `<span class="file-path" data-path="${escapeHtml(cleanPath)}" title="点击在 Finder 中显示">${escapeHtml(cleanPath)}</span>`;
  });
}

// 打断当前任务（查询或播放）
function interruptCurrentTask() {
  console.log('[龙虾助手] 打断当前任务');

  // 设置中断标志
  isProcessing = false;

  // 中断 TTS
  interruptTTS();

  // 清空音频队列
  audioQueue = [];
  isPlayingQueue = false;
  streamingTextBuffer = '';

  // 重置状态
  setAppState('idle');
  showBubble('已打断');
}

// 初始化文件路径点击事件监听
function initFilePathClickHandler() {
  document.addEventListener('click', async (e) => {
    const pathElement = e.target.closest('.file-path');
    if (pathElement) {
      e.stopPropagation();
      const filePath = pathElement.dataset.path;

      console.log('[File] 点击文件路径:', filePath);

      try {
        const result = await window.electronAPI.file.showInFolder(filePath);
        if (result.success) {
          // 显示成功反馈
          pathElement.classList.add('clicked');
          setTimeout(() => pathElement.classList.remove('clicked'), 500);
        } else {
          console.warn('[File] 打开失败:', result.error);
          // 显示错误提示
          showBubble(`无法打开路径: ${result.error}`);
        }
      } catch (err) {
        console.error('[File] 调用失败:', err);
      }
    }
  });
}

// 初始化文件路径点击事件监听
function initFilePathClickHandler() {
  document.addEventListener('click', async (e) => {
    const pathElement = e.target.closest('.file-path');
    if (pathElement) {
      e.stopPropagation();
      const filePath = pathElement.dataset.path;

      console.log('[File] 点击文件路径:', filePath);

      try {
        const result = await window.electronAPI.file.showInFolder(filePath);
        if (result.success) {
          // 显示成功反馈
          pathElement.classList.add('clicked');
          setTimeout(() => pathElement.classList.remove('clicked'), 500);
        } else {
          console.warn('[File] 打开失败:', result.error);
          // 显示错误提示
          showBubble(`无法打开路径: ${result.error}`);
        }
      } catch (err) {
        console.error('[File] 调用失败:', err);
      }
    }
  });
}

// ===== Deepgram 事件监听 =====
function initDeepgramListeners() {
  window.electronAPI.deepgram.removeAllListeners();

  window.electronAPI.deepgram.onConnected(() => {
    console.log('[龙虾助手] Deepgram 已连接');
  });

  window.electronAPI.deepgram.onTranscript((data) => {
    const { transcript, isFinal } = data;
    console.log(`[龙虾助手] 识别 [${isFinal ? '最终' : '临时'}]: "${transcript}"`);

    if (isFinal) {
      if (transcript.trim().length > 0) {
        // 累积识别结果
        if (accumulatedTranscript.length > 0) {
          accumulatedTranscript += ' ' + transcript.trim();
        } else {
          accumulatedTranscript = transcript.trim();
        }

        // 显示累积的用户语音
        showBubble('🎤 ' + escapeHtml(accumulatedTranscript), true);

        // 清除之前的执行定时器
        clearTimeout(executeTimer);

        // 延迟执行：等待用户停顿后执行命令（utterance_end 事件可提前触发）
        executeTimer = setTimeout(() => {
          console.log('[龙虾助手] 用户停顿超时，执行命令');
          clearInterval(countdownInterval);
          const commandToExecute = accumulatedTranscript;
          accumulatedTranscript = '';

          stopRecording().then(() => {
            handleCommand(commandToExecute);
          });
        }, EXECUTE_DELAY);

        // 倒计时显示
        let countdown = Math.ceil(EXECUTE_DELAY / 1000);
        clearInterval(countdownInterval);
        statusHint.textContent = `${countdown}秒后执行...  继续说话可重置`;
        countdownInterval = setInterval(() => {
          countdown--;
          if (countdown > 0) {
            statusHint.textContent = `${countdown}秒后执行...  继续说话可重置`;
          } else {
            clearInterval(countdownInterval);
          }
        }, 1000);
      }
    } else {
      // 实时显示识别中的文字
      if (transcript.trim().length > 0) {
        statusHint.textContent = transcript + '...';
      }
    }
  });

  // 监听语音结束事件（Deepgram 检测到用户停止说话）
  window.electronAPI.deepgram.onUtteranceEnd(() => {
    console.log('[龙虾助手] 检测到语音结束');
    if (accumulatedTranscript.trim().length > 0) {
      // 用户有有效语音且已停止说话，立即执行
      clearTimeout(executeTimer);
      clearInterval(countdownInterval);
      console.log('[龙虾助手] 语音结束，立即执行命令');
      const commandToExecute = accumulatedTranscript;
      accumulatedTranscript = '';
      stopRecording().then(() => {
        handleCommand(commandToExecute);
      });
    }
  });

  window.electronAPI.deepgram.onError((error) => {
    console.error('[龙虾助手] Deepgram 错误:', error);
    stopRecording();
    setAppState('idle');
    showBubble('识别出错了，再点我试试吧');
  });

  window.electronAPI.deepgram.onClosed(() => {
    console.log('[龙虾助手] Deepgram 连接关闭');
  });
}

// ===== 中断 TTS =====
// 流式 TTS 音频队列
let audioQueue = [];
let isPlayingQueue = false;
let streamingTextBuffer = '';

function interruptTTS() {
  // 停止当前播放
  if (audioPlayer) {
    try {
      audioPlayer.onended = null;
      audioPlayer.pause();
    } catch (e) { /* ignore */ }
    audioPlayer = null;
  }
  // 清空队列
  audioQueue = [];
  isPlayingQueue = false;
  streamingTextBuffer = '';
  isSpeaking = false;
  // 通知主进程停止 TTS 生成
  window.electronAPI.tts.stop();
  // 中止后端 agent 执行
  window.electronAPI.abortAgent().catch(err => console.warn('[龙虾助手] abort 失败:', err));
}

// ===== 流式 TTS 初始化 =====
function initStreamingTTS() {
  // 监听音频块
  window.electronAPI.deepgram.onAudioChunk(async (data) => {
    console.log(`[TTS] 收到音频块 #${data.sentenceId}`);

    audioQueue.push(data);

    if (!isPlayingQueue) {
      await processAudioQueue();
    }
  });

  // 监听首个句子（切换状态，但不提前显示文本）
  window.electronAPI.deepgram.onFirstSentence((data) => {
    console.log('[TTS] 首句到达，准备播放');
    // 切换到 speaking 状态
    if (appState === 'thinking') {
      setAppState('speaking');
    }
    // 不提前显示文本，等音频播放时再显示
  });
}

// 处理音频队列
async function processAudioQueue() {
  if (isPlayingQueue || audioQueue.length === 0) return;

  isPlayingQueue = true;

  while (audioQueue.length > 0) {
    const item = audioQueue.shift();

    // 播放音频（音频开始播放时才显示文本）
    await playAudioChunk(item.audio, item.text);
  }

  isPlayingQueue = false;
  isSpeaking = false;

  // TTS 播放完毕，进入追问模式
  if (appState === 'speaking') {
    isProcessing = false;
    setAppState('followup');
    await startRecording();
  }
}

// 播放单个音频块（音频开始播放时才显示对应文本）
function playAudioChunk(audioBase64, text) {
  return new Promise((resolve) => {
    const audioDataUrl = 'data:audio/mp3;base64,' + audioBase64;
    const audio = new Audio(audioDataUrl);

    // 音频开始播放时才显示文本
    audio.onplay = () => {
      // 追加文本到缓冲区并更新显示
      if (streamingTextBuffer && !streamingTextBuffer.includes(text)) {
        streamingTextBuffer += text;
      } else {
        streamingTextBuffer = text;
      }
      showBubble(escapeHtml(streamingTextBuffer));
    };

    audio.onended = () => {
      resolve();
    };

    audio.onerror = () => {
      resolve();
    };

    audio.play().catch(() => resolve());

    audioPlayer = audio;
  });
}

// ===== 录音控制 =====
async function startRecording() {
  if (isRecording || isProcessing) return;

  try {
    interruptTTS();

    audioStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 16000
      }
    });

    const result = await window.electronAPI.deepgram.startListening();
    if (!result.success) {
      showBubble('语音识别启动失败，请检查配置');
      setAppState('idle');
      audioStream.getTracks().forEach(track => track.stop());
      audioStream = null;
      return;
    }

    audioContext = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: 16000
    });

    await audioContext.audioWorklet.addModule('audio-processor.js');
    const source = audioContext.createMediaStreamSource(audioStream);
    audioWorkletNode = new AudioWorkletNode(audioContext, 'audio-processor');

    audioWorkletNode.port.onmessage = (event) => {
      if (isRecording && event.data) {
        const uint8 = new Uint8Array(event.data);
        window.electronAPI.deepgram.sendAudio(uint8);
      }
    };

    source.connect(audioWorkletNode);
    isRecording = true;

  } catch (error) {
    console.error('[龙虾助手] 录音失败:', error);
    setAppState('idle');
    if (error.name === 'NotAllowedError') {
      showBubble('请允许访问麦克风后再点我');
    } else if (error.name === 'NotFoundError') {
      showBubble('没检测到麦克风哦');
    } else {
      showBubble('录音启动失败: ' + error.message);
    }
  }
}

async function stopRecording() {
  if (!isRecording) return;

  isRecording = false;

  // 清除执行定时器和倒计时
  clearTimeout(executeTimer);
  clearInterval(countdownInterval);
  executeTimer = null;

  if (audioWorkletNode) {
    audioWorkletNode.disconnect();
    try { audioWorkletNode.port.close(); } catch (e) {}
    audioWorkletNode = null;
  }

  if (audioContext && audioContext.state !== 'closed') {
    await audioContext.close();
    audioContext = null;
  }

  if (audioStream) {
    audioStream.getTracks().forEach(track => track.stop());
    audioStream = null;
  }

  await window.electronAPI.deepgram.stopListening();
}

// ===== 点击龙虾 → 开始聆听 =====
async function onLobsterClick() {
  // speaking 状态下允许打断 → 直接进入聆听（无需再次点击）
  if (appState === 'speaking') {
    interruptTTS();
    isProcessing = false;
    if (lastAIResponse) {
      showBubbleWithViewBtn(lastAIResponse, true);
    }
    // 打断后直接开始聆听
    accumulatedTranscript = '';
    setAppState('listening');
    await startRecording();
    return;
  }

  // thinking 状态下允许打断 → 停止当前任务
  if (appState === 'thinking') {
    console.log('[龙虾助手] 打断查询任务');
    interruptCurrentTask();
    return;
  }

  if (isProcessing) return;

  if (appState === 'listening' || appState === 'followup') {
    // 再次点击 → 停止聆听
    clearTimeout(executeTimer);
    accumulatedTranscript = '';
    await stopRecording();
    setAppState('idle');
    return;
  }

  // 清空之前的累积文本
  accumulatedTranscript = '';

  // 激活动画
  lobsterChar.classList.add('active');
  setTimeout(() => lobsterChar.classList.remove('active'), 600);

  // 开始聆听
  hideBubble();
  setAppState('listening');
  await startRecording();
}

// ===== 处理命令 =====
async function handleCommand(command) {
  if (isProcessing) return;

  // 检测是否是异步任务
  const asyncKeywords = ['稍后', '待会', '查完告诉我', '完成后告诉我', '好了告诉我', '处理完告诉我'];
  const isAsyncTask = asyncKeywords.some(keyword => command.includes(keyword));

  // 检测是否是告别语
  const goodbyeKeywords = ['再见', '拜拜', '退出', '关闭', 'bye', 'goodbye'];
  const isGoodbye = goodbyeKeywords.some(keyword =>
    command.toLowerCase().includes(keyword)
  );

  if (isAsyncTask) {
    // 异步任务处理
    await handleAsyncTask(command);
  } else {
    // 同步任务处理
    await handleSyncTask(command, isGoodbye);
  }
}

// ===== 处理异步任务 =====
async function handleAsyncTask(command) {
  isProcessing = true;

  try {
    // 创建异步任务
    const result = await window.electronAPI.task.create(command);

    if (result.success) {
      console.log(`[龙虾助手] 创建异步任务: ${result.taskId}`);

      // 立即反馈
      const feedbackMessages = [
        '好的，我去处理，稍后告诉你~',
        '收到！我马上去查，完成后通知你',
        '明白了，让我去看看，待会告诉你结果',
        '好嘞，我去帮你搞定，完成后叫你~'
      ];
      const feedback = feedbackMessages[Math.floor(Math.random() * feedbackMessages.length)];

      showBubble(feedback);
      await playTextToSpeech(feedback);

      setAppState('idle');
    }
  } catch (error) {
    console.error('[龙虾助手] 创建异步任务失败:', error);
    showBubble('任务创建失败，请重试');
    setAppState('idle');
  } finally {
    isProcessing = false;
  }
}

// ===== 处理同步任务 =====
async function handleSyncTask(command, isGoodbye) {
  isProcessing = true;

  setAppState('thinking');

  // 如果当前角色有 preQueryPrompts，先播放提示语再执行查询
  if (currentCharacter.preQueryPrompts && currentCharacter.preQueryPrompts.length > 0) {
    const prePrompt = currentCharacter.preQueryPrompts[Math.floor(Math.random() * currentCharacter.preQueryPrompts.length)];
    showBubble(prePrompt);
    // 播放提示语（非流式 TTS）
    await playTextToSpeech(prePrompt);
  } else {
    // 其他角色显示思考提示
    const prompts = getThinkingPrompts();
    const randomPrompt = prompts[Math.floor(Math.random() * prompts.length)];
    showBubble(randomPrompt);
  }

  // 重置流式 TTS 状态
  streamingTextBuffer = '';
  audioQueue = [];
  isPlayingQueue = false;
  isSpeaking = true;  // 标记正在播放

  try {
    const result = await window.electronAPI.executeCommand(command);

    // 清理 markdown 符号
    const cleanedMessage = cleanMarkdown(result.message);

    // 缓存 AI 回复（用于打断后查看）
    lastAIResponse = cleanedMessage;

    // 流式 TTS 已经在后台播放（由 initStreamingTTS 监听事件驱动）
    // 如果没有收到音频块且主进程也没有启动流式 TTS，使用传统 TTS 作为备选
    if (!result.streamingTTSActive && audioQueue.length === 0 && !isPlayingQueue) {
      // 没有收到流式音频，使用传统 TTS
      setAppState('speaking');
      showBubbleWithViewBtn(cleanedMessage);
      await playTextToSpeech(cleanedMessage);

      // TTS 播放完后，再显示文字
      showBubbleWithTyping(escapeHtml(cleanedMessage));

      // 如果是告别语，播放告别动画
      if (isGoodbye) {
        setAppState('goodbye');
        isProcessing = false;
        setTimeout(() => {
          setAppState('idle');
        }, 3000);
      } else {
        // 进入追问模式
        isProcessing = false;
        setAppState('followup');
        await startRecording();
      }
    }
    // 如果是告别语，特殊处理
    if (isGoodbye) {
      setAppState('goodbye');
      isProcessing = false;
      setTimeout(() => {
        setAppState('idle');
      }, 3000);
    }
    // 否则流式 TTS 会在 processAudioQueue 中自动进入 followup 模式

  } catch (error) {
    console.error('[龙虾助手] 处理失败:', error);
    showBubble('出错了，再点我试试吧');
    setAppState('idle');
    isProcessing = false;
    isSpeaking = false;
  }
}

// ===== TTS 播放 =====
async function playTextToSpeech(text) {
  if (isSpeaking) interruptTTS();

  try {
    isSpeaking = true;
    const result = await window.electronAPI.deepgram.textToSpeech(text);

    if (!result.success) {
      console.warn('[龙虾助手] TTS 失败:', result.error);
      isSpeaking = false;
      return;
    }

    const audioDataUrl = 'data:audio/mp3;base64,' + result.audio;

    if (audioPlayer) {
      audioPlayer.pause();
      audioPlayer = null;
    }

    audioPlayer = new Audio(audioDataUrl);

    return new Promise((resolve) => {
      audioPlayer.onended = () => {
        isSpeaking = false;
        audioPlayer = null;
        resolve();
      };

      audioPlayer.onerror = (e) => {
        console.error('[龙虾助手] TTS 播放错误:', e);
        isSpeaking = false;
        audioPlayer = null;
        resolve();
      };

      audioPlayer.play().catch((err) => {
        console.error('[龙虾助手] TTS play() 失败:', err);
        isSpeaking = false;
        audioPlayer = null;
        resolve();
      });
    });
  } catch (error) {
    console.error('[龙虾助手] TTS 失败:', error);
    isSpeaking = false;
    audioPlayer = null;
  }
}

// ===== 音色选择 =====
const voicePanel = document.getElementById('voice-panel');
const voiceList = document.getElementById('voice-list');
const voiceSelectBtn = document.getElementById('voice-select-btn');
const closeVoicePanel = document.getElementById('close-voice-panel');

// Gemini TTS 音色列表（30种音色，自动检测语言）
const VOICE_OPTIONS = [
  // ===== 推荐 =====
  { group: '推荐', lang: 'all', voices: [
    { id: 'Kore',    icon: 'mdi:ribbon', name: 'Kore',    desc: '温暖友好', gender: 'female' },
    { id: 'Puck',    icon: 'mdi:star-four-points', name: 'Puck',    desc: '活泼俏皮', gender: 'male' },
    { id: 'Charon',  icon: 'mdi:account', name: 'Charon',  desc: '沉稳可靠', gender: 'male' },
    { id: 'Aoede',   icon: 'mdi:emoticon-happy', name: 'Aoede',   desc: '优雅动听', gender: 'female' },
  ]},
  // ===== 女声 =====
  { group: '女声', lang: 'all', voices: [
    { id: 'Kore',    icon: 'mdi:face-woman-shimmer', name: 'Kore',    desc: '温暖友好', gender: 'female' },
    { id: 'Aoede',   icon: 'mdi:flower', name: 'Aoede',   desc: '优雅动听', gender: 'female' },
    { id: 'Leda',    icon: 'mdi:cloud', name: 'Leda',    desc: '柔和舒缓', gender: 'female' },
    { id: 'Callisto', icon: 'mdi:bell', name: 'Callisto', desc: '清脆明亮', gender: 'female' },
    { id: 'Dione',   icon: 'mdi:emoticon-blush', name: 'Dione',   desc: '甜美可爱', gender: 'female' },
    { id: 'Elara',   icon: 'mdi:heart', name: 'Elara',   desc: '亲切温柔', gender: 'female' },
    { id: 'Io',      icon: 'mdi:book-open-page-variant', name: 'Io',      desc: '知性优雅', gender: 'female' },
    { id: 'Thebe',   icon: 'mdi:flower-rose', name: 'Thebe',   desc: '成熟稳重', gender: 'female' },
    { id: 'Himalia', icon: 'mdi:account-tie', name: 'Himalia', desc: '专业干练', gender: 'female' },
    { id: 'Carme',   icon: 'mdi:television', name: 'Carme',   desc: '播音腔调', gender: 'female' },
    { id: 'Ananke',  icon: 'mdi:crown', name: 'Ananke',  desc: '高贵典雅', gender: 'female' },
    { id: 'Lysithea', icon: 'mdi:candy', name: 'Lysithea', desc: '甜蜜温柔', gender: 'female' },
    { id: 'Pasiphae', icon: 'mdi:party-popper', name: 'Pasiphae', desc: '活力四射', gender: 'female' },
    { id: 'Sinope',  icon: 'mdi:sparkles', name: 'Sinope',  desc: '元气满满', gender: 'female' },
    { id: 'Isonoe',  icon: 'mdi:yoga', name: 'Isonoe',  desc: '平静安详', gender: 'female' },
  ]},
  // ===== 男声 =====
  { group: '男声', lang: 'all', voices: [
    { id: 'Puck',    icon: 'mdi:weather-night', name: 'Puck',    desc: '活泼俏皮', gender: 'male' },
    { id: 'Charon',  icon: 'mdi:arm-flex', name: 'Charon',  desc: '沉稳可靠', gender: 'male' },
    { id: 'Fenrir',  icon: 'mdi:heart-outline', name: 'Fenrir',  desc: '强劲有力', gender: 'male' },
    { id: 'Orus',    icon: 'mdi:hat-fedora', name: 'Orus',    desc: '儒雅绅士', gender: 'male' },
    { id: 'Proteus', icon: 'mdi:microphone', name: 'Proteus', desc: '浑厚播音', gender: 'male' },
    { id: 'Triton',  icon: 'mdi:radio', name: 'Triton',  desc: '深沉磁性', gender: 'male' },
    { id: 'Nereid',  icon: 'mdi:tie', name: 'Nereid',  desc: '专业稳重', gender: 'male' },
    { id: 'Larissa', icon: 'mdi:sword-cross', name: 'Larissa', desc: '年轻活力', gender: 'male' },
    { id: 'Galatea', icon: 'mdi:sunglasses', name: 'Galatea', desc: '轻松随意', gender: 'male' },
    { id: 'Despina', icon: 'mdi:tree', name: 'Despina', desc: '温和耐心', gender: 'male' },
    { id: 'Thalassa', icon: 'mdi:microphone-variant', name: 'Thalassa', desc: '低沉有力', gender: 'male' },
    { id: 'Naiad',   icon: 'mdi:target', name: 'Naiad',   desc: '果断坚定', gender: 'male' },
    { id: 'Halimede', icon: 'mdi:glass-wine', name: 'Halimede', desc: '优雅精致', gender: 'male' },
    { id: 'Sao',     icon: 'mdi:robot', name: 'Sao',     desc: '机械感', gender: 'male' },
    { id: 'Laomedeia', icon: 'mdi:account', name: 'Laomedeia', desc: '清爽干净', gender: 'male' },
  ]},
];

let currentSelectedVoice = 'Kore';
let currentFilter = 'all'; // all | zh | en
let previewingVoice = null;

function renderVoiceList() {
  voiceList.innerHTML = '';

  VOICE_OPTIONS.forEach(group => {
    // 筛选：all 显示全部，zh 显示中文和推荐，en 显示英文和推荐
    if (currentFilter !== 'all' && group.lang !== 'all' && group.lang !== currentFilter) {
      return;
    }

    const groupLabel = document.createElement('div');
    groupLabel.className = 'voice-group-label';
    groupLabel.textContent = group.group;
    voiceList.appendChild(groupLabel);

    group.voices.forEach(voice => {
      const item = document.createElement('div');
      item.className = 'voice-item' + (voice.id === currentSelectedVoice ? ' active' : '');
      item.innerHTML = `
        <span class="voice-icon"><span class="iconify" data-icon="${voice.icon}"></span></span>
        <div class="voice-info">
          <div class="voice-name">${voice.name}</div>
          <div class="voice-desc">${voice.desc}</div>
        </div>
        <button class="voice-preview-btn" data-voice="${voice.id}" title="试听">
          <span class="iconify" data-icon="mdi:play"></span>
        </button>
        ${voice.id === currentSelectedVoice ? '<span class="voice-check"><span class="iconify" data-icon="mdi:check"></span></span>' : ''}
      `;

      // 点击选择音色
      item.addEventListener('click', (e) => {
        if (!e.target.closest('.voice-preview-btn')) {
          selectVoice(voice.id);
        }
      });

      // 试听按钮
      const previewBtn = item.querySelector('.voice-preview-btn');
      previewBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        previewVoice(voice.id, voice.name);
      });

      voiceList.appendChild(item);
    });
  });
}

function setFilter(filter) {
  currentFilter = filter;
  // 更新筛选按钮状态
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === filter);
  });
  renderVoiceList();
}

async function previewVoice(voiceId, voiceName) {
  if (previewingVoice === voiceId) return;

  previewingVoice = voiceId;
  const previewText = '你好，很高兴认识你！';

  try {
    // 临时设置音色
    await window.electronAPI.tts.setVoice(voiceId);
    const result = await window.electronAPI.deepgram.textToSpeech(previewText);

    if (result.success) {
      const audio = new Audio('data:audio/mp3;base64,' + result.audio);
      audio.onended = () => { previewingVoice = null; };
      audio.onerror = () => { previewingVoice = null; };
      await audio.play();
    }

    // 恢复原音色
    await window.electronAPI.tts.setVoice(currentSelectedVoice);
  } catch (e) {
    console.error('[龙虾助手] 试听失败:', e);
    previewingVoice = null;
    await window.electronAPI.tts.setVoice(currentSelectedVoice);
  }
}

async function selectVoice(voiceId) {
  currentSelectedVoice = voiceId;
  await window.electronAPI.tts.setVoice(voiceId);
  renderVoiceList();
  // 找到音色名字显示提示
  let voiceName = voiceId;
  for (const g of VOICE_OPTIONS) {
    const v = g.voices.find(v => v.id === voiceId);
    if (v) { voiceName = v.name; break; }
  }
  showBubble(`音色已切换为「${escapeHtml(voiceName)}」`);
  setTimeout(() => {
    voicePanel.style.display = 'none';
  }, 600);
}

function openVoicePanel() {
  currentFilter = 'all';
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === 'all');
  });
  renderVoiceList();
  voicePanel.style.display = 'flex';

  // 绑定筛选按钮事件
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.onclick = () => setFilter(btn.dataset.filter);
  });
}

// 初始化时获取当前音色
async function initVoice() {
  try {
    const result = await window.electronAPI.tts.getVoice();
    if (result.voiceId) currentSelectedVoice = result.voiceId;
  } catch (e) {}
}

// ===== 角色切换 =====
const characterPanel = document.getElementById('character-panel');
const characterList = document.getElementById('character-list');
const characterSelectBtn = document.getElementById('character-select-btn');
const closeCharacterPanel = document.getElementById('close-character-panel');

function renderCharacterList() {
  characterList.innerHTML = '';

  // 检查角色视频资源是否可用
  const availableCharacters = ['lobster', 'amy']; // 有视频资源的角色

  Object.values(CHARACTER_PROFILES).forEach(char => {
    const item = document.createElement('div');
    item.className = 'character-item' + (char.id === currentCharacter.id ? ' active' : '');

    const isAvailable = availableCharacters.includes(char.id);

    item.innerHTML = `
      <span class="character-icon"><span class="iconify" data-icon="${char.icon}"></span></span>
      <div class="character-info">
        <div class="character-name">${char.name}${!isAvailable ? ' <span class="coming-soon">即将上线</span>' : ''}</div>
        <div class="character-desc">${char.desc}</div>
      </div>
      ${char.id === currentCharacter.id ? '<span class="character-check"><span class="iconify" data-icon="mdi:check"></span></span>' : ''}
    `;

    if (isAvailable) {
      item.addEventListener('click', () => {
        switchCharacter(char.id);
      });
    } else {
      item.classList.add('disabled');
    }

    characterList.appendChild(item);
  });
}

async function switchCharacter(characterId) {
  const newChar = CHARACTER_PROFILES[characterId];
  if (!newChar || newChar.id === currentCharacter.id) return;

  console.log(`[角色切换] ${currentCharacter.name} → ${newChar.name}`);

  // 更新角色
  currentCharacter = newChar;
  VIDEO_SOURCES = { ...newChar.videos };

  // 更新光环颜色
  if (auraAnimator && newChar.auraColors) {
    auraAnimator.updateColors(newChar.auraColors);
  }

  // 切换默认音色
  currentSelectedVoice = newChar.defaultVoice;
  try {
    await window.electronAPI.tts.setVoice(newChar.defaultVoice);
  } catch (e) {}

  // 关闭面板
  characterPanel.style.display = 'none';

  // 显示切换提示
  showBubble(`已切换为「${escapeHtml(newChar.name)}」`);

  // 重新播放欢迎动画
  isFirstLaunch = true;
  playWelcomeVideo();

  // 刷新角色列表和音色列表
  renderCharacterList();
  renderVoiceList();
}

function openCharacterPanel() {
  renderCharacterList();
  characterPanel.style.display = 'flex';
}

// ===== 悬浮球模式 =====
const miniOrb = document.getElementById('mini-orb');
const widgetContainer = document.getElementById('widget-container');
const miniOrbVideo = document.getElementById('mini-orb-video');
let isMiniMode = false;
let miniOrbClickTimer = null;

function initMiniMode() {
  // 监听主进程的迷你模式切换
  window.electronAPI.onMiniMode((isMini) => {
    if (isMini) {
      enterMiniMode();
    } else {
      exitMiniMode();
    }
  });

  // 单击悬浮球 = 开始/停止聆听；双击悬浮球 = 恢复大窗口
  miniOrb.addEventListener('click', (e) => {
    console.log('[悬浮球] 点击事件触发, isMiniMode:', isMiniMode, 'target:', e.target.className);
    // 点击放大按钮时不处理
    if (e.target.closest('.mini-expand-btn')) return;

    if (miniOrbClickTimer) {
      // 双击：恢复大窗口
      clearTimeout(miniOrbClickTimer);
      miniOrbClickTimer = null;
      console.log('[悬浮球] 双击 → 恢复大窗口');
      window.electronAPI.restoreWindow();
    } else {
      // 等待判断是否双击
      miniOrbClickTimer = setTimeout(() => {
        miniOrbClickTimer = null;
        console.log('[悬浮球] 单击 → 切换聆听');
        // 单击：切换聆听
        onMiniOrbTap();
      }, 250);
    }
  });

  // 放大按钮
  const expandBtn = document.getElementById('mini-expand-btn');
  if (expandBtn) {
    expandBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      window.electronAPI.restoreWindow();
    });
  }
}

// 悬浮球单击 → 开始/停止聆听
async function onMiniOrbTap() {
  console.log('[悬浮球] onMiniOrbTap, isMiniMode:', isMiniMode, 'appState:', appState, 'isProcessing:', isProcessing);
  if (!isMiniMode) return;

  // speaking 状态下允许打断 → 直接进入聆听
  if (appState === 'speaking') {
    interruptTTS();
    isProcessing = false;
    accumulatedTranscript = '';
    setAppState('listening');
    await startRecording();
    return;
  }

  if (isProcessing) return;

  if (appState === 'listening' || appState === 'followup') {
    // 正在聆听 → 停止
    clearTimeout(executeTimer);
    accumulatedTranscript = '';
    await stopRecording();
    setMiniOrbState('idle');
    setAppState('idle');
    return;
  }

  // 开始聆听
  accumulatedTranscript = '';
  setAppState('listening');
  setMiniOrbState('listening');
  await startRecording();
}

// 更新悬浮球视觉状态
function setMiniOrbState(state) {
  if (!isMiniMode) return;
  miniOrb.classList.remove('mini-listening', 'mini-thinking', 'mini-speaking');
  if (state === 'listening' || state === 'followup') {
    miniOrb.classList.add('mini-listening');
  } else if (state === 'thinking') {
    miniOrb.classList.add('mini-thinking');
  } else if (state === 'speaking') {
    miniOrb.classList.add('mini-speaking');
  }
  // 切换悬浮球视频匹配状态
  const videoSrc = VIDEO_SOURCES[state] || VIDEO_SOURCES.idle;
  const source = miniOrbVideo.querySelector('source');
  if (source && !source.src.endsWith(videoSrc)) {
    source.src = videoSrc;
    miniOrbVideo.load();
    miniOrbVideo.play().catch(() => {});
  }
}

function enterMiniMode() {
  console.log('[悬浮球] 进入迷你模式');
  isMiniMode = true;
  widgetContainer.style.display = 'none';
  miniOrb.style.display = 'flex';
  // 更新悬浮球视频为当前状态
  setMiniOrbState(appState);
}

function exitMiniMode() {
  console.log('[悬浮球] 退出迷你模式，恢复完整窗口');
  isMiniMode = false;
  miniOrb.style.display = 'none';
  miniOrb.classList.remove('mini-listening', 'mini-thinking', 'mini-speaking');
  widgetContainer.style.display = 'flex';

  // 如果在聆听中恢复，保持聆听状态
  if (appState === 'listening' || appState === 'followup') {
    setAppState(appState);
  }
}

// ===== 事件监听 =====
lobsterArea.addEventListener('click', onLobsterClick);

voiceSelectBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  openVoicePanel();
});

characterSelectBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  openCharacterPanel();
});

closeCharacterPanel.addEventListener('click', (e) => {
  e.stopPropagation();
  characterPanel.style.display = 'none';
});

closeVoicePanel.addEventListener('click', (e) => {
  e.stopPropagation();
  voicePanel.style.display = 'none';
});

minimizeBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  window.electronAPI.minimizeWindow();
});

closeBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  window.electronAPI.closeWindow();
});

// ===== 文本输入处理 =====
async function handleTextInput() {
  const text = textInput.value.trim();
  if (!text || isProcessing) return;

  // 清空输入框
  textInput.value = '';

  // 显示用户输入的文字
  showBubble('💬 ' + escapeHtml(text), true);

  // 直接处理命令（不需要语音识别）
  await handleCommand(text);
}

sendBtn.addEventListener('click', handleTextInput);

textInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    handleTextInput();
  }
});
