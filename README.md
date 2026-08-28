<div align="center">
  <h1 align="center">
    <img src="https://raw.githubusercontent.com/Ezra-Y/codex-goal-progress/main/docs/assets/codex-goal-progress-logo.png" alt="Codex Goal Progress logo" width="130"><br>
    Codex Goal Progress
  </h1>
  <p>A native progress bar for Codex Goals, powered by verified checklists and local progress tracking.</p>
</div>

<p align="center">
  <img src="https://raw.githubusercontent.com/Ezra-Y/codex-goal-progress/main/docs/assets/codex-goal-progress-demo.gif" alt="Codex Goal Progress in action">
</p>

## 🆕 Latest update

### v0.2.1 — Event-driven recovery

Got rid of that 2-second loop shitcode Codex wrote.

- ⚡ Goal Progress now responds to real task changes instead of checking every two seconds.
- 🔄 Returning to a task after a page reload restores its progress automatically.
- 🧭 New tasks work even while Codex is showing a temporary sidebar ID.
- 🔌 Recovery starts immediately when the Codex page connection drops.
- ✨ Paused and overall-progress labels now match Codex typography more naturally.

This is the latest release. See the [full changelog](CHANGELOG.md) for more details.

## ✨ Features

Displays a progress view beside the native Codex Goal, bringing together current objective
progress, overall progress, and Token usage attributable to that Goal.

| Capability | Behavior |
|---|---|
| Rule-driven progress | Calculates objective and overall progress from a validated checklist; Token usage and elapsed time remain separate supporting data. |
| Verifiable calculation | The model handles only the necessary Goal understanding and checklist updates; the local Helper manages state and progress calculation. |
| Native theme adaptation | Follows Codex Light/Dark mode and the user's current accent color. |
| Type scale adaptation | Reads the current Codex UI font size and derives spacing continuously from it. |
| Layout adaptation | Measures the real native Goal and composer geometry to coordinate fixed and draggable floating layouts. |
| Language adaptation | Reads the live Codex document locale and direction, selects a matching built-in catalog, and falls back to English. |

## 🚀 Quick start

### Install with AI

Send this instruction to an AI:

```text
Install and verify https://github.com/Ezra-Y/codex-goal-progress by following its INSTALL-FOR-AI.md.
```

### Install from Terminal

```bash
curl -fsSL https://github.com/Ezra-Y/codex-goal-progress/releases/latest/download/install.sh | sh
```

The script downloads the macOS package and `SHA256SUMS`, verifies the ZIP, and runs the bundled
installer. If Codex must restart, the script asks first.

If Codex asks you to review the Goal Progress Hook, approve it, then open a new task so the new
Plugin session loads.

## 🛠️ Requirements

* Apple Silicon Mac
* Codex Desktop

The macOS package includes its runtime.

## 🎯 How to use

Open a native Codex Goal, then select the **Goal Progress** Skill.

The current Codex model prepares or reuses that Goal's checklist and creates a local progress
record.

Enable Goal Progress separately for each new Goal. Ordinary Goals continue through the native
Codex flow.

## 🌓 Light and dark

### Light

| Fixed view | Floating view |
|---|---|
| ![Goal Progress fixed view in the real Codex light theme](https://raw.githubusercontent.com/Ezra-Y/codex-goal-progress/main/docs/assets/codex-goal-progress-light-fixed-en.png) | ![Goal Progress floating view in the real Codex light theme](https://raw.githubusercontent.com/Ezra-Y/codex-goal-progress/main/docs/assets/codex-goal-progress-light-floating-en.png) |

### Dark

| Fixed view | Floating view |
|---|---|
| ![Goal Progress fixed view in the real Codex dark theme](https://raw.githubusercontent.com/Ezra-Y/codex-goal-progress/main/docs/assets/codex-goal-progress-dark-fixed-en.png) | ![Goal Progress floating view in the real Codex dark theme](https://raw.githubusercontent.com/Ezra-Y/codex-goal-progress/main/docs/assets/codex-goal-progress-dark-floating-en.png) |

## 🧭 How it works

<p align="center">
  <img src="https://raw.githubusercontent.com/Ezra-Y/codex-goal-progress/main/docs/assets/codex-goal-progress-architecture.png" alt="How Codex Goal Progress works">
</p>

- The current model updates checklist evidence through local MCP tools.
- Helper validates revisions and is the only state writer.
- Core derives objective and overall progress from the checklist.
- Renderer receives a display-only ViewModel.
- The installer uses a self-contained Node SEA Helper.

Read the [architecture](https://github.com/Ezra-Y/codex-goal-progress/blob/main/docs/ARCHITECTURE.md),
[permissions](https://github.com/Ezra-Y/codex-goal-progress/blob/main/docs/PERMISSIONS.md), and
[support reference](https://github.com/Ezra-Y/codex-goal-progress/blob/main/docs/SUPPORT.md)
for details.

## 🔐 Privacy and permissions

Goal Progress uses:

- local files under its application-support directory;
- a private local Unix socket;
- a loopback CDP connection to the verified Codex process;
- a background Helper registered through launchd;
- three reviewable Plugin Hooks.

See [PERMISSIONS.md](https://github.com/Ezra-Y/codex-goal-progress/blob/main/docs/PERMISSIONS.md)
for the exact scope and removal steps.

## License

[MIT](https://github.com/Ezra-Y/codex-goal-progress/blob/main/LICENSE)
