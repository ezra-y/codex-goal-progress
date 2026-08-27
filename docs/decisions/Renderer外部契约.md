---
id: decision-20260822-01
type: decision
status: active
version: v1
created_at: 2026-08-22
updated_at: 2026-08-22 21:54
refs: [requirement-20260818-01, decision-20260818-01, plan-20260822-01]
---
# Renderer 外部契约

> 本文冻结 release candidate 结构重构前的外部行为。Stage H 可以拆文件、拆组件和拆样式，但不得
> 修改 ViewModel 字段、Bridge 消息格式、公开入口或用户可见行为。本文不决定最终
> 视觉和主题接入方式。

## 使用公开入口

页面只暴露一个全局入口和一个自定义元素：

| 项目 | 当前值 | 约束 |
|---|---|---|
| 页面全局入口 | `globalThis.__CODEX_GOAL_PROGRESS__` | 不读取 Codex 私有 Store |
| Page Host 版本 | `13` | 行为不兼容时必须提高版本 |
| 自定义元素 | `codex-goal-progress` | 只能有一个受管理实例 |
| Host 标记 | `data-codex-goal-progress-host="v1"` | 只清理带该标记的节点 |
| 样式边界 | 元素自己的 Shadow Root | 不向 Codex 页面写全局样式 |

正常加载继续使用 `codex-goal-progress`。如果当前页面已经注册旧版同名组件，Page Host
可临时使用内部版本名 `codex-goal-progress-v13`，仍只保留一个受管理实例。

Page Host 提供四个方法：

| 方法 | 输入 | 结果 |
|---|---|---|
| `mount` | platform、appVersion、ViewModel、UI preference、可选 Bridge nonce | 挂载或更新唯一实例 |
| `update` | 完整 `GoalProgressViewModel` | 更新现有实例，不创建第二个实例 |
| `unmount` | 无 | 清理 Host、Observer、定时器和事件监听 |
| `health` | 无 | 返回挂载状态、原因、Host 数量和有限运行诊断 |

Host 使用结构化 CDP 参数传递数据。目标正文不拼进可执行脚本。

## 保持挂载正确

挂载顺序固定为原生 Goal 行之后、输入区之前。挂载前必须同时满足：

1. 当前 Codex 版本命中公开 Anchor Adapter。
2. 页面中只有一个可靠的原生 Goal 锚点。
3. 当前选中的公开 thread 标记与 ViewModel 的 `sessionId` 一致。
4. 页面中没有未管理或重复的 Goal Progress Host。

找不到锚点、thread 不一致或 Host 不可信时，Page Host 不注入。Goal 消失时卸载；
Goal 恢复、route 变化、reload 或 DOM 重建后，有限观察和退避可以重新挂载。

重复 `mount` 和连续 `update` 始终复用同一 Host。线程变化时先把旧 ViewModel 设为空，
再写入新线程的完整 ViewModel。Helper 启动时先执行一次 `clear`，避免旧 Helper 留下
孤儿 Host。

`placement=floating` 时，Host 脱离文档流，输入框位置不变。Page Host 用当前可见
Goal 边界，以及胶囊和展开面板的实际宽度计算安全中心区；`floatingXRatio` 只映射到
这个安全区。Goal、窗口或内部内容尺寸变化，以及页面滚动时重新测量。拖动过程只本地
预览，松手后才发送一次持久化 intent。Codex Composer 存在缩放或 transform 时，先
实测 Host 局部原点和比例，再把 Goal 的屏幕坐标反算为 Host 局部坐标。

原生临时步骤卡和文件变更胶囊只按 Goal 上方中心带、实际矩形、圆角和 surface 特征
识别，不依赖正文，也不假定它位于 Composer 内或外。胶囊优先横向避让；展开面板保持
在 Goal 内并向上抬过原生 surface。原生 surface 消失后按保存的比例恢复。11 / 14 /
16px 回归使用真实记录的约 414 / 491 / 542px 步骤卡宽度。

