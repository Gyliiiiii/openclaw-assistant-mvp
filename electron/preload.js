const { contextBridge, ipcRenderer } = require('electron');

// 暴露安全的 API 给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // OpenClaw 相关
  getEmails: () => ipcRenderer.invoke('openclaw:getEmails'),
  getDailyBriefing: () => ipcRenderer.invoke('openclaw:getDailyBriefing'),
  executeCommand: (command) => ipcRenderer.invoke('openclaw:executeCommand', command),
  abortAgent: () => ipcRenderer.invoke('openclaw:abort'),

  // Deepgram 语音识别
  deepgram: {
    startListening: () => ipcRenderer.invoke('deepgram:startListening'),
    stopListening: () => ipcRenderer.invoke('deepgram:stopListening'),
    sendAudio: (audioData) => ipcRenderer.invoke('deepgram:sendAudio', audioData),
    textToSpeech: (text) => ipcRenderer.invoke('deepgram:textToSpeech', text),

    // 事件监听 - 返回取消函数
    onConnected: (callback) => {
      const handler = () => callback();
      ipcRenderer.on('deepgram:connected', handler);
      return () => ipcRenderer.removeListener('deepgram:connected', handler);
    },
    onTranscript: (callback) => {
      const handler = (event, data) => callback(data);
      ipcRenderer.on('deepgram:transcript', handler);
      return () => ipcRenderer.removeListener('deepgram:transcript', handler);
    },
    onError: (callback) => {
      const handler = (event, error) => callback(error);
      ipcRenderer.on('deepgram:error', handler);
      return () => ipcRenderer.removeListener('deepgram:error', handler);
    },
    onClosed: (callback) => {
      const handler = () => callback();
      ipcRenderer.on('deepgram:closed', handler);
      return () => ipcRenderer.removeListener('deepgram:closed', handler);
    },
    onUtteranceEnd: (callback) => {
      const handler = () => callback();
      ipcRenderer.on('deepgram:utteranceEnd', handler);
      return () => ipcRenderer.removeListener('deepgram:utteranceEnd', handler);
    },

    // 流式 TTS 音频块事件
    onAudioChunk: (callback) => {
      const handler = (event, data) => callback(data);
      ipcRenderer.on('tts:audioChunk', handler);
      return () => ipcRenderer.removeListener('tts:audioChunk', handler);
    },

    // 首个句子事件（用于前端立即显示）
    onFirstSentence: (callback) => {
      const handler = (event, data) => callback(data);
      ipcRenderer.on('openclaw:firstSentence', handler);
      return () => ipcRenderer.removeListener('openclaw:firstSentence', handler);
    },

    // 清理所有监听器
    removeAllListeners: () => {
      ipcRenderer.removeAllListeners('deepgram:connected');
      ipcRenderer.removeAllListeners('deepgram:transcript');
      ipcRenderer.removeAllListeners('deepgram:error');
      ipcRenderer.removeAllListeners('deepgram:closed');
      ipcRenderer.removeAllListeners('deepgram:utteranceEnd');
      ipcRenderer.removeAllListeners('tts:audioChunk');
      ipcRenderer.removeAllListeners('openclaw:firstSentence');
    }
  },

  // TTS 音色选择
  tts: {
    setVoice: (voiceId) => ipcRenderer.invoke('tts:setVoice', voiceId),
    getVoice: () => ipcRenderer.invoke('tts:getVoice'),
    stop: () => ipcRenderer.invoke('tts:stop')  // 停止 TTS 播放
  },

  // 语言设置
  setLanguage: (language, model) => ipcRenderer.invoke('deepgram:setLanguage', language, model),

  // 异步任务管理
  task: {
    create: (message) => ipcRenderer.invoke('task:create', message),
    get: (taskId) => ipcRenderer.invoke('task:get', taskId),
    getAll: () => ipcRenderer.invoke('task:getAll'),
    cancel: (taskId) => ipcRenderer.invoke('task:cancel', taskId),

    // 任务完成事件
    onCompleted: (callback) => {
      const handler = (event, data) => callback(data);
      ipcRenderer.on('task-completed', handler);
      return () => ipcRenderer.removeListener('task-completed', handler);
    },

    // 任务失败事件
    onFailed: (callback) => {
      const handler = (event, data) => callback(data);
      ipcRenderer.on('task-failed', handler);
      return () => ipcRenderer.removeListener('task-failed', handler);
    }
  },

  // 窗口控制
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  restoreWindow: () => ipcRenderer.send('window:restore'),
  closeWindow: () => ipcRenderer.send('window:close'),
  onMiniMode: (callback) => {
    const handler = (event, isMini) => callback(isMini);
    ipcRenderer.on('window:miniMode', handler);
    return () => ipcRenderer.removeListener('window:miniMode', handler);
  },

  // 文件操作
  file: {
    // 在 Finder 中显示文件
    showInFolder: (filePath) => ipcRenderer.invoke('file:showInFolder', filePath)
  }
});
