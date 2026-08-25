---
id: other-20260821-02
type: other
status: active
version: v1
created_at: 2026-08-21
updated_at: 2026-08-21 05:01
refs: [requirement-20260818-01, decision-20260818-01, plan-20260818-02]
---

# THREAT MODEL

## 范围

Goal Progress 在同一用户的 macOS 账户内运行。默认操作者是本机用户和当前 Codex
会话，不假设有恶意系统管理员或另一名本机用户。

以下输入仍按不可信数据处理：

- Goal 正文、checklist、证据和模型工具参数
- Hook stdin 和 MCP 请求
- Codex App Server、CDP 和 DOM 返回值
- 本地 Store、Plugin 包和 release manifest

本项目不修改 Codex `.app`、签名、`app.asar` 或私有 JavaScript chunk。

## 需要保护的内容

| 内容 | 目标 |
|---|---|
| Goal Contract 和事件历史 | 不串线程、不丢提交、不被旧 revision 覆盖 |
| runtime proof secret | 仅当前用户可读，不进入日志或工具输出 |
| Goal、prompt 和项目内容 | 不新增第三方通道，不写诊断日志 |
| Codex 原生 Goal 和 Token | 只绑定已证明的当前 thread 和 createdAt |
| Codex 页面 | 不执行目标文本，不替换原生控件 |
| Codex app | 不修改文件、签名或内部包 |
| release 和 Plugin | 安装前验证版本、SHA-256、签名和 Hook 内容 |

## 信任边界

```text
当前 Codex 模型
  │  结构化 MCP + 一次性 Hook proof
  ▼
Helper ── Core ── Event Store
  │
  ├── App Server：Goal、Token、thread identity
  └── loopback CDP：本地 Renderer bundle 和结构化 ViewModel
```

Renderer 不写 Contract，也不计算百分比。Helper 是唯一写入者，Core 是唯一进度
计算者。Hook 只提供有限身份和完成回执。

## 威胁与控制

| 威胁 | 控制 | 主要证据 |
|---|---|---|
| 模型直接写百分比 | MCP schema 只接受 checklist 状态；Core 计算 | `tests/unit/core-progress.test.ts` |
| proof 伪造或重放 | HMAC proof、短有效期、一次消费、0600 secret | `tests/unit/runtime-proof.test.ts` |
| 跨 thread 串线 | CurrentThreadResolver、Contract binding、createdAt | 内部验证档案 |
| 并发覆盖 | `expectedRevision`、事件/请求 ID 幂等 | `tests/integration/event-store.test.ts` |
| Goal 替换继承旧进度 | `contract.replaced`、revision 1 新基线 | `tests/integration/helper-lifecycle.test.ts` |
| 目标文本脚本注入 | 结构化 CDP 参数、Lit 文本绑定、无 innerHTML | `tests/e2e/sidecar-mount.spec.ts` |
| 超长输入或 IPC 消息 | 长度上限、总消息上限、proof 仍被消费 | `tests/integration/mcp-stdio.test.ts` |
| 错误 CDP 端口或进程 | 127.0.0.1、随机端口、PID 后代和签名验证 | `tests/unit/macos-cdp-runtime.test.ts` |
| 错误 CDP target | 只接受 `app://-/index.html` | `tests/unit/cdp-client.test.ts` |
| 页面结构变化后插错位置 | 精确 Adapter、唯一锚点、失败时 Host 0 | `docs/decisions/SELECTOR-CONTRACT.md` |
| Renderer bundle 被替换 | release version、bytes 和 SHA-256 | `tests/unit/renderer-bundle.test.ts` |
| Store 损坏或磁盘满 | 事件先提交、原子快照、重放、ENOSPC 失败 | `tests/integration/event-store.test.ts` |
| 日志泄露正文或 secret | 日志 schema 只收 ID、状态、code 和计数 | `tests/unit/store-logger.test.ts` |
| release 或 Plugin 被改 | SHA256SUMS、codesign、Plugin manifest 和 Hook hash | 内部验证档案 |
| 安装器修改官方 app | 安装路径白名单和修改前后 app 元数据检查 | `tests/integration/macos-installer.test.ts` |

## 残余限制

- 原生 Goal 的安全替换控件仍不可用。冲突时保持原 Contract 不变。
- 原生 Goal 行启动按钮尚未发布。当前入口是 Plugin Skill。
- 外部 checklist 文件没有自动 watcher。
- CDP 在功能运行期间仍是本机调试面。它只绑定 loopback，并由 restore 关闭。

这些限制同时记录在 `docs/quality/REQUIREMENT-TRACE.md`。

## 变更规则

新增工具、数据通道、CDP target、写入目录或 Hook 字段时，必须更新本文和对应测试。
三个月内没有拦住真实错误的控制应删除或合并。
