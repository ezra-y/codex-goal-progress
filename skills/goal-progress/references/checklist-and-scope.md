# Checklist And Scope

Read this file only for initialize, rescope, or a trusted native Goal change.

## Prepare A Contract

Check the user checklist, current plan, repository requirements, and facts already available in the
conversation. When a user checklist is partial or incomplete, preserve every valid acceptance result,
exclude setup and execution steps, and add only the missing Goal results.

Use `existing-checklist` when any valid user acceptance result is reused. Use `model-generated` only
when the Checklist is generated from scratch.

Make each top-level `C1...Cn` objective an observable result. Never promote setup, reading,
connecting, planning, or plugin initialization into a top-level result. Child `C1.1...` items measure
completion only inside their parent.

Assign contributions once. Required, non-cancelled top-level contributions must total `10000`.
Preserve valid user contributions. Never provide a total percentage.

Call `goal_progress_initialize` after the structure is complete. Fix a rejected structure in the
same turn. If it still fails validation, report the exact code and leave progress unavailable.
Set `preparedForObjective` to the exact trusted native Goal objective used to prepare the Checklist.
If get returns a newer objective, discard the older preparation and rebuild for that exact value.

Keep `update_plan` as execution detail. Never turn `update_plan` steps into the Goal denominator.

## Scope Changes

Use `goal_progress_rescope` only when accepted Goal results change.
Reevaluate the complete objective set and contributions in the current model. Preserve stable IDs,
completion, and evidence for unchanged results.

Copy edits, code-path changes, and ordinary bug fixes are not scope changes.

For a minor native Goal change:

- keep the same Contract ID;
- preserve unaffected results, contribution, completion, and evidence;
- change only affected results;
- use one short reason beginning with `当前方向：`;
- call `goal_progress_rescope` with the current revision.

For a major native Goal change:

- do not reactivate the Skill;
- read the current native Goal and copy its exact objective into `preparedForObjective`;
- enter preparation without reading the stale Contract first;
- generate a Goal-specific Checklist with a fresh Contract ID;
- do not inherit old progress or evidence;
- call `goal_progress_initialize` for the trusted major Goal change; the Store archives the old
  Contract through replacement.

A change is minor only when the final deliverable and most acceptance results still apply. It is
major when the final deliverable or main acceptance boundary changes.
