# CLAUDE.md

This file provides guidance for Claude Code (claude.ai/code) when working in this codebase.

## Project Overview

OpenClaw Desktop Assistant MVP — an Electron-based AI voice assistant featuring real-time speech recognition (Deepgram), text-to-speech (MiniMax), and integration with the Clawdbot AI backend via OpenClaw WebSocket.

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

# MiniMax API (text-to-speech / TTS)
# Get key: https://platform.minimaxi.com/
MINIMAX_API_KEY=your_minimax_api_key_here
MINIMAX_GROUP_ID=your_minimax_group_id_here
MINIMAX_MODEL=speech-02-turbo
MINIMAX_VOICE_ID=Lovely_Girl

# OpenClaw Gateway
OPENCLAW_PORT=18789
OPENCLAW_GATEWAY_TOKEN=your_openclaw_gateway_token_here
```

Copy `.env.example` to `.env` and fill in your API keys.

## Architecture

### Core Components

**Electron Main Process** (`electron/main.js`)
- Window management (full mode and mini floating bubble mode)
- Deepgram Live API STT integration with persistent WebSocket connection
- MiniMax TTS streaming sentence-by-sentence synthesis (REST API)
- OpenClaw WebSocket client for AI conversations
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
- Exposed APIs: deepgram (STT + streaming TTS events), tts (voice config), task, file, window

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

**WebSocket Protocol**
1. Connect → receive `connect.challenge` event
2. Send `connect` request for token authentication
3. Send `chat.send` request with sessionKey and idempotencyKey
4. Receive streaming `chat` events with text chunks
5. Detect completion via `state: 'final'` or `done: true`
6. 180-second timeout for complex operations (searches, tool calls)

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
- `ws` v8.19.0 — WebSocket client for OpenClaw Gateway

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
- `[OpenClaw]`: AI backend communication
- `[龙虾助手]`: Frontend application events
- `[TaskManager]`: Async task queue operations

### Handling Interruptions

Users can interrupt TTS playback by:
- Clicking the character during `speaking` state
- Clicking the mini floating bubble during playback

Interruption flow:
1. Call `interruptTTS()` to stop audio and clear the queue
2. Display "Interrupted" bubble with a button to view the full response
3. Transition to `listening` state
4. Immediately start recording

## Key Timing Configurations

| Parameter | Value | Description |
|---|---|---|
| FOLLOWUP_TIMEOUT | 30,000ms | Wait for follow-up after TTS ends |
| BUBBLE_AUTO_HIDE | 12,000ms | Auto-hide speech bubble |
| EXECUTE_DELAY | 3,000ms | Delay before executing after voice ends |
| Deepgram Connect Timeout | 10,000ms | Initial connection timeout |
| Deepgram Keep-Alive | 8,000ms | Heartbeat interval |
| OpenClaw Default Timeout | 30,000ms | Standard request timeout |
| OpenClaw Chat Timeout | 180,000ms | Complex operations (search, tools) |

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
- [ ] OpenClaw connection auto-reconnects on loss
- [ ] Chinese speech recognition works correctly (zh-CN)
