# 闪退问题修复说明

## 问题原因

使用了已废弃的 `ScriptProcessorNode` API，导致应用崩溃。

## 修复方案

回退到 `MediaRecorder` API，并添加了：
1. 详细的错误日志
2. 更好的错误处理
3. MIME 类型兼容性检查
4. 更频繁的数据发送（100ms 间隔）

## 当前状态

✅ 应用已重新启动（开发模式）
✅ 添加了详细的 Console 日志
✅ 所有错误都会被捕获并显示

## 测试步骤

### 1. 查看应用窗口
应该已经打开，带有 DevTools

### 2. 打开 Console
在 DevTools 中查看 Console 标签

### 3. 点击麦克风
观察 Console 输出，应该看到：
```
开始请求麦克风权限...
麦克风权限已获取
Deepgram 连接已启动
使用 MIME 类型: audio/webm;codecs=opus
MediaRecorder 已启动
录音已开始
发送音频数据: XXX 字节
```

### 4. 说话测试
清晰地说："今天有什么邮件"

### 5. 观察结果
- 如果看到识别结果 → 成功！
- 如果闪退 → 查看 Console 最后的错误信息
- 如果没有识别结果 → 查看后端日志

## 查看后端日志

```bash
tail -f /tmp/electron-output.log
```

应该看到：
```
Deepgram 连接已建立
收到转录数据: {...}
转录结果: "今天有什么邮件", isFinal: true
```

## 如果还是闪退

请告诉我：
1. Console 中最后显示的消息
2. 是否看到"开始请求麦克风权限"
3. 是否弹出麦克风权限请求

## 备用方案

如果 Deepgram 实时流式识别有问题，我们可以：
1. 改用 Deepgram 的预录制 API（录完再识别）
2. 改用阿里云语音识别
3. 改用讯飞语音识别
4. 改用 OpenAI Whisper API

现在请测试并告诉我结果！
