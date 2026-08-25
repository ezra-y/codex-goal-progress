---
id: other-20260821-03
type: other
status: active
version: v1
created_at: 2026-08-21
updated_at: 2026-08-21 05:01
refs: [requirement-20260818-01, decision-20260818-01, plan-20260818-02]
---

# STATE SCHEMA

## 状态所有权

| 数据 | 所有者 | 持久化 |
|---|---|---|
| Goal Contract | Helper / Event Store | 是 |
| 百分比 | Core 计算 | 否 |
| ViewModel | Helper 投影 | 否 |
| Token 快照 | App Server runtime | 仅保留最新可信内存值 |
| collapsed、motionPaused、hidden | UI Preference store | 是 |
| detached | 每个 thread 的 overlay | 是 |
| CDP PID、端口和 app identity | runtime state | 是 |
| Hook proof secret 和消费标记 | IPC runtime | 是 |

Renderer 只接收 ViewModel。它不读取事件，不写 Contract，不计算百分比。

## Goal Contract v2

主要字段：

| 字段 | 说明 |
|---|---|
| `schemaVersion` | 当前为 2 |
| `contractId` | 稳定 Contract ID |
| `sessionId` / `threadId` | 已证明的当前 thread |
| `sessionTreeId` | 兼容字段，不解释为稳定树根 |
| `nativeGoalBinding` | threadId、createdAt、objectiveHash |
| `nativeGoal` | objective、status、可选 tokenBudget |
| `phase` | preparing、active、paused、completed、error |
| `revision` | 每次 Contract 写入递增 |
| `scopeRevision` | 仅 rescope 递增 |
| `objectives` | required/optional 顶层结果、贡献值、子项和证据 |
| `lastScopeChange` | 最近范围变化原因 |
| `lastProgressCorrection` | 最近进度校正原因 |

required、未取消的顶层贡献值必须精确合计 10000 bps。optional 不进入总体分母，
也不阻止 100%。

## 事件

事件日志是 JSONL。每条事件包含 eventId、requestId、contractId、sessionId、
turnId、revision、时间和来源。

| 事件 | 用途 |
|---|---|
| `contract.initialized` | 建立 revision 1 基线 |
| `contract.items-updated` | 更新既有 checklist 状态和证据 |
| `contract.rescoped` | 修改顶层范围和贡献值 |
| `contract.phase-changed` | 修改追踪 phase |
| `native-goal.synced` | 同步受信任原生 Goal 状态 |
| `contract.migrated` | v1 原位升级到 v2 |
| `contract.replaced` | 归档旧 Contract，建立新 Goal revision 1 |

同一个 requestId 重试只返回 duplicate。不同内容复用 requestId 会失败。

## 进度计算

每个 required 顶层目标先计算内部已完成子项比例，再乘 contributionBps。总体为各项
之和。active、blocked 和 pending 不获得部分分。范围未变化时，模型不能直接修改
分母或总体百分比。

required 全部完成但 native Goal 未完成时，显示最多 95%。两者都完成时显示 100%。

## 本地文件

```text
~/Library/Application Support/CodexGoalProgress/
├── install/
│   ├── current
│   ├── manifest.json
│   └── releases/<version>/
├── state/v1/<session-hash>/
│   ├── snapshot.json
│   ├── events.jsonl
│   └── overlay.json
├── preferences/v1/ui-preferences.json
├── logs/
└── runtime/
    ├── helper.sock
    ├── helper.pid.json
    ├── runtime-context.key
    ├── runtime-proof-consumed/
    └── cdp.json
```

私有目录使用 0700。Store、secret、PID、runtime state 和 socket 使用 0600。

## 恢复与迁移

- 快照损坏时从完整事件日志重建。
- 只截断 JSONL 最后一条未完成记录。
- 事件已提交但快照失败时，重启后重建快照。
- v1 在 activation 或写入前迁移；相同 migration 重试返回 duplicate。
- 旧 UI Preference 路径保持只读兼容，新写入进入 `preferences/v1`。
- Goal clear 只设置 detached；SessionEnd 不删除历史。
