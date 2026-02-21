const { app, BrowserWindow, ipcMain, Notification, shell } = require('electron');
const path = require('path');
const { createClient, LiveTranscriptionEvents } = require('@deepgram/sdk');
const mqtt = require('mqtt');
require('dotenv').config();

// 捕获 EPIPE 错误，防止后台运行时崩溃
process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') {
    // 忽略 EPIPE 错误
    return;
  }
  throw err;
});

process.stderr.on('error', (err) => {
  if (err.code === 'EPIPE') {
    // 忽略 EPIPE 错误
    return;
  }
  throw err;
});

let mainWindow;

// ===== 任务管理器 =====
class TaskManager {
  constructor() {
    this.tasks = new Map();
    this.taskQueue = [];
    this.isProcessing = false;
  }

  // 创建异步任务
  createTask(message) {
    const taskId = `task-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const task = {
      id: taskId,
      message: message,
      status: 'pending',
      createdAt: Date.now(),
      result: null,
      error: null
    };

    this.tasks.set(taskId, task);
    this.taskQueue.push(taskId);

    console.log(`[TaskManager] 创建任务: ${taskId} - "${message}"`);

    // 开始处理队列
    this.processQueue();

    return taskId;
  }

  // 处理任务队列
  async processQueue() {
    if (this.isProcessing || this.taskQueue.length === 0) {
      return;
    }

    this.isProcessing = true;
    const taskId = this.taskQueue.shift();

    await this.executeTask(taskId);

    this.isProcessing = false;

    // 继续处理下一个任务
    if (this.taskQueue.length > 0) {
      this.processQueue();
    }
  }

  // 执行任务
  async executeTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return;

    console.log(`[TaskManager] 开始执行任务: ${taskId}`);
    task.status = 'running';
    task.startedAt = Date.now();

    try {
      // 调用 OpenClaw
      const result = await chatWithOpenClaw(task.message);

      task.status = 'completed';
      task.result = result;
      task.completedAt = Date.now();
      task.duration = task.completedAt - task.startedAt;

      console.log(`[TaskManager] 任务完成: ${taskId} (用时 ${task.duration}ms)`);

      // 通知前端
      this.notifyTaskCompleted(task);
    } catch (error) {
      task.status = 'failed';
      task.error = error.message;
      task.completedAt = Date.now();

      console.error(`[TaskManager] 任务失败: ${taskId} - ${error.message}`);

      // 通知前端失败
      this.notifyTaskFailed(task);
    }
  }

  // 通知前端任务完成
  notifyTaskCompleted(task) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('task-completed', {
        taskId: task.id,
        result: task.result,
        duration: task.duration
      });

      // 显示系统通知
      if (Notification.isSupported()) {
        new Notification({
          title: '任务完成',
          body: task.result.substring(0, 100) + (task.result.length > 100 ? '...' : ''),
          silent: false
        }).show();
      }
    }
  }

  // 通知前端任务失败
  notifyTaskFailed(task) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('task-failed', {
        taskId: task.id,
        error: task.error
      });
    }
  }

  // 获取任务状态
  getTask(taskId) {
    return this.tasks.get(taskId);
  }

  // 获取所有任务
  getAllTasks() {
    return Array.from(this.tasks.values());
  }

  // 取消任务
  cancelTask(taskId) {
    const task = this.tasks.get(taskId);
    if (task && task.status === 'pending') {
      task.status = 'cancelled';
      // 从队列中移除
      const index = this.taskQueue.indexOf(taskId);
      if (index > -1) {
        this.taskQueue.splice(index, 1);
      }
      console.log(`[TaskManager] 任务已取消: ${taskId}`);
      return true;
    }
    return false;
  }
}

const taskManager = new TaskManager();
let deepgramClient = null;
let deepgramLive = null;
let currentSender = null;

// ===== MQTT 配置 =====
const DEVICE_ID = process.env.MQTT_DEVICE_ID || `desktop-${Date.now()}`;
const TOPICS = {
  inbound:  `openclaw/mqtt/${DEVICE_ID}/inbound`,
  outbound: `openclaw/mqtt/${DEVICE_ID}/outbound`,
  control:  `openclaw/mqtt/${DEVICE_ID}/control`,
};

let mqttClient = null;
let currentMessageId = null;  // 追踪当前消息 ID（用于 abort）

// ===== 句子分割器 =====
class SentenceSplitter {
  constructor(onSentence) {
    this.buffer = '';
    this.onSentence = onSentence;
    // 句子结束符：中文和英文
    this.sentenceEnders = /[。！？.!?]\s*/g;
  }

  // 添加文本流
  addText(text) {
    this.buffer += text;
    this.flush();
  }

  // 尝试提取完整句子
  flush() {
    let match;
    const regex = new RegExp(this.sentenceEnders.source, 'g');
    while ((match = regex.exec(this.buffer)) !== null) {
      const endIndex = match.index + match[0].length;
      const sentence = this.buffer.substring(0, endIndex).trim();
      this.buffer = this.buffer.substring(endIndex);

      if (sentence.length > 0) {
        this.onSentence(sentence);
      }
    }
  }

  // 强制刷新剩余缓冲区（流结束时调用）
  finish() {
    if (this.buffer.trim().length > 0) {
      this.onSentence(this.buffer.trim());
      this.buffer = '';
    }
  }

  // 重置
  reset() {
    this.buffer = '';
  }
}

// ===== TTS 音频队列管理器 =====
class TTSQueueManager {
  constructor() {
    this.audioQueue = [];
    this.isProcessing = false;
    this.currentSentenceId = 0;
    this.isStopped = false;
  }

  // 重置队列
  reset() {
    this.audioQueue = [];
    this.isProcessing = false;
    this.currentSentenceId = 0;
    this.isStopped = true;
  }

  // 开始新的会话
  startSession() {
    this.audioQueue = [];
    this.isProcessing = false;
    this.currentSentenceId = 0;
    this.isStopped = false;
  }

  // 添加句子到队列
  async enqueueSentence(sentence) {
    if (this.isStopped) return;

    const sentenceId = ++this.currentSentenceId;
    console.log(`[TTS Queue] 排队句子 #${sentenceId}: "${sentence.substring(0, 30)}..."`);

    this.audioQueue.push({ sentence, sentenceId });

    if (!this.isProcessing) {
      this.processQueue();
    }
  }