C 拖动手柄支持指针和左右方向键，Shift 加速移动。Escape 收起并把焦点还给展开按钮；
点击组件外部也会收起，但保留被点击目标的正常行为。展开详情中的“显示位置设置”提供
A、C 和恢复默认位置三个动作，同一入口由 A/C 共享。

如果 C 的实际边界、步骤卡或上方空间无法容纳胶囊和面板，Page Host 临时使用 A，并在
Host 标记 `data-codex-goal-progress-floating-fallback="insufficient-space"`。用户的 C
偏好和归一化位置不被覆盖；普通进度更新保持 A，窗口或滚动环境变化后再尝试 C。

## 处理 UI intent

Renderer 只发送以下四种 intent：

| intent | 页面事件 | 额外条件 |
|---|---|---|
| `setCollapsed` | `goal-progress-set-collapsed` | 必须带 boolean |
| `setMotionPaused` | `goal-progress-set-motion-paused` | 必须带 boolean |
| `setPlacement` | `goal-progress-set-placement` | 必须是 `inline` 或 `floating` |
| `setFloatingXRatio` | `goal-progress-set-floating-x-ratio` | 必须是 `0–1` 的有限数值 |
| `requestRetry` | `goal-progress-request-retry` | 无正文 |
| `requestDetach` | `goal-progress-request-detach` | 必须来自真实用户操作 |

Bridge 使用 UI intent protocol v2，并校验 nonce、Contract ID、thread ID、1 KiB
大小上限和每秒 8 次速率
上限。其他 intent 被拒绝。Renderer 不直接写 Store，也不计算进度。

## 保持现有展示行为

- `preparing` 不显示正式百分比。
- `active`、`paused`、`completed`、`error` 和 `detached` 使用现有状态分支。
- 默认只展示顶层小目标，不展示内部 checklist。
- 1–5 个小目标完整显示；超过 5 个时使用组件内部滚动。
- 滚动条只在滚动时出现，停止后隐藏；当前 active 项自动进入可见范围。
- Token 不可信或缺失时隐藏。
- 收起、motion pause 和 hidden 是本地 UI preference，不写入 Goal Contract。
- UI preference v2 还保存 `placement` 和 `floatingXRatio`；旧 v1 数据读取时迁移为
  `inline` 和 `0.5`，并保留原有收起、动效和隐藏值。
- `prefers-reduced-motion` 或 motion pause 会停止粒子、掠光和旋转动画。
- 组件移除时清理 scroll listener、ResizeObserver、timer 和 animation frame。

这些规则冻结行为，不冻结文件名和内部组件树。

## 失败时保持 Codex 可用

非法 ViewModel 会让 Page Host 停止 Renderer 运行并移除自己的 Host。原生 Goal 按钮、
输入框和 Codex 页面不被替换。Renderer、Bridge 或锚点失败不能阻止普通 Codex。

## 验证证据

| Evidence | Finding | Path |
|---|---|---|
| `tests/e2e/sidecar-mount.spec.ts` 的 public lifecycle 场景 | mount、update、health、unmount 和幂等规则可观察 | Page Host → SidecarMountController |
| 同文件的 invalid update 场景 | Renderer 失败后原生 Pause、Edit、Clear 仍工作 | invalid input → unmount managed Host |
| route、reload、DOM rebuild 和 thread mismatch 场景 | 旧线程数据不会留到新线程 | Observer → Adapter → reconcile |
| `tests/e2e/renderer.spec.ts` | 状态、滚动、reduced motion、清理和视觉基线已冻结 | ViewModel → Web Component Shadow Root |
| `tests/unit/renderer-bridge.test.ts` | 非白名单或错误身份 intent 不会进入 Helper | CDP binding → envelope validation |

运行：

```bash
pnpm exec vitest run tests/unit/renderer-bridge.test.ts tests/unit/sidecar-mount.test.ts --config vitest.config.ts
pnpm exec playwright test tests/e2e/renderer.spec.ts tests/e2e/sidecar-mount.spec.ts
```
