# AGENTS.md

This file guides coding agents working in the public repository.

## Start here

1. Read `README.md`.
2. Read `docs/ARCHITECTURE.md`.
3. Read `docs/COMPATIBILITY.md`.
4. Check `git status`.

## Commands

- Manage dependencies and the lockfile with `pnpm`.
- Run the public validation gate with `pnpm verify`.

## Architecture

- Renderer displays a ViewModel.
- Helper owns state writes.
- Core owns progress calculation.
- Codex integration uses the Plugin, reviewable Hooks, loopback CDP, and the Codex adapter layer.
- Token usage appears after the current Goal identity is verified.
- Codex-specific DOM selectors live in `packages/codex-adapter`.

## Changes

- Reproduce a bug before fixing it.
- Keep each commit focused and verified.
- Preserve changes already present in the worktree.
- Include exact verification commands in the pull request.
- Pushes, repository visibility, and Releases follow the user's explicit request.

## Public version

`VERSION` is the public product version. Public files use this version consistently.
