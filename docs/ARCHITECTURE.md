# Architecture

Codex Goal Progress adds deterministic checklist progress to one native Codex Goal. The current
Codex model interprets the Goal. Local code validates every update, stores the Contract, computes
the percentage, and renders the result.

## Data flow

```text
Goal Progress Skill
  → runtime proof
  → local MCP tools
  → Helper
  → Core + Event Store
  → display-only ViewModel
  → CDP Page Host
  → Lit Renderer
```

## Component responsibilities

| Component | Responsibility |
|---|---|
| Plugin Skill | Starts progress tracking for the current native Goal |
| Hook | Restores active Contracts and signs Goal Progress tool identity |
| MCP server | Exposes activation, initialization, read, update, rescope, and phase tools |
| Helper | Resolves the current thread, owns writes, reads native Goal and Token state, and publishes ViewModels |
| Core | Validates events and calculates objective and overall progress |
| Event Store | Persists JSONL events and a rebuildable snapshot |
| Codex adapter | Identifies the visible thread, native Goal, and layout geometry |
| Page Host | Maintains one managed Host and selects native or fallback placement |
| Renderer | Displays the ViewModel and emits bounded UI intents |

Helper is the only state writer. Core is the only progress calculator. Renderer displays the
ViewModel.

## Activation

Select the **Goal Progress** Skill for a native Goal.

When the Goal already exists:

1. The Hook injects a signed runtime proof.
2. Helper resolves the current thread and reads its native Goal.
3. `goal_progress_activate({})` returns `initialize`, `get`, or `rescope-or-replace`.
4. The current model reuses or prepares a checklist.
5. `goal_progress_initialize` sends only the Contract ID, source, and objectives. Helper binds the
   Contract to the current native Goal it reads at that moment.

When the Goal changes:

- The current model may use Codex native Goal tools to update it.
- A wording-only change keeps the existing checklist.
- A small scope change updates only affected objectives through `goal_progress_rescope`.
- A new delivery target creates a replacement Contract at revision 1.
- The previous Contract remains in event history.

## Progress calculation

Each required top-level objective receives an integer contribution. Required contributions total
10,000 basis points.

Core calculates progress in this order:

1. Calculate each objective's completed checklist ratio.
2. Multiply that ratio by the objective contribution.
3. Add every required objective contribution.
4. Display 95% when every required item is complete and the native Goal remains active.
5. Display 100% after the native Goal completes.

Token usage, elapsed time, command count, and changed-file count stay separate from the
percentage.

## Thread identity

A single Codex Renderer target can host multiple tasks. The adapter reads the unique active
sidebar row and accepts these exact thread formats:

```text
thread_id
host_id:thread_id
```

Helper confirms the same identity through the public App Server thread, turn, and Goal APIs.

## Native and fallback placement

Page Host selects one placement after thread verification:

- **Native**: the native Goal row is available.
- **Managed fallback**: the thread matches while the native Goal row is unavailable.
- **Hidden**: the visible thread changes.
- **Detached**: the user stops tracking.

Route changes, Reload, Composer rebuilds, Helper restarts, and short identity gaps trigger bounded
reconciliation. Native and fallback placement reuse the same Host and ViewModel.

## Renderer adaptation

The Lit Web Component uses Shadow DOM and local CSS.

It reads live Codex values for:

- theme surface and foreground tokens
- accent color
- UI font size
- document locale
- text direction
- native Goal and Composer geometry

Spacing and control sizes derive continuously from the live font token. The current regression
suite covers 11, 14, 16, and 20 px.

The Renderer selects a matching built-in message catalog from the Codex document locale. Other
locales use English UI copy while preserving locale-aware number formatting and the current text
direction.

## Local runtime

The macOS Release includes a self-contained Node Single Executable Application (SEA) Helper.
Runtime data lives under:

```text
~/Library/Application Support/CodexGoalProgress/
```

See [permissions](PERMISSIONS.md) and [support](SUPPORT.md) for the published boundaries.
