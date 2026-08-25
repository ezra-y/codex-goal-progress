# Contributing

## Prepare the repository

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
```

## Make a change

1. Create a feature branch.
2. Keep the change focused.
3. Reproduce bugs before fixing them.
4. Explain the expected behavior and verification method.
5. Run `pnpm typecheck` and `pnpm build`.

Do not modify Codex application files, private stores, private JavaScript chunks, or code
signatures. Keep Codex-specific DOM knowledge inside `packages/codex-adapter`.

## Submit a pull request

Include:

- the user-visible result;
- the reason for the change;
- exact verification commands and results;
- screenshots for visual changes;
- any known limitation that remains.

The maintained internal test suite is not part of this public mirror. Maintainers run it after
moving an accepted change back to the internal source repository.

Do not include conversation transcripts, private prompts, user files, credentials, local absolute
paths, or raw machine-specific evidence.
