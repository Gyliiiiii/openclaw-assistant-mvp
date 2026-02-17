# Desktop Channel Plugin 开发方案（MQTT 架构）

## 概述

将 OpenClaw 桌面助手改造为标准 Channel 架构：Electron App 和 Gateway Channel Plugin 各自连接 MQTT Broker 进行消息中转，与 Telegram/Discord 等通道平级。

**核心变化**：Electron 不再直连 Gateway WebSocket，而是通过 MQTT Broker 间接通信——与 Telegram Bot 通过 Telegram 服务器中转的模式完全一致。

---

## 架构总览

```
用户 → Electron App → MQTT Broker ← Gateway Desktop Channel Plugin → Agent → 回复 → MQTT → Electron
```

### 与 Telegram 对比

```
Telegram:  用户 → Telegram App → Telegram 服务器 ← Gateway(grammy) → Agent
Desktop:   用户 → Electron App → MQTT Broker    ← Gateway(mqtt)   → Agent
```

| 维度 | Telegram Channel | Desktop Channel |
|------|-----------------|-----------------|
| 传输层 | Telegram Bot API (HTTP polling/webhook) | MQTT Broker (pub/sub) |
| 客户端 SDK | grammy | mqtt.js |
| 消息中转 | Telegram 服务器 | MQTT Broker |
| 认证方式 | Bot Token | MQTT credentials + deviceId |
| 流式支持 | 编辑消息模拟 | 原生流式 topic |
| 部署依赖 | Telegram 公网 | Broker 可本地/云端 |

### 三层架构

```
┌─────────────────┐     ┌──────────────────┐     ┌──────────────────────────┐
│  Electron App   │     │   MQTT Broker    │     │  OpenClaw Gateway        │
│                 │     │                  │     │                          │
│  - 语音识别 STT  │────>│  inbound topic   │────>│  Desktop Channel Plugin  │
│  - TTS 播放     │     │                  │     │    ├── 解析消息            │
│  - UI 渲染      │<────│  outbound topic  │<────│    ├── resolveAgentRoute  │
│  - 工具执行     │<────│  control topic   │<────│    ├── 调用 Agent          │
│                 │────>│                  │────>│    └── 流式回复            │
└─────────────────┘     └──────────────────┘     └──────────────────────────┘
```

---

## MQTT Broker 选型

| 环境 | 方案 | 说明 |
|------|------|------|
| 开发 | 本地 Mosquitto | `brew install mosquitto && mosquitto` |
| 开发 | `test.mosquitto.org` | 免费公共 broker，无需部署，仅限测试 |
| 生产 | EMQX Cloud 免费版 | 1M session min/月，支持 TLS |
| 备选 | HiveMQ Cloud 免费版 | 100 连接，支持 WebSocket |

开发阶段建议使用本地 Mosquitto，可完全离线调试。

---

## Topic 设计

```
openclaw/desktop/{deviceId}/inbound     # Electron → Gateway（用户消息）
openclaw/desktop/{deviceId}/outbound    # Gateway → Electron（完整回复 + 流式文本块）
openclaw/desktop/{deviceId}/control     # 双向（abort、工具事件、状态）
```

- `{deviceId}` 标识设备实例，如 `desktop-001`，支持多设备并行
- Gateway 使用通配符 `openclaw/desktop/+/inbound` 订阅所有设备

### Topic 权限矩阵

| 角色 | inbound | outbound | control |
|------|---------|----------|---------|
| Electron App | publish | subscribe | publish + subscribe |
| Gateway Plugin | subscribe (通配符) | publish | publish + subscribe |

---

## 消息格式（JSON）

### inbound — 用户消息（Electron → Gateway）

```json
{
  "type": "message",
  "id": "msg-1739612345678-abc",
  "text": "今天北京天气怎么样",
  "timestamp": 1739612345678
}
```

### outbound — 流式文本块（Gateway → Electron）

```json
{
  "type": "stream",
  "replyTo": "msg-1739612345678-abc",
  "chunk": "北京今天晴转多云。",
  "seq": 1,
  "done": false
}
```

`done: true` 表示流式传输结束，后续紧跟 `reply` 消息。

### outbound — 完整回复（Gateway → Electron）

```json
{
  "type": "reply",
  "replyTo": "msg-1739612345678-abc",
  "text": "北京今天晴转多云。最高温度十五度，最低三度。建议穿件外套出门哦。",
  "timestamp": 1739612350000
}
```

