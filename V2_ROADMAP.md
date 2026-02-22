# OpenClaw Desktop Assistant V2 开发计划

## 版本目标

将桌面助手从预录视频升级为实时唇形同步的虚拟人，并优化语音交互的延迟和自然度。

---

## 短期目标（1-2周）

### 1. TTS 引擎对比测试 ⭐⭐⭐ ✅ 已完成

**目标：** 评估 ElevenLabs Flash v2.5 vs MiniMax speech-02-turbo

**完成时间：** 2026-02-21

**实施结果：**
- ✅ 实现 ElevenLabs TTS 集成
- ✅ 添加 TTS_PROVIDER 配置项支持切换
- ✅ 创建测试脚本 `test-tts.js`
- ✅ 完成对比测试并生成报告
- ✅ 修复音色切换功能
- ✅ 更新前端音色列表为 ElevenLabs 音色

**测试结论：**
- ElevenLabs 延迟更低，音质更自然
- 已切换为默认 TTS 引擎
- 保留 MiniMax 作为备选方案

---

### 2. Deepgram 模型优化 ⭐⭐ ✅ 已完成

**目标：** 降低 STT 延迟，支持多语言切换

**完成时间：** 2026-02-21

**实施结果：**
- ✅ 测试 Nova-3（延迟更低，但不支持中文）
- ✅ 回退到 Nova-2（保留中文支持）
- ✅ 添加 DEEPGRAM_MODEL 和 DEEPGRAM_LANGUAGE 环境变量配置
- ✅ 实现前端语言选择（中文 / English / 自动检测）
- ✅ 语言切换通过 `deepgram:setLanguage` IPC 调用，自动重连 Deepgram

**结论：**
- Nova-3 不支持中文，暂不适用于当前场景
- Nova-2 支持中英文，配合前端语言选择功能满足需求
- 模型和语言可通过环境变量灵活配置

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

### 4. 多语言支持 ⭐⭐ 🔄 部分完成

**目标：** 支持中英文自动切换

**已完成：**
- ✅ 前端语言选择 UI（中文 / English / 自动检测）
- ✅ Deepgram 模型和语言动态切换（`deepgram:setLanguage` IPC）
- ✅ 语言配置通过环境变量支持（`DEEPGRAM_MODEL`、`DEEPGRAM_LANGUAGE`）

**待完成：**
- [ ] TTS 根据语言自动选择对应音色
- [ ] 后端 Agent 多语言回复支持

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
   - `electron/main.js` 过长（1132 行），拆分为多个模块
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
| **v1.1** | ✅ 已完成 | ElevenLabs TTS + Nova-2 STT + 前端语言选择 |
| **v2.0** | 2月后 | 实时唇形同步头像（D-ID） |
| **v2.1** | 3月后 | 完善多语言支持 + 主动提醒 |
| **v2.5** | 6月后 | 自定义角色 + Windows 支持 |

---

## 成本估算

| 服务 | 月费用（预估） | 备注 |
|---|---|---|
| Deepgram Nova-2 | $50-100 | 按使用量计费 |
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
