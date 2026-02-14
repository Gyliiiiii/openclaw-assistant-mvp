# OpenClaw Desktop Assistant MVP

[中文](#中文) | [English](#english)

---

## 中文

基于 Electron 的 AI 语音桌面助手，集成 Deepgram 实时语音识别、MiniMax 文字转语音，以及 OpenClaw AI 后端。

### 功能特性

- ✅ Electron 桌面应用，支持 macOS (x64 + arm64)
- ✅ 实时语音识别（Deepgram nova-2，中文）
- ✅ 流式文字转语音（MiniMax，逐句合成无缝播放）
- ✅ OpenClaw AI 后端集成（WebSocket 流式对话）
- ✅ 多角色系统（龙虾小虾米、Amy，更多角色开发中）
- ✅ 30 种语音音色可选，实时切换
- ✅ 迷你悬浮球模式（64x64px，单击听写 / 双击恢复）
- ✅ 语音打断 — 随时点击停止播放并继续对话
- ✅ 异步任务队列 — 说"稍后告诉我"创建后台任务
- ✅ 响应中的文件路径自动转为可点击链接
- ✅ Aura 光环动画（Canvas 粒子系统 + 波纹效果）

### 项目结构

```
openclaw-assistant-mvp/
├── electron/
│   ├── main.js              # 主进程（STT / TTS / OpenClaw / 窗口管理）
│   └── preload.js           # IPC 安全桥接
├── public/
│   ├── index.html           # 主页面
│   ├── app.js               # 渲染进程（状态机 / 角色 / 音频队列）
│   ├── orb.js               # Aura 光环动画引擎
│   ├── audio-processor.js   # AudioWorklet 音频采集
│   ├── styles.css           # 样式
│   └── *.mp4                # 角色动画视频
├── .env.example             # 环境变量模板
└── package.json             # 项目配置
```

### 环境配置

1. 复制环境变量模板：

```bash
cp .env.example .env
```

2. 在 `.env` 中填入以下 API 密钥：

```bash
# Deepgram（语音识别）
# 获取: https://console.deepgram.com/
DEEPGRAM_API_KEY=your_key

# MiniMax（文字转语音）
# 获取: https://platform.minimaxi.com/
MINIMAX_API_KEY=your_key
MINIMAX_GROUP_ID=your_group_id
MINIMAX_MODEL=speech-02-turbo
MINIMAX_VOICE_ID=Lovely_Girl

# OpenClaw 后端
OPENCLAW_PORT=18789
OPENCLAW_TOKEN=your_token
```

### 安装和运行

```bash
# 安装依赖
npm install

# 生产模式启动
npm start

# 开发模式启动（打开 DevTools）
npm run dev
```

### 构建

```bash
# macOS 双架构构建（DMG + ZIP）
npm run build

# 仅构建 DMG
npm run build:dmg
```

### 使用说明

1. **语音对话**: 点击角色开始录音，说完自动识别并发送给 AI
2. **文字输入**: 在底部输入框直接输入文字
3. **语音打断**: 播放中点击角色可打断，查看完整回复
4. **角色切换**: 点击角色选择面板切换不同助手形象
5. **音色选择**: 从 30 种预设音色中选择喜欢的声音
6. **迷你模式**: 最小化为悬浮球，单击听写，双击恢复
7. **后台任务**: 说"稍后告诉我"，任务完成后系统通知
8. **窗口拖动**: 在窗口任意位置拖动（除按钮区域）

### 技术栈

| 组件 | 技术 | 说明 |
|---|---|---|
| 桌面框架 | Electron 28 | 跨平台桌面应用 |
| 语音识别 | Deepgram nova-2 | WebSocket 实时转写 |
| 文字转语音 | MiniMax speech-02-turbo | REST API，MP3 32kHz |
| AI 后端 | OpenClaw | WebSocket 流式对话 |
| 前端 | 原生 HTML/CSS/JS | 无框架依赖 |
| 动画 | Canvas 2D | 粒子系统 + 波纹效果 |

### 注意事项

- 语音识别需要麦克风权限
- 需要有效的 Deepgram、MiniMax 和 OpenClaw API 密钥
- 目前仅在 macOS 上测试

### 下一步计划

- [ ] 添加更多角色（猫咪、机器人等视频资源制作中）
- [ ] 主动提醒功能
- [ ] 多语言语音识别切换
- [ ] 自定义角色形象上传
- [ ] Windows 平台支持

---

## English

An Electron-based AI voice desktop assistant featuring real-time speech recognition (Deepgram), text-to-speech (MiniMax), and OpenClaw AI backend integration.

### Features

- ✅ Electron desktop app with macOS support (x64 + arm64)
- ✅ Real-time speech recognition (Deepgram nova-2, Chinese)
- ✅ Streaming text-to-speech (MiniMax, sentence-by-sentence seamless playback)
- ✅ OpenClaw AI backend integration (WebSocket streaming chat)
- ✅ Multi-character system (Lobster, Amy, more coming soon)
- ✅ 30 voice presets with instant switching
- ✅ Mini floating bubble mode (64x64px, click to listen / double-click to restore)
- ✅ Speech interruption — tap to stop playback and continue conversation
- ✅ Async task queue — say "tell me later" to create background tasks
- ✅ Auto-linking file paths in responses (opens in Finder)
- ✅ Aura animation (Canvas particle system + ripple effects)

### Project Structure

```
openclaw-assistant-mvp/
├── electron/
│   ├── main.js              # Main process (STT / TTS / OpenClaw / window mgmt)
│   └── preload.js           # Secure IPC bridge
├── public/
│   ├── index.html           # Main page
│   ├── app.js               # Renderer (state machine / characters / audio queue)
│   ├── orb.js               # Aura animation engine
│   ├── audio-processor.js   # AudioWorklet audio capture
│   ├── styles.css           # Styles
│   └── *.mp4                # Character animation videos
├── .env.example             # Environment variables template
└── package.json             # Project configuration
```

### Environment Setup

1. Copy the environment template:

```bash
cp .env.example .env
```

2. Fill in the following API keys in `.env`:

```bash
# Deepgram (speech recognition)
# Get key: https://console.deepgram.com/
DEEPGRAM_API_KEY=your_key

# MiniMax (text-to-speech)
# Get key: https://platform.minimaxi.com/
MINIMAX_API_KEY=your_key
MINIMAX_GROUP_ID=your_group_id
MINIMAX_MODEL=speech-02-turbo
MINIMAX_VOICE_ID=Lovely_Girl

# OpenClaw backend
OPENCLAW_PORT=18789
OPENCLAW_TOKEN=your_token
```

### Installation & Running

```bash
# Install dependencies
npm install

# Start in production mode
npm start

# Start in development mode (opens DevTools)
npm run dev
```

### Building

```bash
# Build for macOS (universal: DMG + ZIP)
npm run build

# Build DMG only
npm run build:dmg
```

### Usage

1. **Voice Chat**: Tap the character to start recording; speech is auto-recognized and sent to AI
2. **Text Input**: Type directly in the input box at the bottom
3. **Interrupt**: Tap the character during playback to stop and view the full response
4. **Switch Characters**: Open the character panel to choose a different assistant
5. **Change Voice**: Pick from 30 voice presets
6. **Mini Mode**: Minimize to a floating bubble; single-click to listen, double-click to restore
7. **Background Tasks**: Say "tell me later" and get a system notification when done
8. **Drag Window**: Drag anywhere on the window (except button areas)

### Tech Stack

| Component | Technology | Description |
|---|---|---|
| Desktop | Electron 28 | Cross-platform desktop app |
| STT | Deepgram nova-2 | WebSocket real-time transcription |
| TTS | MiniMax speech-02-turbo | REST API, MP3 32kHz |
| AI Backend | OpenClaw | WebSocket streaming chat |
| Frontend | Vanilla HTML/CSS/JS | No framework dependencies |
| Animation | Canvas 2D | Particle system + ripple effects |

### Notes

- Microphone permission is required for speech recognition
- Valid Deepgram, MiniMax, and OpenClaw API keys are needed
- Currently tested on macOS only

### Roadmap

- [ ] Add more characters (Cat, Robot — video assets in progress)
- [ ] Proactive reminders
- [ ] Multi-language speech recognition switching
- [ ] Custom character avatar uploads
- [ ] Windows platform support
