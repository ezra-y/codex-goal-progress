---
id: decision-20260818-01
type: decision
status: active
version: v1
created_at: 2026-08-18
updated_at: 2026-08-22 20:48
refs: [requirement-20260818-01]
---
# Codex Goal Progress 技术架构

> 目标：在不修改 Codex 官方安装包、不启动外部模型、不另开可见 App 的前提下，为当前原生 Goal 提供稳定、可解释、可恢复的总体进度。

## 1. 结论

采用 **Plugin + 主 Skill + 本地 STDIO MCP + 最小 Hooks + 单一 Helper + CDP Sidecar UI**。

```text
用户显式调用 Goal Progress
          │
          ▼
当前会话模型读取主 Skill
          │
          ├─ 无原生 Goal：在同一 thread 创建原生 Goal
          └─ 有原生 Goal：直接附加
          │
          ▼
准备中：复用或生成专属 Goal Contract
          │  当前模型只做这一次语义评估
          ▼
MCP 工具提交结构化 Contract / Checklist 更新
          │
          ▼
PreToolUse Hook 注入真实 session_id / turn_id / model
          │
          ▼
Goal Progress Helper（唯一状态写入者）
    ├─ Zod 校验
    ├─ revision 冲突控制
    ├─ JSONL 事件日志 + 原子快照
    ├─ 纯函数 Reducer 计算进度
    ├─ Native Goal Adapter
    ├─ Token Adapter
    └─ CDP Host
          │
          ▼
<codex-goal-progress> Web Component
    只渲染 ViewModel，不读 Checklist，不算百分比
```

## 2. 为什么不是一个巨大注入脚本

注入脚本只适合改样式。这个产品还有 Goal 身份、Checklist、权重、并发、恢复、Token、安装和卸载。若全部写进 Renderer，会出现四个问题：

1. 页面重载就可能丢状态。
2. DOM 变更会连带破坏进度算法。
3. AI、Hook、页面同时写状态，形成多个事实源。
4. 无法对核心算法做稳定单测。

因此必须分层。**Renderer 失效时，只是不显示；数据和 Goal 工作必须继续正常。**

## 3. 技术栈

### 3.1 固定选型

| 层 | 选型 | 说明 |
|---|---|---|
| 语言 | TypeScript strict | contracts、core、MCP、Helper、CDP、Renderer 共用类型 |
| 包管理 | pnpm workspace | Node 生态兼容好，适合 monorepo |
| Renderer | Lit Web Component + Shadow DOM + 原生 CSS | 不引入 React/Vue；不接入官方 React 树 |
| 打包 | esbuild | 生成单文件 renderer bundle 和 Node bundle |
| MCP | `@modelcontextprotocol/sdk` + Zod | 工具 schema 明确，输入可校验 |
| 测试 | Vitest + Playwright | 纯逻辑与真实浏览器行为分开 |
| 格式化/静态检查 | Biome + `tsc --noEmit` | 一套快速规则，减少配置重叠 |
| 状态存储 | JSON 快照 + JSONL 事件日志 | 可读、可恢复、方便审计；MVP 不上数据库 |
| IPC | macOS Unix Domain Socket；Windows Named Pipe | Helper 单写，MCP/Hook/CDP 都是客户端 |

### 3.2 允许的首批依赖

运行时：

- `zod`
- `@modelcontextprotocol/sdk`
- `lit`，只进入自包含 Renderer bundle，不由 Codex 页面提供

开发时：

- `typescript`
- `tsx`
- `esbuild`
- `vitest`
- `@playwright/test`
- `@biomejs/biome`
- `yaml`，只用于开发期 Plugin 与 Skill 契约校验，不进入运行时产物

优先使用 Node 原生 `WebSocket`、`fetch`、`fs`、`crypto`。只有 POC 证明原生能力不够时，才通过 ADR 增加 `ws` 等依赖。

### 3.3 明确不使用

- 外部或专用进度模型
- OpenAI Platform API Key
- 隐藏的第二条 Codex thread
- React/Vue/Svelte 运行时
- Canvas、WebGL、GIF、视频动画
- SQLite、Redis、远程数据库
- 运行时 HTTP 页面或独立 Dashboard
- Codex 私有 JS Chunk、私有 Store、反编译后的组件源码

## 4. 仓库结构