### control — 中止生成（Electron → Gateway）

```json
{
  "type": "abort",
  "replyTo": "msg-1739612345678-abc"
}
```

### control — 工具事件（Gateway → Electron）

```json
{
  "type": "tool",
  "tool": "desktop_notify",
  "params": {
    "title": "任务完成",
    "body": "你要求查询的资料已经整理好了",
    "silent": false
  }
}
```

支持的工具事件：

| tool | 说明 | params |
|------|------|--------|
| `desktop_notify` | 系统通知 | `{ title, body, silent? }` |
| `open_finder` | 打开 Finder | `{ path }` |
| `desktop_clipboard` | 写入剪贴板 | `{ text }` |

### control — 状态上报（双向）

```json
{
  "type": "status",
  "status": "online",
  "deviceId": "desktop-001",
  "timestamp": 1739612345678
}
```

状态值：`online` | `offline` | `away`

---

## Gateway 侧 Channel Plugin 实现

### 目录结构

```
openclaw/                          # OpenClaw 主项目
└── extensions/
    └── desktop/
        ├── package.json
        └── src/
            ├── index.ts           # 统一导出
            ├── channel.ts         # ChannelPlugin 接口实现（capabilities、agentPrompt）
            ├── mqtt-service.ts    # MQTT 长驻连接服务
            └── plugin.ts          # 插件定义（注册 channel + service + tools + hooks）
```

### 依赖

```json
{
  "dependencies": {
    "mqtt": "^5.0.0"
  }
}
```

### MQTT 服务（mqtt-service.ts）

- 通过 `api.registerService()` 注册为长驻服务，Gateway 启动时自动连接 MQTT Broker
- 订阅通配符 topic `openclaw/desktop/+/inbound` 监听所有设备的消息
- 收到 inbound 消息后，提取 `deviceId`，进入标准 channel pipeline：
  1. 解析 `{ type: "message", text }` 格式
  2. 调用 `resolveAgentRoute()` 确定目标 Agent
  3. 调用 Agent，传入 `sessionKey: agent:{agentId}:desktop:dm:{deviceId}`
  4. Agent 流式回复 → 逐 chunk publish 到 `openclaw/desktop/{deviceId}/outbound`
  5. Agent 完成 → publish `{ type: "reply" }` 到 outbound
  6. 工具调用事件 → publish 到 `openclaw/desktop/{deviceId}/control`
- 订阅 `openclaw/desktop/+/control` 处理 abort 请求：
  - 收到 `{ type: "abort" }` → 调用 Agent abort API 中止生成
- 连接管理：
  - MQTT `clean session = false`，支持离线消息缓存
  - QoS 1 确保消息至少送达一次
  - 自动重连（mqtt.js 内建）

### channel.ts — ChannelPlugin 接口

与之前的 channel 定义基本一致，关键字段：

```typescript
export const desktopChannel: ChannelPlugin = {
  id: 'desktop',
  meta: {
    name: 'Desktop Assistant',
    description: 'Electron 桌面语音助手通道（MQTT）',
    icon: 'monitor',
  },
  capabilities: {
    chatTypes: ['dm'],
    media: { audio: true, image: false, video: false, file: false },
    features: { streaming: true, reactions: false, threads: false, edit: false, delete: false }
  },
  agentPrompt: `你正在通过桌面语音助手与用户对话。请遵循以下规则：
