# OpenClaw Channel 集成方案

## 当前状态

Electron 桌面助手已完成从 `chat.send` 到 `agent` 方法的迁移，作为 OpenClaw Gateway 的标准 WebSocket 客户端运行。

```
Electron App  ──WebSocket──>  OpenClaw Gateway (端口 18789)
                                │
                                ├── connect.challenge（握手）
                                ├── connect（认证）
                                ├── agent（发消息，获取 runId）
                                ├── agent 事件（流式 lifecycle/text/tool）
                                ├── chat final 事件（完整回复）
                                └── agent.abort（中止生成）
```

---

## 已完成的实施步骤

### Phase 1: `chat.send` → `agent` 方法 ✅

**改动文件**: `electron/main.js`

- `chatWithOpenClaw()` 使用 `method: 'agent'` 发送请求
- 请求参数: `{ message, sessionKey, idempotencyKey }`
- 接收 `res` 帧 `status: 'accepted'` 作为接受确认，提取 `runId`
- 监听 `agent` 事件的 `stream` 字段分发处理
- 移除了 `chat.send` 旧协议代码和兼容逻辑

### Phase 2: 动态 sessionKey ✅

**改动文件**: `electron/main.js`

- Channel ID: `desktop`
- `getSessionKey()` 生成 `agent:main:desktop:dm:local`
- 替换了硬编码的 `agent:main:main`

### Phase 3: `agent.abort` 中止能力 ✅

**改动文件**: `electron/main.js`、`electron/preload.js`、`public/app.js`

- `abortCurrentAgent()` 发送 `agent.abort` 请求，fire-and-forget 模式
- `tts:stop` IPC handler 自动触发 abort
- `interruptTTS()` 实现 "双中断"：本地 TTS 停止 + 后端生成停止
- `currentAgentRunId` 追踪当前执行，完成/超时/中止时清空

---

## 实际协议格式（实测确认）

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

---

## 文本提取优先级

代码中按以下优先级获取 AI 回复文本：

1. **agent `stream: text/content` 事件** — 流式累积（支持逐句 TTS）
2. **agent `lifecycle end`** — 如果已有累积文本，立即完成
3. **chat `state: final` 事件** — 从 `message.content[0].text` 提取完整文本
4. **res payload** — 非 accepted 的 res 帧中提取

---

## 未完成：Channel Plugin 扩展

**此步骤在 OpenClaw 项目（非本 Electron 项目）中实现。**

### 目标

将桌面助手注册为 OpenClaw 生态的正式 Channel，获得：
- AI 回复风格自动适配（口语化、避免 markdown）
- 桌面专属工具（`desktop_notify`、打开 Finder 等）
- OpenClaw Web UI 中的通道可见性
- 统一的会话管理和 Agent 路由

### 目录结构

```
extensions/desktop/
  package.json
  src/
    index.ts          # 导出
    channel.ts        # ChannelPlugin 接口实现
    plugin.ts         # 插件定义（注册 channel + tools + hooks）
```

### ChannelPlugin 实现要点

```typescript
{
  id: "desktop",
  capabilities: { chatTypes: ["dm"], media: { audio: true } },
  agentPrompt: "你正在跟桌面语音助手对话，回复要简短口语化，避免 markdown 格式",
  agentTools: ["desktop_notify", "open_finder"],
  config: "从 openclaw.json 的 channels.desktop.accounts 读取"
}
```

### openclaw.json 配置

```jsonc
{
  "channels": {
    "desktop": {
      "accounts": {
        "default": { "enabled": true }
      }
    }
  }
}
```

### 验证方式

- Gateway 启动日志显示 "Desktop channel plugin registered"
- Web UI Channels 页面出现 "Desktop Assistant"
- AI 回复风格变为口语化短句

---

## 改动文件清单

| 文件 | 改动量 | 状态 |
|------|--------|------|
| `electron/main.js` | 大（重写 chatWithOpenClaw，新增 abort） | ✅ 已完成 |
| `electron/preload.js` | 小（+1 行 abortAgent API） | ✅ 已完成 |
| `public/app.js` | 小（+1 行 abort 调用） | ✅ 已完成 |
| `CLAUDE.md` | 中（更新架构文档） | ✅ 已完成 |
| `extensions/desktop/` (OpenClaw 项目) | 新建 | 待实施 |

---

## 验证清单

- [x] `agent` 方法调用成功，控制台显示 `[OpenClaw] 事件: agent`
- [x] 获取到 `runId`，控制台显示 `[OpenClaw] agent 已接受, runId: xxx`
- [x] sessionKey 为 `agent:main:desktop:dm:local`
- [x] TTS 逐句播放正常
- [x] 打断时发送 `agent.abort`
- [x] `chat.send` 旧代码已移除
- [ ] Channel Plugin 注册（待 OpenClaw 项目实施）
- [ ] agentPrompt 口语化风格生效
