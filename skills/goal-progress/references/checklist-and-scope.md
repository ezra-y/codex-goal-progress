# Checklist Organization And Scope Changes

## 1. Purpose

Organize the current Goal into a Checklist with complete scope, clear results, and completion that
can be checked.

The Checklist answers:

> What results must this Goal deliver? Which results are already true?

The implementation plan continues to record execution order, technical steps, and pending work. The
Checklist records acceptance results. They may correspond to each other, but do not copy one
directly into the other.

Organize the Checklist in the current task and current model. Evaluate results and weights when the
Checklist is first created, and adjust them again only when the Goal scope actually changes.
Ordinary execution and status updates reuse the existing structure.

## 2. Determine The Goal And Existing Content First

Use the trusted `currentNativeGoal` returned by the tool to determine the current Goal. Then use the
user request, existing Checklist, current plan, and relevant project requirements to determine the
acceptance scope.

Identify three things first:

**Final deliverable.** What must the user receive in the end? For example, a working import tool, a
research conclusion, or a set of interface designs.

**Completion conditions.** Which results must be true for that deliverable to be complete? For
example, specified formats are supported, failures can be located, or conclusions have source
support.

**Existing results.** Which results are already complete and supported by evidence, and which still
need work?

Use information that is already clear. Read additional relevant material when necessary, but do not
restart an entire research cycle merely to organize the Checklist.

Clarify requirements that are still unconfirmed and would change the delivery scope. Leave small
implementation choices in the execution plan instead of turning every technical detail into an
acceptance condition.

## 3. Split The Checklist By Results

### Write Verifiable Results As Top-Level Items

For each top-level item, first answer:

> How does it contribute to the Goal? What does it deliver? What fact confirms completion?

Write the answer as a short, specific result. These three questions help organize the Checklist;
they do not add separate `Why`, `What`, or `Acceptance` fields.

For example:

| Too vague | Verifiable result |
|---|---|
| Develop import feature | Specified CSV files can be imported correctly |
| Handle errors | Import failures identify the incorrect row and explain the reason |
| Complete research | The capabilities, limits, and costs of three options can be compared directly |
| Improve the interface | Primary actions remain fully visible and clickable in a narrow window |

Activities such as "read the code," "connect the tool," "set up the environment," and "make a plan"
are usually execution steps. They may help complete the Goal, but doing them alone does not increase
Goal completion.

The acceptance target depends on the deliverable the user actually requested. If the user wants a
test report, verify the report content and results. If the user wants a research conclusion, verify
the conclusion and its supporting evidence. Do not force every task into fixed development,
testing, and release stages.

### Cover The Complete Scope With As Few Top-Level Items As Possible

Split results according to whether they can be judged complete separately.

A simple Goal may have only one top-level item. Split a complex Goal only when the results are
genuinely different, not to make the Checklist look detailed.

If two items can only be proven by the same fact, check whether they are duplicates. They may be
merged, or one may become a child acceptance point of the other.

If one item contains several important results that can be completed or fail independently,
consider splitting it.

### Child Items Explain What Makes The Parent Complete

Child items describe only the necessary acceptance conditions inside their parent.

For example:

```text
C1 Specified CSV files can be imported correctly
  C1.1 Supported fields are read and saved correctly
  C1.2 A row missing required fields is not treated as a valid record
```

Together, child items cover the result stated by the parent. An important capability must not appear
only in the parent title without any basis for confirming completion.

Child completion contributes only to its parent. Do not repeat the same result as another top-level
item and count it twice in overall progress.

## 4. Prioritize The User's Existing Checklist

When the user already provides a Checklist, use its valid acceptance results as the foundation.

Preserve the original scope, meaning, and explicit requirements. Keep items that are already clear.
When an item has the right meaning but is too vague, use the current Goal to turn it into an
observable result.

Keep execution steps that are mixed into the Checklist in the implementation plan. Do not discard
work the user requested merely because it is unsuitable for progress calculation.

Add only results that the current Goal truly requires and the existing Checklist omitted. Do not
casually add unrequested performance work, monitoring, deployment, documentation, or compatibility.

When a Contract already exists, preserve the IDs, completion status, and evidence of unchanged
results.

