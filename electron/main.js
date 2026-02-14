const { app, BrowserWindow, ipcMain, Notification, shell } = require('electron');
const path = require('path');
const { createClient, LiveTranscriptionEvents } = require('@deepgram/sdk');
const WebSocket = require('ws');
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

// ===== OpenClaw WebSocket 配置 =====
const OPENCLAW_PORT = process.env.OPENCLAW_PORT || 18789;
const OPENCLAW_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || '';
const OPENCLAW_WS_URL = `ws://localhost:${OPENCLAW_PORT}`;

let openclawWs = null;
let openclawConnected = false;
let openclawRequestId = 0;
let openclawPendingRequests = new Map();

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
        // 调用 TTS 生成音频
        const audioData = await callMiniMaxTTS(item.sentence);

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

// ===== OpenClaw WebSocket 连接 =====
function connectOpenClaw() {
  if (openclawWs && openclawWs.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    console.log(`[OpenClaw] 正在连接 ${OPENCLAW_WS_URL}...`);
    openclawWs = new WebSocket(OPENCLAW_WS_URL);

    const timeout = setTimeout(() => {
      reject(new Error('OpenClaw 连接超时'));
    }, 10000);

    openclawWs.on('open', () => {
      console.log('[OpenClaw] WebSocket 已连接，等待握手...');
    });

    openclawWs.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());

        // 处理连接挑战
        if (msg.type === 'event' && msg.event === 'connect.challenge') {
          console.log('[OpenClaw] 收到连接挑战，发送认证...');
          openclawWs.send(JSON.stringify({
            type: 'req',
            id: 'connect-1',
            method: 'connect',
            params: {
              minProtocol: 3,
              maxProtocol: 3,
              client: {
                id: 'gateway-client',
                version: '1.0.0',
                platform: 'electron',
                mode: 'backend'
              },
              role: 'operator',
              scopes: ['operator.read', 'operator.write'],
              auth: { token: OPENCLAW_TOKEN }
            }
          }));
        }

        // 处理响应
        if (msg.type === 'res') {
          if (msg.id === 'connect-1') {
            if (msg.ok) {
              clearTimeout(timeout);
              openclawConnected = true;
              console.log('[OpenClaw] 认证成功 ✓');
              resolve();
            } else {
              clearTimeout(timeout);
              reject(new Error(msg.error?.message || '认证失败'));
            }
          } else {
            // 处理其他请求的响应
            const pending = openclawPendingRequests.get(msg.id);
            if (pending) {
              openclawPendingRequests.delete(msg.id);
              if (msg.ok) {
                pending.resolve(msg.payload);
              } else {
                pending.reject(new Error(msg.error?.message || '请求失败'));
              }
            }
          }
        }

        // 处理聊天事件（流式响应）
        if (msg.type === 'event' && msg.event === 'chat') {
          const pending = openclawPendingRequests.get('chat-stream');
          if (pending && msg.payload) {
            if (msg.payload.done) {
              openclawPendingRequests.delete('chat-stream');
              pending.resolve(pending.fullText || '');
            } else if (msg.payload.text) {
              pending.fullText = (pending.fullText || '') + msg.payload.text;
            }
          }
        }
      } catch (e) {
        console.error('[OpenClaw] 消息解析错误:', e);
      }
    });

    openclawWs.on('error', (err) => {
      console.error('[OpenClaw] WebSocket 错误:', err.message);
      openclawConnected = false;
    });

    openclawWs.on('close', () => {
      console.log('[OpenClaw] WebSocket 已断开');
      openclawConnected = false;
      openclawWs = null;
    });
  });
}

// 发送 OpenClaw 请求
function openclawRequest(method, params = {}) {
  return new Promise((resolve, reject) => {
    if (!openclawWs || openclawWs.readyState !== WebSocket.OPEN) {
      reject(new Error('OpenClaw 未连接'));
      return;
    }

    const id = `req-${++openclawRequestId}`;
    openclawPendingRequests.set(id, { resolve, reject });

    openclawWs.send(JSON.stringify({
      type: 'req',
      id,
      method,
      params
    }));

    // 超时处理
    setTimeout(() => {
      if (openclawPendingRequests.has(id)) {
        openclawPendingRequests.delete(id);
        reject(new Error('请求超时'));
      }
    }, 30000);
  });
}