```text
codex-goal-progress/
├── .codex-plugin/
│   └── plugin.json
├── skills/
│   └── goal-progress/
│       ├── SKILL.md
│       ├── agents/openai.yaml
│       └── references/
├── hooks/
│   ├── hooks.json
│   └── src/
├── packages/
│   ├── contracts/          # Zod schema + TS 类型；所有层的共同语言
│   ├── core/               # 纯状态机、Reducer、进度算法
│   ├── store/              # 快照、事件日志、迁移、原子写
│   ├── ipc/                # Helper 本地 IPC 协议
│   ├── mcp/                # 模型可调用的最小工具集
│   ├── host/               # 唯一长驻 Helper；唯一状态写入者
│   ├── codex-adapter/      # Goal、Token、CDP、DOM 锚点适配
│   └── renderer/           # Web Component + demo + bundle
├── platform/
│   ├── macos/              # install/doctor/verify/restore/uninstall
│   └── windows/            # P2，MVP 后再做
├── tests/
│   ├── fixtures/
│   ├── integration/
│   └── e2e/
└── docs/
```

## 5. 三个事实源，以及谁有写权限

### 5.1 原生 Goal

Codex 原生 Goal 是目标是否存在、目标正文、运行状态和原生用量的事实源。

### 5.2 Goal Contract

Goal Contract 是进度分母、顶层小目标、Checklist、贡献值和范围版本的事实源。

### 5.3 Renderer ViewModel

ViewModel 只是展示快照，不是事实源。

### 5.4 单写规则

- 当前模型只能通过 MCP 请求更新。
- Hook 只能补充身份、收集事件和做提醒，不直接修改业务状态。
- Renderer 只能发送 UI 意图，例如展开、暂停、重新评估请求。
- **只有 Helper 可以落盘。**
- **只有 Core Reducer 可以计算百分比。**

## 6. 激活与当前会话绑定

### 6.1 用户看到的入口

产品目标是用户只看到一个入口：`Goal Progress`。

POC-A 已验证的 CLI 局部流程：

```text
$ 选择器搜索 Goal Progress
选择 Goal Progress [Skill]
在同一输入继续写目标正文并发送
```

当前 Codex CLI 会把选中的 Plugin Skill 展开为规范标记：

```text
$codex-goal-progress:goal-progress
把目标正文写在下面
```

`$goal-progress` 在当前版本可用于筛选选择器，但直接提交时不是可靠调用。
不得把它写成稳定备用别名。

当前 `$` 选择器同时显示 `Goal Progress [Plugin]` 和
`Goal Progress [Skill]`。这不满足单入口要求，而且只验证了 Skill 行。
双入口是 POC-A 失败项，不是最终交互设计。

Desktop `/` 列表仍是产品目标，但 POC-A 尚未取得证据。Computer Use 被
Codex 安全策略拒绝，CLI `/` 列表也只显示原生命令。完成 Desktop 实测前，
安装文档不得宣称 slash 入口可用。

### 6.2 两个分支

**没有原生 Goal：**

1. 当前会话模型读取 Skill。
2. 在同一 thread 建立原生 Goal。
3. Renderer 显示“准备中”。
4. 模型复用已有 Checklist；没有则生成专属 Contract。
5. `goal_progress_initialize` 成功后显示正式进度。

**已有原生 Goal：**

1. 直接附加当前 Goal。
2. 不替换 objective。
3. 不重置原生 Token 使用记录。
4. 读取当前上下文和已有 Checklist，再建立 Contract。

调用正文与当前 Goal 明显不同时，只报告冲突并推荐附加。当前公开控制面没有
compare-and-swap 保护，不能安全替换未完成 Goal；用户选择替换时返回
`NATIVE_GOAL_REPLACE_UNAVAILABLE`，不得通过清空、完成或阻塞旧 Goal 来绕过。

### 6.3 不让模型手填 session id

正式 Hook 只处理三个窄事件：

- `SessionStart` 只负责恢复已有的活动 Contract。
- `PreToolUse` 只匹配六个 Goal Progress MCP 工具，注入并签名当前身份。
- `PostToolUse` 只精确匹配 `update_goal`。App Server 在原生 Goal 完成后立即返回
  `null`，无法与清除区分，因此暂时保留受信任的完成回执。回执通过 Store 事件
  幂等应用，不直接改文件。`update_plan` 不影响业务状态，不再进入 Hook。
