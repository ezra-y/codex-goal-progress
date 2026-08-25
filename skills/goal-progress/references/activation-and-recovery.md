# Activation And Recovery

Read this file only for first activation, conflicts, cancellation, or recovery.

## Entry Parsing

The Skill is already explicit when this flow starts. Treat repeated identical marker lines in one
message as one invocation. Remove every line whose trimmed value is exactly
`$codex-goal-progress:goal-progress`. Preserve all other lines in order as one objective body.

Call `goal_progress_activate` once. It returns a plan; it does not mean the Contract is active.

## Branches

| Branch | Native Goal | Objective body | Action |
| --- | --- | --- | --- |
| A | Missing | Present | Call `create_goal` with the marker-free body, verify it with `get_goal`, then follow `progressAction`. |
| B | Present | Empty | Attach to the current Goal. |
| C | Present | Exact same text | Attach without replacing the Goal or resetting Token. |
| D | Present | Different text | Report the conflict before changing Goal or progress state. |
| E | Missing | Empty | Ask for a Goal body. Do not create an empty Goal. |

Branch B or C with an existing Contract must Reuse an existing Contract.
For branch D, never clear, complete, block, or overwrite the native Goal. If replacement was
confirmed but verified controls are unavailable, report `NATIVE_GOAL_REPLACE_UNAVAILABLE`.

## Progress Action

Follow `progressAction` exactly:

- `get`: call `goal_progress_get`. Do not rebuild Checklist or contributions.
- `initialize`: do not call `goal_progress_get`. Read the Checklist reference, prepare one Contract,
  and Call `goal_progress_initialize`. For branch B or C, copy `preparedForObjective` from the
  activation result exactly; do not rewrite it.
- `none`: stop Goal Progress tool calls for this activation.

For branch A, the allowed sequence is:

```text
goal_progress_activate
create_goal
get_goal
goal_progress_initialize
```

There is no `goal_progress_get` between `get_goal` and initialize.
For branch A, copy the exact objective returned by `get_goal` into
`goal_progress_initialize.preparedForObjective`.

## Lifecycle Reports

- `planned`: activate returned a branch, but no Contract is proven.
- `preparing`: Goal or Checklist preparation is running.
- `active`: `goal_progress_get` or `goal_progress_initialize` succeeded.

After activate, say Goal Progress is being prepared. Do not say it is active yet.
After get, say the existing Contract was restored or connected.
After initialize, say Goal Progress is active.

## Cancellation And Recovery

`ACTIVATION_CANCELLED` means the user explicitly closed the current preparation. Do not retry or
reactivate until the user explicitly selects the Skill again.

These conditions are not user cancellation:

- an old Contract was detached as stale;
- the native Goal ended or was replaced;
- the Goal anchor was rebuilt;
- Helper or native Goal reads are temporarily unavailable.

Continue the current preparation after an automatic stale detachment. For temporary infrastructure
failure, report the exact code and use doctor or a bounded retry without changing the user's
activation fact. Do not blame the user or ask for another Skill selection.

When trusted SessionStart context reports an active Contract, call only `goal_progress_get`.
Do not call activate, regenerate the Checklist, or reevaluate contributions.