  // 处理队列
  async processQueue() {
    if (this.isProcessing || this.audioQueue.length === 0) return;

    this.isProcessing = true;

    while (this.audioQueue.length > 0 && !this.isStopped) {
      const item = this.audioQueue.shift();

      try {
        // 调用 TTS 生成音频（使用路由函数）
        const audioData = await callTTS(item.sentence);

        if (audioData && mainWindow && !mainWindow.isDestroyed()) {
          // 发送音频块到前端
          mainWindow.webContents.send('tts:audioChunk', {
            sentenceId: item.sentenceId,
            audio: audioData,
            text: item.sentence,
            isLast: this.audioQueue.length === 0
          });
        }
      } catch (error) {
        console.error(`[TTS Queue] 句子 #${item.sentenceId} 生成失败:`, error);
      }
    }

    this.isProcessing = false;
  }
}

const ttsQueueManager = new TTSQueueManager();
let sentenceCounter = 0;

// ===== MQTT 连接管理 =====
let mqttReady = false;  // 连接 + 订阅都完成后才为 true

function connectMQTT() {
  const brokerUrl = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';
  console.log(`[MQTT] 正在连接 ${brokerUrl}, deviceId: ${DEVICE_ID}`);

  const mqttOptions = {
    clientId: `electron-${DEVICE_ID}`,
    clean: false,  // 保持会话，支持离线消息
    reconnectPeriod: 3000,
    protocolVersion: 4,  // MQTT 3.1.1
  };
  if (process.env.MQTT_USERNAME) {
    mqttOptions.username = process.env.MQTT_USERNAME;
    mqttOptions.password = process.env.MQTT_PASSWORD || '';
  }

  mqttClient = mqtt.connect(brokerUrl, mqttOptions);

  mqttClient.on('connect', () => {
    console.log('[MQTT] Connected to broker');
    mqttReady = false;
    // 先订阅，订阅成功后才标记 ready
    mqttClient.subscribe([TOPICS.outbound, TOPICS.control], { qos: 1 }, (err) => {
      if (err) {
        console.error('[MQTT] 订阅失败:', err);
        mqttReady = false;
      } else {
        console.log('[MQTT] 已订阅 outbound 和 control topic');
        mqttReady = true;
        // 订阅完成后再上报在线状态
        mqttClient.publish(TOPICS.control, JSON.stringify({
          type: 'status',
          status: 'online',
          deviceId: DEVICE_ID,
          timestamp: Date.now()
        }), { qos: 1 }, (err) => {
          if (err) console.error('[MQTT] 发布在线状态失败:', err);
          else console.log('[MQTT] 已发布在线状态');
        });
      }
    });
  });

  mqttClient.on('message', (topic, message) => {
    try {
      const data = JSON.parse(message.toString());
      if (topic === TOPICS.outbound) {
        handleOutbound(data);
      } else if (topic === TOPICS.control) {
        handleControl(data);
      }
    } catch (e) {
      console.error('[MQTT] 消息解析错误:', e);
    }
  });

  mqttClient.on('error', (err) => {
    console.error('[MQTT] Error:', err.message);
  });

  mqttClient.on('offline', () => {
    console.log('[MQTT] 客户端离线');
  });

  mqttClient.on('reconnect', () => {
    console.log('[MQTT] 正在重连...');
  });

  mqttClient.on('close', () => {
    console.log('[MQTT] 连接已关闭');
    mqttReady = false;
  });
}