// 发送聊天消息到 OpenClaw（支持流式句子分发）
async function chatWithOpenClaw(message) {
  try {
    await connectOpenClaw();

    console.log(`[OpenClaw] 发送消息: "${message}"`);

    // 生成唯一的 idempotencyKey
    const idempotencyKey = `openclaw-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // 发送消息并等待完成
    const chatReqId = `chat-${++openclawRequestId}`;
    let accumulatedText = '';

    // 重置句子计数器和 TTS 队列
    sentenceCounter = 0;
    ttsQueueManager.startSession();

    // 创建句子分割器
    const splitter = new SentenceSplitter((sentence) => {
      const currentSentenceId = ++sentenceCounter;
      console.log(`[OpenClaw] 句子 #${currentSentenceId}: "${sentence}"`);

      // 第一个句子立即发送到前端显示
      if (currentSentenceId === 1 && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('openclaw:firstSentence', { text: sentence });
      }

      // 将句子加入 TTS 队列
      ttsQueueManager.enqueueSentence(sentence);
    });

    return new Promise((resolve, reject) => {
      // 复杂任务（搜索、工具调用等）可能需要较长时间，超时设为 180 秒
      const timeout = setTimeout(() => {
        if (openclawWs) {
          openclawWs.removeListener('message', chatHandler);
        }
        // 超时但有累积文本时，返回已收到的部分
        if (accumulatedText.length > 0) {
          console.log('[OpenClaw] 响应超时，返回已累积文本:', accumulatedText.substring(0, 200));
          splitter.finish(); // 刷新剩余文本
          resolve(accumulatedText);
        } else {
          reject(new Error('OpenClaw 响应超时'));
        }
      }, 180000);

      // 监听消息
      const chatHandler = (data) => {
        try {
          const msg = JSON.parse(data.toString());

          // 详细日志：记录所有 OpenClaw 消息（调试）
          if (msg.type === 'event') {
            console.log(`[OpenClaw] 事件: ${msg.event}, payload keys: ${Object.keys(msg.payload || {}).join(',')}, state: ${msg.payload?.state || '-'}`);
          } else if (msg.type === 'res' && msg.id !== 'connect-1') {
            console.log(`[OpenClaw] 响应: id=${msg.id}, ok=${msg.ok}`);
          }

          // 1. 处理 chat.send 请求的直接响应（错误检测）
          if (msg.type === 'res' && msg.id === chatReqId) {
            if (!msg.ok) {
              console.error('[OpenClaw] chat.send 请求被拒绝:', msg.error?.message || JSON.stringify(msg.error));
              openclawWs.removeListener('message', chatHandler);
              clearTimeout(timeout);
              reject(new Error(msg.error?.message || 'chat.send 请求失败'));
              return;
            }
            console.log('[OpenClaw] chat.send 请求已接受');
          }

          // 2. 监听 chat 流式事件（累积文本 + 分句处理）
          if (msg.type === 'event' && msg.event === 'chat') {
            const payload = msg.payload || {};

            // 累积流式文本
            if (payload.text) {
              accumulatedText += payload.text;
              // 将新文本喂给分割器
              splitter.addText(payload.text);
            }

            // 检查完成状态
            if (payload.state === 'final' || payload.done === true) {
              console.log('[OpenClaw] 收到 chat final 事件');
              openclawWs.removeListener('message', chatHandler);

              // 刷新分割器剩余文本
              splitter.finish();

              // 如果流式已累积文本，直接使用
              if (accumulatedText.length > 0) {
                clearTimeout(timeout);
                console.log('[OpenClaw] AI 回复 (流式):', accumulatedText.substring(0, 200));
                resolve(accumulatedText);
                return;
              }

              // 否则从历史记录获取
              openclawRequest('chat.history', {
                sessionKey: 'agent:main:main',
                limit: 2
              }).then(history => {
                clearTimeout(timeout);
                if (history?.messages) {
                  const lastAssistant = history.messages.find(m => m.role === 'assistant');
                  if (lastAssistant && lastAssistant.content) {
                    const textContent = lastAssistant.content.find(c => c.type === 'text');
                    if (textContent) {
                      console.log('[OpenClaw] AI 回复 (历史):', textContent.text.substring(0, 200));
                      resolve(textContent.text);
                      return;
                    }
                  }
                }
                resolve('收到了，但没有找到回复内容。');
              }).catch(err => {
                clearTimeout(timeout);
                reject(err);
              });
            }
          }

          // 3. 监听所有其他事件（OpenClaw 可能通过不同事件名返回结果）
          if (msg.type === 'event' && msg.event !== 'chat' && msg.event !== 'connect.challenge') {
            const payload = msg.payload || {};
            // 尝试从任意事件中提取文本
            if (payload.text && typeof payload.text === 'string') {
              console.log(`[OpenClaw] 从事件 "${msg.event}" 收到文本: ${payload.text.substring(0, 100)}`);
              accumulatedText += payload.text;
              splitter.addText(payload.text);
            }
            if (payload.message && typeof payload.message === 'string') {
              console.log(`[OpenClaw] 从事件 "${msg.event}" 收到 message: ${payload.message.substring(0, 100)}`);
              if (!accumulatedText) accumulatedText = payload.message;
            }
            if (payload.result && typeof payload.result === 'string') {
              console.log(`[OpenClaw] 从事件 "${msg.event}" 收到 result: ${payload.result.substring(0, 100)}`);
              if (!accumulatedText) accumulatedText = payload.result;
            }
          }
        } catch (e) {
          // 忽略解析错误
        }
      };

      openclawWs.on('message', chatHandler);

      // 发送消息
      openclawWs.send(JSON.stringify({
        type: 'req',
        id: chatReqId,
        method: 'chat.send',
        params: {
          sessionKey: 'agent:main:main',
          idempotencyKey: idempotencyKey,
          message: message
        }
      }));
    });
  } catch (error) {
    console.error('[OpenClaw] 聊天失败:', error.message);
    throw error;
  }
}

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

