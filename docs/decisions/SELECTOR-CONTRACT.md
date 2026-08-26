---
id: decision-20260820-01
type: decision
status: active
version: v1
created_at: 2026-08-20
updated_at: 2026-08-26 18:34
refs: [requirement-20260818-01, decision-20260818-01, research-20260818-01, plan-20260818-02]
---
# SELECTOR-CONTRACT

## 1. 状态和适用范围

本文是 Gate B 5.6 后冻结的选择器合同。当前只支持以下组合：

| 项目 | 值 |
|---|---|
| Platform | macOS |
| macOS | `26.5 (25F71)` |
| Codex Desktop | `26.818.21641 (6849)`；`26.818.31338 (6892)`；`26.818.41509 (6962)`；`26.818.61809 (7019)`；`26.820.60940 (7119)` |
| Adapter | `macos-26.818.21641-goal-row-v1`；`macos-26.818.31338-goal-row-v1`；`macos-26.818.41509-goal-row-v1`；`macos-26.818.61809-goal-row-v1`；`macos-26.820.60940-goal-row-v1` |
| Page API | v52 |

Codex 版本变化后，当前 Adapter 必须返回 unsupported，直到新的真实 DOM 探测、
脱敏 fixture 和测试通过。不得用版本范围猜测兼容。

## 2. 可见任务身份

同一个 renderer target 可以承载多个任务。renderer 数量不能证明当前任务。

挂载前必须找到唯一任务行，并同时满足：

- `[data-app-action-sidebar-thread-row]`
- `aria-current="page"`
- `data-app-action-sidebar-thread-active="true"`
- `data-app-action-sidebar-thread-selected="true"`

任务身份读取：

- `data-app-action-sidebar-thread-id`
- `data-app-action-sidebar-thread-host-id`

只接受两种精确匹配：

1. 页面 ID 等于实际 `threadId`。
2. 页面 ID 等于 `<hostId>:<threadId>`，其中 `hostId` 必须来自同一任务行。

不得使用后缀包含、目标正文、标题或 CSS class 推测任务。任务行缺失、重复、ID
缺失或不匹配时，移除受管 Host，并拒绝挂载。

## 3. Goal 锚点

当前 Adapter 要求：

1. 页面只有一个 `[data-codex-composer-root]`。
2. Composer 内只有一个 `[role="textbox"][data-codex-composer]`。
3. Goal 候选是 textbox 上方的宽 `button[type="button"]`。
4. 候选包含 disclosure 子节点，且同一结构行有至少两个带 `aria-label` 的控制按钮。
5. 挂载锚点是 Composer 的直接子区域，包含完整 Goal 行和原生控制区。

`Goal` / `目标` 文字只增加语言提示 signal，不决定是否命中。目标正文不参与
锚点选择，也不写入探测证据。

## 4. Host 规则

- 组件名：`codex-goal-progress`
- 所有权标记：`data-codex-goal-progress-host="v1"`
- Host 必须紧跟完整 Goal 区域。
- 页面最多存在一个 Host。
- 未知 Host 或重复 Host 出现时不修改页面。
- 不替换 Composer、Goal、textbox 或官方控制按钮。
- ViewModel 只通过 `Runtime.callFunctionOn` 的结构化参数传入。
- C 浮动 Host 仍保留同一 DOM 所有权关系，但使用当前 Goal 可见边界、胶囊宽度和
  展开面板宽度限制横向中心点；不保存绝对像素。

## 5. 观察和退避

页面 API 在 `documentElement` 上订阅 `childList`，以及以下属性：

- `aria-current`
- `data-app-action-sidebar-thread-active`
- `data-app-action-sidebar-thread-host-id`
- `data-app-action-sidebar-thread-id`
- `data-app-action-sidebar-thread-selected`
- `data-codex-composer`
- `data-codex-composer-root`

MutationObserver 回调只处理 Composer 或当前任务行区域的变化，并忽略 Sidecar
自身 Host 的增删。相关变化等待 150ms 后合并处理。失败按
250 / 500 / 1000 / 2000 / 4000ms 重试五次，然后停止；新的相关变化会重置
退避。页面稳定时不轮询，也不遍历整个 DOM。

## 6. 安全降级

以下情况都必须保持 Host 数量为 0：

- Codex 版本不支持。
- Composer 或 textbox 缺失、重复。
- Goal 锚点缺失、重复或结构失配。
- 当前任务标记缺失、重复或与 ViewModel 不一致。
- Host 所有权不明或存在多个 Host。

诊断只记录 Adapter ID、拒绝原因和计数，不记录对话正文、Goal 正文、原始
thread ID、React Store、私有 chunk、localStorage 或 indexedDB。

## 7. 变更流程

选择器或观察属性变化时：

1. 在正式 Codex 版本上重新运行脱敏 DOM 探测。
2. 新建明确版本的 Adapter 和 fixture。
3. 先补缺失、重复、任务失配和原生控件不受影响的测试。
4. 保存 mounted、reload、route、missing-anchor 机器证据和真实截图。
5. 完整门禁通过后，才更新本文支持表。

## 8. 当前证据

- 详细机器证据保存在内部验证档案中。
