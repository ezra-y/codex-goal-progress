<h1 align="center">Codex Goal Progress</h1>

<p align="center">
  <img src="docs/assets/codex-goal-progress-demo.gif" alt="Codex Goal Progress in action">
</p>

<p align="center">
  <strong>English</strong> · <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">Optional, deterministic checklist progress for native Codex Goals.</p>

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

### Install with AI

Send this instruction to an AI:

```text
Please install and enable https://github.com/Ezra-Y/codex-goal-progress. After installation, run doctor and verify to confirm that it works correctly.
```

### Install manually

Build from source:

```bash
git clone https://github.com/Ezra-Y/codex-goal-progress.git
cd codex-goal-progress

pnpm install --frozen-lockfile
pnpm build

GOAL_PROGRESS_NODE_BINARY=/your/path/to/node-v24.19.0-arm64 \
  pnpm build:release:macos

./dist/release/macos-arm64/bin/goal-progress install --json
./dist/release/macos-arm64/bin/goal-progress doctor --json
./dist/release/macos-arm64/bin/goal-progress verify --json
```

Replace the Node path with the real path on your machine. Follow the installer prompt if Codex
must reconnect or review a Hook.

## 🛠️ Requirements

* Apple Silicon Mac
* Node.js 22.12 or newer
* pnpm 11
* A Node.js 24.19.0 arm64 binary when building the macOS Release

The built Release is written to:

```text
dist/release/macos-arm64
```

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
