# TTS 测试指南

## 快速开始

### 1. 配置 API Keys

在 `.env` 文件中添加：

```bash
# 选择 TTS 提供商
TTS_PROVIDER=minimax
# 可选: minimax | elevenlabs

# ElevenLabs 配置
ELEVENLABS_API_KEY=your_key_here
ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM
```

### 2. 运行对比测试

```bash
npm run test:tts
```

测试结果保存在 `tts-test-output/` 目录。

### 3. 切换 TTS 引擎

修改 `.env` 中的 `TTS_PROVIDER`：
- `minimax` - 使用 MiniMax
- `elevenlabs` - 使用 ElevenLabs

重启应用生效。

## 评估维度

1. **延迟** - 首字节时间（TTFB）
2. **音质** - 自然度、清晰度
3. **中文支持** - 发音准确度
4. **成本** - 每 1000 字符价格

## ElevenLabs 推荐音色

- `21m00Tcm4TlvDq8ikWAM` - Rachel (英文)
- `pNInz6obpgDQGcFmaJgB` - Adam (多语言，支持中文)

查看更多: https://elevenlabs.io/voice-library
