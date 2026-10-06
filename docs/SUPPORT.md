# Support

This page lists the published platform and runtime surfaces.

## Platform

| Surface | Current value |
|---|---|
| Goal Progress release | v0.3.10 |
| Status | Unpublished local candidate; latest public release v0.3.9 |
| Operating system | macOS |
| Architecture | Apple Silicon arm64 |
| Application | Codex Desktop |
| Helper runtime | Node SEA v24.19.0 |
| Goal Contract | schema v2 |
| IPC | protocol v4 |
| Renderer UI intent | protocol v2 |
| Page Host | v64 |

## Recent Codex updates

Version 0.3.9 supports both the current nested Codex CLI bundle and the previous layout.
If an earlier version reports `GOAL_PROGRESS_CODEX_BUNDLED_CLI_NOT_FOUND` after a Codex update,
update Goal Progress through the same installation method you already use.

A successful app startup and delayed progress-page recovery are reported separately.
`STARTUP_RENDERER_RECOVERY_PENDING` means progress-page recovery has not completed; inspect
`causeCode` for the reason. The Helper retries a limited number of times. A missing page can
resolve as the window loads; repeated failures still need investigation.

For the latest user-facing changes, see the [release notes](../CHANGELOG.md).

## Interface adaptation

| Capability | Behavior |
|---|---|
| Theme | Reads live Codex light, dark, system, surface, foreground, and accent tokens |
| Font size | Reads the live Codex font token and derives layout continuously |
| Locale | Reads the live Codex document locale and selects a matching built-in catalog |
| Locale fallback | Uses English UI copy and locale-aware number formatting |
| Text direction | Reads live LTR or RTL direction |
| Placement | Native, managed fallback, fixed, and draggable floating views |
| Motion | Default motion, explicit pause, and `prefers-reduced-motion` |

Font regression tests cover 11, 14, 16, and 20 px.

## Installation results

A healthy installation returns:

```text
INSTALL_OK or INSTALL_ALREADY_CURRENT
DOCTOR_OK
VERIFY_OK
```

Use `nextStep` from the JSON result when a command requests another action.

`INSTALL_OK` can include `codexSessionReconnectRequired: true`. Reopen the affected chat, or
start a new one, to load the updated plugin. Save or finish running work before a full restart.
Doctor and Verify validate installation and connectivity; they do not replace a real Goal-card
check or prove that every already-running auxiliary Codex process has adopted a newer binary.

Release archives retain the documentation bundled at build time. Current installation and
support instructions are maintained on the repository's default branch.

## Product roadmap

The current roadmap includes:

- Developer ID signing and Apple notarization
- a native Goal-row activation shortcut
- an end-user checklist editor
- project checklist file watching
- expanded Token and context details
- additional platform packages
