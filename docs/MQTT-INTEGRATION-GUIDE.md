# 通过 MQTT 接入 OpenClaw 开发指南

本指南详细介绍如何开发一个基于 MQTT 协议的客户端应用，接入 OpenClaw Gateway 实现 AI 对话功能。

## 目录

- [概述](#概述)
- [架构设计](#架构设计)
- [前置准备](#前置准备)
- [第一部分：MQTT 客户端开发](#第一部分mqtt-客户端开发)
- [第二部分：OpenClaw Gateway 插件开发](#第二部分openclaw-gateway-插件开发)
- [第三部分：消息协议详解](#第三部分消息协议详解)
- [第四部分：高级功能](#第四部分高级功能)
- [最佳实践](#最佳实践)
- [示例代码](#示例代码)

---

## 概述

### 为什么选择 MQTT

MQTT（Message Queuing Telemetry Transport）是一个轻量级的发布/订阅消息传输协议，特别适合以下场景：

- **IoT 设备**：低带宽、不稳定网络环境
- **实时通信**：双向消息推送
- **解耦架构**：客户端和服务端独立开发
- **多端同步**：一个账号多设备在线

### 适用场景

- 桌面语音助手（如本项目）
- 移动端 AI 助手
- IoT 智能设备（智能音箱、机器人等）
- Web 端实时聊天应用
- 跨平台消息同步

---

## 架构设计

### 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                         MQTT Broker                             │
│                    (EMQX Cloud Serverless)                      │
│                                                                 │
│  Topics:                                                        │
│  - openclaw/mqtt/{deviceId}/inbound   (客户端 → Gateway)        │
│  - openclaw/mqtt/{deviceId}/outbound  (Gateway → 客户端)        │
│  - openclaw/mqtt/{deviceId}/control   (双向控制)                │
└────────────┬───────────────────────────────────┬────────────────┘
             │                                   │
             │ subscribe/publish                 │ subscribe/publish
             │                                   │
    ┌────────▼────────┐                 ┌────────▼────────┐
    │  MQTT 客户端     │                 │  OpenClaw       │
    │                 │                 │  Gateway        │
    │  - Electron     │                 │                 │
    │  - Mobile App   │                 │  + MQTT Plugin  │
    │  - IoT Device   │                 │  + Agent        │
    └─────────────────┘                 └─────────────────┘
```

### 消息流程

```
用户输入 → 客户端 → publish(inbound) → Broker → Gateway 订阅
                                                    ↓
                                              调用 Agent
                                                    ↓
客户端订阅 ← Broker ← publish(outbound) ← Gateway 流式回复
    ↓
显示/播放
```

---

## 前置准备

### 环境要求

- **Node.js**: 18.x 或更高版本
- **MQTT Broker**: EMQX Cloud Serverless（或本地 Mosquitto）
- **OpenClaw Gateway**: 已安装并运行

### 依赖安装

```bash
npm install mqtt dotenv
```

### 获取必要信息

1. **MQTT Broker 地址**：从 EMQX Cloud 控制台获取
2. **认证凭据**：用户名和密码
3. **Device ID**：设备唯一标识符（自定义）

---

## 第一部分：MQTT 客户端开发

### 1.1 基础连接

创建 `mqtt-client.js`：

```javascript
const mqtt = require('mqtt');
require('dotenv').config();

// 配置
const BROKER_URL = process.env.MQTT_BROKER_URL;
const DEVICE_ID = process.env.MQTT_DEVICE_ID || 'my-device-001';
const USERNAME = process.env.MQTT_USERNAME;
const PASSWORD = process.env.MQTT_PASSWORD;

// 连接选项
const options = {
  clientId: `client-${DEVICE_ID}-${Date.now()}`,
  username: USERNAME,
  password: PASSWORD,
  clean: true,           // 清除会话
  reconnectPeriod: 3000, // 自动重连间隔（毫秒）
  connectTimeout: 10000, // 连接超时
};

// 连接到 Broker
const client = mqtt.connect(BROKER_URL, options);

// 连接成功
client.on('connect', () => {
  console.log('[MQTT] 已连接到 Broker');
});

// 连接错误
client.on('error', (err) => {
  console.error('[MQTT] 连接错误:', err.message);
});

// 断开连接
client.on('close', () => {
  console.log('[MQTT] 连接已关闭');
});

module.exports = client;
```

### 1.2 订阅 Topic

```javascript
// Topic 定义
const TOPICS = {
  inbound: `openclaw/mqtt/${DEVICE_ID}/inbound`,
  outbound: `openclaw/mqtt/${DEVICE_ID}/outbound`,
  control: `openclaw/mqtt/${DEVICE_ID}/control`,
};

// 订阅 outbound 和 control
client.on('connect', () => {
  console.log('[MQTT] 已连接到 Broker');

  // 订阅消息
  client.subscribe([TOPICS.outbound, TOPICS.control], { qos: 1 }, (err) => {
    if (err) {
      console.error('[MQTT] 订阅失败:', err);
    } else {
      console.log('[MQTT] 已订阅 outbound 和 control topic');
    }
  });
});
```

### 1.3 发送消息

```javascript
// 发送用户消息到 Gateway
function sendMessage(text) {
  const messageId = `msg-${Date.now()}`;
  const payload = {
    type: 'message',
    id: messageId,
    text: text,
    timestamp: Date.now(),
  };

  client.publish(
    TOPICS.inbound,
    JSON.stringify(payload),
    { qos: 1 },
    (err) => {
      if (err) {
        console.error('[MQTT] 发送失败:', err);
      } else {
        console.log('[MQTT] 发送消息:', text);
      }
    }
  );

  return messageId;
}
```

### 1.4 接收消息

```javascript
// 接收消息处理
client.on('message', (topic, payload) => {
  try {
    const message = JSON.parse(payload.toString());

    if (topic === TOPICS.outbound) {
      handleOutboundMessage(message);
    } else if (topic === TOPICS.control) {
      handleControlMessage(message);
    }
  } catch (err) {
    console.error('[MQTT] 消息解析失败:', err);
  }
});

// 处理 AI 回复
function handleOutboundMessage(message) {
  if (message.type === 'stream') {
    // 流式文本块
    console.log('[AI 流式]', message.chunk);
    // TODO: 实时显示文本
  } else if (message.type === 'reply') {
    // 完整回复
    console.log('[AI 完整回复]', message.text);
    // TODO: 显示完整消息
  }
}

// 处理控制消息
function handleControlMessage(message) {
  if (message.type === 'status') {
    console.log('[状态]', message.status);
  }
}
```

### 1.5 中止生成

```javascript
// 中止当前 AI 生成
function abortGeneration(messageId) {
  const payload = {
    type: 'abort',
    replyTo: messageId,
  };

  client.publish(
    TOPICS.control,
    JSON.stringify(payload),
    { qos: 1 }
  );

  console.log('[MQTT] 已发送中止请求');
}
```

---

## 第二部分：OpenClaw Gateway 插件开发

### 2.1 插件结构

```
mqtt-plugin/
├── package.json
├── index.ts                 # 插件入口
├── openclaw.plugin.json     # 插件配置
└── src/
    ├── channel.ts           # Channel 插件实现
    ├── monitor.ts           # MQTT 监听器
    ├── inbound.ts           # 消息处理
    ├── mqtt-types.ts        # 类型定义
    ├── types.ts             # 配置类型
    └── runtime.ts           # 运行时工具
```

### 2.2 插件配置文件

创建 `openclaw.plugin.json`：

```json
{
  "id": "mqtt",
  "channels": ["mqtt"],
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "mqttBrokerUrl": {
        "type": "string",
        "description": "MQTT broker URL (e.g. wss://xxx.emqxsl.com:8084/mqtt)"
      },
      "mqttDeviceId": {
        "type": "string",
        "description": "Unique device ID for MQTT topic routing"
      },
      "mqttUsername": {
        "type": "string",
        "description": "MQTT broker username"
      },
      "mqttPassword": {
        "type": "string",
        "description": "MQTT broker password"
      }
    },
    "required": ["mqttBrokerUrl", "mqttDeviceId"]
  }
}
```

### 2.3 消息类型定义

创建 `src/mqtt-types.ts`：

```typescript
// Inbound: 客户端发送的消息
export type MqttInboundMessage = {
  type: "message";
  id: string;
  text: string;
  timestamp: number;
};

// Outbound: Gateway 发送的流式块
export type MqttStreamMessage = {
  type: "stream";
  replyTo: string;
  chunk: string;
  seq: number;
  done: boolean;
};

// Outbound: Gateway 发送的完整回复
export type MqttReplyMessage = {
  type: "reply";
  replyTo: string;
  text: string;
  timestamp: number;
};

// Control: 中止请求
export type MqttAbortControl = {
  type: "abort";
  replyTo: string;
};

// Control: 状态通知
export type MqttStatusControl = {
  type: "status";
  status: "online" | "offline";
  deviceId: string;
  timestamp: number;
};

// Topic 构建器
export function buildTopics(deviceId: string) {
  return {
    inbound: `openclaw/mqtt/${deviceId}/inbound`,
    outbound: `openclaw/mqtt/${deviceId}/outbound`,
    control: `openclaw/mqtt/${deviceId}/control`,
  };
}
```

### 2.4 MQTT 监听器实现

创建 `src/monitor.ts`：

```typescript
import mqtt from "mqtt";
import { buildTopics, type MqttInboundMessage } from "./mqtt-types.js";
import { handleInbound, abortRun } from "./inbound.js";

export async function monitorMqtt(options: {
  brokerUrl: string;
  deviceId: string;
  username?: string;
  password?: string;
}) {
  const topics = buildTopics(options.deviceId);

  // 连接配置
  const connectOptions: mqtt.IClientOptions = {
    clientId: `openclaw-mqtt-${options.deviceId}`,
    reconnectPeriod: 5000,
    clean: true,
  };

  if (options.username) {
    connectOptions.username = options.username;
    connectOptions.password = options.password;
  }

  // 连接到 Broker
  const client = await mqtt.connectAsync(options.brokerUrl, connectOptions);

  // 订阅 topic
  await client.subscribeAsync(topics.inbound, { qos: 1 });
  await client.subscribeAsync(topics.control, { qos: 1 });

  console.log(`[MQTT] 已连接并订阅 (device=${options.deviceId})`);

  // 消息处理
  client.on("message", (topic, payload) => {
    const parsed = JSON.parse(payload.toString());

    if (topic === topics.inbound && parsed.type === "message") {
      // 处理用户消息
      handleInbound({
        message: parsed as MqttInboundMessage,
        publishOutbound: async (reply) => {
          await client.publishAsync(topics.outbound, JSON.stringify(reply), { qos: 1 });
        },
      });
    } else if (topic === topics.control && parsed.type === "abort") {
      // 处理中止请求
      abortRun(parsed.replyTo);
    }
  });

  // 返回停止函数
  return {
    stop: async () => {
      await client.endAsync();
      console.log("[MQTT] 已断开连接");
    },
  };
}
```

### 2.5 消息处理逻辑

创建 `src/inbound.ts`：

```typescript
import type { MqttInboundMessage, MqttStreamMessage, MqttReplyMessage } from "./mqtt-types.js";

const activeRuns = new Map<string, AbortController>();

export async function handleInbound(ctx: {
  message: MqttInboundMessage;
  publishOutbound: (msg: MqttStreamMessage | MqttReplyMessage) => Promise<void>;
}) {
  const { message, publishOutbound } = ctx;
  const abortController = new AbortController();
  activeRuns.set(message.id, abortController);

  try {
    // 调用 OpenClaw Agent
    const response = await callAgent({
      text: message.text,
      signal: abortController.signal,
      onStream: async (chunk: string, seq: number, done: boolean) => {
        // 发送流式块
        await publishOutbound({
          type: "stream",
          replyTo: message.id,
          chunk,
          seq,
          done,
        });
      },
    });

    // 发送完整回复
    await publishOutbound({
      type: "reply",
      replyTo: message.id,
      text: response,
      timestamp: Date.now(),
    });
  } catch (err) {
    console.error("[MQTT] 处理失败:", err);
  } finally {
    activeRuns.delete(message.id);
  }
}

export function abortRun(messageId: string): boolean {
  const controller = activeRuns.get(messageId);
  if (controller) {
    controller.abort();
    activeRuns.delete(messageId);
    return true;
  }
  return false;
}

// 调用 Agent（示例）
async function callAgent(options: {
  text: string;
  signal: AbortSignal;
  onStream: (chunk: string, seq: number, done: boolean) => Promise<void>;
}): Promise<string> {
  // TODO: 实际调用 OpenClaw Agent API
  // 这里是简化示例
  let fullText = "";
  let seq = 0;

  // 模拟流式响应
  const chunks = ["你好", "！", "我是", " AI ", "助手"];
  for (const chunk of chunks) {
    if (options.signal.aborted) break;
    fullText += chunk;
    await options.onStream(chunk, seq++, false);
    await new Promise((r) => setTimeout(r, 100));
  }

  await options.onStream("", seq, true);
  return fullText;
}
```

---

## 第三部分：消息协议详解

### 3.1 Inbound 消息（客户端 → Gateway）

**Topic**: `openclaw/mqtt/{deviceId}/inbound`

**格式**:
```json
{
  "type": "message",
  "id": "msg-1708156800000",
  "text": "你好，今天天气怎么样？",
  "timestamp": 1708156800000
}
```

**字段说明**:
- `type`: 固定为 `"message"`
- `id`: 消息唯一标识符（用于关联回复和中止）
- `text`: 用户输入的文本
- `timestamp`: 消息发送时间戳（毫秒）

### 3.2 Outbound 消息（Gateway → 客户端）

#### 3.2.1 流式文本块

**Topic**: `openclaw/mqtt/{deviceId}/outbound`

**格式**:
```json
{
  "type": "stream",
  "replyTo": "msg-1708156800000",
  "chunk": "今天",
  "seq": 0,
  "done": false
}
```

**字段说明**:
- `type`: 固定为 `"stream"`
- `replyTo`: 对应的 inbound 消息 ID
- `chunk`: 文本块内容
- `seq`: 序列号（从 0 开始递增）
- `done`: 是否为最后一个块

#### 3.2.2 完整回复

**格式**:
```json
{
  "type": "reply",
  "replyTo": "msg-1708156800000",
  "text": "今天天气晴朗，温度适宜。",
  "timestamp": 1708156805000
}
```

**字段说明**:
- `type`: 固定为 `"reply"`
- `replyTo`: 对应的 inbound 消息 ID
- `text`: 完整回复文本
- `timestamp`: 回复时间戳

### 3.3 Control 消息（双向）

#### 3.3.1 中止请求（客户端 → Gateway）

**Topic**: `openclaw/mqtt/{deviceId}/control`

**格式**:
```json
{
  "type": "abort",
  "replyTo": "msg-1708156800000"
}
```

#### 3.3.2 状态通知（双向）

**格式**:
```json
{
  "type": "status",
  "status": "online",
  "deviceId": "desktop-001",
  "timestamp": 1708156800000
}
```

**status 取值**:
- `"online"`: 设备上线
- `"offline"`: 设备离线

---

## 第四部分：高级功能

### 4.1 消息队列管理

```javascript
class MessageQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
  }

  async add(message) {
    this.queue.push(message);
    if (!this.processing) {
      await this.process();
    }
  }

  async process() {
    this.processing = true;
    while (this.queue.length > 0) {
      const message = this.queue.shift();
      await this.handleMessage(message);
    }
    this.processing = false;
  }

  async handleMessage(message) {
    // 处理消息逻辑
  }
}
```

### 4.2 断线重连处理

```javascript
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;

client.on('close', () => {
  console.log('[MQTT] 连接关闭');

  if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
    reconnectAttempts++;
    console.log(`[MQTT] 尝试重连 (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
  } else {
    console.error('[MQTT] 达到最大重连次数，停止重连');
    client.end(true);
  }
});

client.on('connect', () => {
  reconnectAttempts = 0; // 重置计数器
  console.log('[MQTT] 连接成功');
});
```

### 4.3 离线消息缓存

```javascript
const offlineMessages = [];

function sendMessage(text) {
  const message = {
    type: 'message',
    id: `msg-${Date.now()}`,
    text,
    timestamp: Date.now(),
  };

  if (client.connected) {
    client.publish(TOPICS.inbound, JSON.stringify(message), { qos: 1 });
  } else {
    // 离线时缓存消息
    offlineMessages.push(message);
    console.log('[MQTT] 离线，消息已缓存');
  }
}

client.on('connect', () => {
  // 重连后发送缓存的消息
  while (offlineMessages.length > 0) {
    const message = offlineMessages.shift();
    client.publish(TOPICS.inbound, JSON.stringify(message), { qos: 1 });
  }
});
```

### 4.4 消息去重

```javascript
const processedMessages = new Set();
const MESSAGE_CACHE_SIZE = 1000;

client.on('message', (topic, payload) => {
  const message = JSON.parse(payload.toString());

  // 检查是否已处理
  if (processedMessages.has(message.replyTo)) {
    console.log('[MQTT] 重复消息，跳过');
    return;
  }

  // 记录已处理
  processedMessages.add(message.replyTo);

  // 限制缓存大小
  if (processedMessages.size > MESSAGE_CACHE_SIZE) {
    const firstItem = processedMessages.values().next().value;
    processedMessages.delete(firstItem);
  }

  // 处理消息
  handleMessage(message);
});
```

### 4.5 心跳保活

```javascript
const HEARTBEAT_INTERVAL = 30000; // 30秒

let heartbeatTimer;

function startHeartbeat() {
  heartbeatTimer = setInterval(() => {
    if (client.connected) {
      client.publish(
        TOPICS.control,
        JSON.stringify({
          type: 'status',
          status: 'online',
          deviceId: DEVICE_ID,
          timestamp: Date.now(),
        }),
        { qos: 1 }
      );
    }
  }, HEARTBEAT_INTERVAL);
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
  }
}

client.on('connect', startHeartbeat);
client.on('close', stopHeartbeat);
```

---

## 最佳实践

### 5.1 QoS 选择

| QoS 级别 | 说明 | 适用场景 |
|---|---|---|
| 0 | 最多一次（fire and forget） | 状态通知、心跳 |
| 1 | 至少一次（推荐） | 用户消息、AI 回复 |
| 2 | 恰好一次 | 关键业务消息 |

**推荐配置**：
- Inbound/Outbound 消息：QoS 1
- Control 消息：QoS 1
- 心跳消息：QoS 0

### 5.2 Topic 命名规范

```
{prefix}/{channel}/{deviceId}/{direction}

示例：
openclaw/mqtt/desktop-001/inbound
openclaw/mqtt/mobile-ios-001/outbound
openclaw/iot/speaker-living-room/control
```

**规范**：
- 使用小写字母和连字符
- 层级不超过 5 层
- 避免使用通配符（`+`、`#`）作为 topic 名称

### 5.3 错误处理

```javascript
client.on('error', (err) => {
  console.error('[MQTT] 错误:', err.message);
  
  // 根据错误类型处理
  if (err.message.includes('Not authorized')) {
    console.error('[MQTT] 认证失败，请检查用户名密码');
    // 停止重连
    client.end(true);
  } else if (err.message.includes('Connection refused')) {
    console.error('[MQTT] 连接被拒绝，请检查 Broker 地址');
  }
});
```

### 5.4 安全建议

1. **使用 TLS 加密**：生产环境必须使用 `wss://` 或 `mqtts://`
2. **强密码策略**：密码长度 ≥ 16 位，包含大小写字母、数字、特殊字符
3. **定期轮换凭据**：每 90 天更换一次密码
4. **限制 Topic 权限**：在 Broker 配置 ACL 规则
5. **不要硬编码凭据**：使用环境变量或密钥管理服务

### 5.5 性能优化

```javascript
// 1. 批量发送消息
const messageBatch = [];
const BATCH_SIZE = 10;
const BATCH_INTERVAL = 100; // ms

function batchSend(message) {
  messageBatch.push(message);
  
  if (messageBatch.length >= BATCH_SIZE) {
    flushBatch();
  }
}

function flushBatch() {
  if (messageBatch.length === 0) return;
  
  messageBatch.forEach(msg => {
    client.publish(TOPICS.inbound, JSON.stringify(msg), { qos: 1 });
  });
  
  messageBatch.length = 0;
}

// 2. 消息压缩（大消息）
const zlib = require('zlib');

function compressMessage(text) {
  if (text.length > 1024) {
    return zlib.gzipSync(text).toString('base64');
  }
  return text;
}
```

---

## 示例代码

### 完整客户端示例

创建 `example-client.js`：

```javascript
const mqtt = require('mqtt');
require('dotenv').config();

const BROKER_URL = process.env.MQTT_BROKER_URL;
const DEVICE_ID = process.env.MQTT_DEVICE_ID || 'example-001';
const USERNAME = process.env.MQTT_USERNAME;
const PASSWORD = process.env.MQTT_PASSWORD;

const TOPICS = {
  inbound: `openclaw/mqtt/${DEVICE_ID}/inbound`,
  outbound: `openclaw/mqtt/${DEVICE_ID}/outbound`,
  control: `openclaw/mqtt/${DEVICE_ID}/control`,
};

// 连接
const client = mqtt.connect(BROKER_URL, {
  clientId: `example-${DEVICE_ID}-${Date.now()}`,
  username: USERNAME,
  password: PASSWORD,
  clean: true,
  reconnectPeriod: 3000,
});

// 状态管理
let currentMessageId = null;
let fullResponse = '';

// 连接成功
client.on('connect', () => {
  console.log('[MQTT] 已连接');
  
  // 订阅
  client.subscribe([TOPICS.outbound, TOPICS.control], { qos: 1 }, (err) => {
    if (!err) {
      console.log('[MQTT] 订阅成功');
      
      // 发送测试消息
      sendMessage('你好，请介绍一下自己');
    }
  });
});

// 接收消息
client.on('message', (topic, payload) => {
  const message = JSON.parse(payload.toString());
  
  if (topic === TOPICS.outbound) {
    if (message.type === 'stream') {
      // 流式文本
      process.stdout.write(message.chunk);
      fullResponse += message.chunk;
      
      if (message.done) {
        console.log('\n[完成]');
        fullResponse = '';
      }
    } else if (message.type === 'reply') {
      // 完整回复
      console.log('\n[完整回复]', message.text);
      currentMessageId = null;
    }
  }
});

// 发送消息
function sendMessage(text) {
  currentMessageId = `msg-${Date.now()}`;
  
  client.publish(
    TOPICS.inbound,
    JSON.stringify({
      type: 'message',
      id: currentMessageId,
      text,
      timestamp: Date.now(),
    }),
    { qos: 1 }
  );
  
  console.log('[发送]', text);
  return currentMessageId;
}

// 中止
function abort() {
  if (currentMessageId) {
    client.publish(
      TOPICS.control,
      JSON.stringify({
        type: 'abort',
        replyTo: currentMessageId,
      }),
      { qos: 1 }
    );
    console.log('[中止]');
  }
}

// 优雅退出
process.on('SIGINT', () => {
  console.log('\n[退出]');
  client.end();
  process.exit(0);
});
```

运行示例：

```bash
# 配置 .env
MQTT_BROKER_URL=wss://your-broker.emqxsl.com:8084/mqtt
MQTT_DEVICE_ID=example-001
MQTT_USERNAME=your_username
MQTT_PASSWORD=your_password

# 运行
node example-client.js
```

---

## 附录

### A. 常见问题

**Q: 为什么消息发送后没有回复？**

A: 检查以下几点：
1. Device ID 是否在客户端和 Gateway 配置中一致
2. Gateway 是否已启动并连接到 Broker
3. Topic 前缀是否正确（`openclaw/mqtt/`）
4. 使用 MQTTX 工具测试 Broker 连接

**Q: 如何支持多设备？**

A: 每个设备使用不同的 Device ID，Gateway 会自动为每个设备创建独立的 topic。

**Q: 流式消息顺序错乱怎么办？**

A: 使用 `seq` 字段排序，或者使用 QoS 2 保证顺序。

**Q: 如何实现消息持久化？**

A: 在 EMQX Cloud 控制台配置消息持久化规则，或在客户端本地存储。

### B. 调试工具

1. **MQTTX**：图形化 MQTT 客户端
   - 下载：https://mqttx.app/
   - 支持 WebSocket、TLS、认证

2. **mosquitto_pub/sub**：命令行工具
   ```bash
   # 订阅
   mosquitto_sub -h broker.emqx.io -t "openclaw/mqtt/+/outbound" -v
   
   # 发布
   mosquitto_pub -h broker.emqx.io -t "openclaw/mqtt/test-001/inbound" \
     -m '{"type":"message","id":"test","text":"hello","timestamp":1708156800000}'
   ```

3. **EMQX Dashboard**：Broker 管理界面
   - 实时监控连接数、消息吞吐量
   - 查看 topic 订阅情况
   - 配置 ACL 权限

### C. 相关资源

- [MQTT 3.1.1 协议规范](https://docs.oasis-open.org/mqtt/mqtt/v3.1.1/mqtt-v3.1.1.html)
- [mqtt.js 官方文档](https://github.com/mqttjs/MQTT.js)
- [EMQX Cloud 文档](https://docs.emqx.com/en/cloud/latest/)
- [OpenClaw 插件开发指南](https://github.com/openclaw/openclaw)

### D. 示例项目

- **OpenClaw Desktop Assistant**：本项目
  - 仓库：https://github.com/Gyliiiiii/openclaw-assistant-mvp
  - 技术栈：Electron + MQTT + Deepgram + MiniMax

- **@leegyl/mqtt 插件**：Gateway MQTT 插件
  - 仓库：https://github.com/leegyl/mqtt
  - 安装：`openclaw plugin install @leegyl/mqtt`

---

## 总结

通过本指南，你已经学会了：

1. ✅ MQTT 客户端开发（连接、订阅、发布、接收）
2. ✅ OpenClaw Gateway 插件开发（监听器、消息处理）
3. ✅ 消息协议设计（Inbound、Outbound、Control）
4. ✅ 高级功能实现（队列、重连、缓存、去重、心跳）
5. ✅ 最佳实践（QoS、命名、错误处理、安全、性能）

现在你可以基于 MQTT 协议开发自己的 OpenClaw 客户端应用了！

如有问题，欢迎提交 Issue 或参考示例代码。
