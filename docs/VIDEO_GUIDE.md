# 视频素材指南

## 需要准备的视频文件

请将以下视频文件放置在 `public/` 目录下：

### 1. 待机状态视频
**文件名**: `lobster-idle.mp4`
**用途**: 默认待机状态，没有交互时显示
**建议内容**:
- 龙虾静态站立或轻微呼吸动画
- 偶尔眨眼或小幅度移动
- 循环播放，时长建议 3-5 秒

### 2. 监听状态视频
**文件名**: `lobster-listening.mp4`
**用途**: 用户说话时，AI 正在监听
**建议内容**:
- 龙虾倾听的姿态
- 可以有耳朵或触角的动画
- 表现出专注聆听的样子
- 循环播放，时长建议 2-3 秒

### 3. 思考状态视频
**文件名**: `lobster-thinking.mp4`
**用途**: AI 正在思考回复内容
**建议内容**:
- 龙虾思考的动作
- 可以有头部转动、触角摆动等
- 表现出思考的样子
- 循环播放，时长建议 2-3 秒

### 4. 说话状态视频
**文件名**: `lobster-speaking.mp4`
**用途**: AI 正在语音回复
**建议内容**:
- 龙虾说话的动作
- 嘴部或钳子的开合动画
- 表现出交流的样子
- 循环播放，时长建议 2-3 秒

## 视频格式要求

### 推荐格式
- **格式**: MP4 (H.264) 或 WebM (VP9 with Alpha)
- **分辨率**: 320x400 (与窗口尺寸一致)
- **帧率**: 30fps
- **背景**: 透明背景（推荐使用 WebM VP9 格式支持 alpha 通道）

### 如果使用黑色背景
如果视频有黑色背景，CSS 已经配置了 `mix-blend-mode: screen` 来去除黑色。
但为了最佳效果，建议使用透明背景的视频。

## 转换视频为透明背景

### 使用 FFmpeg 转换为 WebM (透明背景)
```bash
ffmpeg -i input.mp4 -c:v libvpx-vp9 -pix_fmt yuva420p -auto-alt-ref 0 -an output.webm
```

### 调整视频尺寸
```bash
ffmpeg -i input.mp4 -vf scale=320:400 -c:v libx264 -crf 23 output.mp4
```

## 当前状态映射

| 应用状态 | 视频文件 | 触发时机 |
|---------|---------|---------|
| idle | lobster-idle.mp4 | 默认待机状态 |
| listening | lobster-listening.mp4 | 用户点击开始说话 |
| thinking | lobster-thinking.mp4 | AI 正在思考回复 |
| speaking | lobster-speaking.mp4 | AI 正在语音回复 |
| followup | lobster-listening.mp4 | 等待用户继续对话（复用 listening） |

## 测试视频

在准备好视频后：
1. 将视频文件放入 `public/` 目录
2. 重启应用: `npm start`
3. 点击龙虾测试不同状态的视频切换

## 扩展：添加情绪状态

如果需要添加情绪状态（高兴、低落等），可以：

1. 在 `app.js` 的 `VIDEO_SOURCES` 对象中添加新状态：
```javascript
const VIDEO_SOURCES = {
  // ... 现有状态
  happy: 'lobster-happy.mp4',
  sad: 'lobster-sad.mp4',
  excited: 'lobster-excited.mp4'
};
```

2. 在需要的地方调用 `setAppState('happy')` 来切换到对应状态

## 注意事项

- 所有视频都会自动循环播放（HTML 中设置了 `loop` 属性）
- 视频会自动静音播放（设置了 `muted` 属性）
- 视频切换是平滑的，会保持播放状态
- 如果视频文件不存在，会显示空白或错误