// ===== MQTT 消息处理 =====
// 流式回复回调管理
let streamResolve = null;
let streamReject = null;
let streamTimeout = null;
let accumulatedText = '';
let streamSplitter = null;

function cleanupStream() {
  streamResolve = null;
  streamReject = null;
  streamTimeout = null;
  accumulatedText = '';
  streamSplitter = null;
  currentMessageId = null;
}

// outbound 消息处理（Gateway → Electron）
function handleOutbound(data) {
  if (data.type === 'stream') {
    // 流式文本块
    const chunk = data.chunk || '';
    if (chunk) {
      accumulatedText += chunk;
      if (streamSplitter) {
        streamSplitter.addText(chunk);
      }
    }

    if (data.done) {
      console.log('[MQTT] 流式传输结束');
      if (streamSplitter) {
        streamSplitter.finish();
      }
    }
  } else if (data.type === 'reply') {
    console.log('[MQTT] 收到完整回复:', (data.text || '').substring(0, 200));

    // 如果没有累积文本（没有收到 stream），使用 reply 的文本
    if (!accumulatedText && data.text) {
      accumulatedText = data.text;
      if (streamSplitter) {
        streamSplitter.addText(data.text);
        streamSplitter.finish();
      }
    }

    // resolve chatWithOpenClaw promise
    if (streamResolve) {
      clearTimeout(streamTimeout);
      const result = accumulatedText || data.text || '收到了，但没有找到回复内容。';
      streamResolve(result);
      cleanupStream();
    }
  }
}

