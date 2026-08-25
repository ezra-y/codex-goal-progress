<div align="center">
  <h1 align="center">
    <img src="docs/assets/codex-goal-progress-logo.png" alt="Codex Goal Progress 标志" width="130"><br>
    Codex Goal Progress
  </h1>
  <p>给 Codex 原生 Goal 加上一条清晰、可验证的进度。</p>
  <p>
    <a href="README.md">English</a> · <strong>简体中文</strong>
  </p>
</div>

<p align="center">
  <img src="docs/assets/codex-goal-progress-demo.gif" alt="Codex Goal Progress 演示">
</p>

## ✨ 功能特性

在 Codex 原生 Goal 旁显示一个紧凑的进度视图，集中展示当前阶段进度、总体进度，以及可归属于该 Goal 的 Token 用量。

| 能力 | 表现 |
|---|---|
| 规则驱动进度 | 根据已验证的 Checklist 计算小目标和总体进度，不根据 Token、耗时或猜测生成百分比。 |
| 可验证计算 | 模型只参与必要的目标理解与 Checklist 更新，进度计算和状态管理由本地 Helper 完成。 |
| 原生主题适配 | 跟随 Codex 的浅色/深色主题和用户当前选择的强调色。 |
| 字号适配 | 读取 Codex 当前 UI 字号，并由字号连续计算间距。 |
| 布局适配 | 测量真实原生 Goal 和输入框尺寸，让固定布局与可拖动漂浮布局保持协调。 |
| 语言适配 | 跟随 Codex 文档的语言和文字方向，不修改进度 Contract。 |

## 🚀 快速开始

### 让 AI 安装

把下面这句话发给 AI：

```text
请安装并启用 https://github.com/Ezra-Y/codex-goal-progress。安装完成后运行 doctor 和 verify，确认它可以正常工作。
```

### 在终端一行安装

```bash
curl -fsSL https://github.com/Ezra-Y/codex-goal-progress/releases/latest/download/install.sh | sh
```

脚本会下载 macOS 安装包和 `SHA256SUMS`，校验 ZIP 后运行安装包自带的安装器。
如果需要重启 Codex，脚本会先询问。

如果 Codex 提示审核 Goal Progress Hook，请完成审核，然后打开一个新任务，让新的
Plugin 会话加载。

## 🛠️ 环境要求

* Apple Silicon Mac
* Codex Desktop

使用 macOS 安装包不需要 Node.js 或 pnpm。贡献者可以按
[CONTRIBUTING.md](CONTRIBUTING.md) 构建和验证源码。

## 🎯 如何使用

打开一个原生 Codex Goal，然后选择 **Goal Progress** Skill。

当前 Codex 模型会整理或复用该 Goal 的 Checklist，并创建本地进度记录。

每个新 Goal 都需要单独启用一次。没有启用 Goal Progress 的普通 Goal 不受影响。

## 🌓 浅色与深色

### 浅色

| 固定显示 | 漂浮显示 |
|---|---|
| ![真实 Codex 浅色主题中的 Goal Progress 固定显示](docs/assets/codex-goal-progress-light-fixed-en.png) | ![真实 Codex 浅色主题中的 Goal Progress 漂浮显示](docs/assets/codex-goal-progress-light-floating-en.png) |

### 深色

| 固定显示 | 漂浮显示 |
|---|---|
| ![真实 Codex 深色主题中的 Goal Progress 固定显示](docs/assets/codex-goal-progress-dark-fixed-en.png) | ![真实 Codex 深色主题中的 Goal Progress 漂浮显示](docs/assets/codex-goal-progress-dark-floating-en.png) |

## 🧭 工作原理

<p align="center">
  <img src="docs/assets/codex-goal-progress-architecture.png" alt="Codex Goal Progress 工作原理">
</p>

- 当前模型通过本地 MCP 工具更新 Checklist 证据。
- Helper 校验 revision，并作为唯一状态写入者。
- Core 根据 Checklist 计算小目标进度和总体进度。
- Renderer 只接收展示用 ViewModel。
- 安装器使用自包含的 Node SEA Helper。

更多信息见[技术架构](docs/decisions/CodexGoalProgress技术架构.md)、
[权限范围](docs/architecture/PERMISSIONS.md)和
[威胁模型](docs/quality/THREAT-MODEL.md)。

## 🔐 隐私与权限

Goal Progress 使用：

- 应用支持目录中的本地文件；
- 私有本地 Unix Socket；
- 连接已验证 Codex 进程的 loopback CDP；
- 由 launchd 注册的后台 Helper；
- 三个可以审核的 Plugin Hook。

完整范围和卸载步骤见 [PERMISSIONS.md](docs/architecture/PERMISSIONS.md)。

## 许可证

[MIT](LICENSE)
