# 项目升级总结

## 问题诊断

原项目使用 Web Speech API，依赖 Google 服务，在国内无法访问，导致"网络错误"。

## 解决方案

参考 TEN framework 架构，实现基于 Deepgram 的实时语音识别系统。

## 技术架构

### 前端（public/app.js）
- 使用 MediaRecorder API 捕获麦克风音频
- 每 250ms 发送音频数据到后端
- 接收并显示实时识别结果
- 处理最终识别结果并执行命令

### 后端（electron/main.js）
- 集成 Deepgram SDK
- 建立 WebSocket 连接到 Deepgram Live API
- 转发音频流到 Deepgram
- 接收识别结果并通过 IPC 发送到前端

### 通信层（electron/preload.js）
- 安全的 IPC 通信桥接
- 暴露 Deepgram 相关 API 到渲染进程

## 核心改动

### 1. 依赖安装
```bash
npm install @deepgram/sdk dotenv
```

### 2. 环境配置
- 创建 `.env.example` 模板
- 添加 `.gitignore` 保护敏感信息

### 3. 代码重构
- **electron/main.js**: 添加 Deepgram 集成逻辑
- **electron/preload.js**: 添加 Deepgram IPC 接口
- **public/app.js**: 替换 Web Speech API 为 MediaRecorder + Deepgram

## 使用流程

1. 获取 Deepgram API Key（https://console.deepgram.com/）
2. 创建 `.env` 文件并配置 API Key
3. 运行 `npm start` 启动应用
4. 点击麦克风开始实时对话

## 优势

| 特性 | Web Speech API | Deepgram |
|------|----------------|----------|
| 国内可用性 | ❌ 不可用 | ✅ 可用 |
| 识别准确度 | 中等 | 高 |
| 实时性 | 好 | 优秀 |
| 自定义能力 | 有限 | 丰富 |
| 成本 | 免费 | 按量付费（有免费额度） |

## 文档

- `DEEPGRAM_SETUP.md`: 详细配置和使用指南
- `QUICKSTART_DEEPGRAM.md`: 快速开始指南
- `.env.example`: 环境变量模板

## 成本

- 新用户: $200 免费额度
- Pay-as-you-go: $0.0043/分钟
- 每天使用 30 分钟约 $0.13

## 下一步

1. 配置 Deepgram API Key
2. 测试实时语音识别
3. 根据需要调整识别参数
4. 考虑添加 TTS 语音回复功能

## 技术支持

遇到问题请查看：
1. 控制台日志（`npm run dev` 开启开发模式）
2. `DEEPGRAM_SETUP.md` 常见问题部分
3. Deepgram 官方文档