- 回复要简短口语化，适合语音播报（每句不超过 30 字）
- 不要使用 markdown 格式（**加粗**、*斜体*、\`代码\`、列表等）
- 使用自然的中文口语表达，像朋友聊天一样
- 如果内容较长，分成多个短句，用句号分隔
- 数字和英文用口语化表达（比如"大约一百五十"而不是"约150"）
- 不要输出 URL 链接，改为口头描述
- 文件路径可以完整输出（桌面端会自动转为可点击链接）`,
};
```

### agentTools — 桌面专属工具

工具定义与之前一致（`desktop_notify`、`open_finder`、`desktop_clipboard`），但 `execute()` 的实现从 WebSocket 事件推送改为 MQTT publish：

```typescript
async execute(params, ctx) {
  // 从 ctx 获取 deviceId，publish 到对应设备的 control topic
  await mqttClient.publish(
    `openclaw/desktop/${ctx.deviceId}/control`,
    JSON.stringify({ type: 'tool', tool: 'desktop_notify', params })
  );
  return { success: true, message: `已发送通知: ${params.title}` };
}
```

### hooks

- `agent:beforeSend` hook 自动清理 markdown 格式（与之前一致）

---

## Electron 侧改动

### 新增依赖

```bash
npm install mqtt
```

### 新增环境变量

```bash
# MQTT Broker
MQTT_BROKER_URL=mqtt://broker.emqx.io:1883
MQTT_DEVICE_ID=desktop-001
# 可选认证
MQTT_USERNAME=
MQTT_PASSWORD=
```

### 移除

| 移除项 | 说明 |
|--------|------|
| `connectOpenClaw()` | WebSocket 直连 Gateway |
| `openclawRequest()` | WebSocket 请求封装 |
| `chatWithOpenClaw()` | WebSocket agent 调用 |
| `abortCurrentAgent()` | WebSocket agent.abort |
| `channelLogin()` / `channelLogout()` | WebSocket 认证 |
| `OPENCLAW_PORT` 环境变量 | Gateway 端口 |
| `OPENCLAW_GATEWAY_TOKEN` 环境变量 | operator token |
| `ws` npm 依赖 | WebSocket 客户端 |

### 新增 MQTT 连接管理

```javascript
const mqtt = require('mqtt');

let mqttClient = null;
const DEVICE_ID = process.env.MQTT_DEVICE_ID || `desktop-${Date.now()}`;
const TOPICS = {
  inbound:  `openclaw/desktop/${DEVICE_ID}/inbound`,
  outbound: `openclaw/desktop/${DEVICE_ID}/outbound`,
  control:  `openclaw/desktop/${DEVICE_ID}/control`,
};