- Hook 不读取或保存 plan 输入、工具响应和 transcript。

显式 Skill 已由宿主加载后，当前模型直接调用 `goal_progress_activate`。Helper 在
处理 `activation.plan` 时写入脱敏激活审计。普通 prompt 不经过 Goal Progress
Hook，也不依赖 Helper、Store 或安装目录是否健康。

Hook 不写 Goal Contract，不计算进度，也不把任何 prompt 或工具正文交给 Helper。
观察审计最多等待 `150ms`；Helper 不可用不能阻断普通 prompt 或已完成的工具。

`activation.resume` 返回 `active`、`inactive` 或 `temporarily_unavailable`。没有
Contract、Contract 已完成或原生 Goal 明确不匹配时立即返回 `inactive`。Helper
IPC、App Server 或原生 Goal 读取暂时失败时，`SessionStart` 只按
`0 / 100 / 250 / 500 / 900ms` 重试；全部失败后静默放行并最多记录一次脱敏诊断。
恢复只读取并重新发布原 Contract，不改 revision、Checklist 或贡献值。

Hook stdin 协议当前为 v1。事件 Schema 接受额外字段，并兼容上一个 Release 的
输入形状。Release Hook 命令只调用稳定的 `install/current/bin/goal-progress`；该
二进制不存在时直接退出 0，不输出控制结果。

Plugin Hook 使用 `PreToolUse` 匹配 Goal Progress MCP 工具，并把 Hook 输入里的真实字段写进工具参数：

```json
{
  "_runtimeContext": {
    "sessionId": "thr_123",
    "turnId": "turn_456",
    "model": "current-model-slug",
    "cwd": "/workspace"
  },
  "_runtimeProof": {
    "version": 1,
    "toolUseId": "call_123",
    "issuedAtMs": 1787000000000,
    "nonce": "32-hex-characters",
    "signature": "64-hex-characters"
  }
}
```

### 6.4 Activation Orchestrator

- 显式 Skill、Plugin 选择和未来 Goal 区快捷入口都调用受限
  `goal_progress_activate`。
- Helper 使用受信任 Hook proof 解析当前 actual thread，读取同 thread 的 native
  Goal 和 Contract，再调用 Core 纯函数返回 A–E。
- Orchestrator 只返回 `nativeGoalAction`、`progressAction` 和稳定 code；它不创建
  native Goal、不写 Contract、不启动 thread/turn，也不调用模型。
- 无 Goal + 有正文时，当前模型使用宿主 `create_goal`；已有 Goal 时只 attach。
- 不同正文返回冲突。无 CAS 时，即使用户确认替换也返回
  `NATIVE_GOAL_REPLACE_UNAVAILABLE`，等待 verified native controls。
- 需要 initialize 时 Helper 先发布无百分比的 revision 0 preparing ViewModel；
  正式 Contract 建立后覆盖该临时视图。
- `goal_progress_activate` 不写 native Goal 或 Contract，但会写本地 preparation
  UI/overlay。失败时保留 native Goal；retry 只重读；close 阻止当前 initialize，
  再次显式激活才恢复。

### 6.5 日常更新与 Rescope

- `goal_progress_update` 只接受目标/子项状态和证据；不接受总体百分比、贡献值或
  scope 结构。Core 是唯一百分比计算者。
- `update_plan` 不进入 Hook，也不写日志或 Contract。无法映射的动作保持原状态；
  当前模型只有在结果能绑定到稳定目标 ID 时才调用 `goal_progress_update`。
- 只有交付结果改变才使用 `goal_progress_rescope`。copy、code path 和普通 bug
  fix 不触发 rescope。
- rescope 必须给 reason，重新提交完整验收点和 contribution；Core 校验 required
  denominator、增加 scopeRevision，并允许带说明的进度下降。
- required/optional 的变化属于 rescope；UI 从 ViewModel
  `scopeChangeNotice` 显示原因。

规则：

- 模型不需要猜这些值；schema 说明同时把两个字段标为“禁止手填”。
- Hook 通过 0600 UDS 请求 Helper 签发 proof。只有 Helper 读取权限为 `0600`
  的随机密钥，并为身份、tool use id、时间和 nonce 计算 HMAC-SHA256 签名。
- MCP server 把 proof 交给 Helper。Helper 拒绝缺少身份或签名、验签失败、
  过期、未来时间和重放的请求。
