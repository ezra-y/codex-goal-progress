---
id: other-20260821-06
type: other
status: active
version: v1
created_at: 2026-08-21
updated_at: 2026-08-25 19:06
refs: [decision-20260818-01, decision-20260820-01, plan-20260818-02]
---
# SUPPORT MATRIX

## Release Candidate

| 项目 | 支持值 | 状态 |
|---|---|---|
| Goal Progress | `0.1.0` | 支持 |
| Goal Contract | schema v2 | 冻结 |
| IPC | protocol v4 | 冻结 |
| Renderer/UI Intent Bridge | protocol v2 | 冻结 |
| Page Host API | v52 | 冻结 |
| Helper runtime | Node SEA `v24.19.0` | 支持 |

## 平台

| 项目 | 版本 | 架构 | 状态 |
|---|---|---|---|
| macOS | `26.5 (25F71)` | arm64 | 已验证 |
| macOS 其他版本 | 任意 | arm64 | 未验证 |
| macOS | 任意 | x86_64 | 不提供 release |
| Windows / Linux | 任意 | 任意 | 不提供 MVP release |

## Codex

| 产品 | 版本 | 状态 |
|---|---|---|
| Codex Desktop | `26.818.21641 (6849)` | 已验证 |
| Codex Desktop | `26.818.31338 (6892)` | 已验证 |
| Codex Desktop | `26.818.41509 (6962)` | 已验证 |
| Codex Desktop | `26.818.61809 (7019)` | 已验证 |
| Codex CLI Plugin 安装 | `0.149.0-alpha.4` | 已验证 |
| 其他 Desktop 版本 | 任意 | Adapter 返回 unsupported |
| Web / IDE 专用入口 | 任意 | 未验证 |

DOM Adapter 只支持 `macos-26.818.21641-goal-row-v1` 和
`macos-26.818.31338-goal-row-v1`、`macos-26.818.41509-goal-row-v1`、
`macos-26.818.61809-goal-row-v1`。版本或结构变化后必须重新采集脱敏 fixture、
截图和真实 smoke；不得扩大版本范围猜兼容。

## 安装

- release：`macos-arm64`
- Helper：自包含 SEA，不要求用户安装 Node 或 pnpm
- Plugin：Codex 本地 marketplace
- Hook：首次安装和内容变化后由用户审核
- CDP：仅 127.0.0.1、随机端口、验证 PID 和 `app://-/index.html`

## 不支持

- 修改 Codex `.app`、签名、app.asar 或私有 chunk
- 外部进度模型、隐藏 thread 或额外模型 API key
- 远程 Renderer bundle 或 CDN runtime
- 自动绕过 Hook 信任