// control 消息处理（Gateway → Electron 工具事件）
function handleControl(data) {
  if (data.type === 'tool') {
    switch (data.tool) {
      case 'desktop_notify':
        console.log(`[MQTT] 收到通知事件: ${data.params?.title}`);
        if (Notification.isSupported()) {
          new Notification({
            title: data.params?.title || '通知',
            body: data.params?.body || '',
            silent: !!data.params?.silent
          }).show();
        }
        break;
      case 'open_finder':
        console.log(`[MQTT] 收到打开 Finder 事件: ${data.params?.path}`);
        if (data.params?.path) {
          const os = require('os');
          const expandedPath = data.params.path.startsWith('~/')
            ? data.params.path.replace('~', os.homedir())
            : data.params.path;
          shell.showItemInFolder(expandedPath);
        }
        break;
      case 'desktop_clipboard':
        console.log('[MQTT] 收到剪贴板事件');
        if (data.params?.text) {
          const { clipboard } = require('electron');
          clipboard.writeText(data.params.text);
        }
        break;
    }
  }
}

// ===== 等待 MQTT 就绪（连接 + 订阅完成） =====
function waitForMQTT(timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    if (mqttReady) {
      resolve();
      return;
    }
    const timeout = setTimeout(() => {
      clearInterval(poll);
      reject(new Error('MQTT 连接超时'));
    }, timeoutMs);
    // 轮询检查 mqttReady 状态
    const poll = setInterval(() => {
      if (mqttReady) {
        clearTimeout(timeout);
        clearInterval(poll);
        resolve();
      }
    }, 100);
  });
}

// ===== 发送聊天消息（基于 MQTT） =====
async function chatWithOpenClaw(message) {
  console.log(`[MQTT] 发送消息: "${message}"`);

  // 等待 MQTT 连接就绪（最多 10 秒）
  await waitForMQTT(10000);

  // 二次检查连接状态
  if (!mqttClient || !mqttClient.connected) {
    throw new Error('MQTT 未连接');
  }

  const msgId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  currentMessageId = msgId;

  // 重置句子计数器和 TTS 队列
  sentenceCounter = 0;
  ttsQueueManager.startSession();
  accumulatedText = '';

  // 创建句子分割器
  streamSplitter = new SentenceSplitter((sentence) => {
    const currentSentenceId = ++sentenceCounter;
    console.log(`[MQTT] 句子 #${currentSentenceId}: "${sentence}"`);

    // 第一个句子立即发送到前端显示
    if (currentSentenceId === 1 && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('openclaw:firstSentence', { text: sentence });
    }

    // 将句子加入 TTS 队列
    ttsQueueManager.enqueueSentence(sentence);
  });

  return new Promise((resolve, reject) => {
    streamResolve = resolve;
    streamReject = reject;

    // 超时处理（180 秒，复杂任务可能需要较长时间）
    streamTimeout = setTimeout(() => {
      if (accumulatedText.length > 0) {
        console.log('[MQTT] 响应超时，返回已累积文本');
        if (streamSplitter) streamSplitter.finish();
        resolve(accumulatedText);
      } else {
        reject(new Error('MQTT 响应超时'));
      }
      cleanupStream();
    }, 180000);

    // 发送消息到 inbound topic
    const payload = JSON.stringify({
      type: 'message',
      id: msgId,
      text: message,
      timestamp: Date.now()
    });

    console.log(`[MQTT] Publishing to ${TOPICS.inbound}, payload size: ${payload.length} bytes`);

    mqttClient.publish(TOPICS.inbound, payload, { qos: 1 }, (err) => {
      if (err) {
        console.error('[MQTT] Publish 失败:', err);
        clearTimeout(streamTimeout);
        cleanupStream();
        reject(new Error(`MQTT publish 失败: ${err.message}`));
      } else {
        console.log('[MQTT] Publish 成功, msgId:', msgId);
      }
    });
  });
}

// ===== 中止当前生成（基于 MQTT） =====
function abortCurrentAgent() {
  if (!currentMessageId) {
    console.log('[MQTT] 无活跃消息 ID，跳过 abort');
    return;
  }

  const msgId = currentMessageId;
  currentMessageId = null;

  if (!mqttClient || !mqttClient.connected) {
    console.log('[MQTT] 未连接，跳过 abort');
    return;
  }

  console.log(`[MQTT] 发送 abort, replyTo: ${msgId}`);
  mqttClient.publish(TOPICS.control, JSON.stringify({
    type: 'abort',
    replyTo: msgId
  }), { qos: 1 });

  // 清理等待中的 stream
  if (streamResolve) {
    clearTimeout(streamTimeout);
    if (accumulatedText.length > 0) {
      streamResolve(accumulatedText);
    } else {
      streamResolve('已中止');
    }
    cleanupStream();
  }
}