- Helper 用 `wx` 原子建立 proof 摘要标记；所有 MCP 进程共享消费结果，所以
  同一 proof 不能跨会话重放。过期标记会低频清理。
- Hook 无法连接 Helper 时拒绝受保护工具调用，不退回到未签名身份。
- MCP 只返回校验后的 `_runtimeContext`，不返回签名或密钥。
- 每次写操作都按真实 `sessionId` 路由，支持多个 Codex 会话并行。
- 该 proof 防止普通模型参数直接冒充 Hook，不是同一 macOS 用户下的恶意进程
  隔离。拥有本地文件权限的进程可以读取 Plugin data。正式写路径还必须依赖
  Helper 的 session 绑定、`expectedRevision` 和单写者规则。

### 6.4 已验证的身份通道

POC-B 已在 Codex CLI `0.148.0-alpha.9` 通过：

- Plugin MCP server key 使用标识符安全的 `goal_progress`，对应 Hook 工具名
  `mcp__goal_progress__echo_context`。
- Plugin MCP 使用相对命令和 `cwd: "."`。Codex 把 cwd 解析到已安装 Plugin
  根目录；MCP 参数不依赖 `${PLUGIN_ROOT}` 展开。
- 当前 legacy manifest 不展开 MCP env 中的 `${PLUGIN_DATA}`，MCP 子进程也
  不保证继承 `CODEX_HOME`。server 从已安装 Plugin cache cwd 推导同一 Plugin
  data 目录，并用 realpath、`plugins/cache` 层级、Codex `config.toml`、Plugin
  manifest 名称和版本做校验；若未来宿主直接展开绝对路径，则优先使用该路径。
  结构不完整的伪 cache 和逃逸符号链接安全失败。
- MCP 的 `cwd` 由 Codex Plugin loader 选择，这是此 POC 的宿主信任点。若同一
  用户在 Codex 外主动复制完整 config、manifest 和 cache 层级再启动 bundle，
  目录检查无法识别冒充；把这类本地进程隔离交给后续 Helper/IPC 安全边界。
- Plugin Hook 命令中的 `${PLUGIN_ROOT}` 会展开成安装目录，但首次和每次内容
  变化后仍需用户在 `/hooks` 审核。
- 未信任时，MCP 的共享身份守卫返回 `GOAL_PROGRESS_HOOK_CONTEXT_REQUIRED`，
  不猜 session。
- 直接伪造 `_runtimeContext`、错误密钥签名、单进程重放和跨进程重放均被拒绝。
- 两个并发会话共 20 次调用没有串线；每次调用都有独立、已校验的签名摘要。
  详细证据见接入验证清单。

### 6.5 仍需 POC 的关键点

官方文档说明 App Server 可以通过 `thread/goal/set|get|clear` 管理与 `/goal`
相同的持久 Goal；Hook 也提供当前 `session_id`。该值是宿主提供的不透明 Hook
会话身份，不能单独当作当前 `threadId` 的证明。当前线程必须由
`CurrentThreadResolver` 用公开的 `thread/loaded/list`、`thread/list` 和
`thread/turns/list` 证明。

1. 已证明：Hook `session_id` 不是当前 App Server `threadId` 的充分证明。
   当前 Desktop 的根线程、同目录 fork 和 worktree fork 样本中，它都等于当前
   `threadId`；两种 fork 同时获得了不同于来源根线程的新值。实现不依赖这个
   相等关系，仍以当前 turn 唯一匹配为准。
   fork 会复制来源线程已有 turn，因此来源线程在 fork 当回合再次解析可能命中
   多个线程；Resolver 必须返回 `CURRENT_THREAD_AMBIGUOUS`，不能退回字符串直比。
2. 独立本地 App Server 控制进程能否读取和修改桌面端同一 thread，而不创建新 thread。
3. 当前模型是否已经有宿主原生 Goal 工具，可直接设置 Goal。

优先顺序：

1. 使用宿主已暴露的原生 Goal 能力。
2. 若不存在，使用本地 App Server 控制面，针对同一 thread 调 `thread/goal/set`。
3. 两者都不能证明时，停止该分支并写 ADR。不得用模拟键盘、私有 Store 或新 thread 伪装成功。

## 7. Goal Contract

### 7.1 建议 schema

