# OpenClaw Desktop Assistant V2 开发计划

## 版本目标

将桌面助手从预录视频升级为实时唇形同步的虚拟人，并优化语音交互的延迟和自然度。

---

## 短期目标（1-2周）

### 1. TTS 引擎对比测试 ⭐⭐⭐

**目标：** 评估 ElevenLabs Flash v2.5 vs MiniMax speech-02-turbo

**测试维度：**
- 延迟（首字节时间 TTFB）
- 音质（自然度、情感表达）
- 中文支持（发音准确度、多音字）
- 成本（每 1000 字符价格）
- 流式支持（是否支持逐句合成）

**实施步骤：**
1. 注册 ElevenLabs 账号，获取 API Key
2. 在 `electron/main.js` 中实现 ElevenLabs TTS 函数（与 MiniMax 并行）
3. 添加配置项 `TTS_PROVIDER=minimax|elevenlabs`
4. 准备 10 条测试文本（短句、长句、专业术语、情感表达）
5. 记录对比数据，生成测试报告

**预期产出：**
- `docs/tts-comparison.md` 测试报告
- 可切换的 TTS 引擎实现

---

### 2. 升级 Deepgram Nova-3 ⭐⭐

**目标：** 降低 STT 延迟 100-200ms

**实施步骤：**
1. 修改 `electron/main.js` 第 691 行：`model: 'nova-2'` → `model: 'nova-3'`
2. 测试识别准确率是否下降
3. 对比延迟改善效果

**预期收益：**
- 语音识别延迟从 ~500ms 降至 ~300ms
- 更快的对话响应体验

---

## 中期目标（1-2月）

### 3. 实时唇形同步头像 ⭐⭐⭐

**目标：** 替换预录视频为实时生成的唇形同步虚拟人

**技术方案调研：**

| 方案 | 优点 | 缺点 | 成本 |
|---|---|---|---|
| **LemonSlice** | 低延迟（<100ms），LiveKit 集成 | 需要 LiveKit 架构 | 未知 |
| **D-ID** | 成熟稳定，API 简单 | 延迟较高（~1s） | $0.12/分钟 |
| **HeyGen** | 高质量，多语言 | 延迟高，成本高 | $0.50/分钟 |
| **Wav2Lip (开源)** | 免费，可本地部署 | 需要 GPU，质量一般 | 免费 |
| **SadTalker (开源)** | 免费，效果较好 | 需要 GPU，首次加载慢 | 免费 |

**推荐方案：**
- **短期：** D-ID（快速验证，API 简单）
- **长期：** 本地部署 SadTalker（成本低，隐私好）

**实施步骤（D-ID 方案）：**
1. 注册 D-ID 账号，获取 API Key
2. 准备角色静态头像（PNG/JPG，正面照）
3. 实现 D-ID Streaming API 集成：
   - 创建流式会话
   - 发送 TTS 音频流
   - 接收视频流并播放
4. 修改前端视频播放逻辑，支持实时流
5. 优化缓冲策略，减少卡顿

**实施步骤（SadTalker 本地方案）：**
1. 搭建 Python 后端服务（FastAPI）
2. 部署 SadTalker 模型（需要 CUDA GPU）
3. 实现 WebSocket 接口：接收音频 → 生成视频帧 → 推送到前端
4. Electron 通过 IPC 调用本地服务
5. 优化模型加载和推理速度

**预期产出：**
- 实时唇形同步的虚拟人头像
- 更自然的视觉交互体验
- 可配置的头像切换（用户上传自定义头像）

---

### 4. 多语言支持 ⭐⭐

**目标：** 支持中英文自动切换

**实施步骤：**
1. 添加语言检测（前端或后端）
2. Deepgram 配置支持 `language: 'multi'` 或动态切换
3. TTS 根据语言选择对应音色
4. UI 添加语言切换按钮

---

## 长期目标（3-6月）

### 5. 主动提醒功能 ⭐⭐⭐

**功能描述：**
- 用户设置定时提醒（"每天早上 9 点提醒我开会"）
- 助手主动唤醒并语音播报
- 支持自然语言设置提醒

**技术实现：**
- 使用 `node-cron` 或 `node-schedule` 管理定时任务
- 提醒数据存储在本地 SQLite
- 提醒触发时播放 TTS + 显示通知

---

### 6. 自定义角色上传 ⭐⭐

**功能描述：**
- 用户上传自己的头像照片
- 系统生成对应的虚拟人模型
- 支持多个自定义角色

**技术实现：**
- 前端上传图片到本地或云存储
- 调用 D-ID/SadTalker 生成模型
- 保存角色配置到本地数据库

---

### 7. Windows 平台支持 ⭐

**实施步骤：**
1. 修改 `electron-builder` 配置，添加 Windows 目标
2. 测试 Windows 上的音频采集和播放
3. 适配 Windows 特有的 UI 样式
4. 构建 `.exe` 安装包

---

## 技术债务

### 需要优化的部分

1. **代码模块化**
   - `electron/main.js` 过长（1020 行），拆分为多个模块
   - 提取 STT、TTS、MQTT 为独立类

2. **错误处理**
   - 增强 MQTT 断线重连逻辑
   - TTS 失败时的降级策略

3. **性能优化**
   - 音频队列内存管理
   - 视频播放缓冲优化

4. **测试覆盖**
   - 添加单元测试（Jest）
   - 集成测试（Playwright）

---

## 里程碑

| 版本 | 时间 | 核心功能 |
|---|---|---|
| **v1.1** | 2周后 | ElevenLabs TTS + Nova-3 STT |
| **v2.0** | 2月后 | 实时唇形同步头像（D-ID） |
| **v2.1** | 3月后 | 多语言支持 + 主动提醒 |
| **v2.5** | 6月后 | 自定义角色 + Windows 支持 |

---

## 成本估算

| 服务 | 月费用（预估） | 备注 |
|---|---|---|
| Deepgram Nova-3 | $50-100 | 按使用量计费 |
| ElevenLabs | $30-80 | 取决于使用量 |
| D-ID | $50-150 | 按分钟计费 |
| EMQX Cloud | $0 | 免费额度足够 |
| **总计** | **$130-330/月** | 中等使用量 |

**降本方案：**
- 使用开源 SadTalker 替代 D-ID（需要 GPU 服务器）
- 自建 Deepgram 替代方案（Whisper）

---

## 风险评估

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| D-ID 延迟过高 | 用户体验差 | 提前测试，准备本地方案 |
| GPU 成本高 | 运营成本增加 | 优先使用云服务，按需切换 |
| 唇形同步不自然 | 视觉体验差 | 多方案对比，选择最优 |
| Windows 兼容性问题 | 用户覆盖受限 | 提前测试，逐步适配 |

---

## 参考资源

- [LiveKit Agents](https://github.com/livekit/agents)
- [D-ID API Docs](https://docs.d-id.com/)
- [ElevenLabs API Docs](https://elevenlabs.io/docs)
- [SadTalker GitHub](https://github.com/OpenTalker/SadTalker)
- [Wav2Lip GitHub](https://github.com/Rudrabha/Wav2Lip)
