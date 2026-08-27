---
id: decision-20260818-02
type: decision
status: active
version: v1
created_at: 2026-08-18
updated_at: 2026-08-18 08:23
refs: [requirement-20260818-01, decision-20260818-01, research-20260818-01]
---
# 原生 Goal 创建与控制面

## 背景

Goal Progress 必须绑定 Codex 原生 Goal。创建、读取或附加都必须留在当前
thread，不能启动新模型会话，也不能用普通聊天状态代替。

## 实测事实

- 环境：macOS `26.5`，Codex CLI/App Server `0.148.0-alpha.9`。
- 当前模型有宿主 `create_goal`、`get_goal`、`update_goal` 能力。用户本次
  `/goal` 已建立原生 Goal。
- 宿主 `get_goal` 返回 thread
  `01a01158-e08c-7531-824f-1ae6ac7e3c0e`。
- 独立 STDIO App Server 对同一 ID 调 `thread/goal/get`，读到相同 objective、
  status 和 `createdAt`。
- POC 曾用同 objective 调 `thread/goal/set`，计数和 `createdAt` 没有重置。
  独立审查指出协议没有 revision/CAS，写回旧 objective 仍可能覆盖并发编辑。
- 最终 attach 因此改为纯读取。前后 turn ID 不变，请求中没有
  `thread/goal/set`、`thread/start`、`thread/fork` 或 `turn/start`。
- 明显不同的新 objective 在本地保护层返回 conflict，且不发送
  `thread/goal/set`。

## 决定

1. 无原生 Goal 时，主 Skill 要求当前会话模型调用宿主 `create_goal`。这是首选
   创建路径，保证同一模型和同一 thread。
2. 已有 Goal 时，attach 只通过 App Server `thread/goal/get` 读取，不回写
   objective、status 或 tokenBudget。
3. 不同 objective 默认返回冲突，不静默替换。正式状态写入等 Helper 阶段定义
   并发保护后再实现；没有 CAS 时不能用旧快照回写 objective。
4. App Server 客户端只走 STDIO 控制面。探针会比较 turn 列表和通知；出现新
   turn、`thread/start` 或 `thread/fork` 就失败。
5. MCP 不直接控制原生 Goal。它把已验签的 session 身份交给 Helper，由 Helper
   执行上述保护。
6. App Server 响应、通知和服务端请求必须严格区分。任何 `thread/started`、
   `turn/started`、未知服务端请求或通知 thread 串线都使操作失败。
7. 探针必须在最后一个 RPC 后自然关闭并排空 App Server 输出，再判定通知。
   若进程需要 `SIGTERM` 或 `SIGKILL` 才能退出，排空未得到证明，探针失败。

## 未完成门禁

- 当前 Goal 正在承载本次夜间任务，不能清空它来实测“无 Goal 创建”，否则会
  丢失真实 Token 历史。
- 规则禁止新建隐藏 thread，且 Codex Desktop 当前未全局安装测试 Hook。因此
  尚未在同一个 Desktop thread 中直接比对 Hook `session_id` 与 App Server
  `threadId`。
- 在这两项获得真实证据前，不把 App Server `goal/set` 作为默认创建路径，也不
  宣称 Stage 4 全部完成。

## 不采用

- 不通过 `thread/start` 或 `thread/fork` 建立测试或产品 thread。
- 不通过 Codex MCP server 间接启动 agent；当前 MCP transport 不暴露原生 Goal
  生命周期。
- 不用 CDP 模拟 `/goal` 输入，不读私有 React Store，不修改 Codex 安装包。
