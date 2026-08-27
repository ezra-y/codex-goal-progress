---
id: other-20260822-01
type: other
status: active
version: v1
created_at: 2026-08-22
updated_at: 2026-08-22 01:40
refs: [plan-20260821-01, requirement-20260818-01]
---

# HOOK SAFETY

Goal Progress 的 Hook 只能影响 Goal Progress 自己。普通提示词、普通工具、普通 Goal
和其他 Plugin 不依赖 Helper、Store、CDP 或安装目录。

## 设计结论

旧的全局提示词 Hook 事故说明：只要一个 `UserPromptSubmit` Hook 依赖可删除的源码、
运行时或后台服务，基础设施故障就可能阻止所有普通输入。修复原则是删除这条拦截面，
让显式 Skill 和 MCP 负责激活。

Goal Progress 不写 `~/.codex/hooks.json`。所有 Hook 随 Plugin 发布。安装器也不向
`config.toml` 写 Hook 或信任值。

## Hook 表

| Event | Matcher | Timeout | Async | 失败策略 |
|---|---|---:|---:|---|
| `SessionStart` | `startup|resume|compact` | 2 秒 | 否 | fail-open；只恢复已有 Contract |
| `PreToolUse` | 仅 `goal_progress_*` | 1 秒 | 否 | 只拒绝无有效 proof 的自有工具 |
| `PostToolUse` | `^update_goal$` | 2 秒 | 是 | fail-open；只观察完成信号 |

以下事件不存在：

- `UserPromptSubmit`
- `Stop`
- `SubagentStop`
- `PostToolUse(update_plan)`

非 Goal Progress 工具不会匹配 PreToolUse。MCP Server 会再次验证 Runtime Proof，
Hook 不是唯一安全边界。

## 稳定 command 和审核

三条 Hook 使用同一个稳定 guard：

```sh
/bin/sh -c 'p="$HOME/Library/Application Support/CodexGoalProgress/install/current/bin/goal-progress"; [ -x "$p" ] || exit 0; exec "$p" hook'
```

运行二进制缺失时直接退出 0。command 不含源码仓库、下载目录、临时目录、Node、
Python 或 shell PATH。

Codex 根据 Hook 定义维护信任值。安装器不读取、不生成、不复制 `trusted_hash`。
command、event、matcher 或控制能力变化时，用户重新审核；普通业务修复只替换稳定
路径后的二进制。

## 生命周期顺序

安装和升级：

1. 验证 Codex App、Release 和 CDP。
2. 复制 Release，写 LaunchAgent plist。
3. 用 Codex 内置 CLI 安装 Plugin。
4. 原子切换 `current`。
5. 启动 Helper，等待真实 ping。
6. 运行 doctor 和 verify。
7. 成功后写安装清单；失败则反向回滚。

卸载：

1. 移除 Plugin。
2. 停止 Helper。
3. 关闭 CDP，并通过 LaunchServices 正常重开 Codex。
4. 删除 LaunchAgent、运行目录和安装目录。
5. 默认保留 Goal 历史。

Codex 必须通过 LaunchServices 启动。直接由 Goal Progress 启动 App 可让 macOS TCC
把 Codex 子进程的权限访问错误归因给 Goal Progress。证据见
内部验证档案。

## 故障边界

- SessionStart、PostToolUse、未知事件、非法 JSON、Helper 缺失和日志失败均退出 0。
- 自有 PreToolUse 输入或 proof 无效时，返回合法 deny JSON，进程仍退出 0。
- 删除 Helper、`current`、二进制或源码仓库时，普通提示词仍进入模型。
- `/hooks` 禁用或 Hook 等待审核时，Goal Progress 不可用，普通 Codex 继续。
- Disable、restore 和 uninstall 只处理本插件，不改其他 Hook 或 Plugin。
