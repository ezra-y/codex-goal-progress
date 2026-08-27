# Contributing

## Prepare the repository

```bash
pnpm install --frozen-lockfile
pnpm verify
```

## Make a change

1. Create a feature branch.
2. Keep the change focused.
3. Reproduce the current behavior.
4. Implement the smallest complete change.
5. Run `pnpm verify`.

Codex-specific DOM knowledge belongs in `packages/codex-adapter`. Renderer receives a ViewModel,
Helper owns writes, and Core owns progress calculation.

## Submit a pull request

Include:

- the user-visible result;
- the reason for the change;
- exact verification commands and results;
- screenshots for visual changes;
- the current scope after the change.

The public repository contains the release source. Maintainers apply the internal test suite
before the next public export.

Pull-request evidence uses bounded technical data such as IDs, states, counts, and hashes.
