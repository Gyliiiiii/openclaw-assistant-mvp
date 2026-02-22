# CLAUDE.md

This file provides guidance for Claude Code (claude.ai/code) when working in this codebase.

## 语言偏好

总是用中文回复。

## Project Overview

OpenClaw Desktop Assistant MVP — an Electron-based AI voice assistant featuring real-time speech recognition (Deepgram), text-to-speech (MiniMax/ElevenLabs), and integration with the Clawdbot AI backend via MQTT.

## Development Commands

### Running the App
```bash
# Start in production mode
npm start

# Start in development mode (opens DevTools)
npm run dev
```

### Building
```bash
# Build for macOS (universal binary: x64 + arm64)
npm run build

# Build DMG installer only
npm run build:dmg
```

## Environment Configuration

Required environment variables in the `.env` file:

```bash
# Deepgram API (speech recognition / STT)
# Get key: https://console.deepgram.com/
DEEPGRAM_API_KEY=your_deepgram_api_key_here
DEEPGRAM_MODEL=nova-2
# Options: nova-2 (supports Chinese) | nova-3 (English only, lower latency)
DEEPGRAM_LANGUAGE=zh-CN
# Options: zh-CN (Chinese) | en-US (English) | other language codes

# TTS Provider Selection
TTS_PROVIDER=minimax
# Options: minimax | elevenlabs

# MiniMax TTS (text-to-speech)
# Get key: https://platform.minimaxi.com/
MINIMAX_API_KEY=your_minimax_api_key_here
MINIMAX_GROUP_ID=your_minimax_group_id_here
MINIMAX_MODEL=speech-02-turbo
MINIMAX_VOICE_ID=Lovely_Girl

# ElevenLabs TTS (text-to-speech)
# Get key: https://elevenlabs.io/
ELEVENLABS_API_KEY=your_elevenlabs_api_key_here
ELEVENLABS_VOICE_ID=pNInz6obpgDQGcFmaJgB

# MQTT Broker
MQTT_BROKER_URL=mqtt://localhost:1883
MQTT_DEVICE_ID=desktop-001
MQTT_USERNAME=
MQTT_PASSWORD=
```

**生产环境（EMQX Cloud Serverless）：**
```bash
MQTT_BROKER_URL=wss://your-address.emqxsl.com:8084/mqtt
MQTT_DEVICE_ID=desktop-001
MQTT_USERNAME=your_username
MQTT_PASSWORD=your_password
```

EMQX Cloud Serverless 特点：
- 免费额度：每月 100 万会话分钟 + 1GB 流量（永久免费）
- 仅支持 WebSocket over TLS（`wss://` 端口 8084）
- 强制 TLS + 用户名密码认证
- mqtt.js 原生支持，无需额外依赖

Copy `.env.example` to `.env` and fill in your API keys.

## Architecture

### Core Components

**Electron Main Process** (`electron/main.js`)
- Window management (full mode and mini floating bubble mode)
- Deepgram Live API STT integration with persistent WebSocket connection (Nova-3)
- Dual TTS support: MiniMax and ElevenLabs (switchable via TTS_PROVIDER)
- MQTT client for OpenClaw Gateway communication (pub/sub)
- Task queue manager for async operations (TaskManager class)
- SentenceSplitter class for real-time text chunking
- TTSQueueManager class for audio queue management
- File system operations (reveal in Finder)

**Renderer Process** (`public/app.js`)
- State machine: welcome → idle → listening → thinking → speaking → followup → goodbye
- Character system supporting multiple characters (Lobster, Amy, Cat, Robot)
- Audio capture using AudioWorklet (`audio-processor.js`)
- Real-time transcription display with 3-second delayed execution
- Streaming TTS audio queue management
- Speech interruption handling
- Aura/orb animation engine (`orb.js`) with particle system and ripple effects

**Preload Script** (`electron/preload.js`)
- Secure IPC bridge using contextBridge
- Exposed APIs: deepgram (STT + streaming TTS events), tts (voice config), task, file, window, abortAgent

### Key Architectural Patterns

**Persistent WebSocket Connection (Deepgram)**
- Deepgram Live API connection kept alive via 8-second keep-alive heartbeat
- Connection reused across multiple listening sessions
- `isListeningActive` flag controls when transcriptions are processed
- Disconnects only on app shutdown, not between conversations
- 10-second connection timeout for initial setup