```ts
interface GoalContractV2 {
  schemaVersion: 2;
  contractId: string;
  sessionId: string;
  sessionTreeId: string;
  threadId: string;
  nativeGoalBinding: {
    threadId: string;
    createdAt: number;
    objectiveHash: string;
  };
  nativeGoal: {
    objective: string;
    status: "active" | "paused" | "complete" | "blocked";
    tokenBudget?: number;
  };
  phase: "preparing" | "active" | "paused" | "completed" | "error";
  revision: number;
  scopeRevision: number;
  source: "existing-checklist" | "model-generated";
  objectives: Objective[];
  createdAt: string;
  updatedAt: string;
}

interface Objective {
  id: `C${number}`;
  title: string;
  requirement: "required" | "optional";
  contributionBps: number;
  status: "pending" | "active" | "completed" | "blocked" | "cancelled";
  items: ChecklistItem[];
}

interface ChecklistItem {
  id: `${string}.${number}`;
  title: string;
  status: "pending" | "active" | "completed" | "blocked" | "cancelled";
  evidence?: Evidence[];
}
```

使用整数基点 `contributionBps`：`10000 = 100%`。避免浮点误差。所有未取消的 required 顶层目标贡献总和必须等于 `10000`。optional 项贡献必须为 0，不进入总体分母，也不阻止 100%。

### 7.2 Checklist 规则

- 顶层 `C1…Cn` 是用户界面里的“小目标”。
- 子项 `C1.1…` 是计算证据，不在默认界面展示。
- 顶层小目标数量建议 3–12；界面最多同时露出 5 行。
- 每个顶层目标应是可验证的结果，不是“读取文件”“搭脚手架”这类前置动作。
- 前置动作在准备阶段或执行计划里，不进入进度分母。
- 一个顶层目标没有子项时，它是 0/100 的二元目标。
- 子项默认等分该顶层目标。大小明显失衡时，模型应在初始评估中拆分或合并，而不是给每个子项再加一层权重。

## 8. 进度算法

```text
objectiveProgress = completedActiveItems / countableItems

overallProgressBps =
  Σ(objective.contributionBps × objectiveProgress)
```

精确规则：

1. `completed` 计 1。
2. `pending`、`active`、`blocked` 计 0。
3. `cancelled` 不进入该层分母，但只有明确范围重评估可以取消。
4. `active` 只控制转圈和文案，不自动算 50%。
5. 没有子项的顶层目标：顶层状态 `completed` 才计 100%。
6. 一般更新不能改变 `contributionBps`、增加顶层目标或删除分母。
7. 只有 `goal_progress_rescope` 可以改变范围；必须给出 reason，增加 `scopeRevision`，允许进度下降，并在 UI 标明“范围已调整”。
8. 100% 需要所有 required 项完成且原生 Goal 进入完成状态（内部称 `completionConfirmed`，不是证据层的 verified）。否则最高展示 95% 和“最终校验中”。optional 项可以保存状态和证据，但不阻止 100%。

## 9. 模型调用边界

### 9.1 允许

- 当前 Goal 会话第一次启用时：评估目标、复用或生成 Checklist、分配顶层贡献值。
- 明确范围变化时：当前会话模型调用 `rescope` 重新评估。
- 正常执行过程中：当前模型顺手调用 MCP 更新已完成的 Checklist。这里是同一轮工具调用，不是额外外部模型请求。

### 9.2 禁止

- 为刷新百分比另发一次模型请求。
- 后台启动专用进度模型。
- 使用 API Key 调外部模型。
- 用 Hook 自动启动新 turn。
- 用 Token、时间或文件数猜进度。

## 10. MCP 工具面

MVP 保持 5 个工具：

1. `goal_progress_initialize`
2. `goal_progress_get`
3. `goal_progress_update`
4. `goal_progress_rescope`
5. `goal_progress_set_phase`

每个写工具必须包含 `expectedRevision`。冲突时返回：

```json
{
  "ok": false,
  "code": "REVISION_CONFLICT",
  "currentRevision": 8,
  "summary": "C2 已完成；C3.2 正在进行"
}
```

不得“最后写入覆盖前面写入”。

## 11. Helper、IPC 与存储

### 11.1 Helper

唯一长驻进程。职责：

- 进程单实例
- MCP/Hook/Renderer 请求接入
- 状态写入和迁移
- Native Goal / Token / CDP adapter 调度
- 日志与 doctor

