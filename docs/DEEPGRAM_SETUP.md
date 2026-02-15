# Deepgram 实时语音识别集成指南

## 概述

项目已从 Web Speech API 升级为基于 Deepgram 的实时语音识别架构，解决了国内网络访问问题。

## 架构说明

### 技术栈
- **前端**: MediaRecorder API（音频捕获）
- **后端**: Deepgram SDK（实时语音识别）
- **通信**: Electron IPC（音频流传输）

### 数据流
```
麦克风 → MediaRecorder → IPC → Deepgram Live API → 实时转录结果 → 命令处理
```

## 配置步骤

### 1. 获取 Deepgram API Key

1. 访问 [Deepgram Console](https://console.deepgram.com/)
2. 注册/登录账号
3. 创建新项目
4. 生成 API Key
5. 复制 API Key

### 2. 配置环境变量

在项目根目录创建 `.env` 文件：

```bash
cp .env.example .env
```

编辑 `.env` 文件，填入你的 API Key：

```env
DEEPGRAM_API_KEY=你的_deepgram_api_key
```

### 3. 启动应用

```bash
npm start
```

## 使用方法

1. **开始对话**
   - 点击麦克风图标（变红色表示开始录音）
   - 直接说话，系统会实时显示识别内容
   - 格式：`正在识别: [你说的内容]`

2. **执行命令**
   - 说完整的命令，例如："今天有什么邮件"
   - 系统识别完成后自动执行命令
   - 显示结果并打开相应面板

3. **停止对话**
   - 再次点击麦克风图标停止录音

## 支持的命令

- "今天有什么邮件" / "查看邮件" / "email"
- "今天的日程安排" / "今日汇报" / "briefing"
- 其他包含关键词的自然语言命令

## 技术细节

### Deepgram 配置

```javascript
{
  model: 'nova-2',           // 最新的语音识别模型
  language: 'zh-CN',         // 中文识别
  smart_format: true,        // 智能格式化（标点符号等）
  interim_results: true,     // 返回实时识别结果
  utterance_end_ms: 1000,    // 语句结束检测（1秒）
  vad_events: true           // 语音活动检测
}
```

### 音频参数

```javascript
{
  channelCount: 1,           // 单声道
  sampleRate: 16000          // 16kHz 采样率
}
```

### MediaRecorder 配置

```javascript
{
  mimeType: 'audio/webm;codecs=opus',  // Opus 编码
  timeslice: 250                        // 每 250ms 发送一次数据
}
```

## 与 Web Speech API 的对比

| 特性 | Web Speech API | Deepgram |
|------|----------------|----------|
| 网络依赖 | Google 服务（国内不可用） | Deepgram API（全球可用） |
| 识别准确度 | 中等 | 高 |
| 实时性 | 好 | 优秀 |
| 语言支持 | 有限 | 广泛 |
| 成本 | 免费 | 按使用量付费 |
| 自定义 | 有限 | 丰富 |

## 常见问题

### 1. 提示"请先配置 Deepgram API Key"

**原因**: 未配置或配置错误
**解决**: 检查 `.env` 文件是否存在，API Key 是否正确

### 2. 麦克风权限被拒绝

**原因**: 浏览器/系统未授予麦克风权限
**解决**:
- macOS: 系统偏好设置 → 安全性与隐私 → 麦克风
- 浏览器: 点击地址栏的麦克风图标，允许访问

### 3. 识别结果不准确

**可能原因**:
- 环境噪音过大
- 麦克风质量问题
- 说话不清晰

**优化建议**:
- 使用质量较好的麦克风
- 在安静环境中使用
- 说话清晰，语速适中

### 4. 网络连接错误

**原因**: 无法连接到 Deepgram API
**解决**:
- 检查网络连接
- 确认 API Key 有效
- 检查防火墙设置

## 成本估算

Deepgram 定价（截至 2026年）:
- **Pay-as-you-go**: $0.0043/分钟
- **Growth Plan**: $0.0036/分钟（月费 $99）
- **免费额度**: 新用户通常有 $200 免费额度

**示例**:
- 每天使用 30 分钟 = $0.13/天
- 每月使用 15 小时 = $3.87/月

## 下一步优化

1. **添加语音唤醒词**: 实现"你好助手"唤醒功能
2. **集成 TTS**: 添加语音回复功能
3. **本地缓存**: 缓存常用命令的识别结果
4. **多语言支持**: 支持英文等其他语言
5. **自定义词汇**: 添加专业术语识别
6. **降噪处理**: 前端音频预处理

## 参考资源

- [Deepgram 官方文档](https://developers.deepgram.com/)
- [Deepgram Node.js SDK](https://github.com/deepgram/deepgram-node-sdk)
- [MediaRecorder API](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder)
- [TEN Framework 参考](https://github.com/TEN-framework/ten-framework)

## 技术支持

如遇问题，请检查：
1. 控制台日志（开发模式: `npm run dev`）
2. Deepgram API 状态
3. 网络连接状态
4. API Key 配额使用情况