**Streaming TTS Pipeline**
```
AI Response → SentenceSplitter → TTSQueueManager → MiniMax API → Audio Chunks → Sequential Playback
```
- Sentences extracted in real time as the AI streams its response
- Each sentence synthesized independently via MiniMax REST API
- Audio chunks (MP3, base64-encoded) sent to renderer via `tts:audioChunk` IPC events
- Audio chunks played back seamlessly in sequence
- First sentence triggers state transition to 'speaking'

**State Management**
- `appState` controls UI, animations, and video playback
- `isProcessing` prevents concurrent command execution
- `isSpeaking` tracks TTS playback state
- `accumulatedTranscript` buffers speech recognition results

**Character System**
- Each character includes: videos, auraColors, thinkingPrompts, defaultVoice
- Video source switches based on state (welcome, idle, listening, thinking, speaking)
- Some videos play with audio (welcome, thinking), others are muted
- Switching characters triggers welcome video replay
- Currently only `lobster` and `amy` have video assets; `cat` and `robot` are placeholders

### Audio Processing

**Speech Recognition Pipeline (Deepgram)**
```
Microphone → AudioContext (16kHz) → AudioWorklet → IPC → Deepgram Live API → Transcription Events
```

**Key Parameters**
- Model: `nova-2`
- Language: `zh-CN`
- Sample rate: 16kHz mono PCM (linear16)
- Interim results: enabled
- Utterance end timeout: 1200ms
- VAD events: enabled
- Endpointing: 300ms
- End-of-speech detection: `UtteranceEnd` event

**TTS Synthesis (MiniMax)**
- MiniMax TTS REST API (`speech-02-turbo` model)
- Endpoint: `https://api.minimax.io/v1/t2a_v2?GroupId=${MINIMAX_GROUP_ID}`
- Output format: MP3, 32kHz, 128kbit/s
- Hex-encoded audio in API response, converted to base64 for IPC transport
- Configurable voice_id, speed, volume, pitch
- Language boost: Chinese

### Task Management

**Async Task System**
- Users can say "tell me later" to create background tasks
- Tasks are queued and processed sequentially via TaskManager class
- Task states: pending → running → completed/failed
- System notifications triggered on completion
- Task results sent via IPC events: `task-completed`, `task-failed`

**Sync vs. Async Detection**
```javascript
const asyncKeywords = ['稍后', '待会', '查完告诉我', '完成后告诉我'];
const isAsyncTask = asyncKeywords.some(keyword => command.includes(keyword));
```

### OpenClaw Integration

**MQTT Protocol**
1. Electron connects to MQTT Broker on startup (supports `mqtt://`, `mqtts://`, `wss://`)
2. Subscribe to `openclaw/desktop/{deviceId}/outbound` and `openclaw/desktop/{deviceId}/control`
3. User message → publish to `openclaw/desktop/{deviceId}/inbound` as `{ type: "message", id, text, timestamp }`
4. Gateway Channel Plugin receives message, calls Agent
5. Agent streams response → Gateway publishes `{ type: "stream", replyTo, chunk, seq, done }` to outbound
6. Agent completes → Gateway publishes `{ type: "reply", replyTo, text, timestamp }` to outbound
7. Abort → Electron publishes `{ type: "abort", replyTo }` to control topic
8. Tool events → Gateway publishes `{ type: "tool", tool, params }` to control topic

**MQTT Broker 配置**

开发环境（本地 Mosquitto）：
```bash
MQTT_BROKER_URL=mqtt://localhost:1883
MQTT_DEVICE_ID=desktop-001
MQTT_USERNAME=
MQTT_PASSWORD=
```

生产环境（EMQX Cloud Serverless）：
```bash
MQTT_BROKER_URL=wss://your-address.emqxsl.com:8084/mqtt
MQTT_DEVICE_ID=desktop-001
MQTT_USERNAME=your_username
MQTT_PASSWORD=your_password
```

EMQX Cloud Serverless 特点：
- 免费额度：每月 100 万会话分钟 + 1GB 流量（永久免费）
- 仅支持 WebSocket over TLS（`wss://` 端口 8084）
- 强制 TLS + 用户名密码认证
- mqtt.js 原生支持，无需额外依赖

**Gateway 配置**

需要在 `~/.openclaw/openclaw.json` 中配置两处：

1. `channels.desktop` 配置：
```json
"channels": {
  "desktop": {
    "enabled": true,
    "mqttBrokerUrl": "wss://your-address.emqxsl.com:8084/mqtt",
    "mqttDeviceId": "desktop-001",
    "mqttUsername": "your_username",
    "mqttPassword": "your_password"
  }
}
```