// IPC handler: 前端触发 abort
ipcMain.handle('openclaw:abort', async () => {
  abortCurrentAgent();
  return { success: true };
});

// ===== 窗口创建 =====
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 330,
    height: 550,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '../public/index.html'));

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ===== 命令处理（通过 OpenClaw） =====
ipcMain.handle('openclaw:executeCommand', async (event, command) => {
  console.log('[CMD] 收到命令:', command);

  try {
    const reply = await chatWithOpenClaw(command);
    console.log(`[CMD] OpenClaw 回复: ${reply}`);
    const streamingTTSActive = sentenceCounter > 0;
    return { type: 'chat', data: null, message: reply, streamingTTSActive };
  } catch (error) {
    console.error('[CMD] OpenClaw 调用失败:', error.message);
    // 降级处理：返回友好提示
    return {
      type: 'chat',
      data: null,
      message: 'OpenClaw 暂时无法连接，请确保 openclaw 服务正在运行。'
    };
  }
});

// ===== 异步任务管理 =====
ipcMain.handle('task:create', async (event, message) => {
  const taskId = taskManager.createTask(message);
  return { success: true, taskId };
});

ipcMain.handle('task:get', async (event, taskId) => {
  const task = taskManager.getTask(taskId);
  return task || null;
});

ipcMain.handle('task:getAll', async (event) => {
  return taskManager.getAllTasks();
});

ipcMain.handle('task:cancel', async (event, taskId) => {
  const success = taskManager.cancelTask(taskId);
  return { success };
});

// ===== Deepgram STT =====
let deepgramKeepAlive = null;
let isListeningActive = false; // 是否处于活动听写状态（用于长连接优化）