// ===== MiniMax TTS =====
const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY || '';
const MINIMAX_GROUP_ID = process.env.MINIMAX_GROUP_ID || '';
const MINIMAX_MODEL = process.env.MINIMAX_MODEL || 'speech-02-turbo';

// 当前选择的音色（可被前端动态修改）
let currentVoiceId = process.env.MINIMAX_VOICE_ID || 'Lovely_Girl';

// 核心 TTS 函数（提取为独立函数，供 TTSQueueManager 调用）
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

// 前端设置音色
ipcMain.handle('tts:setVoice', async (event, voiceId) => {
  console.log(`[TTS] 音色已切换: ${currentVoiceId} → ${voiceId}`);
  currentVoiceId = voiceId;
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
  return { success: true };
});

// 非流式 TTS（兼容旧接口）
ipcMain.handle('deepgram:textToSpeech', async (event, text) => {
  try {
    const audioBase64 = await callMiniMaxTTS(text);
    return { success: true, audio: audioBase64 };
  } catch (error) {
    console.error('[TTS] MiniMax 失败:', error);
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
  // 预连接 OpenClaw（不等待，后台连接）
  connectOpenClaw().then(() => {
    console.log('[启动] OpenClaw 预连接成功');
  }).catch(err => {
    console.warn('[启动] OpenClaw 预连接失败（首次对话时会重试）:', err.message);
  });
  // 注意：Deepgram 不在此处预连接，而是在首次 startListening 时创建
  // 因为 Deepgram 连接需要前端准备好音频流
});

app.on('window-all-closed', () => {
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
