# OpenClaw Desktop Assistant MVP

一个结合 Live2D 和 OpenClaw 的智能桌面助手最小可行版本。

## 功能特性

- ✅ Electron 桌面应用
- ✅ 简洁的 UI 界面
- ✅ 语音输入支持（按住说话）
- ✅ 模拟 OpenClaw 数据
- ✅ 邮件查询
- ✅ 日程查询
- ✅ 快捷操作按钮

## 项目结构

```
openclaw-assistant-mvp/
├── electron/           # Electron 主进程
│   ├── main.js        # 应用入口
│   └── preload.js     # 预加载脚本
├── public/            # 前端资源
│   ├── index.html     # 主页面
│   ├── styles.css     # 样式
│   └── app.js         # 应用逻辑
└── package.json       # 项目配置
```

## 安装和运行

### 1. 安装依赖

```bash
npm install
```

### 2. 运行应用

```bash
npm start
```

或者以开发模式运行（会打开开发者工具）：

```bash
npm run dev
```

## 使用说明

1. **语音输入**: 按住麦克风按钮说话，松开后自动识别
2. **快捷按钮**: 点击"邮件"或"日程"按钮快速查询
3. **窗口控制**: 右上角可以最小化或关闭窗口
4. **拖动窗口**: 在窗口任意位置拖动（除了按钮区域）

## 支持的命令

- "今天有什么邮件" / "邮件"
- "今天的日程安排" / "日程" / "汇报"

## 下一步计划

- [ ] 集成真实的 OpenClaw API
- [ ] 添加 Live2D 角色
- [ ] 增强语音识别准确度
- [ ] 添加更多命令支持
- [ ] 主动提醒功能
- [ ] 自定义角色形象

## 技术栈

- Electron 28
- Web Speech API (语音识别)
- 原生 HTML/CSS/JavaScript

## 注意事项

- 语音识别需要麦克风权限
- 目前使用模拟数据，未连接真实 OpenClaw
- 仅在 macOS 和 Windows 上测试
