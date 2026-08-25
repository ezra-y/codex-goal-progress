<div align="center">
  <h1 align="center">
    <img src="docs/assets/codex-goal-progress-logo.png" alt="Codex Goal Progress logo" width="130"><br>
    Codex Goal Progress
  </h1>
  <p>A native progress bar for Codex Goals, powered by verified checklists and local progress tracking.</p>
  <p>
    <strong>English</strong> · <a href="README.zh-CN.md">简体中文</a>
  </p>
</div>

<p align="center">
  <img src="docs/assets/codex-goal-progress-demo.gif" alt="Codex Goal Progress in action">
</p>

## ✨ Features

Displays a progress view beside the native Codex Goal, bringing together current objective
progress, overall progress, and Token usage attributable to that Goal.

| Capability | Behavior |
|---|---|
| Rule-driven progress | Calculates objective and overall progress from a validated checklist, not from Token usage, elapsed time, or guesses. |
| Verifiable calculation | The model handles only the necessary Goal understanding and checklist updates; the local Helper manages state and progress calculation. |
| Native theme adaptation | Follows Codex Light/Dark mode and the user's current accent color. |
| Type scale adaptation | Reads the current Codex UI font size and derives spacing continuously from it. |
| Layout adaptation | Measures the real native Goal and composer geometry to coordinate fixed and draggable floating layouts. |
| Language adaptation | Follows the Codex document language and text direction without changing the progress Contract. |

## 🚀 Quick start

### Option 1: Download the macOS Release

Download [codex-goal-progress-macos-arm64.zip](https://github.com/Ezra-Y/codex-goal-progress/releases/latest/download/codex-goal-progress-macos-arm64.zip),
unzip it, then double-click **Install Goal Progress.command**.

### Option 2: Install from Terminal

```bash
curl -fsSL https://github.com/Ezra-Y/codex-goal-progress/releases/latest/download/install.sh | sh
```

The script downloads the macOS Release and `SHA256SUMS`, verifies the ZIP, and runs the bundled
installer. If Codex must restart, the script asks first.

If Codex asks you to review the Goal Progress Hook, approve it, then open a new task so the new
Plugin session loads.

## 🛠️ Requirements

* Apple Silicon Mac
* Codex Desktop

Release users do not need Node.js or pnpm. Contributors can follow
[CONTRIBUTING.md](CONTRIBUTING.md) to build and verify the source.

## 🎯 How to use

Open a native Codex Goal, then select the **Goal Progress** Skill.

The current Codex model prepares or reuses that Goal's checklist and creates a local progress
record.

Enable Goal Progress separately for each new Goal. Ordinary Goals remain unchanged when Goal
Progress is not enabled.

## 🌓 Light and Dark

### Light

| Fixed view | Floating view |
|---|---|
| ![Goal Progress fixed view in the real Codex light theme](docs/assets/codex-goal-progress-light-fixed-en.png) | ![Goal Progress floating view in the real Codex light theme](docs/assets/codex-goal-progress-light-floating-en.png) |

### Dark

| Fixed view | Floating view |
|---|---|
| ![Goal Progress fixed view in the real Codex dark theme](docs/assets/codex-goal-progress-dark-fixed-en.png) | ![Goal Progress floating view in the real Codex dark theme](docs/assets/codex-goal-progress-dark-floating-en.png) |

## 🧭 How it works

<p align="center">
  <img src="docs/assets/codex-goal-progress-architecture.png" alt="How Codex Goal Progress works">
</p>

- The current model updates checklist evidence through local MCP tools.
- Helper validates revisions and is the only state writer.
- Core derives objective and overall progress from the checklist.
- Renderer receives a display-only ViewModel.
- The installer uses a self-contained Node SEA Helper.

Read the [architecture decision](docs/decisions/CodexGoalProgress技术架构.md),
[permissions](docs/architecture/PERMISSIONS.md), and
[threat model](docs/quality/THREAT-MODEL.md) for details.

## 🔐 Privacy and permissions

Goal Progress uses:

- local files under its application-support directory;
- a private local Unix socket;
- a loopback CDP connection to the verified Codex process;
- a background Helper registered through launchd;
- three reviewable Plugin Hooks.

See [PERMISSIONS.md](docs/architecture/PERMISSIONS.md) for the exact scope and removal steps.

## License

[MIT](LICENSE)
