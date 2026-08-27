# Permissions

Goal Progress uses local resources for the Plugin, Helper, progress state, and Codex Sidecar.

## Product access

| Resource | Purpose | Scope |
|---|---|---|
| Codex Plugin | Skill, Hook, MCP, and Renderer bundle | `codex-goal-progress` only |
| Application Support | Release files, state, logs, and preferences | `~/Library/Application Support/CodexGoalProgress` |
| LaunchAgent | Starts the local Helper | `com.codexgoalprogress.helper` |
| Unix socket | Connects Hook, MCP, CDP Bridge, and Doctor to Helper | Private runtime directory, mode `0600` |
| Loopback CDP | Mounts the display-only Renderer in the verified Codex process | Random `127.0.0.1` port |
| Codex App Server | Reads native Goal, Token, thread, and turn identity | Current Codex user session |
| Process inspection | Confirms Codex and Helper ownership | Verified local PIDs and ports |

Goal, Contract, and Token data flow between the current Codex session and the local Helper.

## macOS prompts

macOS displays a Goal Progress background item because launchd starts the Helper.

Codex restarts through LaunchServices when CDP configuration changes. This keeps macOS permission
attribution attached to the Codex application.

If macOS displays an additional permission prompt:

1. Save the prompt time and a screenshot.
2. Run `goal-progress doctor --json`.
3. Run `goal-progress emergency-disable --json` when the prompt repeats.
4. Attach the Doctor result to a private security report.

## Removal

Run:

```bash
goal-progress uninstall --json --keep-history
```

Use `--delete-history` after the user requests Goal history deletion.
