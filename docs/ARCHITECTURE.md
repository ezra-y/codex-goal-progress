---
id: decision-20260827-01
type: decision
status: active
version: v1
created_at: 2026-08-27
updated_at: 2026-08-27 11:15
refs: []
---
# Architecture

Codex Goal Progress adds a local progress layer to the active Codex Goal.

## Data flow

```text
Goal Progress Skill
        ↓
current Codex model
        ↓
local MCP tools
        ↓
Goal Progress Helper
        ↓
Goal Contract + local event store
        ↓
Renderer Bridge
        ↓
<codex-goal-progress>
```

The current Codex model creates and updates a checklist. The Helper validates each update,
stores it locally, and calculates progress from completed checklist items. The Renderer receives
a display-only ViewModel.

## Components

| Component | Role |
|---|---|
| Plugin and Skill | Start or resume progress tracking in the current task |
| MCP tools | Submit structured checklist updates |
| Hooks | Add trusted task and turn identity |
| Helper | Own state writes, revision checks, progress calculation, and recovery |
| Event store | Keep local snapshots and append-only events |
| Renderer Bridge | Deliver the latest ViewModel to Codex |
| Web Component | Render progress, Token usage, and local display controls |

## Task identity

The Page Host compares the visible Codex task ID with the ViewModel session ID.

| Result | Display behavior |
|---|---|
| Matched | Show the current ViewModel |
| Temporarily unknown | Keep a previously verified Host during a bounded retry period |
| Mismatch | Remove the Host immediately |

This identity check is independent from the native Goal locator.

## Native and fallback display

The macOS locator searches for the current native Goal row.

| Locator result | Display mode |
|---|---|
| Goal row found | Native placement beside the Goal |
| Goal row unavailable | Managed fallback placement |

Native and fallback modes reuse one Host and one ViewModel. The saved placement preference stays
unchanged while the effective display mode follows the current Codex layout.

## Recovery

The Helper keeps the latest full ViewModel and its delivery state. After a page lifecycle change,
the Bridge reconnects, verifies the visible task, and republishes the latest ViewModel. Recovery
also checks Host ownership, Host count, display mode, and ViewModel revision.

## Local runtime

The macOS package contains a self-contained Node SEA Helper. The installer registers one launchd
job, installs the local Codex Plugin, and prepares a loopback CDP connection. Doctor and Verify
check the Helper owner, Plugin tree, file permissions, IPC, Store access, and CDP ownership.