ipcMain.handle('deepgram:startListening', async (event) => {
  try {
    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey || apiKey === 'your_deepgram_api_key_here') {
      return { success: false, error: '请先在 .env 文件中配置 DEEPGRAM_API_KEY' };
    }

    currentSender = event.sender;

    // 复用已有连接（如果仍然活跃）
    if (deepgramLive) {
      try {
        const readyState = deepgramLive.getReadyState();
        if (readyState === 1) { // WebSocket.OPEN
          console.log('[STT] 复用现有 Deepgram 连接 ✓');
          isListeningActive = true; // 激活听写状态
          return { success: true };
        }
      } catch (e) { /* 连接异常，重新创建 */ }
      // 连接已关闭或异常，清理后重建
      if (deepgramKeepAlive) { clearInterval(deepgramKeepAlive); deepgramKeepAlive = null; }
      try { deepgramLive.finish(); } catch (e) {}
      deepgramLive = null;
    }

    console.log(`[STT] Deepgram API Key: ${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 4)}`);

    // 创建新连接
    deepgramClient = createClient(apiKey);

    console.log('[STT] 正在建立 Deepgram WebSocket 连接...');

    deepgramLive = deepgramClient.listen.live({
      model: 'nova-2',
      language: 'zh-CN',
      smart_format: true,
      interim_results: true,
      utterance_end_ms: 1200,
      vad_events: true,
      encoding: 'linear16',
      sample_rate: 16000,
      channels: 1,
      endpointing: 300
    });

    // 连接超时检测（10秒内没建立则报错）
    const connectTimeout = setTimeout(() => {
      if (deepgramLive) {
        const rs = deepgramLive.getReadyState();
        if (rs !== 1) {
          console.error(`[STT] Deepgram 连接超时 (readyState=${rs})，可能 API Key 无效`);
          if (currentSender && !currentSender.isDestroyed()) {
            currentSender.send('deepgram:error', 'Deepgram 连接超时，请检查 API Key 是否有效');
          }
          try { deepgramLive.finish(); } catch (e) {}
          deepgramLive = null;
        }
      }
    }, 10000);

    deepgramLive.on(LiveTranscriptionEvents.Open, () => {
      clearTimeout(connectTimeout);
      console.log('[STT] Deepgram 连接已建立 ✓');
      // KeepAlive: 每 8 秒发送心跳，防止空闲断开
      deepgramKeepAlive = setInterval(() => {
        if (deepgramLive) {
          try { deepgramLive.keepAlive(); } catch (e) {}
        }
      }, 8000);
      if (currentSender && !currentSender.isDestroyed()) {
        currentSender.send('deepgram:connected');
      }
    });

    deepgramLive.on(LiveTranscriptionEvents.Transcript, (data) => {
      // 关键：只有在活动状态下才处理转写结果（长连接优化）
      if (!isListeningActive) {
        return;
      }

      if (!data.channel || !data.channel.alternatives || data.channel.alternatives.length === 0) return;

      const transcript = data.channel.alternatives[0].transcript;
      const isFinal = data.is_final;

      if (transcript && transcript.trim().length > 0) {
        console.log(`[STT] ${isFinal ? '✓ 最终' : '... 临时'}: "${transcript}"`);
        if (currentSender && !currentSender.isDestroyed()) {
          currentSender.send('deepgram:transcript', { transcript, isFinal });
        }
      }
    });

    deepgramLive.on(LiveTranscriptionEvents.UtteranceEnd, () => {
      // 只有活动状态下才通知前端（长连接优化）
      if (!isListeningActive) return;

      console.log('[STT] UtteranceEnd - 用户停止说话');
      if (currentSender && !currentSender.isDestroyed()) {
        currentSender.send('deepgram:utteranceEnd');
      }
    });

    deepgramLive.on(LiveTranscriptionEvents.Error, (error) => {
      clearTimeout(connectTimeout);
      console.error('[STT] Deepgram 错误:', error);
      if (currentSender && !currentSender.isDestroyed()) {
        currentSender.send('deepgram:error', error.message || String(error));
      }
    });

    deepgramLive.on(LiveTranscriptionEvents.Close, () => {
      clearTimeout(connectTimeout);
      if (deepgramKeepAlive) { clearInterval(deepgramKeepAlive); deepgramKeepAlive = null; }
      console.log('[STT] Deepgram 连接已关闭');
      isListeningActive = false; // 重置状态
      if (currentSender && !currentSender.isDestroyed()) {
        currentSender.send('deepgram:closed');
      }
    });

    isListeningActive = true; // 激活听写状态
    return { success: true };
  } catch (error) {
    console.error('[STT] 启动失败:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('deepgram:stopListening', async () => {
  // 长连接优化：不再断开连接，只是暂停听写状态
  isListeningActive = false;
  console.log('[STT] 停止听写（暂停状态，连接保持）');
  return { success: true };
});

ipcMain.handle('deepgram:sendAudio', async (event, audioData) => {
  try {
    // 只有在活动状态下才发送音频数据
    if (deepgramLive && audioData && isListeningActive) {
      const readyState = deepgramLive.getReadyState();
      if (readyState === 1) {
        const buffer = Buffer.from(audioData);
        deepgramLive.send(buffer);
      }
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ===== TTS 配置 =====
const TTS_PROVIDER = process.env.TTS_PROVIDER || 'minimax';

// MiniMax
const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY || '';
const MINIMAX_GROUP_ID = process.env.MINIMAX_GROUP_ID || '';
const MINIMAX_MODEL = process.env.MINIMAX_MODEL || 'speech-02-turbo';

// ElevenLabs
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';
let currentElevenLabsVoiceId = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';

// 当前选择的音色（可被前端动态修改）
let currentVoiceId = process.env.MINIMAX_VOICE_ID || 'Lovely_Girl';

// ElevenLabs TTS 函数
async function callElevenLabsTTS(text) {
  if (!ELEVENLABS_API_KEY) {
    throw new Error('ElevenLabs API Key 未配置');
  }

  const startTime = Date.now();
  console.log(`[TTS] ElevenLabs 生成语音 (音色: ${currentElevenLabsVoiceId}): "${text.substring(0, 50)}..."`);

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${currentElevenLabsVoiceId}`,
    {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': ELEVENLABS_API_KEY
      },
      body: JSON.stringify({
        text: text,
        model_id: 'eleven_flash_v2_5',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75
        }
      })
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[TTS] ElevenLabs 错误响应:', errorText);
    throw new Error(`ElevenLabs API ${response.status}: ${errorText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const audioBuffer = Buffer.from(arrayBuffer);

  if (audioBuffer.length < 1000) {
    const text = audioBuffer.toString('utf-8');
    if (text.includes('detail') || text.includes('error')) {
      throw new Error(`ElevenLabs 返回错误: ${text}`);
    }
  }
  const duration = Date.now() - startTime;
  console.log(`[TTS] ElevenLabs 生成音频: ${audioBuffer.length} 字节, 耗时: ${duration}ms`);

  return audioBuffer.toString('base64');
}

// MiniMax TTS 函数
async function callMiniMaxTTS(text) {
  if (!MINIMAX_API_KEY || !MINIMAX_GROUP_ID) {
    throw new Error('MiniMax API Key 或 Group ID 未配置');
  }

  console.log(`[TTS] MiniMax 生成语音 (音色: ${currentVoiceId}): "${text.substring(0, 50)}..."`);

  const response = await fetch(
    `https://api.minimax.io/v1/t2a_v2?GroupId=${MINIMAX_GROUP_ID}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MINIMAX_API_KEY}`
      },
      body: JSON.stringify({
        model: MINIMAX_MODEL,
        text: text,
        stream: false,
        voice_setting: {
          voice_id: currentVoiceId,
          speed: 1.0,
          vol: 1.0,
          pitch: 0
        },
        audio_setting: {
          sample_rate: 32000,
          format: 'mp3',
          bitrate: 128000
        },
        language_boost: 'Chinese'
      })
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`MiniMax API ${response.status}: ${errorText}`);
  }

  const data = await response.json();

  if (data.base_resp && data.base_resp.status_code !== 0) {
    throw new Error(data.base_resp.status_msg || 'MiniMax 返回错误');
  }

  if (!data.data || !data.data.audio) {
    throw new Error('无音频数据');
  }

  // MiniMax 返回 hex 编码的音频，转为 base64
  const audioBuffer = Buffer.from(data.data.audio, 'hex');
  console.log(`[TTS] MiniMax 生成音频: ${audioBuffer.length} 字节`);

  if (audioBuffer.length < 100) {
    throw new Error('TTS 音频数据太小');
  }

  return audioBuffer.toString('base64');
}

// TTS 路由函数（根据配置选择提供商）
async function callTTS(text) {
  const provider = TTS_PROVIDER.toLowerCase();

  if (provider === 'elevenlabs') {
    return await callElevenLabsTTS(text);
  } else {
    return await callMiniMaxTTS(text);
  }
}

// 前端设置音色
ipcMain.handle('tts:setVoice', async (event, voiceId) => {
  console.log(`[TTS] 音色已切换: ${currentVoiceId} → ${voiceId}`);

  if (TTS_PROVIDER === 'elevenlabs') {
    currentElevenLabsVoiceId = voiceId;
  } else {
    currentVoiceId = voiceId;
  }

  return { success: true };
});

// 前端获取当前音色
ipcMain.handle('tts:getVoice', async () => {
  return { voiceId: currentVoiceId };
});

// 停止 TTS 播放
ipcMain.handle('tts:stop', async () => {
  console.log('[TTS] 停止播放');
  ttsQueueManager.reset();
  abortCurrentAgent();
  return { success: true };
});

// 非流式 TTS（兼容旧接口）
ipcMain.handle('deepgram:textToSpeech', async (event, text) => {
  try {
    const audioBase64 = await callTTS(text);
    return { success: true, audio: audioBase64 };
  } catch (error) {
    console.error('[TTS] 失败:', error);
    return { success: false, error: error.message };
  }
});

// ===== 窗口控制 =====
const FULL_WIDTH = 330;
const FULL_HEIGHT = 550;
const MINI_SIZE = 64;
let isMiniMode = false;

ipcMain.on('window:minimize', () => {
  if (!mainWindow) return;
  // 切换到悬浮球模式
  isMiniMode = true;
  const bounds = mainWindow.getBounds();
  // 记住展开位置
  mainWindow._restoreX = bounds.x;
  mainWindow._restoreY = bounds.y;
  // 缩小到悬浮球
  mainWindow.setMinimumSize(MINI_SIZE, MINI_SIZE);
  mainWindow.setSize(MINI_SIZE, MINI_SIZE);
  // 移动到屏幕右下区域
  const { screen } = require('electron');
  const display = screen.getPrimaryDisplay();
  const x = display.workArea.x + display.workArea.width - MINI_SIZE - 20;
  const y = display.workArea.y + display.workArea.height - MINI_SIZE - 20;
  mainWindow.setPosition(x, y);
  mainWindow.webContents.send('window:miniMode', true);
});

ipcMain.on('window:restore', () => {
  if (!mainWindow) return;
  isMiniMode = false;
  mainWindow.setMinimumSize(200, 300);
  mainWindow.setSize(FULL_WIDTH, FULL_HEIGHT);
  // 恢复到之前的位置
  if (mainWindow._restoreX !== undefined) {
    mainWindow.setPosition(mainWindow._restoreX, mainWindow._restoreY);
  } else {
    mainWindow.center();
  }
  mainWindow.webContents.send('window:miniMode', false);
});

ipcMain.on('window:close', () => {
  if (mainWindow) mainWindow.close();
});

// ===== 文件操作 =====
// 在 Finder 中显示文件
ipcMain.handle('file:showInFolder', async (event, filePath) => {
  try {
    const fs = require('fs');
    const os = require('os');

    // 展开 ~ 为用户目录
    let expandedPath = filePath;
    if (filePath.startsWith('~/')) {
      expandedPath = filePath.replace('~', os.homedir());
    }

    // 验证路径是否存在
    if (!fs.existsSync(expandedPath)) {
      console.warn('[File] 文件不存在:', expandedPath);
      return { success: false, error: '文件不存在' };
    }

    // 在 Finder 中显示文件
    shell.showItemInFolder(expandedPath);
    console.log('[File] 在 Finder 中显示:', expandedPath);
    return { success: true };
  } catch (error) {
    console.error('[File] 打开失败:', error.message);
    return { success: false, error: error.message };
  }
});

// ===== 应用生命周期 =====
app.whenReady().then(() => {
  createWindow();
  // 延迟连接 MQTT，等 Electron 网络栈完全就绪
  mainWindow.webContents.on('did-finish-load', () => {
    connectMQTT();
  });
});

app.on('window-all-closed', () => {
  // MQTT: 上报离线状态并断开
  if (mqttClient && mqttClient.connected) {
    mqttClient.publish(TOPICS.control, JSON.stringify({
      type: 'status',
      status: 'offline',
      deviceId: DEVICE_ID,
      timestamp: Date.now()
    }), { qos: 1 });
    mqttClient.end();
  }
  // 清理 Deepgram 连接
  isListeningActive = false;
  if (deepgramKeepAlive) { clearInterval(deepgramKeepAlive); deepgramKeepAlive = null; }
  if (deepgramLive) { try { deepgramLive.finish(); } catch (e) {} deepgramLive = null; }
  // 清理 TTS 队列
  ttsQueueManager.reset();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