2. `plugins.entries.desktop.config` 配置：
```json
"plugins": {
  "entries": {
    "desktop": {
      "enabled": true,
      "config": {
        "mqttBrokerUrl": "wss://your-address.emqxsl.com:8084/mqtt",
        "mqttDeviceId": "desktop-001",
        "mqttUsername": "your_username",
        "mqttPassword": "your_password"
      }
    }
  }
}
```

修改配置后需要重启 Gateway：
```bash
openclaw gateway restart
```

**MQTT Topics**
```
openclaw/mqtt/{deviceId}/inbound     # Electron → Gateway（用户消息）
openclaw/mqtt/{deviceId}/outbound    # Gateway → Electron（流式文本块 + 完整回复）
openclaw/mqtt/{deviceId}/control     # 双向（abort、工具事件、状态）
```

**Message Formats**
- inbound: `{ type: "message", id, text, timestamp }`
- outbound stream: `{ type: "stream", replyTo, chunk, seq, done }`
- outbound reply: `{ type: "reply", replyTo, text, timestamp }`
- control abort: `{ type: "abort", replyTo }`
- control tool: `{ type: "tool", tool, params }`
- control status: `{ type: "status", status, deviceId, timestamp }`

**Abort (中止生成)**
- 用户打断 TTS 时自动触发 "双中断"：本地 TTS 停止 + publish abort 到 control topic
- `interruptTTS()` → `tts.stop()` → `abortCurrentAgent()` publish abort 消息
- `currentMessageId` 追踪当前消息，完成/超时/中止时清空

**Sentence Splitting for Streaming TTS**
- SentenceSplitter class with regex: `/[。！？.!?]\s*/g`
- Buffers partial sentences until a delimiter is found
- Call `finish()` to flush remaining text
- Each sentence immediately enqueued for TTS synthesis via TTSQueueManager

### Window Modes

**Full Mode** (330x550px)
- Full UI with character video, control buttons, text input
- Draggable, always-on-top, transparent background
- Minimum size: 200x300px

**Mini Mode** (64x64px floating bubble)
- Minimized circular video display
- Single click: start/stop listening
- Double click: restore full mode
- Positioned at bottom-right corner of screen
- Position memory for expand/minimize transitions

### File Path Detection

Text containing file paths (e.g., `~/Documents/file.txt`, `/Users/...`) is automatically converted to clickable links that open in Finder via `shell.showItemInFolder()`. Tilde (`~`) is expanded to the home directory path.

## Dependencies

**Runtime:**
- `@deepgram/sdk` v4.11.3 — Speech-to-text via Deepgram WebSocket API
- `dotenv` v17.2.4 — Environment variable management
- `node-fetch` v2.7.0 — HTTP client for MiniMax TTS API calls
- `mqtt` ^5.0.0 — MQTT client for OpenClaw Gateway communication

**Dev:**
- `electron` v28.0.0 — Desktop application framework
- `electron-builder` v26.7.0 — Application packaging & distribution

## Common Development Tasks

### Adding a New Character

1. Add character config to `CHARACTER_PROFILES` in `app.js`
2. Provide video files: `{id}-welcome.mp4`, `{id}-idle.mp4`, `{id}-listening.mp4`, `{id}-thinking.mp4`, `{id}-speaking.mp4`
3. Define `auraColors` (RGB values) for each state
4. Set `defaultVoice` from available MiniMax voice IDs
5. Add the character ID to the `availableCharacters` array in `renderCharacterList()`

> **Note:** Currently only `lobster` (5 videos) and `amy` (3 videos: welcome, listening, speaking) have video assets.

### Adding a New Voice Preset

Voice presets are configured in the `VOICE_OPTIONS` array in `app.js`:
```javascript
{
  id: 'Kore',  // Voice ID sent to backend
  icon: 'mdi:icon-name',
  name: 'Kore',
  desc: 'Warm and friendly',
  gender: 'female'
}
```

The frontend currently lists 30 Gemini-style voice names organized in groups (Recommended, Female, Male). The selected voice ID is passed to MiniMax via `tts:setVoice` IPC call.

Available voices: Kore, Puck, Charon, Aoede, Fenrir, Leda, Orus, Callisto, Dione, Elara, Io, Thebe, Himalia, Carme, Ananke, Lysithea, Pasiphae, Sinope, Isonoe, Proteus, Triton, Nereid, Larissa, Galatea, Despina, Thalassa, Naiad, Halimede, Sao, Laomedeia

