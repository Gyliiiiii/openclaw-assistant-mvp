# OpenClaw Channel 集成方案

## 当前状态

桌面助手正在从 WebSocket 直连架构迁移到 **MQTT Channel 架构**，与 Telegram/Discord 等通道平级。

### 架构演进

```
Phase 1-3（Legacy）:
  Electron App  ──WebSocket──>  OpenClaw Gateway (端口 18789)

Phase 4（MQTT Channel）:
  Electron App  ──MQTT──>  Broker  <──MQTT──  Gateway Desktop Channel Plugin
```

### MQTT 三层架构

```
┌─────────────────┐     ┌──────────────────┐     ┌──────────────────────────┐
│  Electron App   │     │   MQTT Broker    │     │  OpenClaw Gateway        │
│                 │     │                  │     │                          │
│  - 语音识别 STT  │────>│  inbound topic   │────>│  Desktop Channel Plugin  │
│  - TTS 播放     │     │                  │     │    ├── resolveAgentRoute  │
│  - UI 渲染      │<────│  outbound topic  │<────│    ├── 调用 Agent          │
│  - 工具执行     │<────│  control topic   │<────│    └── 流式回复            │
└─────────────────┘     └──────────────────┘     └──────────────────────────┘
```

与 Telegram 对比：
```
Telegram:  用户 → Telegram App → Telegram 服务器 ← Gateway(grammy) → Agent
Desktop:   用户 → Electron App → MQTT Broker    ← Gateway(mqtt)   → Agent
```

---

## Legacy: Phase 1-3（WebSocket 直连）

> **状态**: 已完成，将在 Phase 4 中被替换。以下记录保留作为历史参考。

### Phase 1: `chat.send` → `agent` 方法 ✅ (Legacy)

**改动文件**: `electron/main.js`

- `chatWithOpenClaw()` 使用 `method: 'agent'` 发送请求
- 请求参数: `{ message, sessionKey, idempotencyKey }`
- 接收 `res` 帧 `status: 'accepted'` 作为接受确认，提取 `runId`
- 监听 `agent` 事件的 `stream` 字段分发处理
- 移除了 `chat.send` 旧协议代码和兼容逻辑

### Phase 2: 动态 sessionKey ✅ (Legacy)

**改动文件**: `electron/main.js`

- Channel ID: `desktop`
- `getSessionKey()` 生成 `agent:main:desktop:dm:local`
- 替换了硬编码的 `agent:main:main`

### Phase 3: `agent.abort` 中止能力 ✅ (Legacy)

**改动文件**: `electron/main.js`、`electron/preload.js`、`public/app.js`

- `abortCurrentAgent()` 发送 `agent.abort` 请求，fire-and-forget 模式
- `tts:stop` IPC handler 自动触发 abort
- `interruptTTS()` 实现 "双中断"：本地 TTS 停止 + 后端生成停止
- `currentAgentRunId` 追踪当前执行，完成/超时/中止时清空

---

## Phase 4: MQTT Channel 通信 🚧

**状态**: 待实施

将 Electron 与 Gateway 之间的 WebSocket 直连替换为 MQTT Broker 中转，使桌面助手成为与 Telegram 平级的标准 Channel。

详细方案见：[DESKTOP-CHANNEL-PLUGIN.md](DESKTOP-CHANNEL-PLUGIN.md)

### 核心改动

1. **Gateway 侧**：新建 `extensions/desktop/` Channel Plugin，MQTT 长驻服务
2. **Electron 侧**：移除 WebSocket 直连，改用 MQTT 客户端
3. **通信协议**：从 WebSocket req/res/event 改为 MQTT pub/sub（inbound/outbound/control）

### Topic 设计

```
openclaw/desktop/{deviceId}/inbound     # Electron → Gateway（用户消息）
openclaw/desktop/{deviceId}/outbound    # Gateway → Electron（流式回复 + 完整回复）
openclaw/desktop/{deviceId}/control     # 双向（abort、工具事件、状态）
```

### 消息格式

| 方向 | type | 说明 |
|------|------|------|
| inbound | `message` | 用户消息 `{ id, text, timestamp }` |
| outbound | `stream` | 流式文本块 `{ replyTo, chunk, seq, done }` |
| outbound | `reply` | 完整回复 `{ replyTo, text, timestamp }` |
| control | `abort` | 中止生成 `{ replyTo }` |
| control | `tool` | 工具事件 `{ tool, params }` |
| control | `status` | 状态上报 `{ status, deviceId, timestamp }` |

### 环境变量变更

**新增**:
```bash
MQTT_BROKER_URL=mqtt://broker.emqx.io:1883
MQTT_DEVICE_ID=desktop-001
MQTT_USERNAME=（可选）
MQTT_PASSWORD=（可选）
```

**移除**:
```bash
OPENCLAW_PORT=18789
OPENCLAW_GATEWAY_TOKEN=your_token
```

---

