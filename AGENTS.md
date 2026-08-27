# AGENTS.md

This file is for external coding agents working in the public repository.

## Choose the task path

- **Installation**: For installation tasks, read `INSTALL-FOR-AI.md` first and follow that procedure.
- **Code change**: Read `docs/ARCHITECTURE.md`, then inspect the relevant source.
- **Runtime diagnosis**: Read `docs/SUPPORT.md` and the relevant architecture section.

Check `git status` before editing.

## Commands

- Use `pnpm` for dependencies and the lockfile.
- Run all public validation gates with `pnpm verify`.

## Architecture boundaries

- Renderer displays a ViewModel.
- Helper is the only state writer.
- Core is the only progress calculator.
- Codex `.app`, `app.asar`, code signing, private React state, and private JavaScript chunks stay unchanged.
- The current Codex model performs Goal interpretation.
- Token usage appears after current-Goal attribution succeeds.
- DOM selectors belong only in the Codex adapter layer.

## Change rules

- Reproduce a bug before fixing it.
- Describe how the change was verified. Maintainers run the internal test suite after importing an
  accepted change.
- Keep each commit to one verified change.
- Preserve user changes already present in the worktree.
- Ask before pushing, publishing a Release, or changing repository visibility.

## Public version

`VERSION` is the only public product version. Public files use that version.
