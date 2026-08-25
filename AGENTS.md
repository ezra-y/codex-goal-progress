# AGENTS.md

This file is for external coding agents working in the public repository.

## Start here

1. Read `README.md`.
2. Read `docs/decisions/CodexGoalProgress技术架构.md`.
3. Read `docs/quality/KNOWN-LIMITATIONS.md`.
4. Check `git status` before editing.

## Commands

- Use `pnpm`. Do not use npm, yarn, or Bun to change dependencies or the lockfile.
- Run all public validation gates: `pnpm verify`

## Architecture boundaries

- Renderer displays a ViewModel. It does not save state or calculate progress.
- Helper is the only state writer.
- Core is the only progress calculator.
- Do not modify Codex `.app`, `app.asar`, code signing, private React state, or private JavaScript chunks.
- Do not add an external progress model, a model API key, or a hidden Codex task.
- Token usage must stay hidden when it cannot be attributed to the current Goal.
- DOM selectors belong only in the Codex adapter layer.

## Change rules

- Reproduce a bug before fixing it.
- Describe how the change was verified. The public mirror does not contain the internal test suite.
- Keep each commit to one verified change.
- Preserve user changes already present in the worktree.
- Do not push, publish a Release, or change repository visibility unless the user asks.

## Public version

`VERSION` is the only public product version. Do not copy internal development or release-candidate
numbers into public files.