## Legacy 协议格式（WebSocket 直连，供参考）

<details>
<summary>展开查看 WebSocket 协议细节</summary>

### 请求

```json
{
  "type": "req",
  "id": "agent-1",
  "method": "agent",
  "params": {
    "message": "用户消息",
    "sessionKey": "agent:main:desktop:dm:local",
    "idempotencyKey": "agent-1771121607164-xxx"
  }
}
```

### 响应流程

**1. 接受确认 (`res` 帧)**
```json
{
  "type": "res",
  "id": "agent-1",
  "ok": true,
  "payload": {
    "runId": "agent-1771121607164-mqss37pon",
    "status": "accepted",
    "acceptedAt": 1771121608082
  }
}
```

**2. Agent 流式事件**
```json
{
  "type": "event",
  "event": "agent",
  "payload": {
    "runId": "agent-xxx",
    "stream": "lifecycle",
    "data": { "phase": "end", "endedAt": 1771121833221 },
    "sessionKey": "agent:main:desktop:dm:local",
    "seq": 25
  }
}
```

Agent 事件 `stream` 类型：
| stream | 说明 | data 格式 |
|--------|------|-----------|
| `text` / `content` | 流式文本块 | `string` |
| `lifecycle` | 生命周期 | `{ phase: "start" \| "end" }` |
| `tool` | 工具调用 | 工具调用详情对象 |

**3. Chat Final 事件（完整回复）**
```json
{
  "type": "event",
  "event": "chat",
  "payload": {
    "runId": "agent-xxx",
    "sessionKey": "agent:main:desktop:dm:local",
    "state": "final",
    "message": {
      "role": "assistant",
      "content": [{ "type": "text", "text": "AI 完整回复文本" }],
      "timestamp": 1771121833253
    }
  }
}
```

### 中止请求

```json
{
  "type": "req",
  "id": "abort-1",
  "method": "agent.abort",
  "params": { "runId": "agent-xxx" }
}
```

### 文本提取优先级

1. **agent `stream: text/content` 事件** — 流式累积（支持逐句 TTS）
2. **agent `lifecycle end`** — 如果已有累积文本，立即完成
3. **chat `state: final` 事件** — 从 `message.content[0].text` 提取完整文本
4. **res payload** — 非 accepted 的 res 帧中提取

</details>

---

## 文件改动清单

### Phase 1-3 (Legacy, 已完成)

| 文件 | 改动量 | 状态 |
|------|--------|------|
| `electron/main.js` | 大（重写 chatWithOpenClaw，新增 abort） | ✅ 已完成 |
| `electron/preload.js` | 小（+1 行 abortAgent API） | ✅ 已完成 |
| `public/app.js` | 小（+1 行 abort 调用） | ✅ 已完成 |
| `CLAUDE.md` | 中（更新架构文档） | ✅ 已完成 |

### Phase 4 (MQTT Channel)

| 文件 | 操作 | 说明 |
|------|------|------|
| `extensions/desktop/` (OpenClaw 项目) | 新建 | Channel Plugin（channel.ts + mqtt-service.ts + plugin.ts） |
| `electron/main.js` | 重写通信层 | 移除 WebSocket 直连，新增 MQTT 客户端 |
| `electron/preload.js` | 小改 | 移除 WebSocket 相关 IPC（如需） |
| `.env.example` | 更新 | 新增 MQTT 变量，移除 OPENCLAW_PORT/TOKEN |
| `package.json` | 更新 | 移除 `ws`，新增 `mqtt` |
| `CLAUDE.md` | 更新 | 架构文档同步 |

---

## 验证清单

### Phase 1-3 (Legacy) ✅

- [x] `agent` 方法调用成功，控制台显示 `[OpenClaw] 事件: agent`
- [x] 获取到 `runId`，控制台显示 `[OpenClaw] agent 已接受, runId: xxx`
- [x] sessionKey 为 `agent:main:desktop:dm:local`
- [x] TTS 逐句播放正常
- [x] 打断时发送 `agent.abort`
- [x] `chat.send` 旧代码已移除

### Phase 4 (MQTT Channel) 🚧

- [ ] MQTT Broker 搭建完成（本地 Mosquitto 或 EMQX Cloud）
- [ ] Gateway Desktop Channel Plugin 加载成功
- [ ] Electron 连接 MQTT Broker 成功
- [ ] 端到端消息收发：inbound → Agent → outbound stream/reply
- [ ] 流式文本正确驱动 SentenceSplitter → TTS 逐句播放
- [ ] abort 通过 control topic 中止 Agent 生成
- [ ] `desktop_notify` 工具事件触发系统通知
- [ ] `open_finder` 工具事件打开 Finder
- [ ] `desktop_clipboard` 工具事件写入剪贴板
- [ ] 通道状态上报：启动时 online，退出时 offline
- [ ] agentPrompt 口语化风格生效
- [ ] 已有功能不受影响：STT、TTS、打断、追问、角色切换、窗口模式
