---
id: other-20260822-02
type: other
status: active
version: v1
created_at: 2026-08-22
updated_at: 2026-08-22 02:38
refs: [plan-20260821-01, requirement-20260818-01]
---
# PERMISSIONS

Goal Progress 使用本地 Plugin、Hook、后台 Helper 和 loopback CDP。它不需要读取整台
电脑，也不需要媒体或辅助功能权限。

## 完整清单

| 权限或能力 | 必需 | 何时触发 | 访问范围 | 关闭方法 |
|---|---:|---|---|---|
| 安装 Codex Plugin | 是 | install / upgrade | 只处理 `codex-goal-progress` | uninstall |
| 审核 Plugin Hook | 是 | 首次安装或定义变化 | 三条 Plugin-bundled Hook | CLI `/hooks` 单独禁用 |
| Plugin `Read` / `Write` | 是 | MCP 读取或更新进度 | Goal Progress Contract，不开放任意文件 API | 禁用 Plugin |
| 后台项 | 是 | install | `com.codexgoalprogress.helper` | Disable 或 uninstall |
| 应用支持目录 | 是 | install 和运行 | `~/Library/Application Support/CodexGoalProgress` | uninstall；历史默认保留 |
| LaunchAgent plist | 是 | install | `~/Library/LaunchAgents/com.codexgoalprogress.helper.plist` | uninstall |
| Release 所在目录 | 条件需要 | install / upgrade | 只读取 Release 文件；Downloads 中运行时可能触发 Downloads 访问 | 安装后删除 Release |
| Codex Plugin 配置 | 是 | install / upgrade / uninstall | 通过 Codex 内置 CLI 处理本插件和 marketplace | uninstall |
| 用户 Hook 文件只读检查 | 是 | doctor / verify | 只检查 `~/.codex/hooks.json` 是否含 Goal Progress | 不运行 doctor |
| Unix socket | 是 | Helper 运行 | Goal Progress 私有 runtime 目录，0600 | Disable 或 uninstall |
| Loopback CDP | 是 | UI 启用 | `127.0.0.1` 随机端口；校验 PID、签名和 `app://` target | restore 或 uninstall |
| Codex 重启 | 条件需要 | 开启或关闭 CDP | 只重启已验证的 ChatGPT.app | 拒绝重启 |
| 进程与端口检查 | 是 | doctor / CDP 生命周期 | `ps`、`lsof` 只验证 Codex 和 Helper 所有权 | Disable 或 uninstall |

## 明确不需要

| macOS 权限 | 状态 |
|---|---|
| 屏幕录制 | 不申请、不需要 |
| 摄像头 | 不申请、不需要 |
| 麦克风 | 不申请、不需要 |
| 辅助功能 | 不申请、不需要 |
| 完全磁盘访问 | 不申请、不需要 |
| 输入监控 | 不申请、不需要 |
| App 管理 | 不申请、不需要 |
| 自动化 / Apple Events | 不申请、不需要 |
| 位置、联系人、照片、日历 | 不申请、不需要 |
| 外网入站或第三方服务 | 不申请、不需要 |
| 外部模型 API Key | 不申请、不需要 |

loopback CDP 不向局域网或互联网开放。Goal、Contract 和 Token 不发送到第三方服务；
当前 Codex 模型的正常处理不属于新增数据通道。

## macOS 提示

正常安装会显示 Goal Progress 后台项，因为 Helper 通过 launchd 运行。这是预期提示。

Goal Progress 不需要 App 管理、屏幕录制或 Apple Events。真实验收曾发现直接启动
Codex 会让 macOS 把 Codex 子进程的 TCC 访问归因给 Goal Progress。当前实现已改用
LaunchServices，修复后责任进程是 `com.openai.codex`。证据见
内部验证档案。

验收期间使用过 Computer Use、截图、测试浏览器和 Downloads 中的开发仓库，因此
macOS 曾为开发路径记录 Apple Events、Desktop、Downloads、App Bundles 和 Media
Library 状态。这些是验收工具或旧责任链的记录，不是 Release 功能。最终验收已删除
两个精确路径的 8 条 TCC 记录；恢复产品后 doctor、verify、Hook、Sidecar、普通
提示词均通过，TCC 记录仍为 0。

如果正式包仍显示 Goal Progress 请求 App 管理、录屏、Apple Events、摄像头、
麦克风、辅助功能或完全磁盘访问：

1. 不要允许。
2. 运行 `goal-progress doctor --json`。
3. 保存提示时间和截图。
4. 运行 `goal-progress emergency-disable --json`。

## 开发验收工具

开发阶段可以用 Codex 已有的 Computer Use 或本机 CDP 生成验收截图。这些能力不随
Goal Progress Release 发布，也不构成产品权限。本轮正式截图使用 loopback CDP，
只截 `codex-goal-progress` Host。