Use the existing source convention:

```text
Reused valid acceptance results supplied by the user:
source = existing-checklist

Generated the Checklist from scratch:
source = model-generated
```

When part of the user Checklist is reused and missing results are added, continue using
`existing-checklist`.

## 5. IDs And Weights

For `goal_progress_initialize`, omit `contractId`; the plugin generates it. Copy the returned
`contractId` into later update, rescope, and phase calls.

### IDs Follow Results, Not Display Order

When first generated, top-level items use IDs such as `C1` and `C2`. Child items use IDs such as
`C1.1` and `C1.2`: the parent ID, a dot, and a positive integer. Do not use UUIDs or titles as checklist IDs.

As long as the meaning of a result does not change, preserve its ID. Inserting a new item, changing
display order, or editing wording must not renumber other items.

Do not reassign the ID of a removed result to a new result with a different meaning.

### Weights Represent Contribution To Goal Completion

Assign `contributionBps` to each top-level result and use `contributionReason` to state the basis
briefly.

Required, non-cancelled top-level items that participate in overall progress must total `10000`.
Here, `10000` represents 100% of the complete Goal.

Assign weights according to the importance and scope of each result. Execution time, file count,
tool call count, and how much is already complete do not directly determine weight.

When results are equally important, weights may be close to equal. Create a larger difference only
when there is a clear primary and secondary result. Do not invent a complicated score that only
looks precise.

For example:

```text
C1 Data imports correctly                     4500
C2 Duplicate and invalid records are handled 3500
C3 The user can run the import command        2000
```

Preserve valid contribution values already specified by the user.

Ordinary status updates do not change weights. Do not temporarily change contribution values or
split out already completed work merely to increase progress or avoid a decrease.

Core calculates the overall percentage. The model submits only the Checklist, contribution values,
status, and evidence.

## 6. Status Must Match Actual Completion

Set the status of new items from current facts:

| Status | Meaning |
|---|---|
| `pending` | Work has not started |
| `active` | Work is in progress, but the acceptance result is not fully true |
| `completed` | The acceptance result is true and has checkable support |

A Checklist may be enabled for work that is already in progress. Existing results may be recorded
as complete after they are confirmed; they do not need to restart from zero.

Starting work, spending time, or calling tools does not by itself prove a result is complete. When
only part is complete, update the corresponding child items and preserve the true status of the
remaining work.

Evidence must directly support the corresponding result and state what was actually observed. For
example: test results, generated files, page behavior, source material, or user confirmation.

**The scope of the evidence must match the conclusion.** Verification of one part proves only that
part. Results that have not been confirmed keep their existing status.

The same evidence may support multiple different conclusions, but the same acceptance result counts
only once.

## 7. Adjusting The Checklist When The Goal Changes

First inspect the current Goal and existing Checklist, then decide whether the acceptance scope
actually changed.

### Only Wording Or Implementation Changes

When the final deliverable and acceptance results have not changed, preserve the original Checklist,
weights, status, and evidence.

Changing a variable name, replacing an implementation method, reordering development work, or fixing
an ordinary bug required to meet the result does not automatically change scope.

### Minor Scope Changes

When the final deliverable stays the same and most acceptance results still apply, preserve the same
Contract.

Add, edit, or cancel only affected results. Preserve the IDs, status, and evidence of unchanged
results, along with any contribution allocation that remains valid.

Use `goal_progress_rescope`. Submit the complete adjusted result set with the current revision. Keep
the existing short reason format, for example:

```text
当前方向：Add XLSX support to the existing CSV import.
```

`当前方向：` is the fixed prefix currently required by the tool.

When scope expands or shrinks, the existing progress percentage may change. Preserve actual
completion and let Core recalculate it; do not compensate for the percentage manually.

### Major Goal Changes

When the final deliverable or primary acceptance boundary changes, create a new Contract.

For example, the Goal changes from "deliver a local import tool" to "compare existing import
products and submit a selection report."

Generate a Checklist that fits the new Goal and establish it with `goal_progress_initialize`,
omitting `contractId` so the plugin generates a new one. Check completion against the new Goal. Do not directly inherit the old
Goal's percentage or evidence.

