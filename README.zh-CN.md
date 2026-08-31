<div align="center">
  <h1 align="center">
    <img src="https://raw.githubusercontent.com/Ezra-Y/codex-goal-progress/main/docs/assets/codex-goal-progress-logo.png" alt="Codex Goal Progress 标志" width="130"><br>
    Codex Goal Progress
  </h1>
  <p>为 Codex 原生 Goal 提供由已验证清单和本地进度追踪驱动的进度条。</p>
  <p>
    <a href="https://github.com/Ezra-Y/codex-goal-progress/blob/main/README.md">English</a> ·
    <strong>简体中文</strong>
  </p>
</div>

<p align="center">
  <img src="https://raw.githubusercontent.com/Ezra-Y/codex-goal-progress/main/docs/assets/codex-goal-progress-demo.gif" alt="Codex Goal Progress 演示">
</p>

## 🆕 最近更新

### 🚀 v0.3.0 — 重启恢复、多窗口支持与应用内更新

- 🔌 **直接从官方图标启动。** 自动建立所需的 CDP 连接，无需额外运行命令或手动配置。
- 🔄 **完全退出后，进度自动恢复。** 再次打开旧任务，清单、进度、Token 和显示设置继续保留。
  退出和启动时，都不必停在有进度的任务上。
- 🪟 **新增多窗口支持。** 新建窗口、通过链接打开任务、在新窗口中打开任务，都能自动接入。
  每个窗口跟随自己的任务，切换或关闭一个窗口不影响其他窗口。
- 🎉 **新增应用内更新。** 自动检查新版本，也支持手动检查。有更新时，点击“立即更新”即可
  下载、校验和安装，并显示真实下载进度。
- ⋯ **全新的更多菜单。** 右上角三点菜单分为“版本”“效果”“显示”。查看当前版本、检查更新、
  打开更新说明，以及调整动画和显示位置，都在同一处。
- 🧩 **安装和更新更可靠。** 修复安装时过早判定失败的问题，自动启用插件所需的 Hook。
  下载中断可以重试，重启后不再因恢复时序问题一直停在“待重启”。
- 🛠️ **整理底层代码。** 拆分大文件，减少安装、诊断和验证中的重复逻辑。完善页面重载、
  任务切换和更新中断后的恢复，更新完成后自动清理临时文件。
- 🤖 **换上新的可爱机器人 Logo。** Goal Progress 现在使用透明背景的小机器人图标。

这是最新版本。更多内容请查看[完整更新记录](CHANGELOG.md)。

## ✨ 功能特性

在 Codex 原生 Goal 旁显示进度视图，集中展示当前小目标、总体进度，以及能够确认归属于该 Goal 的 Token 用量。

| 能力 | 表现 |
|---|---|
| 规则驱动进度 | 根据已验证的 Checklist 计算小目标和总体进度；Token 与耗时保持为独立辅助信息。 |
| 可验证计算 | 模型只负责必要的 Goal 理解和 Checklist 更新；本地 Helper 管理状态并计算进度。 |
| 原生主题适配 | 跟随 Codex 的浅色/深色主题和用户当前选择的强调色。 |
| 字号适配 | 读取 Codex 当前 UI 字号，并由字号连续计算间距。 |
| 布局适配 | 测量真实原生 Goal 和输入框尺寸，协调固定布局与可拖动漂浮布局。 |
| 语言适配 | 读取 Codex 当前文档语言和文字方向，选择对应的内置词典，并以英文作为最终回退。 |

## 🚀 快速开始

### 让 AI 安装

把下面这句话发给 AI：

```text
请按照仓库中的 INSTALL-FOR-AI.md，安装并验证 https://github.com/Ezra-Y/codex-goal-progress。
```

### 在终端一行安装

```bash
curl -fsSL https://github.com/Ezra-Y/codex-goal-progress/releases/latest/download/install.sh | sh
```

脚本会下载 macOS 安装包和 `SHA256SUMS`，校验 ZIP，然后运行安装包内置的安装器。
需要重启 Codex 时，脚本会先询问。

安装后按提示重新打开 Codex，再打开一个新任务，让新的 Plugin 会话加载。

## 🛠️ 环境要求

- Apple Silicon Mac
- Codex Desktop

macOS 安装包已经包含运行时。

## 🎯 如何使用

打开一个原生 Codex Goal，然后选择 **Goal Progress** Skill。

当前 Codex 模型会整理或复用该 Goal 的 Checklist，并创建本地进度记录。

每个新 Goal 需要单独启用 Goal Progress。普通 Goal 继续使用 Codex 原生流程。

## 🌓 浅色与深色

### 浅色

| 固定显示 | 漂浮显示 |
|---|---|
| ![真实 Codex 浅色主题中的 Goal Progress 固定显示](https://raw.githubusercontent.com/Ezra-Y/codex-goal-progress/main/docs/assets/codex-goal-progress-light-fixed-en.png) | ![真实 Codex 浅色主题中的 Goal Progress 漂浮显示](https://raw.githubusercontent.com/Ezra-Y/codex-goal-progress/main/docs/assets/codex-goal-progress-light-floating-en.png) |

### 深色

| 固定显示 | 漂浮显示 |
|---|---|
| ![真实 Codex 深色主题中的 Goal Progress 固定显示](https://raw.githubusercontent.com/Ezra-Y/codex-goal-progress/main/docs/assets/codex-goal-progress-dark-fixed-en.png) | ![真实 Codex 深色主题中的 Goal Progress 漂浮显示](https://raw.githubusercontent.com/Ezra-Y/codex-goal-progress/main/docs/assets/codex-goal-progress-dark-floating-en.png) |

## 🧭 工作原理

<p align="center">
  <img src="https://raw.githubusercontent.com/Ezra-Y/codex-goal-progress/main/docs/assets/codex-goal-progress-architecture.png" alt="Codex Goal Progress 工作原理">
</p>

- 当前模型通过本地 MCP 工具更新 Checklist 证据。
- Helper 校验 revision，并作为唯一状态写入者。
- Core 根据 Checklist 计算小目标进度和总体进度。
- Renderer 只接收用于显示的 ViewModel。
- 安装器使用自包含的 Node SEA Helper。

更多信息请查看[技术架构](https://github.com/Ezra-Y/codex-goal-progress/blob/main/docs/ARCHITECTURE.md)、
[权限范围](https://github.com/Ezra-Y/codex-goal-progress/blob/main/docs/PERMISSIONS.md)和
[支持说明](https://github.com/Ezra-Y/codex-goal-progress/blob/main/docs/SUPPORT.md)。

## 🔐 隐私与权限

Goal Progress 使用：

- 应用支持目录中的本地文件；
- 私有本地 Unix Socket；
- 连接已验证 Codex 进程的 loopback CDP；
- 由 launchd 注册的后台 Helper；
- 三个可审核的 Plugin Hook。

完整范围和卸载步骤请查看
[PERMISSIONS.md](https://github.com/Ezra-Y/codex-goal-progress/blob/main/docs/PERMISSIONS.md)。

## 许可证

[MIT](https://github.com/Ezra-Y/codex-goal-progress/blob/main/LICENSE)