### 11.2 默认路径（macOS MVP）

```text
~/Library/Application Support/CodexGoalProgress/
├── state/v1/<sha256(session-id)>/snapshot.json
├── state/v1/<sha256(session-id)>/events.jsonl
├── runtime/helper.sock
├── runtime/helper-locks/<instance-id>.json
├── runtime/helper.pid.json
├── runtime/runtime-context.key
├── runtime/runtime-proof-consumed/
├── logs/helper.log
└── install/manifest.json
```

不污染项目目录。P2 再提供显式导出到项目的功能。

### 11.3 写入规则

- 目录和 socket 权限只允许当前用户。
- 写临时文件 → flush/fsync → 原子 rename。
- 快照损坏时从 JSONL 重放。
- 事件包含 `eventId`、`revision`、`sessionId`、`turnId`、时间和来源。
- 日志默认不写完整用户目标和对话正文；只写 ID、状态、错误码和长度。

## 12. Renderer

### 12.1 组件边界

```html
<codex-goal-progress></codex-goal-progress>
```

- 作为原生 Goal 行的相邻节点挂载。
- 使用 Shadow DOM。
- 不覆盖 Codex 全局 CSS。
- 不读 DOM 里的对话内容。
- 只接收 `GoalProgressViewModel`。

### 12.2 UI 状态

ViewModel 用 `trackingPhase` 描述追踪生命周期；`collapsed`、`motionPaused` 和 `hidden` 是本机 UI Preference，不进入 Goal Contract 事件历史，也不能改变百分比。

- `preparing`：只显示克制的准备提示；不显示 0%。
- `active`：小目标 + 小进度条 + 总百分比 + 总进度条 + 可选 Token。
- `paused`：业务暂停（原生 Goal 或 Contract 暂停）。动画停，显示暂停。不复制官方 pause/resume 控件。
- `completed`：勾选和完成状态。
- `error`：显示可恢复错误，不影响官方 Goal。
- `detached`：停止追踪当前 Goal；官方 Goal 不受影响。
- `motionPaused`：仅暂停面板动效，不调用原生 Goal pause。
- `collapsed` / `hidden`：只改变本机展示；`hidden` 使用原生 HTML `hidden`。

### 12.3 视觉要求

- 默认最多露出 5 个小目标；更多项目在内部滚动。
- 滚动时显示细滚动条，停止后淡出。
- 完成：勾；进行中：转圈；待做：空心标记；阻塞：克制警示。
- 主进度条：紫蓝到洋红的克制渐变，固定数量的小粒子持续缓慢移动。
- 小进度条：约 4–6 秒一次错峰掠光。
- 只动画 `transform` 和 `opacity` 为主。
- 遵循 `prefers-reduced-motion`；关闭后信息仍完整。
- 不把内部权重直接展示为“权重 23%”。解释页可写“完成此项将推动整体约 23%”。

## 13. Codex DOM 与 CDP 适配

### 13.1 CDP 安全边界

借鉴 Dream Skin 的成熟部分：

1. 校验官方 Codex app 标识、签名、Team ID 和架构。
2. CDP 只绑定 `127.0.0.1` 和随机端口。
3. 确认端口属于 Codex 或合法子进程。
4. 只注入预期 `app://` Renderer。
5. Injector 在重载和路由切换后恢复。
6. Restore 必须重启到无调试参数的官方 Codex，才算真正关闭风险窗口。

不照搬它的大面积主题覆盖。我们的注入范围只包含一个 Host 元素和极少量启动按钮。

### 13.2 锚点适配器

```ts
interface CodexAnchorAdapter {
  id: string;
  probe(document: Document): ProbeResult;
  matchVisibleThread(document: Document, expectedThreadId: string): VisibleThreadMatchResult;
  findGoalAnchor(document: Document): HTMLElement | null;
  findGoalControls(document: Document): HTMLElement | null;
}
```

查找顺序：

1. 稳定 `data-*`、ARIA、role。
2. Goal 控件结构关系。
3. Composer 和 Goal 区域的相对关系。

找不到可靠锚点时安全降级为“不显示”。不得猜位置强插。

同一 renderer target 可以承载多个任务。当前版本 Adapter 还要读取唯一的当前侧栏
任务行，并用 `data-app-action-sidebar-thread-host-id` 与
`data-app-action-sidebar-thread-id` 做精确身份比较。原始 `threadId` 和
`<hostId>:<threadId>` 两种公开格式分别精确匹配；不得只做后缀包含判断。

