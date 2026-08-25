---
name: goal-progress
description: Explicitly attach verified checklist progress to one native Codex Goal. Use only when the user explicitly selects Goal Progress or invokes $codex-goal-progress:goal-progress. Do not use for an ordinary Goal, a status question, or update_plan.
---

# Goal Progress

Goal Progress adds verified checklist progress to one native Codex Goal.
The Skill is the only user-facing activation entry. Internal tools never activate it by themselves.

## Entry

Start only after explicit Skill selection or the canonical marker. Do not activate for an ordinary
Goal, a status question, `update_plan`, or a general mention of progress.
After the explicit start, continue for the bound Goal without requiring the marker on every later turn.
When trusted SessionStart context says the Contract is active, call `goal_progress_get` and continue
without asking the user to repeat the marker. Do not call `goal_progress_activate` again.

Keep progress work in the current thread and current model. Never start a hidden thread, child Agent,
external model, or model API call for progress. Only the main execution Agent may use write tools; a
nested or child Agent must not initialize, update, rescope, or set phase.
Hooks own runtime identity. Never invent runtime proof, IDs, revisions, or overall percentages.

## Start Or Resume

Read [Activation and recovery](references/activation-and-recovery.md) for a first activation,
conflict, cancellation, or recovery.

1. Remove every pure Skill marker line and preserve all other body lines in order.
2. Call `goal_progress_activate` exactly once as the first internal Goal Progress tool.
3. Follow `progressAction` exactly:
   - `get`: call `goal_progress_get` and reuse the existing Contract.
   - `initialize`: do not call `goal_progress_get`; prepare the Checklist and call `goal_progress_initialize`.
   - `none`: do not call another Goal Progress tool.
4. Report active only after `goal_progress_get` or `goal_progress_initialize` succeeds.

## Work Loop

Keep `update_plan` as an execution plan. Never turn its steps into the Goal denominator.
Complete normal Goal work. After a concrete fact is completed or verified, call
`goal_progress_get`, then `goal_progress_update` with stable target IDs and the returned revision.
Leave uncertain work unchanged. Active work alone does not earn progress.
Never call a model merely to refresh progress. Core computes every percentage.
On a revision conflict, review the returned current summary before retrying.

## Native Goal Changes

When the trusted native Goal changes, Classify the change as minor or major in the current model.
Do not use text similarity, another model, or another thread.
Do not ask the user to invoke Goal Progress again.
Read [Checklist and scope](references/checklist-and-scope.md) before rescope or replacement.
A minor change keeps the Contract and uses `goal_progress_rescope`.
A major change prepares a fresh Contract and uses `goal_progress_initialize`.
Ordinary implementation, bug-fix, or `update_plan` changes do neither.

## Finish

Run final verification and update only verified remaining targets.
Mark the native Goal complete only when its objective is achieved.
Set Goal Progress to `completed` only after both the Contract and native Goal are complete.

## References

- [Activation and recovery](references/activation-and-recovery.md)
- [Checklist and scope](references/checklist-and-scope.md)
- [Contract examples](references/contract-examples.md)
