# OpenClaw 模块接入完整指南

> 本文档基于 OpenClaw v2026.2.10 源码分析，供 ClawDashboard 外围开发参考。
> 最后更新：2026-02-12

---

## 目录

1. [项目总览](#1-项目总览)
2. [架构概述](#2-架构概述)
3. [Gateway 网关层](#3-gateway-网关层)
4. [Gateway 协议与 RPC 方法](#4-gateway-协议与-rpc-方法)
5. [Agent 智能体系统](#5-agent-智能体系统)
6. [Tool 工具系统](#6-tool-工具系统)
7. [Skill 技能系统](#7-skill-技能系统)
8. [Hook 钩子系统](#8-hook-钩子系统)
9. [Plugin 插件系统](#9-plugin-插件系统)
10. [Channel 消息通道系统](#10-channel-消息通道系统)
11. [配置系统](#11-配置系统)
12. [Session 会话管理](#12-session-会话管理)
13. [Memory 记忆与嵌入系统](#13-memory-记忆与嵌入系统)
14. [Auth 认证与凭据管理](#14-auth-认证与凭据管理)
15. [Node 设备节点协议](#15-node-设备节点协议)
16. [Sandbox 沙箱执行环境](#16-sandbox-沙箱执行环境)
17. [Cron 定时任务系统](#17-cron-定时任务系统)
18. [Browser 浏览器自动化](#18-browser-浏览器自动化)
19. [Web UI 控制面板](#19-web-ui-控制面板)
20. [Extension 扩展开发指南](#20-extension-扩展开发指南)
21. [Plugin SDK 接口参考](#21-plugin-sdk-接口参考)
22. [数据流与消息管线](#22-数据流与消息管线)
23. [文件系统布局](#23-文件系统布局)
24. [构建与测试](#24-构建与测试)
25. [Dashboard 接入建议](#25-dashboard-接入建议)

---

## 1. 项目总览

### 1.1 定位

**OpenClaw** 是一个运行在用户自有设备上的**个人 AI 助手网关**（Personal AI Assistant Gateway）。它将 AI 模型能力通过统一的 Gateway 层分发到 30+ 个消息通道（WhatsApp、Telegram、Discord、Slack、Signal、iMessage、Microsoft Teams、Matrix、Zalo 等），并提供 macOS、iOS、Android 原生客户端。

核心理念：**Gateway 只是控制平面（control plane），产品是助手本身。**

### 1.2 技术栈

| 层面 | 技术选型 |
|------|----------|
| 语言 | TypeScript (strict, ES2023, NodeNext) |
| 运行时 | Node.js ≥ 22.12.0 |
| 包管理 | pnpm 10.23.0 (workspace monorepo) |
| 构建 | tsdown (基于 rolldown 的 TypeScript 打包器) |
| 测试 | Vitest 4.x + V8 Coverage (70% 阈值) |
| Lint | oxlint (type-aware) + oxfmt |
| Web 框架 | Express 5.x |
| UI 框架 | Lit 3.x (Web Components + Signals) |
| Schema | Zod 4.x (运行时验证) + TypeBox (工具 schema) |
| 容器 | Docker (沙箱隔离) |
| 部署 | Fly.io, Docker Compose, npm global install |

### 1.3 Monorepo 结构

```
openclaw/
├── src/                    # 核心源码 (~477K LOC)
├── ui/                     # Web 控制面板 (Lit + Vite)
├── packages/               # 子包
│   ├── clawdbot/           # ClawdBot 辅助机器人
│   └── moltbot/            # MoltBot 辅助机器人
├── extensions/             # 36 个扩展插件
├── apps/                   # 原生应用
│   ├── android/            # Android (Kotlin/Gradle)
│   ├── ios/                # iOS (Swift/XcodeGen)
│   ├── macos/              # macOS (Swift/SwiftUI/SPM)
│   └── shared/             # 共享 Swift 库 (OpenClawKit)
├── Swabble/                # 唤醒词守护进程 (Swift 6.2, macOS 26+)
├── docs/                   # Mintlify 文档站 (多语言)
├── skills/                 # 内置技能
├── scripts/                # 构建/发布脚本
└── vendor/                 # 第三方依赖
```

**pnpm-workspace.yaml**:
```yaml
packages:
  - "."           # 根包
  - "ui"          # Web UI
  - "packages/*"  # 子包
  - "extensions/*"# 扩展插件
```

### 1.4 版本策略

- **版本格式**: `YYYY.M.D`（日历版本） + 可选 `-beta.N` / `-patch`
- **发布通道**: `latest`(稳定)、`beta`(测试)、`dev`(开发)
- **版本源**:
  - CLI: `package.json` → `version`
  - macOS: `apps/macos/Sources/OpenClaw/Resources/Info.plist`
  - iOS: `apps/ios/Sources/Info.plist`
  - Android: `apps/android/app/build.gradle.kts` → `versionName`

---

## 2. 架构概述

### 2.1 Hub-and-Spoke 模型

OpenClaw 采用**中心辐射式架构**，Gateway 进程作为中央枢纽：

```
                        ┌─────────────┐
                        │  Model APIs  │
                        │ (Anthropic,  │
                        │  OpenAI,     │
                        │  Bedrock...) │
                        └──────┬──────┘
                               │
┌──────────┐  ┌──────────┐  ┌──┴───────────┐  ┌──────────┐
│ WhatsApp │──│ Telegram │──│   Gateway     │──│  CLI     │
│ Slack    │  │ Discord  │  │  (WebSocket   │  │  TUI     │
│ Signal   │  │ iMessage │  │   Port 18789) │  │  Web UI  │
│ Matrix   │  │ Teams    │  └──┬───────────┘  └──────────┘
│ Zalo ... │  │ LINE ... │     │
└──────────┘  └──────────┘     │
                        ┌──────┴──────┐
                        │  Device     │
                        │  Nodes      │
                        │ (iOS/macOS/ │
                        │  Android)   │
                        └─────────────┘
```

### 2.2 核心模块关系

```
Gateway Server (src/gateway/)
  ├── Protocol Layer (protocol/) ──── JSON-RPC over WebSocket
  ├── Server Methods (server-methods/) ── 91 个 RPC 方法
  ├── Authentication (auth.ts, device-auth.ts)
  ├── Config Reload (config-reload.ts)
  └── Control UI (control-ui.ts)

Agent System (src/agents/)
  ├── Agent Scope & Config (agent-scope.ts)
  ├── Pi Embedded Runner (pi-embedded-runner/)
  ├── Auth Profiles (auth-profiles/) ── 凭据轮换
  ├── Tools (tools/) ── 工具注册
  ├── Skills (skills/) ── 技能加载
  ├── Sandbox (sandbox/) ── 容器隔离
  └── Schema (schema/) ── TypeBox 类型

Channel System (src/channels/ + extensions/)
  ├── Plugin Infrastructure (plugins/)
  ├── Routing (src/routing/)
  ├── Core Channels (telegram/, discord/, slack/, signal/, imessage/, line/)
  └── Extension Channels (extensions/matrix, msteams, zalo, ...)

Support Systems
  ├── Config (src/config/) ── Zod schema 驱动
  ├── Memory (src/memory/) ── 向量嵌入 + FTS
  ├── Hooks (src/hooks/) ── 事件驱动钩子
  ├── Plugins (src/plugins/) ── 插件生命周期
  ├── Sessions (src/sessions/) ── JSONL 持久化
  ├── Cron (src/cron/) ── 定时任务
  ├── Browser (src/browser/) ── Playwright 自动化
  └── Media (src/media/) ── 图像/音频/视频处理
```

---

## 3. Gateway 网关层

### 3.1 核心职责

Gateway 是整个系统的**控制平面和事件总线**，负责：

1. **通道连接管理**：维持与各消息平台的长连接
2. **消息路由**：将入站消息路由到正确的 Agent
3. **会话管理**：创建、恢复、压缩会话
4. **配置分发**：动态配置重载与分发
5. **设备协调**：管理 iOS/macOS/Android 节点
6. **安全认证**：Token/密码认证、设备签名
7. **控制 UI**：提供 Web 管理界面

### 3.2 服务端点

Gateway 在**单一端口** (默认 `18789`) 上同时提供：

| 端点 | 协议 | 用途 |
|------|------|------|
| `ws://127.0.0.1:18789` | WebSocket | 主控制协议（RPC + Events） |
| `http://127.0.0.1:18789/` | HTTP | Web 控制面板 UI |
| `http://127.0.0.1:18789/v1/chat/completions` | HTTP | OpenAI 兼容 API |
| `http://127.0.0.1:18789/api/...` | HTTP | 插件自定义 HTTP 路由 |

Canvas 文件服务使用独立端口（默认 `18793`）。

### 3.3 连接生命周期

```
Client                          Gateway
  │                                │
  │──── WebSocket Connect ────────>│
  │                                │
  │<──── connect.challenge ────────│  (Event: 发送认证挑战)
  │                                │
  │──── connect {token/password} ─>│  (Request: 回应挑战)
  │                                │
  │<──── connect response ─────────│  (Response: 握手完成)
  │                                │
  │<──── presence event ───────────│  (Event: 状态同步)
  │<──── health event ─────────────│  (Event: 健康状态)
  │                                │
  │──── agent {message} ──────────>│  (Request: 执行 Agent)
  │<──── agent streaming events ───│  (Events: 流式响应)
  │<──── agent response ───────────│  (Response: 完成)
  │                                │
```

### 3.4 关键源文件

| 文件 | 说明 |
|------|------|
| `src/gateway/server.impl.ts` | Gateway 服务器初始化与启动 |
| `src/gateway/protocol/index.ts` | 协议验证器与导出 |
| `src/gateway/protocol/schema/` | 所有 RPC schema 定义 |
| `src/gateway/server-methods/` | 91 个方法处理器 |
| `src/gateway/server-methods-list.ts` | 方法注册表 |
| `src/gateway/auth.ts` | Token/密码认证 |
| `src/gateway/device-auth.ts` | 设备签名认证 |
| `src/gateway/client.ts` | WebSocket 客户端实现 |
| `src/gateway/config-reload.ts` | 动态配置重载 |
| `src/gateway/control-ui.ts` | Web UI 静态文件服务 |
| `src/gateway/hooks.ts` | Gateway 钩子执行 |
| `src/gateway/net.ts` | 网络工具 |

---

## 4. Gateway 协议与 RPC 方法

### 4.1 协议帧格式

协议版本：**3**（向后兼容 v1-2）

**三种帧类型**：

```typescript
// 请求帧
type RequestFrame = {
  type: "req";
  id: string;         // 唯一请求 ID
  method: string;     // RPC 方法名
  params?: object;    // 方法参数
};

// 响应帧
type ResponseFrame = {
  type: "res";
  id: string;         // 对应请求 ID
  ok: boolean;        // 是否成功
  payload?: any;      // 成功时的返回数据
  error?: {           // 失败时的错误信息
    code: string;
    message: string;
    details?: any;
  };
};

// 事件帧
type EventFrame = {
  type: "event";
  event: string;      // 事件名称
  payload: any;       // 事件数据
  seq?: number;       // 序列号（用于排序）
};
```

### 4.2 完整 RPC 方法列表（91 个方法）

#### 系统与健康

| 方法 | 参数 | 说明 |
|------|------|------|
| `connect` | `{token?, password?, protocol?}` | 握手认证 |
| `health` | `{}` | 网关健康状态 |
| `status` | `{}` | 综合状态报告 |
| `status.all` | `{}` | 全部系统状态 |
| `logs` | `{level?, limit?}` | 查询日志 |
| `logs.stream.start` | `{level?}` | 开始日志流 |
| `logs.stream.stop` | `{}` | 停止日志流 |
| `wake` | `{}` | 唤醒网关 |
| `heartbeat` | `{}` | 心跳保活 |
| `shutdown` | `{}` | 关闭网关 |

#### 消息与 Agent

| 方法 | 参数 | 说明 |
|------|------|------|
| `agent` | `{message, sessionKey?, model?, ...}` | 执行 Agent 对话轮次（返回 runId，流式事件） |
| `agent.abort` | `{runId}` | 中止正在执行的 Agent |
| `send` | `{to, text?, media?, channel?}` | 向通道发送消息 |
| `poll` | `{sessionKey?}` | 轮询新消息 |
| `chat` | `{message, sessionKey?}` | 简化聊天接口 |
| `chat.stream` | `{message, sessionKey?}` | 流式聊天 |
| `tts` | `{text, voice?}` | 文字转语音 |

#### 会话管理

| 方法 | 参数 | 说明 |
|------|------|------|
| `sessions.list` | `{agentId?}` | 列出会话 |
| `sessions.get` | `{sessionKey}` | 获取会话详情 |
| `sessions.patch` | `{sessionKey, model?, thinking?, ...}` | 修改会话属性 |
| `sessions.reset` | `{sessionKey}` | 重置会话 |
| `sessions.compact` | `{sessionKey}` | 压缩会话历史 |
| `sessions.delete` | `{sessionKey}` | 删除会话 |
| `sessions.usage` | `{sessionKey?}` | 查询 Token 用量 |
| `sessions.transcript` | `{sessionKey, format?}` | 导出会话记录 |
| `sessions.replay` | `{sessionKey}` | 重放会话 |

#### 配置管理

| 方法 | 参数 | 说明 |
|------|------|------|
| `config.get` | `{path?}` | 获取配置（支持路径选择） |
| `config.set` | `{path, value}` | 设置单个配置值 |
| `config.patch` | `{patch}` | 批量修改配置 |
| `config.apply` | `{config}` | 应用完整配置 |
| `config.schema` | `{}` | 获取配置 schema |
| `config.reset` | `{path?}` | 重置配置到默认值 |

#### Agent 管理

| 方法 | 参数 | 说明 |
|------|------|------|
| `agents.list` | `{}` | 列出所有 Agent |
| `agents.get` | `{agentId}` | 获取 Agent 详情 |
| `agents.create` | `{id, name?, model?, ...}` | 创建 Agent |
| `agents.update` | `{agentId, ...}` | 更新 Agent |
| `agents.delete` | `{agentId}` | 删除 Agent |
| `agents.files` | `{agentId, path?}` | 访问 Agent 工作区文件 |

#### 模型与技能

| 方法 | 参数 | 说明 |
|------|------|------|
| `models.list` | `{}` | 列出可用模型 |
| `models.scan` | `{}` | 扫描模型可用性 |
| `skills.list` | `{agentId?}` | 列出技能 |
| `skills.install` | `{name, source?}` | 安装技能 |
| `skills.update` | `{name}` | 更新技能 |
| `skills.remove` | `{name}` | 卸载技能 |

#### 节点与设备

| 方法 | 参数 | 说明 |
|------|------|------|
| `node.list` | `{}` | 列出已配对节点 |
| `node.invoke` | `{nodeId, capability, params?}` | 调用节点能力 |
| `node.describe` | `{nodeId}` | 查询节点详情 |
| `node.pair.request` | `{...}` | 发起配对请求 |
| `node.pair.approve` | `{code}` | 批准配对 |
| `node.pair.reject` | `{code}` | 拒绝配对 |
| `node.unpair` | `{nodeId}` | 解除配对 |
| `device.pair.request` | `{...}` | 设备配对请求 |
| `device.pair.approve` | `{code}` | 设备配对批准 |
| `device.list` | `{}` | 列出设备 |

#### Cron 定时任务

| 方法 | 参数 | 说明 |
|------|------|------|
| `cron.list` | `{}` | 列出定时任务 |
| `cron.add` | `{schedule, action, ...}` | 添加定时任务 |
| `cron.update` | `{id, ...}` | 更新定时任务 |
| `cron.remove` | `{id}` | 删除定时任务 |
| `cron.run` | `{id}` | 立即执行任务 |
| `cron.pause` | `{id}` | 暂停任务 |
| `cron.resume` | `{id}` | 恢复任务 |

#### 通道管理

| 方法 | 参数 | 说明 |
|------|------|------|
| `channels.status` | `{channel?}` | 通道状态 |
| `channels.login` | `{channel, accountId?}` | 通道登录 |
| `channels.logout` | `{channel, accountId?}` | 通道登出 |
| `channels.probe` | `{channel}` | 探测通道连接 |
| `channels.audit` | `{channel}` | 通道审计 |

#### 执行审批

| 方法 | 参数 | 说明 |
|------|------|------|
| `exec.approval.list` | `{}` | 列出待审批项 |
| `exec.approval.approve` | `{id}` | 批准执行 |
| `exec.approval.reject` | `{id, reason?}` | 拒绝执行 |

#### 向导 / Setup

| 方法 | 参数 | 说明 |
|------|------|------|
| `wizard.start` | `{type?}` | 开始向导 |
| `wizard.next` | `{step, data?}` | 向导下一步 |
| `wizard.cancel` | `{}` | 取消向导 |
| `wizard.status` | `{}` | 向导状态 |

### 4.3 Gateway 事件列表（17 个事件）

| 事件 | Payload | 说明 |
|------|---------|------|
| `connect.challenge` | `{nonce}` | 认证挑战 |
| `agent` | `{runId, type, data}` | Agent 流式输出（text/tool_call/tool_result） |
| `chat` | `{...}` | 聊天流事件 |
| `presence` | `{host, ip, platform, ...}` | 客户端在线状态 |
| `health` | `{status, uptime, ...}` | 系统健康状态 |
| `tick` | `{timestamp}` | 心跳 tick |
| `node.pair.request` | `{nodeId, code, ...}` | 节点配对请求通知 |
| `node.pair.approved` | `{nodeId}` | 节点配对已批准 |
| `node.pair.rejected` | `{nodeId}` | 节点配对已拒绝 |
| `device.pair.request` | `{deviceId, code}` | 设备配对请求 |
| `device.pair.approved` | `{deviceId}` | 设备配对已批准 |
| `exec.approval.request` | `{id, tool, params}` | 执行审批请求 |
| `exec.approval.resolved` | `{id, approved}` | 执行审批结果 |
| `config.changed` | `{path?, patch?}` | 配置变更通知 |
| `session.updated` | `{sessionKey}` | 会话更新通知 |
| `shutdown` | `{}` | 网关关闭通知 |
| `log` | `{level, message, ...}` | 日志流事件 |

### 4.4 错误码

```typescript
// src/gateway/protocol/schema/error-codes.ts
const ERROR_CODES = {
  INVALID_REQUEST: "invalid_request",
  UNAUTHORIZED: "unauthorized",
  FORBIDDEN: "forbidden",
  NOT_FOUND: "not_found",
  METHOD_NOT_FOUND: "method_not_found",
  CONFLICT: "conflict",
  RATE_LIMITED: "rate_limited",
  INTERNAL_ERROR: "internal_error",
  SERVICE_UNAVAILABLE: "service_unavailable",
  TIMEOUT: "timeout",
  AGENT_ERROR: "agent_error",
  CONTEXT_OVERFLOW: "context_overflow",
  COMPACTION_FAILURE: "compaction_failure",
} as const;
```

---

## 5. Agent 智能体系统

### 5.1 概述

Agent 是 OpenClaw 的核心执行单元，基于 `@mariozechner/pi-agent-core` 实现。每个 Agent 拥有独立的：
- 模型配置（主模型 + 备选）
- 工作区目录（系统提示词、工具配置、技能）
- 会话存储
- 沙箱策略
- 认证档案

### 5.2 Agent 配置结构

```typescript
type AgentConfig = {
  id: string;                    // Agent 标识符
  default?: boolean;             // 是否为默认 Agent
  name?: string;                 // 显示名称
  workspace?: string;            // 工作区目录路径
  agentDir?: string;             // Agent 数据目录
  model?: AgentModelConfig;      // 模型配置
  skills?: string[];             // 技能白名单（可选，不设则全部可用）
  memorySearch?: MemorySearchConfig;  // 记忆搜索配置
  humanDelay?: HumanDelayConfig;      // 模拟人类回复延迟
  heartbeat?: HeartbeatConfig;        // 心跳配置
  identity?: IdentityConfig;          // 身份/人设配置
  groupChat?: GroupChatConfig;        // 群聊行为配置
  subagents?: {                       // 子 Agent 配置
    allowAgents?: string[];
    model?: string | { primary?: string; fallbacks?: string[] };
  };
  sandbox?: SandboxConfig;            // 沙箱配置
  tools?: AgentToolsConfig;           // 工具策略
};

type AgentModelConfig =
  | string                             // 简写：单一模型 ID
  | {
      primary?: string;               // 主模型
      fallbacks?: string[];            // 备选模型列表
    };
```

### 5.3 Agent 执行流程

```
1. 收到消息 → 路由解析 (resolveAgentRoute)
2. 解析 Agent 配置 (resolveAgentConfig)
3. 解析认证档案 (auth-profiles)
4. 组装系统提示词 (AGENTS.md + SOUL.md + TOOLS.md + Skills)
5. 加载会话历史 (JSONL)
6. 执行 Pi Agent (runEmbeddedPiAgent)
   ├── 模型 API 调用
   ├── 工具调用 → 沙箱/主机执行
   ├── 流式输出 → Gateway Events
   └── 会话持久化
7. 回复分发到通道
```

### 5.4 Agent 执行结果

```typescript
type EmbeddedPiRunResult = {
  payloads?: Array<{
    text?: string;           // 文本回复
    mediaUrl?: string;       // 媒体 URL
    mediaUrls?: string[];    // 多媒体 URL
    replyToId?: string;      // 回复目标消息 ID
    isError?: boolean;       // 是否错误回复
  }>;
  meta: {
    durationMs: number;      // 执行时长
    agentMeta?: {
      sessionId: string;
      provider: string;      // 模型提供商
      model: string;         // 使用的模型
      compactionCount?: number;
      usage?: {              // Token 用量
        input?: number;
        output?: number;
        cacheRead?: number;
        cacheWrite?: number;
        total?: number;
      };
    };
    aborted?: boolean;
    error?: {
      kind: "context_overflow" | "compaction_failure" | "role_ordering" | "image_size";
      message: string;
    };
    stopReason?: string;     // "completed" | "tool_calls"
  };
  didSendViaMessagingTool?: boolean;
  messagingToolSentTexts?: string[];
};
```

### 5.5 关键源文件

| 文件 | 说明 |
|------|------|
| `src/agents/agent-scope.ts` | Agent 作用域解析（ID、配置、路径） |
| `src/agents/agent-paths.ts` | Agent 目录路径管理 |
| `src/agents/pi-embedded-runner/` | Pi Agent 嵌入式运行器 |
| `src/agents/pi-embedded-runner/types.ts` | 运行结果类型定义 |
| `src/agents/pi-embedded-helpers/` | Pi Agent 辅助工具 |
| `src/agents/pi-extensions/` | Pi Agent 扩展 |
| `src/agents/anthropic.ts` | Anthropic API 集成 |
| `src/agents/bedrock-discovery.ts` | AWS Bedrock 模型发现 |
| `src/agents/model-scan.ts` | 模型可用性扫描 |

---

## 6. Tool 工具系统

### 6.1 概述

工具（Tool）是 Agent 与外部世界交互的能力接口。OpenClaw 提供丰富的内置工具，并支持通过 Plugin SDK 注册自定义工具。

### 6.2 工具分类与配置文件

| 工具组 | 工具 | 源文件 |
|--------|------|--------|
| **文件系统** | read, write, edit, apply_patch | `tools/fs-tools.ts` |
| **运行时** | exec, bash, process | `tools/bash-tools.ts`, `tools/bash-tools.exec.ts` |
| **记忆** | memory_search, memory_get | `tools/memory-tools.ts` |
| **Web** | web_search, web_fetch | `tools/web-tools.ts` |
| **浏览器** | browser (status/start/stop/navigate/screenshot/act...) | `tools/browser-tool.ts`, `tools/browser-tool.schema.ts` |
| **Canvas** | canvas (render/update/control) | `tools/canvas-tool.ts` |
| **消息** | message (发送到通道) | `tools/messaging-tool.ts` |
| **Cron** | cron (add/update/remove/run) | `tools/cron-tool.ts` |
| **Gateway** | gateway (status/config) | `tools/gateway-tool.ts` |
| **节点** | node.invoke (调用设备能力) | `tools/node-tools.ts` |

### 6.3 工具策略 (Tool Policy)

工具执行受**分层策略**控制：

```
全局策略 (config.tools) → Agent 策略 (agent.tools) → 群组策略 → 沙箱策略
```

```typescript
type AgentToolsConfig = {
  profile?: "minimal" | "coding" | "messaging" | "full";  // 预设配置文件
  allow?: string[];    // 工具白名单
  deny?: string[];     // 工具黑名单
};
```

**预设配置文件**:
- `minimal`: 仅基本对话能力
- `coding`: 文件读写 + 代码执行
- `messaging`: 消息发送
- `full`: 全部工具（默认）

### 6.4 工具 Schema 设计模式

OpenClaw 工具统一使用 **TypeBox 扁平化 schema**（而非 `anyOf` 联合类型），以确保跨提供商兼容：

```typescript
// 正确模式：扁平化 + 判别器字段
const CronToolSchema = Type.Object({
  action: stringEnum(["add", "update", "remove", "run", "list"]),  // 判别器
  id: Type.Optional(Type.String()),
  schedule: Type.Optional(Type.String()),
  // ... 每个 action 的参数都作为可选字段
});

// 运行时按 action 值验证必需参数
```

### 6.5 自定义工具注册

通过 Plugin SDK 注册：

```typescript
// 方式 1：静态工具
api.registerTool({
  name: "my_tool",
  description: "工具描述",
  schema: Type.Object({ param1: Type.String() }),
  handler: async (params) => {
    return { text: "结果" };
  }
});

// 方式 2：工厂函数（可访问上下文）
api.registerTool((ctx: OpenClawPluginToolContext) => {
  // ctx 包含 config, workspaceDir, agentId, sessionKey 等
  return {
    name: "context_aware_tool",
    description: "...",
    schema: Type.Object({}),
    handler: async (params) => { /* ... */ }
  };
});
```

---

## 7. Skill 技能系统

### 7.1 概述

技能（Skill）是可插拔的 **提示词注入包**，为 Agent 添加特定领域能力（如搜索、代码分析、翻译等）。技能通过 `SKILL.md` 文件定义提示词，可附带配置和依赖。

### 7.2 技能来源

| 来源 | 目录 | 说明 |
|------|------|------|
| 内置技能 | `skills/` (项目根) | 随 OpenClaw 分发 |
| 托管技能 | `~/.openclaw/skills/` | 通过 ClawdHub 安装 |
| 工作区技能 | `~/.openclaw/workspace/skills/` | 用户自定义 |
| 插件技能 | `extensions/*/skills/` | 由扩展提供 |

### 7.3 技能元数据

```typescript
type OpenClawSkillMetadata = {
  always?: boolean;         // 是否始终加载
  skillKey?: string;        // 配置键名
  primaryEnv?: string;      // 主要环境变量
  emoji?: string;           // 展示图标
  homepage?: string;        // 主页链接
  os?: string[];            // 支持的操作系统
  requires?: {
    bins?: string[];        // 必需的二进制工具（全部满足）
    anyBins?: string[];     // 必需的二进制工具（至少一个）
    env?: string[];         // 必需的环境变量
    config?: string[];      // 必需的配置路径
  };
  install?: SkillInstallSpec[];  // 依赖安装规格
};

type SkillInstallSpec = {
  kind: "brew" | "node" | "go" | "uv" | "download";
  label?: string;
  bins?: string[];
  os?: string[];
  formula?: string;      // brew formula
  package?: string;       // npm/go/uv 包名
  module?: string;        // go module
  url?: string;           // 下载 URL
  archive?: string;       // 归档格式
  extract?: boolean;
  targetDir?: string;
};
```

### 7.4 技能过滤逻辑

技能加载时按以下条件过滤：

```
1. 技能配置 enabled !== false
2. 内置技能通过白名单检查 (isBundledSkillAllowed)
3. OS 兼容性 (osList 匹配当前平台或远程节点平台)
4. metadata.always === true 则跳过后续检查
5. 必需二进制工具可用 (requiredBins)
6. 至少一个可选二进制工具可用 (requiredAnyBins)
7. 必需环境变量已设置 (requiredEnv)
8. 必需配置路径存在且有值 (requiredConfig)
```

### 7.5 技能快照

加载后的技能会生成快照注入到系统提示词：

```typescript
type SkillSnapshot = {
  prompt: string;                    // 合并后的提示词文本
  skills: Array<{
    name: string;
    primaryEnv?: string;
  }>;
  resolvedSkills?: Skill[];          // 解析后的技能列表
  version?: number;
};
```

---

## 8. Hook 钩子系统

### 8.1 概述

钩子（Hook）是**事件驱动的自动化脚本**，在特定系统事件发生时自动执行。与技能不同，钩子不注入提示词，而是执行外部处理逻辑。

### 8.2 钩子元数据

```typescript
type OpenClawHookMetadata = {
  always?: boolean;
  hookKey?: string;
  emoji?: string;
  homepage?: string;
  events: string[];              // 监听的事件列表
  export?: string;               // 导出的处理函数名
  os?: string[];
  requires?: {
    bins?: string[];
    anyBins?: string[];
    env?: string[];
    config?: string[];
  };
  install?: HookInstallSpec[];
};

// 钩子来源
type HookSource =
  | "openclaw-bundled"     // 内置
  | "openclaw-managed"     // 托管安装
  | "openclaw-workspace"   // 用户工作区
  | "openclaw-plugin";     // 插件提供
```

### 8.3 支持的事件

钩子可以监听的事件包括：

| 事件 | 触发时机 |
|------|----------|
| `command:new` | 新命令执行 |
| `session:start` | 会话开始 |
| `session:end` | 会话结束 |
| `message:received` | 收到消息 |
| `message:sending` | 消息即将发送 |
| `message:sent` | 消息已发送 |
| `agent:start` | Agent 开始执行 |
| `agent:end` | Agent 执行完成 |
| `tool:before` | 工具调用前 |
| `tool:after` | 工具调用后 |

---

## 9. Plugin 插件系统

### 9.1 概述

插件（Plugin）是 OpenClaw 最强大的扩展机制，可以注册：工具、钩子、HTTP 路由、通道、Gateway 方法、CLI 命令、服务、Provider 等几乎所有系统组件。

### 9.2 插件定义

```typescript
type OpenClawPluginDefinition = {
  id?: string;
  name?: string;
  description?: string;
  version?: string;
  kind?: "memory";                          // 特殊插件类型
  configSchema?: OpenClawPluginConfigSchema; // 插件配置 schema
  register?: (api: OpenClawPluginApi) => void | Promise<void>;  // 注册阶段
  activate?: (api: OpenClawPluginApi) => void | Promise<void>;  // 激活阶段
};
```

### 9.3 插件生命周期

```
1. Discovery（发现）: 扫描 extensions/ 目录
2. Load（加载）: 执行插件模块
3. Register（注册）: 调用 register() — 声明式注册能力
4. Activate（激活）: 调用 activate() — 运行时绑定
```

### 9.4 Plugin API 完整接口

```typescript
type OpenClawPluginApi = {
  // === 标识信息 ===
  id: string;
  name: string;
  version?: string;
  description?: string;
  source: string;                  // 插件来源路径

  // === 运行时上下文 ===
  config: OpenClawConfig;          // 当前配置快照
  pluginConfig?: Record<string, unknown>;  // 插件专属配置
  runtime: PluginRuntime;          // 运行时工具集（见 9.5）
  logger: PluginLogger;            // 日志接口

  // === 注册方法 ===
  registerTool(
    tool: AnyAgentTool | OpenClawPluginToolFactory,
    opts?: OpenClawPluginToolOptions
  ): void;

  registerHook(
    events: string | string[],
    handler: InternalHookHandler,
    opts?: OpenClawPluginHookOptions
  ): void;

  registerHttpHandler(handler: OpenClawPluginHttpHandler): void;

  registerHttpRoute(params: {
    path: string;
    handler: OpenClawPluginHttpRouteHandler;
  }): void;

  registerChannel(
    registration: OpenClawPluginChannelRegistration | ChannelPlugin
  ): void;

  registerGatewayMethod(
    method: string,
    handler: GatewayRequestHandler
  ): void;

  registerCli(
    registrar: OpenClawPluginCliRegistrar,
    opts?: { commands?: string[] }
  ): void;

  registerService(service: OpenClawPluginService): void;

  registerProvider(provider: ProviderPlugin): void;

  registerCommand(command: OpenClawPluginCommandDefinition): void;

  resolvePath(input: string): string;

  // === 生命周期钩子 ===
  on<K extends PluginHookName>(
    hookName: K,
    handler: PluginHookHandlerMap[K],
    opts?: { priority?: number }
  ): void;
};
```

### 9.5 Plugin Runtime 工具集

`PluginRuntime` 提供大量运行时工具，按领域组织：

```typescript
type PluginRuntime = {
  version: string;

  // 配置管理
  config: {
    loadConfig: () => OpenClawConfig;
    writeConfigFile: (config: OpenClawConfig) => void;
  };

  // 系统操作
  system: {
    enqueueSystemEvent: (...) => void;
    runCommandWithTimeout: (...) => Promise<...>;
    formatNativeDependencyHint: (...) => string;
  };

  // 媒体处理
  media: {
    loadWebMedia: (...) => Promise<Buffer>;
    detectMime: (...) => string;
    getImageMetadata: (...) => Promise<...>;
    resizeToJpeg: (...) => Promise<Buffer>;
    // ...更多
  };

  // 语音合成
  tts: {
    textToSpeechTelephony: (...) => Promise<Buffer>;
  };

  // 工具创建
  tools: {
    createMemoryGetTool: (...) => AnyAgentTool;
    createMemorySearchTool: (...) => AnyAgentTool;
    registerMemoryCli: (...) => void;
  };

  // 通道工具集 (重点！)
  channel: {
    // 文本处理
    text: {
      chunkByNewline: (...) => string[];
      chunkMarkdownText: (...) => string[];
      resolveChunkMode: (...) => string;
    };

    // 回复分发
    reply: {
      dispatchReplyWithBufferedBlockDispatcher: (...) => Promise<void>;
      createReplyDispatcherWithTyping: (...) => ReplyDispatcher;
    };

    // 路由
    routing: {
      resolveAgentRoute: (...) => ResolvedAgentRoute;
    };

    // 配对
    pairing: {
      buildPairingReply: (...) => string;
      readAllowFromStore: (...) => AllowList;
      upsertPairingRequest: (...) => void;
    };

    // 媒体
    media: {
      fetchRemoteMedia: (...) => Promise<Buffer>;
      saveMediaBuffer: (...) => Promise<string>;
    };

    // 会话
    session: {
      resolveStorePath: (...) => string;
      recordInboundSession: (...) => void;
    };

    // 提及检测
    mentions: {
      buildMentionRegexes: (...) => RegExp[];
      matchesMentionPatterns: (...) => boolean;
    };

    // 通道专用工具
    discord: { messageActions, probeDiscord, sendMessageDiscord, ... };
    slack: { probeSlack, sendMessageSlack, handleSlackAction, ... };
    telegram: { probeTelegram, sendMessageTelegram, messageActions, ... };
    signal: { probeSignal, sendMessageSignal, messageActions, ... };
    imessage: { probeIMessage, sendMessageIMessage, ... };
    whatsapp: { sendMessageWhatsApp, loginWeb, handleWhatsAppAction, ... };
    line: { probeLineBot, sendMessageLine, pushMessageLine, ... };
  };

  // 日志与状态
  logging: {
    shouldLogVerbose: () => boolean;
    getChildLogger: (name: string) => Logger;
  };
  state: {
    resolveStateDir: (pluginId: string) => string;
  };
};
```

### 9.6 插件钩子 (Plugin Hooks)

```typescript
type PluginHookName =
  | "before_agent_start"    // Agent 执行前（可修改系统提示词）
  | "agent_end"             // Agent 执行后
  | "before_compaction"     // 会话压缩前
  | "after_compaction"      // 会话压缩后
  | "message_received"      // 收到消息
  | "message_sending"       // 消息即将发送（可修改/取消）
  | "message_sent"          // 消息已发送
  | "before_tool_call"      // 工具调用前（可修改参数/阻止）
  | "after_tool_call"       // 工具调用后
  | "tool_result_persist"   // 工具结果持久化时
  | "session_start"         // 会话开始
  | "session_end"           // 会话结束
  | "gateway_start"         // Gateway 启动
  | "gateway_stop";         // Gateway 停止

// 示例：before_agent_start 钩子
type PluginHookBeforeAgentStartEvent = {
  prompt: string;           // 当前系统提示词
  messages?: unknown[];     // 历史消息
};
type PluginHookBeforeAgentStartResult = {
  systemPrompt?: string;    // 替换系统提示词
  prependContext?: string;  // 在提示词前插入上下文
};

// 示例：before_tool_call 钩子
type PluginHookBeforeToolCallEvent = {
  toolName: string;
  params: Record<string, unknown>;
};
type PluginHookBeforeToolCallResult = {
  params?: Record<string, unknown>;  // 修改参数
  block?: boolean;                   // 阻止调用
  blockReason?: string;
};

// 示例：message_sending 钩子
type PluginHookMessageSendingEvent = {
  to: string;
  content: string;
  metadata?: Record<string, unknown>;
};
type PluginHookMessageSendingResult = {
  content?: string;    // 修改消息内容
  cancel?: boolean;    // 取消发送
};
```

### 9.7 插件命令

插件可以注册自定义斜杠命令：

```typescript
type OpenClawPluginCommandDefinition = {
  name: string;             // 命令名（不含前导 /）
  description: string;      // 在 /help 中显示
  acceptsArgs?: boolean;    // 是否接受参数
  requireAuth?: boolean;    // 是否需要认证（默认 true）
  handler: (ctx: PluginCommandContext) => PluginCommandResult;
};

type PluginCommandContext = {
  senderId?: string;
  channel: string;
  channelId?: ChannelId;
  isAuthorizedSender: boolean;
  args?: string;             // 命令参数
  commandBody: string;       // 完整命令文本
  config: OpenClawConfig;
  from?: string;
  to?: string;
  accountId?: string;
  messageThreadId?: number;
};
```

### 9.8 插件服务

长驻后台服务：

```typescript
type OpenClawPluginService = {
  id: string;
  start: (ctx: OpenClawPluginServiceContext) => void | Promise<void>;
  stop?: (ctx: OpenClawPluginServiceContext) => void | Promise<void>;
};

type OpenClawPluginServiceContext = {
  config: OpenClawConfig;
  workspaceDir?: string;
  stateDir: string;
  logger: PluginLogger;
};
```

---

## 10. Channel 消息通道系统

### 10.1 概述

通道（Channel）是 OpenClaw 连接外部消息平台的适配器。系统采用统一的 `ChannelPlugin` 接口，支持 6 个核心通道和 30+ 个扩展通道。

### 10.2 核心通道

| 通道 ID | 平台 | 底层库 | 源码目录 |
|---------|------|--------|----------|
| `whatsapp` | WhatsApp | `@whiskeysockets/baileys` | `src/web/` |
| `telegram` | Telegram | `grammy` | `src/telegram/` (87 文件) |
| `discord` | Discord | `discord-api-types` + WebSocket | `src/discord/` (44 文件) |
| `slack` | Slack | `@slack/bolt` + `@slack/web-api` | `src/slack/` (36 文件) |
| `signal` | Signal | `signal-cli` | `src/signal/` (24 文件) |
| `imessage` | iMessage | macOS AppleScript/XPC | `src/imessage/` (16 文件) |
| `line` | LINE | `@line/bot-sdk` | `src/line/` (36 文件) |

### 10.3 扩展通道

| 通道 | 目录 | 说明 |
|------|------|------|
| `matrix` | `extensions/matrix/` | Matrix/Element 协议 |
| `msteams` | `extensions/msteams/` | Microsoft Teams |
| `bluebubbles` | `extensions/bluebubbles/` | iMessage 桥接 |
| `feishu` | `extensions/feishu/` | 飞书/Lark |
| `googlechat` | `extensions/googlechat/` | Google Chat |
| `mattermost` | `extensions/mattermost/` | Mattermost |
| `nextcloud-talk` | `extensions/nextcloud-talk/` | Nextcloud Talk |
| `nostr` | `extensions/nostr/` | Nostr 协议 |
| `tlon` | `extensions/tlon/` | Tlon/Urbit |
| `twitch` | `extensions/twitch/` | Twitch 直播 |
| `irc` | `extensions/irc/` | IRC |
| `zalo` | `extensions/zalo/` | Zalo OA |
| `zalouser` | `extensions/zalouser/` | Zalo 个人 |
| `voice-call` | `extensions/voice-call/` | 语音通话 |
| `talk-voice` | `extensions/talk-voice/` | 语音聊天 |

### 10.4 ChannelPlugin 接口

这是通道插件的**核心接口**，所有通道都必须实现：

```typescript
type ChannelPlugin<ResolvedAccount, Probe, Audit> = {
  // === 标识 ===
  id: ChannelId;                          // 通道标识符
  meta: {
    id: string;
    label: string;                        // 显示名称
    docsPath: string;                     // 文档路径
    order: number;                        // 排序权重
  };

  // === 能力声明 ===
  capabilities: {
    chatTypes: ChatType[];                // 支持的聊天类型 (dm/group/channel)
    polls?: boolean;                      // 投票
    reactions?: boolean;                  // 表情反应
    threads?: boolean;                    // 线程回复
    media?: {                             // 媒体支持
      images?: boolean;
      audio?: boolean;
      video?: boolean;
      documents?: boolean;
      maxSize?: number;
    };
  };

  // === 配置适配器 ===
  config: {
    listAccountIds: (cfg: OpenClawConfig) => string[];
    resolveAccount: (cfg: OpenClawConfig, accountId?: string | null) => ResolvedAccount;
    defaultAccountId?: (cfg: OpenClawConfig) => string;
    setAccountEnabled?: (params) => OpenClawConfig;
    deleteAccount?: (params) => OpenClawConfig;
    isEnabled?: (account, cfg) => boolean;
    isConfigured?: (account, cfg) => boolean | Promise<boolean>;
    describeAccount?: (account, cfg) => ChannelAccountSnapshot;
  };

  // === 可选适配器 ===
  onboarding?: ChannelOnboardingAdapter;   // 引导配置
  setup?: ChannelSetupAdapter;             // 初始化设置
  pairing?: ChannelPairingAdapter;         // 配对逻辑
  security?: ChannelSecurityAdapter;       // 安全策略
  groups?: ChannelGroupAdapter;            // 群组管理
  mentions?: ChannelMentionAdapter;        // @提及处理

  // === 消息收发 ===
  outbound?: {
    deliveryMode: "direct" | "gateway" | "hybrid";
    chunker?: (text: string, limit: number) => string[];
    textChunkLimit?: number;
    pollMaxOptions?: number;
    resolveTarget?: (params) => { ok: true; to: string } | { ok: false; error: Error };
    sendPayload?: (ctx) => Promise<OutboundDeliveryResult>;
    sendText?: (ctx) => Promise<OutboundDeliveryResult>;
    sendMedia?: (ctx) => Promise<OutboundDeliveryResult>;
    sendPoll?: (ctx) => Promise<ChannelPollResult>;
  };
  messaging?: ChannelMessagingAdapter;     // 消息处理
  streaming?: ChannelStreamingAdapter;     // 流式输出
  threading?: ChannelThreadingAdapter;     // 线程管理

  // === 管理 ===
  status?: ChannelStatusAdapter;           // 状态查询
  auth?: ChannelAuthAdapter;               // 认证
  elevated?: ChannelElevatedAdapter;       // 提权操作
  commands?: ChannelCommandAdapter;        // 命令处理
  directory?: ChannelDirectoryAdapter;     // 联系人/群组目录
  resolver?: ChannelResolverAdapter;       // 消息目标解析

  // === 高级功能 ===
  actions?: ChannelMessageActionAdapter;   // 消息动作
  heartbeat?: ChannelHeartbeatAdapter;     // 心跳检测
  agentPrompt?: ChannelAgentPromptAdapter; // 通道专属提示词
  agentTools?: ChannelAgentToolFactory | ChannelAgentTool[];  // 通道专属工具

  // === Gateway 集成 ===
  gatewayMethods?: string[];               // 注册的 Gateway 方法
  gateway?: ChannelGatewayAdapter;         // Gateway 处理器
};
```

### 10.5 消息路由

路由系统将入站消息映射到正确的 Agent：

```typescript
type ResolveAgentRouteInput = {
  cfg: OpenClawConfig;
  channel: string;           // 通道 ID
  accountId?: string | null;  // 通道账号 ID
  peer?: {                    // 对话对象
    kind: ChatType;           // "dm" | "group" | "channel"
    id: string;               // 对象标识
  } | null;
  parentPeer?: { kind: ChatType; id: string } | null;
  guildId?: string | null;    // Discord 服务器 ID
  teamId?: string | null;     // Slack 团队 ID
};

type ResolvedAgentRoute = {
  agentId: string;            // 路由到的 Agent
  channel: string;
  accountId: string;
  sessionKey: string;         // 会话键
  mainSessionKey: string;     // 主会话键
  matchedBy:                  // 匹配方式
    | "binding.peer"
    | "binding.peer.parent"
    | "binding.guild"
    | "binding.team"
    | "binding.account"
    | "binding.channel"
    | "default";
};
```

**路由优先级**:
1. `binding.peer` — 特定对话绑定
2. `binding.peer.parent` — 父对话绑定
3. `binding.guild` — Discord 服务器绑定
4. `binding.team` — Slack 团队绑定
5. `binding.account` — 通道账号绑定
6. `binding.channel` — 通道类型绑定
7. `default` — 默认 Agent

---

## 11. 配置系统

### 11.1 配置优先级

```
环境变量 (OPENCLAW_*) > CLI 标志 (--port) > 配置文件 (~/.openclaw/openclaw.json) > 默认值
```

**环境变量源优先级**:
```
进程环境 > ./.env (项目本地) > ~/.openclaw/.env > openclaw.json 中的 env 块
```

### 11.2 主配置文件结构

`~/.openclaw/openclaw.json` (JSON5 格式):

```jsonc
{
  // Gateway 配置
  "gateway": {
    "port": 18789,
    "host": "127.0.0.1",
    "token": "xxx",              // 认证 Token
    "password": "xxx",           // 认证密码（二选一）
    "tls": { /* TLS 配置 */ }
  },

  // Agent 配置
  "agents": {
    "defaults": {
      "model": "claude-opus-4-6",
      "tools": { "profile": "full" },
      "sandbox": { "mode": "off" },
      "memorySearch": { "enabled": true },
      "humanDelay": { "enabled": false, "minMs": 500, "maxMs": 3000 }
    },
    "list": [
      {
        "id": "main",
        "default": true,
        "name": "主助手",
        "model": { "primary": "claude-opus-4-6", "fallbacks": ["gpt-4o"] },
        "workspace": "/path/to/workspace",
        "skills": ["web-search", "code-analysis"],  // 可选技能白名单
        "identity": {
          "name": "Clawd",
          "personality": "helpful and friendly"
        }
      },
      {
        "id": "work",
        "name": "工作助手",
        "model": "claude-sonnet-4-5-20250929"
      }
    ]
  },

  // 通道配置
  "channels": {
    "telegram": {
      "accounts": {
        "default": {
          "enabled": true,
          "token": "BOT_TOKEN",
          "dmPolicy": "pairing",        // 私信策略
          "groupPolicy": "mention",     // 群组策略
          "allowlist": ["+15555550123"]
        }
      }
    },
    "whatsapp": { /* ... */ },
    "discord": { /* ... */ },
    "slack": { /* ... */ }
  },

  // 工具策略
  "tools": {
    "allow": ["*"],
    "deny": []
  },

  // 会话配置
  "session": {
    "resetPolicy": "idle",       // idle | daily | off
    "idleTimeoutMinutes": 30,
    "queueMode": "sequential"    // sequential | concurrent | collect
  },

  // 插件配置
  "plugins": {
    "my-plugin": {
      "enabled": true,
      "customKey": "value"
    }
  },

  // 模型配置
  "models": {
    "providers": {
      "anthropic": { /* ... */ },
      "openai": { /* ... */ },
      "bedrock": { /* ... */ }
    }
  },

  // 环境变量块
  "env": {
    "ANTHROPIC_API_KEY": "sk-ant-..."
  }
}
```

### 11.3 配置类型模块

| 文件 | 内容 |
|------|------|
| `src/config/types.base.ts` | 核心配置类型（gateway, session, tools） |
| `src/config/types.agents.ts` | Agent 配置类型 |
| `src/config/types.channels.ts` | 通道配置类型 |
| `src/config/types.models.ts` | 模型 Provider 配置 |
| `src/config/types.plugins.ts` | 插件配置类型 |
| `src/config/zod-schema.ts` | Zod 验证 schema |

### 11.4 动态配置重载

Gateway 支持**运行时配置热重载**：

```
配置文件修改 → 文件系统监听 → config-reload.ts → 验证 schema → 广播 config.changed 事件
```

通过 Gateway RPC 也可动态修改：
- `config.patch` — 增量更新
- `config.apply` — 全量替换
- `config.set` — 设置单个路径

---

## 12. Session 会话管理

### 12.1 会话键格式

```
agent:{agentId}:{provider}:{scope}:{identifier}
```

**示例**：
| 会话键 | 说明 |
|--------|------|
| `agent:main:main` | 主 Agent 直连对话 |
| `agent:main:whatsapp:dm:+15555550123` | WhatsApp 私信 |
| `agent:main:telegram:group:-1234567890` | Telegram 群组 |
| `agent:work:discord:dm:123456789` | 工作 Agent 的 Discord 私信 |
| `agent:main:slack:channel:C12345678` | Slack 频道 |

### 12.2 存储结构

```
~/.openclaw/agents/{agentId}/sessions/
  ├── {sessionKey}.jsonl           # 消息记录（JSONL 格式）
  ├── {sessionKey}.meta.json       # 会话元数据
  └── {sessionKey}.state.json      # 会话状态
```

### 12.3 会话属性

每个会话维护以下状态：
- 模型覆盖（可临时切换模型）
- 思考深度（thinking level）
- 工具策略覆盖
- 压缩计数
- 重置策略
- 队列模式

### 12.4 会话生命周期

```
创建 → 激活 → 对话轮次(1..N) → [压缩] → [重置/过期] → 归档
                    │
                    ├── 每轮：追加 JSONL 记录
                    ├── 压缩：达到上下文限制时自动压缩
                    └── 重置：按策略 (idle/daily) 自动重置
```

### 12.5 队列模式

| 模式 | 行为 |
|------|------|
| `sequential` | 消息串行处理，按到达顺序排队 |
| `concurrent` | 消息并行处理（可能乱序） |
| `collect` | 收集一段时间内的消息，批量处理 |

---

## 13. Memory 记忆与嵌入系统

### 13.1 概述

记忆系统为 Agent 提供**语义搜索**能力，支持从工作区文件和历史会话中检索相关信息。

### 13.2 双后端架构

| 后端 | 类型 | 说明 |
|------|------|------|
| `builtin` | FTS (全文搜索) | SQLite FTS5，内置无需额外依赖 |
| `qmd` | Vector (向量搜索) | 基于 `sqlite-vec`，需要嵌入模型 |

可通过 `extensions/memory-lancedb/` 使用 LanceDB 作为替代向量存储。

### 13.3 核心接口

```typescript
interface MemorySearchManager {
  search(
    query: string,
    opts?: {
      maxResults?: number;
      minScore?: number;
      sessionKey?: string;
    }
  ): Promise<MemorySearchResult[]>;

  readFile(params: {
    relPath: string;
    from?: number;
    lines?: number;
  }): Promise<{ text: string; path: string }>;

  status(): MemoryProviderStatus;

  sync?(params?: {
    reason?: string;
    force?: boolean;
    progress?: (update: MemorySyncProgressUpdate) => void;
  }): Promise<void>;

  probeEmbeddingAvailability(): Promise<MemoryEmbeddingProbeResult>;
  probeVectorAvailability(): Promise<boolean>;
  close?(): Promise<void>;
}

type MemorySearchResult = {
  path: string;           // 文件路径
  startLine: number;      // 起始行
  endLine: number;        // 结束行
  score: number;          // 相关性分数
  snippet: string;        // 匹配片段
  source: "memory" | "sessions";  // 来源
  citation?: string;      // 引用信息
};
```

### 13.4 记忆状态

```typescript
type MemoryProviderStatus = {
  backend: "builtin" | "qmd";
  provider: string;          // 嵌入模型提供商
  model?: string;            // 嵌入模型名称
  files?: number;            // 已索引文件数
  chunks?: number;           // 文本块数
  dirty?: boolean;           // 是否需要重新索引
  workspaceDir?: string;
  dbPath?: string;
  sources?: MemorySource[];
  vector?: {
    enabled: boolean;
    available?: boolean;
    dims?: number;           // 向量维度
  };
  fts?: {
    enabled: boolean;
    available: boolean;
  };
  batch?: {
    enabled: boolean;
    concurrency: number;     // 并发数
    failures: number;        // 失败次数
  };
};
```

---

## 14. Auth 认证与凭据管理

### 14.1 Gateway 认证

两种认证方式：

| 方式 | 配置 | 适用场景 |
|------|------|----------|
| Token | `OPENCLAW_GATEWAY_TOKEN` | 程序化接入 |
| Password | `OPENCLAW_GATEWAY_PASSWORD` | 人工登录 |

非本地回环地址访问**必须**提供认证。

### 14.2 模型 Auth Profile

Auth Profile 是 OpenClaw 的**模型凭据轮换系统**，支持多凭据自动切换：

```typescript
type AuthProfileCredential =
  | ApiKeyCredential     // API Key 认证
  | TokenCredential      // Token 认证
  | OAuthCredential;     // OAuth 认证

type ApiKeyCredential = {
  type: "api_key";
  provider: string;      // "anthropic" | "openai" | "bedrock" | ...
  key?: string;
  email?: string;
  metadata?: Record<string, string>;
};

type OAuthCredential = OAuthCredentials & {
  type: "oauth";
  provider: string;
  clientId?: string;
  email?: string;
};

// Auth Profile 存储
type AuthProfileStore = {
  version: number;
  profiles: Record<string, AuthProfileCredential>;  // profileId → 凭据
  order?: Record<string, string[]>;    // Agent → 偏好顺序
  lastGood?: Record<string, string>;   // Agent → 最近成功的 profile
  usageStats?: Record<string, ProfileUsageStats>;
};

// 使用统计（驱动轮换逻辑）
type ProfileUsageStats = {
  lastUsed?: number;
  cooldownUntil?: number;          // 冷却到期时间
  disabledUntil?: number;          // 禁用到期时间
  disabledReason?: AuthProfileFailureReason;
  errorCount?: number;
  failureCounts?: Partial<Record<AuthProfileFailureReason, number>>;
  lastFailureAt?: number;
};

type AuthProfileFailureReason =
  | "auth"         // 认证失败
  | "format"       // 格式错误
  | "rate_limit"   // 限流
  | "billing"      // 账单问题
  | "timeout"      // 超时
  | "unknown";     // 未知错误
```

### 14.3 凭据轮换策略

```
1. 按优先级排序 profiles (order)
2. 跳过 cooldown/disabled 中的 profile
3. 尝试 lastGood profile（如果可用）
4. 失败时 → 记录 failureReason → 设置 cooldown
5. 连续失败达阈值 → 临时禁用 profile
6. 所有 profile 失败 → 返回错误
```

### 14.4 Provider 插件

第三方认证通过 Provider 插件实现：

```typescript
type ProviderPlugin = {
  id: string;                    // "anthropic" | "openai" | ...
  label: string;                 // 显示名称
  docsPath?: string;
  aliases?: string[];            // 别名
  envVars?: string[];            // 相关环境变量
  models?: ModelProviderConfig;  // 模型列表
  auth: ProviderAuthMethod[];    // 支持的认证方式
  formatApiKey?: (cred: AuthProfileCredential) => string;
  refreshOAuth?: (cred: OAuthCredential) => Promise<OAuthCredential>;
};
```

---

## 15. Node 设备节点协议

### 15.1 概述

Node 是运行在 iOS、macOS、Android 上的伴侣应用，通过 WebSocket 连接到 Gateway，提供设备级能力。

### 15.2 发现与配对

```
1. Gateway 通过 mDNS 广播 _openclaw-gateway._tcp
2. Node 应用发现 Gateway
3. Node 发送 node.pair.request（附带能力声明）
4. Gateway 生成 6 位配对码
5. 用户通过 CLI 批准: openclaw nodes pair approve <code>
6. Node 建立 WebSocket 持久连接
```

### 15.3 设备能力

| 能力 | 平台 | 说明 |
|------|------|------|
| `system.run` | macOS | 执行 shell 命令 |
| `camera.snap` | iOS/macOS/Android | 拍照 |
| `screen.record` | macOS | 屏幕录制 |
| `screen.screenshot` | macOS | 屏幕截图 |
| `location.get` | iOS/Android | 获取位置 |
| `notification.send` | 全部 | 发送系统通知 |
| `canvas.render` | 全部 | 渲染 Canvas UI |
| `clipboard.get` | macOS | 读取剪贴板 |
| `clipboard.set` | macOS | 设置剪贴板 |

### 15.4 调用方式

通过 Gateway RPC：
```json
{
  "type": "req",
  "id": "uuid",
  "method": "node.invoke",
  "params": {
    "nodeId": "my-macbook",
    "capability": "camera.snap",
    "params": { "camera": "front" }
  }
}
```

---

## 16. Sandbox 沙箱执行环境

### 16.1 概述

沙箱使用 Docker 为每个会话提供**隔离的代码执行环境**。

### 16.2 配置

```typescript
type SandboxConfig = {
  mode?: "off" | "non-main" | "all";   // 沙箱模式
  workspaceAccess?: "none" | "ro" | "rw";  // 工作区访问级别
  scope?: "session" | "agent" | "shared";   // 容器作用域
  perSession?: boolean;                      // 每会话独立容器
  workspaceRoot?: string;
  docker?: {
    image?: string;
    network?: string;
    env?: Record<string, string>;
  };
  browser?: {
    enabled: boolean;
    image: string;
    headless: boolean;
    allowHostControl: boolean;
  };
};
```

### 16.3 工具策略

沙箱内的工具受额外策略限制：

```typescript
type SandboxToolPolicy = {
  allow?: string[];    // 沙箱内允许的工具
  deny?: string[];     // 沙箱内禁止的工具
};
```

### 16.4 沙箱模式说明

| 模式 | 行为 |
|------|------|
| `off` | 不使用沙箱，直接在主机执行 |
| `non-main` | 仅非默认 Agent 使用沙箱 |
| `all` | 所有 Agent 都使用沙箱 |

---

## 17. Cron 定时任务系统

### 17.1 概述

Cron 系统允许 Agent 调度定期执行的自动化任务，基于 `croner` 库实现。

### 17.2 管理方式

| 方式 | 说明 |
|------|------|
| Agent 工具 | Agent 通过 `cron` 工具自主管理任务 |
| CLI | `openclaw cron list/add/remove/run` |
| Gateway RPC | `cron.list/add/update/remove/run/pause/resume` |

### 17.3 核心源文件

| 文件 | 说明 |
|------|------|
| `src/cron/service/` | Cron 服务实现 |
| `src/cron/isolated-agent/` | 定时任务 Agent 隔离上下文 |
| `src/agents/tools/cron-tool.ts` | Agent 侧 Cron 工具 |
| `src/cli/cron-cli/` | CLI 命令 |

---

## 18. Browser 浏览器自动化

### 18.1 概述

基于 Playwright 的浏览器自动化系统，Agent 可以浏览网页、截图、执行 JavaScript、填写表单等。

### 18.2 浏览器工具动作

```typescript
const BROWSER_TOOL_ACTIONS = [
  "status",       // 浏览器状态
  "start",        // 启动浏览器
  "stop",         // 关闭浏览器
  "profiles",     // 列出浏览器配置
  "tabs",         // 标签页管理
  "open",         // 打开新标签
  "focus",        // 聚焦标签
  "close",        // 关闭标签
  "snapshot",     // 页面 A11y 快照
  "screenshot",   // 页面截图
  "navigate",     // 导航
  "console",      // 控制台日志
  "pdf",          // 保存为 PDF
  "upload",       // 上传文件
  "dialog",       // 对话框处理
  "act",          // 交互操作（点击/输入/拖拽等）
] as const;

const BROWSER_ACT_KINDS = [
  "click",        // 点击元素
  "type",         // 输入文本
  "press",        // 按键
  "hover",        // 悬停
  "drag",         // 拖拽
  "select",       // 选择下拉项
  "fill",         // 填写输入框
  "resize",       // 调整窗口
  "wait",         // 等待
  "evaluate",     // 执行 JS
  "close",        // 关闭页面
] as const;
```

---

## 19. Web UI 控制面板

### 19.1 技术栈

- **框架**: Lit 3.3.2 (Web Components + Signals)
- **构建**: Vite 7.x
- **安全**: DOMPurify (XSS 防护) + Marked (Markdown 渲染)
- **测试**: Vitest + Playwright browser runner

### 19.2 目录结构

```
ui/
├── package.json
├── src/
│   ├── main.ts              # Vite 入口
│   ├── styles/              # CSS 模块
│   └── ui/                  # 53 个 UI 组件目录
├── public/                  # 静态资源
├── index.html               # HTML 模板
├── vite.config.ts
└── vitest.config.ts
```

### 19.3 通信方式

Web UI 通过 Gateway 的 WebSocket 端口 (`18789`) 通信：
- 使用与 CLI/移动端相同的 `connect` 握手
- 使用相同的 RPC 方法集
- 非本地访问需要 Token 认证

---

## 20. Extension 扩展开发指南

### 20.1 扩展目录结构

```
extensions/my-extension/
├── package.json              # 包元数据 + 依赖
├── README.md                 # 文档
├── src/
│   ├── index.ts              # 主导出
│   ├── plugin.ts             # 插件工厂（如有）
│   └── channel.ts            # 通道插件（如是通道扩展）
├── plugin.ts                 # 插件入口
└── *.test.ts                 # 测试
```

### 20.2 package.json 要求

```jsonc
{
  "name": "@openclaw/extension-my-ext",
  "version": "2026.2.10",
  "type": "module",
  "main": "src/index.ts",

  // ⚠️ 关键规则：
  // 运行时依赖必须放在 dependencies（不能用 workspace:*）
  "dependencies": {
    "my-sdk": "^1.0.0"
  },

  // openclaw 本身放在 devDependencies 或 peerDependencies
  "devDependencies": {
    "openclaw": "2026.2.10"
  },

  // 插件元数据
  "openclaw": {
    "skills": {
      "dependencies": {
        "tools": [],
        "binaries": [],
        "envVars": []
      }
    }
  }
}
```

### 20.3 通道扩展示例 (Matrix)

```typescript
// extensions/matrix/src/channel.ts
import type { ChannelPlugin } from "openclaw/plugin-sdk";

type ResolvedMatrixAccount = {
  enabled: boolean;
  homeserver: string;
  userId: string;
  accessToken: string;
  // ...
};

export const matrixPlugin: ChannelPlugin<ResolvedMatrixAccount, MatrixProbe, MatrixAudit> = {
  id: "matrix",

  meta: {
    id: "matrix",
    label: "Matrix",
    docsPath: "channels/matrix",
    order: 200,
  },

  capabilities: {
    chatTypes: ["dm", "group"],
    reactions: true,
    threads: true,
    media: {
      images: true,
      audio: true,
      video: true,
      documents: true,
    },
  },

  config: {
    listAccountIds: (cfg) => {
      return Object.keys(cfg.channels?.matrix?.accounts ?? {});
    },
    resolveAccount: (cfg, accountId) => {
      // 解析账号配置
    },
  },

  outbound: {
    deliveryMode: "direct",
    textChunkLimit: 60000,
    sendText: async (ctx) => {
      // 发送文本消息
    },
    sendMedia: async (ctx) => {
      // 发送媒体消息
    },
  },

  directory: {
    listPeers: async (params) => { /* ... */ },
    listGroups: async (params) => { /* ... */ },
  },

  // ... 更多适配器
};
```

### 20.4 功能扩展示例

```typescript
// extensions/my-feature/src/plugin.ts
import type { OpenClawPluginDefinition } from "openclaw/plugin-sdk";

const plugin: OpenClawPluginDefinition = {
  id: "my-feature",
  name: "My Feature",
  version: "1.0.0",

  register(api) {
    // 注册自定义工具
    api.registerTool({
      name: "my_tool",
      description: "自定义工具",
      schema: Type.Object({
        action: Type.String(),
      }),
      handler: async (params) => {
        return { text: "OK" };
      },
    });

    // 注册 Agent 生命周期钩子
    api.on("before_agent_start", async (event, ctx) => {
      return {
        prependContext: "额外上下文信息",
      };
    });

    // 注册自定义命令
    api.registerCommand({
      name: "mycommand",
      description: "自定义斜杠命令",
      handler: (ctx) => {
        return { text: `执行了 /mycommand ${ctx.args}` };
      },
    });

    // 注册 HTTP 路由
    api.registerHttpRoute({
      path: "/api/my-feature/status",
      handler: (req, res) => {
        res.json({ status: "ok" });
      },
    });

    // 注册后台服务
    api.registerService({
      id: "my-background-worker",
      start: async (ctx) => {
        ctx.logger.info("后台服务已启动");
        // 启动后台逻辑
      },
      stop: async (ctx) => {
        ctx.logger.info("后台服务已停止");
      },
    });
  },
};

export default plugin;
```

---

## 21. Plugin SDK 接口参考

### 21.1 导入方式

```typescript
import {
  // 核心类型
  type OpenClawPluginApi,
  type OpenClawPluginDefinition,
  type OpenClawConfig,
  type PluginRuntime,

  // 通道类型
  type ChannelPlugin,
  type ChannelConfigAdapter,
  type ChannelOutboundAdapter,
  type ChannelCapabilities,

  // 工具类型
  type AnyAgentTool,
  type OpenClawPluginToolFactory,
  type OpenClawPluginToolContext,

  // 钩子类型
  type PluginHookName,
  type PluginHookHandlerMap,

  // 工具函数
  buildChannelConfigSchema,
  deleteAccountFromConfigSection,
  setAccountEnabledInConfigSection,
  resolveChannelMediaMaxBytes,
  resolveControlCommandGate,

  // 通道专用工具
  normalizeDiscordMessagingTarget,
  normalizeSlackMessagingTarget,
  resolveDiscordAccount,
  resolveSlackAccount,
  // ... 更多
} from "openclaw/plugin-sdk";
```

### 21.2 SDK 生成

Plugin SDK 的类型声明通过以下流程生成：

```bash
pnpm build:plugin-sdk:dts    # 基于 tsconfig.plugin-sdk.dts.json 生成 .d.ts
```

输出到 `dist/plugin-sdk/*.d.ts`，运行时通过 `jiti` 别名解析 `openclaw/plugin-sdk` 导入。

---

## 22. 数据流与消息管线

### 22.1 入站消息管线 (Inbound)

```
1. 通道适配器接收消息
   │
2. 访问策略检查
   ├── DM 策略: pairing | allowlist | open | disabled
   ├── 群组策略: mention | open | disabled
   └── 白名单验证
   │
3. 会话键解析 (resolveAgentRoute)
   ├── peer 绑定 → binding.peer
   ├── 账号绑定 → binding.account
   └── 默认 → default agent
   │
4. Agent 配置加载
   ├── 模型配置 (primary + fallbacks)
   ├── 工具策略 (profile + allow/deny)
   └── 沙箱配置
   │
5. 系统提示词组装
   ├── AGENTS.md (系统提示词)
   ├── SOUL.md (人设/性格)
   ├── TOOLS.md (工具使用指南)
   └── Skills (技能提示词注入)
   │
6. 会话历史加载 (JSONL)
   │
7. 模型 API 调用
   ├── Auth Profile 选择
   ├── 工具调用 → 沙箱/主机执行
   └── 流式输出 → Gateway Events
   │
8. 会话持久化 (追加 JSONL)
   │
9. 回复分发到通道
   ├── 文本分块 (按通道限制)
   ├── 媒体转换 (格式/尺寸)
   └── 发送到目标通道
```

### 22.2 出站消息管线 (Outbound)

```
1. Agent 生成回复（或 send RPC 调用）
   │
2. message_sending 钩子 → 可修改/取消
   │
3. 通道 Outbound 适配器
   ├── 文本分块 (chunkMarkdownText)
   ├── 媒体处理 (resizeToJpeg, detectMime)
   └── 投票/反应等特殊消息
   │
4. 通道 API 发送
   │
5. message_sent 钩子 → 回调通知
```

### 22.3 Gateway WebSocket 数据流

```
Dashboard ←→ Gateway (ws://127.0.0.1:18789)
    │
    ├── connect (握手)
    ├── agent (发送消息，接收流式回复)
    ├── config.* (配置 CRUD)
    ├── sessions.* (会话管理)
    ├── channels.* (通道状态)
    ├── node.* (设备操作)
    ├── cron.* (定时任务)
    └── Events (presence, health, agent streaming, ...)
```

---

## 23. 文件系统布局

### 23.1 运行时数据目录

```
~/.openclaw/
├── openclaw.json              # 主配置文件
├── .env                       # 环境变量
├── credentials/               # 通道认证凭据
│   ├── whatsapp/              # WhatsApp QR/session
│   ├── telegram/              # Telegram bot token
│   └── ...
├── agents/
│   └── {agentId}/
│       ├── agent/
│       │   └── auth-profiles.json   # 模型凭据存储
│       ├── sessions/                 # 会话记录 (JSONL)
│       │   ├── {sessionKey}.jsonl
│       │   ├── {sessionKey}.meta.json
│       │   └── {sessionKey}.state.json
│       └── workspace/
│           ├── AGENTS.md             # 系统提示词
│           ├── SOUL.md               # 人设定义
│           ├── TOOLS.md              # 工具指南
│           └── skills/               # Agent 专属技能
├── workspace/                        # 默认 Agent 工作区
├── skills/                           # 托管技能目录
├── hooks/                            # 托管钩子目录
├── plugins/                          # 插件状态目录
└── logs/                             # JSONL 调试日志
```

### 23.2 项目源码目录

```
openclaw/src/
├── index.ts, entry.ts, runtime.ts     # 入口点
├── cli/                               # CLI 命令 (109 文件)
│   ├── program.ts                     # Commander.js 程序
│   ├── daemon-cli/                    # 守护进程管理
│   ├── gateway-cli/                   # Gateway 控制
│   ├── node-cli/                      # 节点管理
│   └── cron-cli/                      # Cron 管理
├── commands/                          # 命令实现 (189 文件)
├── gateway/                           # 网关层 (133 文件)
│   ├── protocol/                      # 协议 schema
│   └── server-methods/                # RPC 处理器
├── agents/                            # Agent 系统 (316 文件)
│   ├── tools/                         # 工具实现
│   ├── skills/                        # 技能加载
│   ├── auth-profiles/                 # 凭据管理
│   └── sandbox/                       # 沙箱
├── channels/                          # 通道基础 (33 文件)
├── telegram/                          # Telegram (87 文件)
├── discord/                           # Discord (44 文件)
├── slack/                             # Slack (36 文件)
├── signal/                            # Signal (24 文件)
├── imessage/                          # iMessage (16 文件)
├── line/                              # LINE (36 文件)
├── config/                            # 配置系统 (132 文件)
├── memory/                            # 记忆系统 (50 文件)
├── plugins/                           # 插件系统 (39 文件)
├── hooks/                             # 钩子系统 (30 文件)
├── sessions/                          # 会话管理 (9 文件)
├── routing/                           # 路由逻辑 (7 文件)
├── security/                          # 安全模块 (17 文件)
├── media/                             # 媒体处理 (22 文件)
├── media-understanding/               # 媒体理解 (23 文件)
├── browser/                           # 浏览器自动化 (71 文件)
├── cron/                              # 定时任务 (37 文件)
├── daemon/                            # 守护进程 (32 文件)
├── auto-reply/                        # 自动回复 (73 文件)
├── acp/                               # Agent Client Protocol (15 文件)
├── pairing/                           # 设备配对 (7 文件)
├── infra/                             # 基础设施 (159 文件)
├── terminal/                          # 终端 UI (14 文件)
├── providers/                         # Provider 抽象 (10 文件)
├── process/                           # 进程管理 (11 文件)
└── canvas-host/                       # Canvas 渲染 (7 文件)
```

---

## 24. 构建与测试

### 24.1 核心脚本

```bash
# 构建
pnpm build                    # 完整构建 (tsdown + DTS + UI)
pnpm build:plugin-sdk:dts     # 生成插件 SDK 类型声明

# 开发
pnpm dev                      # 开发模式运行 CLI
pnpm gateway:dev              # 开发模式启动 Gateway
pnpm ui:dev                   # 启动 Web UI 开发服务器

# 测试
pnpm test                     # 全部测试
pnpm test:unit                # 仅单元测试
pnpm test:e2e                 # E2E 测试
pnpm test:live                # 真实 API 测试 (需要 LIVE=1)
pnpm test:coverage            # 覆盖率报告

# 质量检查
pnpm check                    # 格式 + 类型 + Lint
pnpm lint                     # Oxlint
pnpm format                   # Oxfmt
pnpm tsgo                     # TypeScript 类型检查

# 协议
pnpm protocol:gen             # 生成 Gateway 协议 schema
pnpm protocol:gen:swift       # 生成 Swift 协议模型
pnpm protocol:check           # 校验协议一致性
```

### 24.2 测试配置

| 配置文件 | 范围 | 特点 |
|----------|------|------|
| `vitest.config.ts` | 主配置 | V8 Coverage, 70% 阈值, fork pool |
| `vitest.unit.config.ts` | 单元测试 | 仅 `*.test.ts` |
| `vitest.e2e.config.ts` | E2E | `*.e2e.test.ts` |
| `vitest.live.config.ts` | 真实 API | `*.live.test.ts`, 需要 `LIVE=1` |
| `vitest.extensions.config.ts` | 扩展测试 | `extensions/` 目录 |
| `vitest.gateway.config.ts` | Gateway 测试 | Gateway 专属 |

### 24.3 覆盖率标准

- **行覆盖率**: ≥ 70%
- **函数覆盖率**: ≥ 70%
- **语句覆盖率**: ≥ 70%
- **分支覆盖率**: ≥ 55%

---

## 25. Dashboard 接入建议

### 25.1 推荐接入方式

Dashboard 应通过 **Gateway WebSocket 协议** 接入，这是 OpenClaw 的标准控制平面接口：

```typescript
// 连接 Gateway
const ws = new WebSocket("ws://127.0.0.1:18789");

// 发送请求
function sendRequest(method: string, params: object): Promise<any> {
  const id = crypto.randomUUID();
  ws.send(JSON.stringify({ type: "req", id, method, params }));
  return waitForResponse(id);
}

// 监听事件
ws.addEventListener("message", (event) => {
  const frame = JSON.parse(event.data);
  if (frame.type === "event") {
    handleEvent(frame.event, frame.payload);
  }
});
```

### 25.2 核心接入模块

| Dashboard 功能 | Gateway 方法 | 说明 |
|---------------|-------------|------|
| **系统状态** | `health`, `status`, `status.all` | 网关健康、通道状态、Agent 状态 |
| **Agent 管理** | `agents.list/get/create/update/delete` | Agent CRUD |
| **会话管理** | `sessions.list/get/patch/reset/delete` | 会话查看与控制 |
| **会话记录** | `sessions.transcript` | 导出对话记录 |
| **Token 用量** | `sessions.usage` | 统计 Token 消耗 |
| **模型管理** | `models.list`, `models.scan` | 可用模型与扫描 |
| **技能管理** | `skills.list/install/update/remove` | 技能安装与管理 |
| **通道状态** | `channels.status/probe/audit` | 通道连接状态 |
| **通道登录** | `channels.login/logout` | 通道认证 |
| **配置管理** | `config.get/set/patch/apply/schema` | 配置读写 |
| **设备管理** | `node.list/describe`, `device.list` | 设备查看 |
| **设备配对** | `node.pair.approve/reject` | 配对审批 |
| **定时任务** | `cron.list/add/update/remove/run` | 定时任务管理 |
| **执行审批** | `exec.approval.list/approve/reject` | 安全审批 |
| **日志查看** | `logs`, `logs.stream.start/stop` | 实时日志流 |
| **消息发送** | `send` | 通过指定通道发消息 |
| **对话** | `agent`, `chat` | 直接与 Agent 对话 |

### 25.3 实时事件监听

Dashboard 应监听以下事件以实现实时更新：

```typescript
const eventHandlers: Record<string, (payload: any) => void> = {
  // Agent 流式输出
  "agent": (p) => updateAgentStream(p),

  // 系统状态
  "presence": (p) => updatePresence(p),
  "health": (p) => updateHealth(p),

  // 配置变更
  "config.changed": (p) => reloadConfig(p),

  // 会话更新
  "session.updated": (p) => refreshSession(p),

  // 配对请求
  "node.pair.request": (p) => showPairingDialog(p),
  "device.pair.request": (p) => showDevicePairingDialog(p),

  // 执行审批
  "exec.approval.request": (p) => showApprovalDialog(p),

  // 日志流
  "log": (p) => appendLog(p),

  // 网关关闭
  "shutdown": () => handleShutdown(),
};
```

### 25.4 认证接入

```typescript
// 1. 建立 WebSocket 连接
const ws = new WebSocket("ws://127.0.0.1:18789");

// 2. 等待 connect.challenge 事件
ws.onmessage = (e) => {
  const frame = JSON.parse(e.data);
  if (frame.type === "event" && frame.event === "connect.challenge") {
    // 3. 回应挑战
    ws.send(JSON.stringify({
      type: "req",
      id: "connect-1",
      method: "connect",
      params: {
        token: "YOUR_GATEWAY_TOKEN",  // 或 password: "YOUR_PASSWORD"
        protocol: 3,                   // 协议版本
      }
    }));
  }
};
```

### 25.5 OpenAI 兼容 API

Gateway 还提供 OpenAI 兼容的 HTTP API，可用于简单集成：

```bash
curl http://127.0.0.1:18789/v1/chat/completions \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-opus-4-6",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

### 25.6 关键注意事项

1. **协议版本**: 始终使用 `protocol: 3`，Gateway 向后兼容但推荐最新版
2. **认证要求**: 非 `127.0.0.1` 访问**必须**提供 Token/Password
3. **事件序列号**: 使用 `seq` 字段保证事件顺序
4. **错误处理**: 检查 `res.ok` 字段，错误详情在 `res.error`
5. **配置变更**: 监听 `config.changed` 事件实现实时同步
6. **会话键格式**: `agent:{agentId}:{provider}:{scope}:{identifier}`
7. **流式输出**: `agent` 方法通过事件流返回，不是一次性响应
8. **重连策略**: WebSocket 断线后应使用指数退避重连

---

## 附录 A：主要依赖列表

### 模型 Provider SDK

| 依赖 | 版本 | 用途 |
|------|------|------|
| `@agentclientprotocol/sdk` | 0.14.1 | Agent 协议 |
| `@aws-sdk/client-bedrock` | ^3.986.0 | AWS Bedrock 模型 |

### 消息通道

| 依赖 | 版本 | 用途 |
|------|------|------|
| `@slack/bolt` | ^4.6.0 | Slack 集成 |
| `grammy` | ^1.40.0 | Telegram 集成 |
| `@whiskeysockets/baileys` | 7.0.0-rc.9 | WhatsApp 集成 |
| `@line/bot-sdk` | ^10.6.0 | LINE 集成 |
| `@larksuiteoapi/node-sdk` | ^1.58.0 | 飞书/Lark 集成 |
| `discord-api-types` + `ws` | - | Discord 集成 |

### AI/Agent 基础

| 依赖 | 版本 | 用途 |
|------|------|------|
| `@mariozechner/pi-agent-core` | 0.52.9 | PI Agent 核心运行时 |
| `@sinclair/typebox` | 0.34.48 | JSON Schema 验证 |
| `zod` | ^4.3.6 | 运行时类型验证 |

### 基础设施

| 依赖 | 版本 | 用途 |
|------|------|------|
| `express` | ^5.2.1 | Web 服务器 |
| `playwright-core` | 1.58.2 | 浏览器自动化 |
| `ws` | ^8.19.0 | WebSocket |
| `croner` | ^10.0.1 | Cron 调度 |
| `sqlite-vec` | 0.1.7-alpha.2 | 向量数据库 |
| `sharp` | ^0.34.5 | 图像处理 |

---

## 附录 B：环境变量参考

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `OPENCLAW_GATEWAY_PORT` | Gateway 端口 | 18789 |
| `OPENCLAW_GATEWAY_HOST` | Gateway 绑定地址 | 127.0.0.1 |
| `OPENCLAW_GATEWAY_TOKEN` | Gateway 认证 Token | - |
| `OPENCLAW_GATEWAY_PASSWORD` | Gateway 认证密码 | - |
| `OPENCLAW_CONFIG_DIR` | 配置目录 | ~/.openclaw |
| `ANTHROPIC_API_KEY` | Anthropic API Key | - |
| `OPENAI_API_KEY` | OpenAI API Key | - |
| `LIVE` | 启用真实 API 测试 | - |

---

## 附录 C：文档资源

| 资源 | URL |
|------|-----|
| 官方文档 | https://docs.openclaw.ai |
| DeepWiki | https://deepwiki.com/openclaw/openclaw |
| GitHub | https://github.com/openclaw/openclaw |
| Discord | https://discord.gg/clawd |
| 入门指南 | https://docs.openclaw.ai/start/getting-started |
| 插件开发 | https://docs.openclaw.ai/plugins |
| Gateway 文档 | https://docs.openclaw.ai/gateway |
| CLI 命令参考 | https://docs.openclaw.ai/cli |