### 13.3 挂载

- `ensureMounted()` 幂等。
- 可见任务身份缺失、重复或不一致时，先移除受管 Host，再拒绝挂载。
- `MutationObserver` 只监听必要容器。
- 路由变化后短延迟重探测。
- 失败使用指数退避；不得 10–50ms 高频轮询。
- Host 通过 CDP 结构化参数调用 `window.__CODEX_GOAL_PROGRESS__.update(viewModel)`，不得拼接用户文本进 JavaScript 字符串。

### 13.4 Helper Bridge

- Helper 内部 `ViewModelPublisher` 是唯一实时发布入口；相同 ViewModel 不重复推送。
- Renderer bundle 使用 release version、PageHost version、字节数和 SHA-256
  manifest，校验通过后才注入。
- PageHost 只暴露 `window.__CODEX_GOAL_PROGRESS__`，提供
  `mount`、`update`、`unmount` 和 `health`。
- 每个 Helper 用 nonce 派生唯一 CDP UI binding。PageHost 捕获函数后立即删除
  全局属性；事件必须匹配当前 Contract、thread 和 nonce。
- UI intent protocol v2 只允许 `setCollapsed`、`setMotionPaused`、
  `setPlacement`、`setFloatingXRatio`、`requestRetry` 和 `requestDetach`；
  payload 最大 1024 字节，每秒最多 8 次。
- `doctor --json` 复用当前 Bridge 的 `health()`，输出 App、CDP、Adapter、锚点、
  bundle、Goal/Token/thread 和最新 revision；不输出 Goal 正文或 raw threadId。

## 14. Token

优先来源：同一原生 Goal 的 `tokensUsed` / `tokenBudget`，或经验证的同 thread token usage event。

显示规则：

- 有 used：`Token 128K`
- 有 budget：`Token 128K / 200K`
- 不能证明 session 一致：隐藏
- 不从页面文字抓取
- 不新建 SDK thread
- 不把 Token 参与进度计算

## 15. 安装与分发

### 15.1 MVP

- macOS 优先。
- GitHub 仓库 + 本地 marketplace / 本地 Plugin 安装。
- Plugin 包含主 Skill、Hooks、MCP 声明和 Helper 资源。
- Hook 首次或变更后必须走 Codex 的信任审核。
- 开发环境可要求 Node/pnpm；发布包不要求普通用户安装 Node。

### 15.2 发布形式

POC 完成后再选自包含二进制方案。必须有：

```text
goal-progress install --json
goal-progress doctor --json
goal-progress verify --json
goal-progress restore --json
goal-progress uninstall --json
```

这些命令输出稳定机器 JSON，方便 AI 安装和排错。

`doctor` 和 `verify` 不以安装清单存在作为健康证据。它们还要确认 launchd 已加载、
socket 可连接、IPC 协议一致、ping PID 与当前唯一 Helper owner 一致，并通过
Helper 做一次不创建目录的 Store 只读探测。Plugin source/cache、Hook 清单 hash、
稳定保护命令、用户级 `~/.codex/hooks.json` 和 CDP listener ownership 也必须
检查。没有公开 Hook 信任查询接口时只输出 `hookTrust: pending_review`，不能声称
已信任。任一必需检查失败时 `ok` 必须为 `false`。

安装器从已经验证 bundle ID、Team ID 和真实路径的 Codex.app 推导
`Contents/Resources/codex`。该文件必须存在、可执行且 realpath 仍在同一 App 的
Resources 目录。正式路径不查询 shell `PATH`，也不回退到用户安装的全局 `codex`；
只有测试可直接向低层 Plugin controller 注入命令。CLI 错误只返回已检查的 App /
CLI 路径和有界 stdout、stderr，不复制环境变量。

安装与升级使用 `InstallTransaction`。Release、plist、Plugin、`current`、Helper、
CDP 和 manifest 的变更都在执行前登记逆序 rollback。新 Release 先进入 versioned
目录并完成 checksum、权限和 Plugin 校验；`current` 切换后才启动 Helper；候选
系统通过 doctor/verify 后，最后原子写 manifest。完整回滚返回 `changed:false`；
rollback 自身失败时返回 `INSTALL_PARTIAL_STATE`、逐步结果、保留的旧 Release 和
人工恢复命令。升级不删除上一版 Release；Codex Plugin 更新后也恢复上一版 cache，
避免活跃旧会话依赖的文件消失。需要重启 Codex 时先返回明确的 required/pending
状态，只有用户传入 `--restart-codex` 才安排重启。