function connectMQTT() {
  mqttClient = mqtt.connect(process.env.MQTT_BROKER_URL, {
    clientId: `openclaw-desktop-${DEVICE_ID}`,
    username: process.env.MQTT_USERNAME || undefined,
    password: process.env.MQTT_PASSWORD || undefined,
    clean: false,  // 支持离线消息
  });

  mqttClient.on('connect', () => {
    console.log('[MQTT] Connected to broker');
    mqttClient.subscribe([TOPICS.outbound, TOPICS.control], { qos: 1 });
    // 上报在线状态
    mqttClient.publish(TOPICS.control, JSON.stringify({
      type: 'status', status: 'online', deviceId: DEVICE_ID, timestamp: Date.now()
    }));
  });

  mqttClient.on('message', (topic, message) => {
    const data = JSON.parse(message.toString());
    if (topic === TOPICS.outbound) {
      handleOutbound(data);
    } else if (topic === TOPICS.control) {
      handleControl(data);
    }
  });

  mqttClient.on('error', (err) => console.error('[MQTT] Error:', err));
}
```

### 新增 chatWithOpenClaw（基于 MQTT）

```javascript
function chatWithOpenClaw(text) {
  const msgId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  currentMessageId = msgId;

  mqttClient.publish(TOPICS.inbound, JSON.stringify({
    type: 'message',
    id: msgId,
    text: text,
    timestamp: Date.now()
  }), { qos: 1 });

  return msgId;
}
```

### 新增 outbound 处理

```javascript
function handleOutbound(data) {
  if (data.type === 'stream') {
    // 流式文本块 → SentenceSplitter → TTSQueueManager
    onStreamChunk(data.chunk, data.done);
  } else if (data.type === 'reply') {
    // 完整回复 → 保存全文用于"查看完整回复"
    onReplyComplete(data.text);
  }
}
```

### 新增 abort（基于 MQTT）

```javascript
function abortCurrentAgent() {
  if (currentMessageId) {
    mqttClient.publish(TOPICS.control, JSON.stringify({
      type: 'abort',
      replyTo: currentMessageId
    }), { qos: 1 });
    currentMessageId = null;
  }
}
```

### 新增 control 处理（工具事件）

```javascript
function handleControl(data) {
  if (data.type === 'tool') {
    switch (data.tool) {
      case 'desktop_notify':
        if (Notification.isSupported()) {
          new Notification({ title: data.params.title, body: data.params.body, silent: data.params.silent }).show();
        }
        break;
      case 'open_finder':
        shell.showItemInFolder(data.params.path);
        break;
      case 'desktop_clipboard':
        require('electron').clipboard.writeText(data.params.text);
        break;
    }
  }
}
```

### 保留不变

- Deepgram STT（语音识别）
- MiniMax TTS（语音合成）
- SentenceSplitter（句子分割）
- TTSQueueManager（TTS 队列管理）
- TaskManager（异步任务）
- 窗口管理（全屏/迷你模式）
- UI 渲染、状态机、角色系统

---

## 环境变量配置

### 新增

```bash
# MQTT Broker
MQTT_BROKER_URL=mqtt://broker.emqx.io:1883   # 或 mqtt://localhost:1883
MQTT_DEVICE_ID=desktop-001                     # 设备唯一标识
MQTT_USERNAME=                                 # 可选
MQTT_PASSWORD=                                 # 可选
```

### 移除

```bash
# 以下不再需要
# OPENCLAW_PORT=18789
# OPENCLAW_GATEWAY_TOKEN=your_token
```

---

## 开发步骤

### Step 1: 搭建 MQTT Broker

```bash
# macOS 本地安装
brew install mosquitto
# 启动（前台运行，便于观察日志）
mosquitto -v
# 默认监听 localhost:1883
```

验证：用 `mosquitto_sub` 和 `mosquitto_pub` 命令行工具测试收发。

### Step 2: Gateway 侧实现 Channel Plugin

1. 在 OpenClaw 项目创建 `extensions/desktop/` 目录
2. 实现 `mqtt-service.ts`：连接 Broker，订阅 `+/inbound`，处理消息
3. 实现 `channel.ts`：capabilities、agentPrompt
4. 实现 `plugin.ts`：注册 channel + service + tools + hooks
5. 在 `openclaw.json` 中注册扩展并配置 MQTT 连接信息
6. 启动 Gateway，验证日志：`[Desktop Channel] MQTT connected, subscribing to openclaw/desktop/+/inbound`

### Step 3: Electron 侧替换通信层

1. `npm install mqtt` 添加依赖
2. 新增 MQTT 连接管理代码（connect、subscribe、publish）
3. 新增基于 MQTT 的 `chatWithOpenClaw()`
4. 新增基于 MQTT 的 `abortCurrentAgent()`
5. 新增 outbound/control 消息处理
6. 移除 WebSocket 直连代码和相关环境变量
7. 更新 `.env.example`

### Step 4: 联调测试

1. 启动 Mosquitto（本地）
2. 启动 Gateway（加载 Desktop Channel Plugin）
3. 启动 Electron App
4. 端到端测试：语音输入 → MQTT → Agent → MQTT → TTS 播放

---

## 验证清单

### Broker 连接
- [ ] Electron App 连接 MQTT Broker 成功，日志显示 `[MQTT] Connected to broker`
- [ ] Gateway Plugin 连接 MQTT Broker 成功，订阅通配符 topic
- [ ] 断线自动重连正常

### 消息收发
- [ ] Electron publish inbound → Gateway 收到并解析
- [ ] Gateway publish outbound stream → Electron 收到流式文本块
- [ ] Gateway publish outbound reply → Electron 收到完整回复
- [ ] 流式文本正确驱动 SentenceSplitter → TTS 逐句播放

### 中止与工具
- [ ] Electron publish abort → Gateway 中止 Agent 生成
- [ ] 打断 TTS 时自动 publish abort（双中断保留）
- [ ] `desktop_notify` 工具事件通过 control topic 触发系统通知
- [ ] `open_finder` 工具事件打开 Finder
- [ ] `desktop_clipboard` 工具事件写入剪贴板

### 状态与兼容
- [ ] Electron 启动时上报 `online` 状态
- [ ] Electron 退出时上报 `offline` 状态
- [ ] AI 回复风格为口语化短句（agentPrompt 生效）
- [ ] 已有功能不受影响：STT、TTS、打断、追问、角色切换、窗口模式

---

## 风险与注意事项

| 风险 | 缓解措施 |
|------|----------|
| MQTT Broker 单点故障 | 生产环境使用 EMQX Cloud 集群；开发环境可退回本地 Mosquitto |
| 消息丢失 | QoS 1 + clean session false 确保离线消息缓存 |
| 安全性（公网 Broker） | 生产环境启用 TLS + 用户名密码认证；topic 按 deviceId 隔离 |
| 多设备 deviceId 冲突 | 默认使用时间戳生成，也可由用户指定固定 ID |
| 消息乱序 | outbound stream 带 `seq` 序号，Electron 侧按序处理 |
| Plugin 加载失败 | Gateway 应 graceful degradation，不影响其他 channel |