### Modifying State Transitions

Edit the `setAppState(newState)` function in `app.js`. Key states:
- `welcome`: First launch, plays welcome video with audio
- `idle`: Waiting for user interaction
- `listening`: Recording user speech, shows pulse ring animation
- `thinking`: Processing command (displays random thinking prompts)
- `speaking`: Playing TTS response, shows speech indicator
- `followup`: Waiting for follow-up question (30-second timeout)
- `goodbye`: Farewell animation

### Debugging Speech Recognition

Enable development mode to view console logs:
```bash
npm run dev
```

Key log prefixes:
- `[STT]`: Deepgram speech-to-text events
- `[TTS]`: MiniMax text-to-speech operations
- `[MQTT]`: MQTT broker communication
- `[龙虾助手]`: Frontend application events
- `[TaskManager]`: Async task queue operations

### Handling Interruptions

Users can interrupt TTS playback by:
- Clicking the character during `speaking` state
- Clicking the mini floating bubble during playback

Interruption flow:
1. Call `interruptTTS()` to stop audio and clear the queue
2. Call `abortAgent()` to publish abort message to MQTT control topic (stops AI generation)
3. Display "Interrupted" bubble with a button to view the full response
4. Transition to `listening` state
5. Immediately start recording

## Key Timing Configurations

| Parameter | Value | Description |
|---|---|---|
| FOLLOWUP_TIMEOUT | 30,000ms | Wait for follow-up after TTS ends |
| BUBBLE_AUTO_HIDE | 12,000ms | Auto-hide speech bubble |
| EXECUTE_DELAY | 3,000ms | Delay before executing after voice ends |
| Deepgram Connect Timeout | 10,000ms | Initial connection timeout |
| Deepgram Keep-Alive | 8,000ms | Heartbeat interval |
| MQTT Agent Timeout | 180,000ms | Complex operations (search, tools) |
| MQTT Reconnect | 3,000ms | Auto-reconnect interval |

## Important Implementation Notes

- Do NOT close the Deepgram connection between conversations (use the `isListeningActive` flag instead)
- Always use `escapeHtml()` when displaying user input or AI responses
- Video elements must handle both muted and unmuted playback (fall back to muted when autoplay is blocked)
- `VIDEO_WITH_AUDIO` states are `welcome` and `thinking` — these unmute video for embedded audio
- The SentenceSplitter must call `finish()` to flush any remaining buffer
- TTSQueueManager processes sequentially to maintain sentence order
- File paths in responses are automatically converted to clickable links via `linkifyFilePaths()`
- Markdown formatting (`**bold**`, `*italic*`, `` `code` ``) is stripped from TTS text via `cleanMarkdown()`
- Deepgram audio format: 16kHz mono PCM (linear16), sent as raw buffer
- MiniMax TTS output format: MP3 (32kHz, 128kbit/s), hex-encoded → base64 for IPC
- MQTT client uses `clean: false` for offline message caching and QoS 1 for at-least-once delivery
- On app start, publish `online` status to control topic; on shutdown, publish `offline` status

## Testing Checklist

- [ ] Speech recognition works in both full mode and mini mode
- [ ] Character switching preserves state and plays welcome video
- [ ] Voice preset changes take effect immediately
- [ ] Full response is shown in viewer after interruption
- [ ] File paths in responses are clickable
- [ ] System notification triggered when async tasks complete
- [ ] Window minimize/restore preserves position
- [ ] TTS plays sentences in correct order with no gaps
- [ ] Deepgram connection persists across multiple listening sessions
- [ ] MQTT connection to broker works (connect, subscribe, publish)
- [ ] Agent abort stops backend generation on interruption
- [ ] Chinese speech recognition works correctly (zh-CN)

## V2 Development Roadmap

详细的 V2 版本开发计划请查看 `V2_ROADMAP.md`。

### 核心升级方向

1. **短期（1-2周）**
   - 测试 ElevenLabs TTS vs MiniMax（延迟、音质、成本对比）
   - 升级 Deepgram Nova-3（降低 100-200ms 延迟）

2. **中期（1-2月）**
   - 实时唇形同步头像（D-ID 或 SadTalker）
   - 多语言支持（中英文自动切换）

3. **长期（3-6月）**
   - 主动提醒功能
   - 自定义角色上传
   - Windows 平台支持

详见 `V2_ROADMAP.md` 获取完整技术方案和实施步骤。