卸载按 Plugin → launchd/Helper → CDP restore → 文件顺序执行；默认只删除安装和
runtime，保留 `state`、日志和偏好。旧 Hook 失去稳定 `current` 后静默 exit 0，
旧 MCP launcher 返回 `GOAL_PROGRESS_UNINSTALLED_OR_DISABLED`。紧急停用只移除
Goal Progress Plugin、卸载自身 Helper job 并移除 `current`；不改用户级 Hook、
其他 Plugin、Goal 历史或 CDP。Release 提供可从 Finder 运行的 Disable command，
并提示用户在 `/hooks` 只禁用 Goal Progress。

`repair` 先运行 doctor，再按错误码只修复 Helper、Plugin cache、Hook release 或
CDP 中的失败项。修复可以连续处理多个失败项，但不读取或写入 Contract，不重置
Token；Hook 定义仍等于安装 manifest 时输出 `hookReviewRequired:false`。

Release 根目录提供 Install、Repair、Disable、Uninstall 四个 `.command`。它们只用
自身绝对目录调用 `bin/goal-progress <command> --human`，不复制安装逻辑；Finder
终端中显示结果码和一个 next step，`--verbose` 才附加 details。AI 和自动化始终
使用 `--json`。安装 details 的 `states` 明确区分 `installed`、
`already_current`、`pending_restart`、`hook_review_required` 和
`partial_failure_rolled_back`。

### 15.3 公共插件目录

当前公开提交不适合“只有本地 STDIO MCP”的插件。MVP 不把进入公共目录作为硬前提。先做好本地 Plugin 和 GitHub 安装，等官方支持变化后再做发布 ADR。

## 16. 测试策略

- `contracts/core/store`：Vitest，纯单测，无 Codex、无模型。
- MCP：schema、revision、非法 ID、冲突、重试测试。
- Renderer：Playwright，准备/活动/完成/暗色/减少动态/滚动。
- CDP：fixture 页面和假 target；真实 Codex 只做受控 smoke。
- Hook：固定 JSON fixture，验证 session 注入和不泄露正文。
- Store：断电式截断、损坏快照、重复事件、迁移。
- Installer：安装、重复安装、升级、Restore、卸载的临时 HOME 测试。
- E2E：无 Goal 新建、已有 Goal 附加、重启恢复、范围重评估、Token 隐藏降级。

完成标准不是“页面看起来能动”。完成必须同时满足：

1. 同一 thread 原生 Goal 绑定已证明。
2. 无外部模型调用。
3. Helper 单写和 revision 测试通过。
4. Renderer 被删除后能恢复，找不到锚点时安全退出。
5. Restore 能关闭调试端口风险窗口。
6. `verify.py` 全绿。

## 17. 待确认项的默认决定

- `R-14`：准备文案只保留 3 个用户状态：`正在建立目标`、`正在整理验收点`、`正在准备进度`。内部技术步骤只进日志。
- `W-16`：MVP 不做人工编辑权重。P2 再做高级编辑器。
- `D-06`：macOS 默认存 Application Support；MVP 不写项目目录。P2 支持显式导出。

## 18. 参考资料（实施前重新核对当前版本）

- OpenAI Codex App Server：`thread/goal/set|get|clear` 与 Goal 用量
- OpenAI Build skills：Skill 显式/隐式调用和 progressive disclosure
- OpenAI Slash commands：启用的 Skill 出现在 slash 列表
- OpenAI Build plugins：Plugin manifest、本地 marketplace、Skill/MCP/Hook 打包
- OpenAI Hooks：`session_id`、`turn_id`、`model`、MCP `PreToolUse` 输入改写
- OpenAI MCP：本地 STDIO server 与 Plugin MCP 配置
- Fei-Away/Codex-Dream-Skin：本机 loopback CDP、签名校验、注入、Verify、Restore、安全边界

> API 与桌面 DOM 都可能变化。任何实现前先查当前官方文档和真实运行输出，不凭本文猜具体字段名。
