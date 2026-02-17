# EMQX Cloud Serverless 部署教程

本教程介绍如何将 OpenClaw Desktop Assistant 的 MQTT 通信从本地 Mosquitto 迁移到 EMQX Cloud Serverless，实现远程访问能力。

## 目录

- [为什么选择 EMQX Cloud Serverless](#为什么选择-emqx-cloud-serverless)
- [前置准备](#前置准备)
- [步骤 1: 注册并创建 EMQX Cloud Serverless 部署](#步骤-1-注册并创建-emqx-cloud-serverless-部署)
- [步骤 2: 配置 Electron 客户端](#步骤-2-配置-electron-客户端)
- [步骤 3: 安装并配置 Gateway MQTT 插件](#步骤-3-安装并配置-gateway-mqtt-插件)
- [步骤 4: 验证连接](#步骤-4-验证连接)
- [故障排查](#故障排查)
- [架构说明](#架构说明)

---

## 为什么选择 EMQX Cloud Serverless

### 优势

- **永久免费额度**：每月 100 万会话分钟 + 1GB 流量
- **无需信用卡**：注册即可使用免费版
- **开箱即用**：无需自建服务器和维护
- **全球部署**：支持多地域节点
- **企业级可靠性**：99.99% SLA 保证

### 技术特点

- 仅支持 **WebSocket over TLS** 连接（`wss://` 协议）
- 端口：`8084`，路径：`/mqtt`
- 强制 TLS 加密 + 用户名密码认证
- mqtt.js 原生支持，无需额外依赖

---

## 前置准备

### 必需条件

1. **Electron 客户端**：已安装依赖（`npm install`）
2. **OpenClaw Gateway**：已安装并运行（`openclaw gateway start`）
3. **邮箱账号**：用于注册 EMQX Cloud

### 技术栈

- Electron 客户端：`mqtt` ^5.0.0
- Gateway 插件：`@leegyl/mqtt` 2026.2.14+
- Node.js: 18.x+

---

## 步骤 1: 注册并创建 EMQX Cloud Serverless 部署

### 1.1 注册账号

1. 访问 [EMQX Cloud 注册页面](https://accounts.emqx.com/signup)
2. 使用邮箱注册（支持 Google/GitHub 快速登录）
3. 验证邮箱并登录控制台

### 1.2 创建 Serverless 部署

1. 登录后点击 **"+ New Deployment"**
2. 选择 **"Serverless"** 版本
3. 配置部署：
   - **Name**: 自定义名称（如 `openclaw-desktop`）
   - **Region**: 选择离你最近的区域（如 `Asia Southeast 1 (Singapore)`）
   - **Spend Limit**: 保持默认（$0，使用免费额度）
4. 点击 **"Deploy"** 创建（约 30 秒完成）

### 1.3 获取连接地址

部署完成后，在 **Overview** 页面找到：

```
Connection Address: ncff230f.ala.asia-southeast1.emqxsl.com
Connection Port: 8084 (WebSocket)
```

完整连接 URL 格式：
```
wss://<your-address>.emqxsl.com:8084/mqtt
```

### 1.4 创建认证凭据

1. 进入 **Access Control** → **Authentication**
2. 点击 **"+ Add"** 添加用户
3. 填写信息：
   - **Username**: 自定义用户名（如 `openclaw_user`）
   - **Password**: 设置强密码（建议 16 位以上）
4. 点击 **"Confirm"** 保存

> **安全提示**：密码仅显示一次，请妥善保存。

---

## 步骤 2: 配置 Electron 客户端

### 2.1 更新环境变量

编辑 `/path/to/openclaw-assistant-mvp/.env` 文件：

```bash
# Deepgram API Key (语音识别)
DEEPGRAM_API_KEY=your_deepgram_api_key_here

# MiniMax TTS 配置
MINIMAX_API_KEY=your_minimax_api_key_here
MINIMAX_GROUP_ID=your_minimax_group_id_here
MINIMAX_MODEL=speech-02-turbo
MINIMAX_VOICE_ID=Lovely_Girl

# MQTT Broker (EMQX Cloud Serverless)
MQTT_BROKER_URL=wss://ncff230f.ala.asia-southeast1.emqxsl.com:8084/mqtt
MQTT_DEVICE_ID=desktop-001
MQTT_USERNAME=openclaw_user
MQTT_PASSWORD=your_strong_password_here
```

### 2.2 配置说明

| 参数 | 说明 | 示例 |
|---|---|---|
| `MQTT_BROKER_URL` | EMQX Cloud 连接地址 | `wss://xxx.emqxsl.com:8084/mqtt` |
| `MQTT_DEVICE_ID` | 设备唯一标识符 | `desktop-001` |
| `MQTT_USERNAME` | EMQX 认证用户名 | `openclaw_user` |
| `MQTT_PASSWORD` | EMQX 认证密码 | `your_password` |

> **重要**：`MQTT_DEVICE_ID` 必须与 Gateway 配置保持一致。

---

## 步骤 3: 安装并配置 Gateway MQTT 插件

### 3.1 安装 MQTT 插件

使用 OpenClaw CLI 安装：

```bash
openclaw plugin install @leegyl/mqtt
```

或手动安装：

```bash
cd ~/.openclaw/extensions
git clone https://github.com/leegyl/mqtt.git
cd mqtt
npm install
```

### 3.2 配置 Gateway

编辑 `~/.openclaw/openclaw.json`，添加或修改以下配置：

#### 3.2.1 启用 MQTT 通道

在 `channels` 部分添加：

```json
{
  "channels": {
    "mqtt": {
      "enabled": true,
      "mqttBrokerUrl": "wss://ncff230f.ala.asia-southeast1.emqxsl.com:8084/mqtt",
      "mqttDeviceId": "desktop-001",
      "mqttUsername": "openclaw_user",
      "mqttPassword": "your_strong_password_here"
    }
  }
}
```

#### 3.2.2 启用 MQTT 插件

在 `plugins` 部分添加：

```json
{
  "plugins": {
    "allow": [
      "telegram",
      "mqtt"
    ],
    "entries": {
      "mqtt": {
        "enabled": true
      }
    }
  }
}
```

### 3.3 重启 Gateway

```bash
openclaw gateway restart
```

---

## 步骤 4: 验证连接

### 4.1 启动 Electron 客户端

```bash
cd /path/to/openclaw-assistant-mvp
npm run dev
```

### 4.2 检查日志

**Electron 客户端日志**（DevTools Console）：

```
[MQTT] 正在连接 wss://ncff230f.ala.asia-southeast1.emqxsl.com:8084/mqtt, deviceId: desktop-001
[MQTT] Connected to broker
[MQTT] 已订阅 outbound 和 control topic
```

**Gateway 日志**（终端）：

```
[mqtt] connected to wss://ncff230f.ala.asia-southeast1.emqxsl.com:8084/mqtt (device=desktop-001)
```

### 4.3 测试对话

1. 点击 Electron 客户端的角色开始录音
2. 说 "你好"
3. 应该能看到：
   - `[MQTT] 发送消息: "你好"`
   - `[MQTT] 收到流式文本块: "你好！..."`
   - AI 语音回复播放

### 4.4 使用 MQTTX 测试（可选）

下载 [MQTTX](https://mqttx.app/) 客户端进行调试：

1. 创建新连接：
   - **Name**: EMQX Cloud Test
   - **Host**: `wss://ncff230f.ala.asia-southeast1.emqxsl.com`
   - **Port**: `8084`
   - **Path**: `/mqtt`
   - **Username**: `openclaw_user`
   - **Password**: `your_password`
2. 订阅 topic：`openclaw/mqtt/desktop-001/outbound`
3. 发布测试消息到：`openclaw/mqtt/desktop-001/inbound`
   ```json
   {
     "type": "message",
     "id": "test-123",
     "text": "测试消息",
     "timestamp": 1708156800000
   }
   ```

---

## 故障排查

### 问题 1: 连接超时

**症状**：
```
[MQTT] 连接超时
Error: Connection timeout
```

**解决方案**：
1. 检查网络连接（是否能访问 EMQX Cloud 域名）
2. 确认 URL 格式正确（`wss://` 协议，端口 `8084`，路径 `/mqtt`）
3. 检查防火墙是否拦截 WebSocket 连接

### 问题 2: 认证失败

**症状**：
```
[MQTT] Connection refused: Not authorized
```

**解决方案**：
1. 确认用户名密码正确（区分大小写）
2. 在 EMQX Cloud 控制台检查用户是否存在
3. 重新创建认证凭据

### 问题 3: 消息发送但无回复

**症状**：
```
[MQTT] 发送消息: "你好"
（无后续日志）
```

**解决方案**：
1. 检查 `MQTT_DEVICE_ID` 是否在客户端和 Gateway 配置中一致
2. 确认 Gateway 已启动并连接到 MQTT Broker
3. 检查 Gateway 日志是否有错误信息
4. 验证 topic 前缀是否正确（`openclaw/mqtt/`）

### 问题 4: Gateway 无法连接

**症状**：
```
[mqtt] connection error: ...
```

**解决方案**：
1. 确认 `~/.openclaw/openclaw.json` 配置正确
2. 检查 `@leegyl/mqtt` 插件是否已安装
3. 运行 `openclaw gateway restart` 重启 Gateway
4. 查看详细日志：`openclaw gateway logs`

---

## 架构说明

### MQTT Topic 结构

```
openclaw/mqtt/{deviceId}/inbound     # Electron → Gateway（用户消息）
openclaw/mqtt/{deviceId}/outbound    # Gateway → Electron（AI 回复）
openclaw/mqtt/{deviceId}/control     # 双向控制消息（abort、status）
```

### 消息流程

```
┌─────────────────┐                  ┌──────────────────┐                  ┌─────────────────┐
│  Electron 客户端 │                  │  EMQX Cloud      │                  │  OpenClaw       │
│                 │                  │  Serverless      │                  │  Gateway        │
└────────┬────────┘                  └────────┬─────────┘                  └────────┬────────┘
         │                                    │                                     │
         │  1. 用户说话 "你好"                 │                                     │
         │─────────────────────────────────>│                                     │
         │  publish: inbound                 │                                     │
         │  { type: "message", text: "你好" } │                                     │
         │                                    │  2. 转发消息                         │
         │                                    │──────────────────────────────────>│
         │                                    │  subscribe: inbound                │
         │                                    │                                     │
         │                                    │                                  3. 调用 Agent
         │                                    │                                     │
         │                                    │  4. 流式回复                         │
         │                                    │<──────────────────────────────────│
         │  5. 接收回复                        │  publish: outbound                 │
         │<─────────────────────────────────│  { type: "stream", chunk: "..." }  │
         │  subscribe: outbound              │                                     │
         │                                    │                                     │
         │  6. TTS 播放                        │                                     │
         │                                    │                                     │
```

### Device ID 说明

- **作用**：用于构建 MQTT topic，实现消息路由
- **要求**：客户端和 Gateway 必须使用相同的 Device ID
- **命名建议**：
  - 单设备：`desktop-001`（默认）
  - 多设备：`desktop-macbook-pro`、`desktop-office` 等

### 连接参数

| 参数 | Electron 客户端 | Gateway |
|---|---|---|
| Client ID | `electron-{deviceId}` | `openclaw-mqtt-{deviceId}` |
| Clean Session | `true` | `true` |
| QoS | 1 | 1 |
| Reconnect Period | 3000ms | 5000ms |

---

## 附录

### A. 完整配置示例

**Electron `.env`**:
```bash
DEEPGRAM_API_KEY=your_key
MINIMAX_API_KEY=your_key
MINIMAX_GROUP_ID=your_group_id
MINIMAX_MODEL=speech-02-turbo
MINIMAX_VOICE_ID=Lovely_Girl
MQTT_BROKER_URL=wss://ncff230f.ala.asia-southeast1.emqxsl.com:8084/mqtt
MQTT_DEVICE_ID=desktop-001
MQTT_USERNAME=openclaw_user
MQTT_PASSWORD=your_password
```

**Gateway `openclaw.json`**:
```json
{
  "channels": {
    "mqtt": {
      "enabled": true,
      "mqttBrokerUrl": "wss://ncff230f.ala.asia-southeast1.emqxsl.com:8084/mqtt",
      "mqttDeviceId": "desktop-001",
      "mqttUsername": "openclaw_user",
      "mqttPassword": "your_password"
    }
  },
  "plugins": {
    "allow": ["mqtt"],
    "entries": {
      "mqtt": {
        "enabled": true
      }
    }
  }
}
```

### B. 相关链接

- [EMQX Cloud 官网](https://www.emqx.com/en/cloud)
- [EMQX Cloud 文档](https://docs.emqx.com/en/cloud/latest/)
- [mqtt.js 文档](https://github.com/mqttjs/MQTT.js)
- [OpenClaw 文档](https://github.com/openclaw/openclaw)

### C. 费用说明

**免费额度**（永久）：
- 会话分钟数：100 万/月
- 流量：1GB/月
- 连接数：100 并发

**超出免费额度后**：
- 按量计费，详见 [EMQX Cloud 定价](https://www.emqx.com/en/pricing)
- 可设置消费上限避免意外扣费

---

## 总结

通过本教程，你已经成功：

1. ✅ 注册并创建了 EMQX Cloud Serverless 部署
2. ✅ 配置了 Electron 客户端连接到云端 MQTT Broker
3. ✅ 安装并配置了 Gateway MQTT 插件
4. ✅ 验证了端到端的消息通信

现在你的 OpenClaw Desktop Assistant 已经支持远程访问，可以在任何有网络的地方使用！

如有问题，请参考[故障排查](#故障排查)章节或提交 Issue。