## 8. Review And Save Before Submission

After generating the Checklist, check four things in the current turn:

**Scope.** Does it cover every result the user requested? Did it add work the user did not request?

**Items.** Can each item be judged complete independently? Do parent and child items correspond? Is
anything counted twice?

**Structure.** Are IDs stable? Do participating contribution values satisfy the required total? Do
statuses match the current tool format?

**Facts.** Does every result marked complete have support? Does the evidence actually support the
conclusion?

Correct problems directly before submission. This check is part of the current organization work;
do not create a separate review process or call another model.

Use `goal_progress_initialize` for the first Checklist. Use `goal_progress_rescope` for a minor scope
change. Use `goal_progress_get` to restore an existing Checklist. Use `goal_progress_update` for
ordinary completion status updates.

Use the existing tool Schema for parameters. See `contract-examples.md` in the same directory for
JSON shapes. Do not invent fields.

The Helper reads and binds the Goal text from the trusted native Goal. The Hook supplies runtime
identity. Get the revision of an existing Contract from the tool result.

When tool validation rejects a submission, correct the structure according to the explicit error.
Report that the Checklist was established or adjusted only after it has been saved successfully.

## 9. Three Organization Examples

These examples demonstrate how to split results. Specific items and weights depend on the real Goal;
they are not a fixed template for every task.

### Example A: Development Task

**User Goal**

> Build a local CSV import tool. Do not import the same record twice, explain the reason for invalid
> rows, and let the user run it from a command.

**Organized Checklist**

```text
C1 Specified CSV data can be imported correctly
Contribution: 4500
Reason: Correct data output is the primary deliverable.

  C1.1 Supported fields are read and saved correctly
  C1.2 Import results match a verified sample

C2 Duplicate records and invalid rows are handled correctly
Contribution: 3500
Reason: Prevent invalid data from entering the result and make failures traceable.

  C2.1 Deduplicate by the agreed record identifier
  C2.2 Error messages include the row number and reason
  C2.3 Invalid rows are not counted as successful imports

C3 The user can complete an import through the command
Contribution: 2000
Reason: The tool must be usable in practice.

  C3.1 The command runs by following the provided usage
  C3.2 The result shows successful and failed records
```

Put "read the project," "choose a parser library," "write functions," and "run tests" in the
implementation plan. Test results may serve as evidence for the acceptance items above.

### Example B: Research Task

**User Goal**

> Compare the capabilities, limits, and costs of three options, then recommend one for this project.

**Organized Checklist**

```text
C1 The key facts of all three options can be compared directly
Contribution: 4000
Reason: The choice requires a consistent factual basis.

  C1.1 Describe each option's capabilities and costs using the same dimensions
  C1.2 Key facts have traceable sources
  C1.3 Unconfirmed information is clearly marked

C2 Primary limits and their effect on this project are explained
Contribution: 3500
Reason: Limits may directly determine whether an option is usable.

  C2.1 Distinguish confirmed limits from conditions that still need verification
  C2.2 Explain which project result each important limit affects

C3 The recommendation has a clear basis
Contribution: 2500
Reason: The research must support the next decision.

  C3.1 Recommendation reasons correspond to the project's actual requirements
  C3.2 State the conditions and primary tradeoffs behind the recommendation
```

"Search the web," "read documentation," and "organize notes" are research activities. The number of
pages opened does not directly represent research completion.

### Example C: User-Provided Mixed Checklist

**User Goal**

> Deliver a working CSV import command with deduplication and traceable errors.

**Existing User Checklist**

```text
Read the project
Support CSV import
Do not duplicate the same record
Write tests
```

**Organization**

Preserve the acceptance meaning of "support CSV import" and "do not duplicate the same record."

Keep "read the project" and "write tests" in the implementation plan.

Add the missing error traceability and command usability results required by the user Goal:

```text
C1 CSV data can be imported correctly through the command
C2 The same record is not created twice
C3 Import errors identify the corresponding record and explain the reason
```

This Checklist reuses valid acceptance results from the user, so use:

```text
source = existing-checklist
```

Then add the necessary child items and contribution values according to the actual scope of the
three results. Do not add an unrequested release process, monitoring service, or support for
additional formats.
