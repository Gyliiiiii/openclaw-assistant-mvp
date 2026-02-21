#!/usr/bin/env node
/**
 * TTS 对比测试脚本
 * 用法: node test-tts.js
 */

require('dotenv').config();
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

// 测试文本
const TEST_TEXTS = [
  '你好，我是你的AI助手。',
  '今天天气真不错，适合出去散步。',
  '人工智能技术正在快速发展，深度学习、自然语言处理等领域取得了显著进展。',
  '我能帮你做什么呢？比如查询天气、设置提醒、回答问题等等。',
  '这是一段较长的测试文本，用来评估语音合成的流畅度和自然度。我们希望通过这个测试，找到最适合我们项目的TTS引擎。'
];

// 配置
const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY;
const MINIMAX_GROUP_ID = process.env.MINIMAX_GROUP_ID;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';

// 创建输出目录
const OUTPUT_DIR = path.join(__dirname, 'tts-test-output');
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR);
}

// MiniMax TTS
async function testMiniMax(text, index) {
  const startTime = Date.now();

  const response = await fetch(
    `https://api.minimax.io/v1/t2a_v2?GroupId=${MINIMAX_GROUP_ID}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MINIMAX_API_KEY}`
      },
      body: JSON.stringify({
        model: 'speech-02-turbo',
        text: text,
        stream: false,
        voice_setting: {
          voice_id: 'Lovely_Girl',
          speed: 1.0,
          vol: 1.0,
          pitch: 0
        },
        audio_setting: {
          sample_rate: 32000,
          format: 'mp3',
          bitrate: 128000
        },
        language_boost: 'Chinese'
      })
    }
  );

  const duration = Date.now() - startTime;
  const data = await response.json();

  if (data.data && data.data.audio) {
    const audioBuffer = Buffer.from(data.data.audio, 'hex');
    const filename = `minimax_${index}.mp3`;
    fs.writeFileSync(path.join(OUTPUT_DIR, filename), audioBuffer);

    return {
      provider: 'MiniMax',
      duration,
      size: audioBuffer.length,
      filename
    };
  }

  throw new Error('MiniMax 返回无效数据');
}

// ElevenLabs TTS
async function testElevenLabs(text, index) {
  const startTime = Date.now();

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
    {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': ELEVENLABS_API_KEY
      },
      body: JSON.stringify({
        text: text,
        model_id: 'eleven_flash_v2_5',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75
        }
      })
    }
  );

  const duration = Date.now() - startTime;

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ElevenLabs API ${response.status}: ${errorText}`);
  }

  const audioBuffer = Buffer.from(await response.arrayBuffer());

  // 检查是否是错误响应
  if (audioBuffer.length < 1000) {
    const text = audioBuffer.toString('utf-8');
    if (text.includes('detail') || text.includes('error')) {
      throw new Error(`ElevenLabs 返回错误: ${text}`);
    }
  }

  const filename = `elevenlabs_${index}.mp3`;
  fs.writeFileSync(path.join(OUTPUT_DIR, filename), audioBuffer);

  return {
    provider: 'ElevenLabs',
    duration,
    size: audioBuffer.length,
    filename
  };
}

// 运行测试
async function runTests() {
  console.log('=== TTS 对比测试 ===\n');

  const results = [];

  for (let i = 0; i < TEST_TEXTS.length; i++) {
    const text = TEST_TEXTS[i];
    console.log(`测试 ${i + 1}/${TEST_TEXTS.length}: "${text.substring(0, 30)}..."`);

    try {
      // 测试 MiniMax
      if (MINIMAX_API_KEY && MINIMAX_GROUP_ID) {
        const minimax = await testMiniMax(text, i + 1);
        console.log(`  ✓ MiniMax: ${minimax.duration}ms, ${minimax.size} bytes`);
        results.push({ text, ...minimax });
      }

      // 测试 ElevenLabs
      if (ELEVENLABS_API_KEY) {
        const elevenlabs = await testElevenLabs(text, i + 1);
        console.log(`  ✓ ElevenLabs: ${elevenlabs.duration}ms, ${elevenlabs.size} bytes`);
        results.push({ text, ...elevenlabs });
      }

      console.log('');
    } catch (error) {
      console.error(`  ✗ 错误: ${error.message}\n`);
    }
  }

  // 生成报告
  generateReport(results);
}

function generateReport(results) {
  const minimax = results.filter(r => r.provider === 'MiniMax');
  const elevenlabs = results.filter(r => r.provider === 'ElevenLabs');

  const report = `# TTS 对比测试报告

生成时间: ${new Date().toLocaleString('zh-CN')}

## 测试结果

### MiniMax
- 平均延迟: ${avg(minimax.map(r => r.duration)).toFixed(0)}ms
- 平均文件大小: ${avg(minimax.map(r => r.size)).toFixed(0)} bytes

### ElevenLabs
- 平均延迟: ${avg(elevenlabs.map(r => r.duration)).toFixed(0)}ms
- 平均文件大小: ${avg(elevenlabs.map(r => r.size)).toFixed(0)} bytes

## 详细数据

| 测试 | 提供商 | 延迟(ms) | 大小(bytes) | 文件 |
|---|---|---|---|---|
${results.map((r, i) => `| ${Math.floor(i / 2) + 1} | ${r.provider} | ${r.duration} | ${r.size} | ${r.filename} |`).join('\n')}

## 音频文件

所有生成的音频文件保存在 \`tts-test-output/\` 目录中。
请手动播放并评估音质、自然度、发音准确度。
`;

  fs.writeFileSync(path.join(OUTPUT_DIR, 'report.md'), report);
  console.log(`\n报告已生成: ${path.join(OUTPUT_DIR, 'report.md')}`);
}

function avg(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// 执行
runTests().catch(console.error);
