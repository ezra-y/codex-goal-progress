# Install Goal Progress for a user

Use this procedure only on macOS arm64 and only from an extracted `macos-arm64` Release.
Do not assemble installation files manually from the source tree.

## Install

Run from the extracted Release directory:

```bash
./bin/goal-progress install --json
```

Read only `ok`, `code`, `nextStep`, and `details`.

If `nextStep` requires a Codex restart, ask the user first. After approval, run:

```bash
./bin/goal-progress install --json --restart-codex
```

When Hook review is required, stop and ask the user to review Goal Progress in Codex. Do not
edit `config.toml`, write `trusted_hash`, or bypass Hook review.

After the user confirms Hook review, run:

```bash
./bin/goal-progress doctor --json
./bin/goal-progress verify --json
```

If either command returns `ok: false`, follow its single `nextStep` and retry. Do not guess the
Codex application path.

## Repair, upgrade, and uninstall

Repair only reported failures:

```bash
./bin/goal-progress repair --json
```

Upgrade from the new extracted Release:

```bash
./bin/goal-progress upgrade --json
```

Uninstall while preserving Goal history:

```bash
./bin/goal-progress uninstall --json --keep-history
```

Use `--delete-history` only when the user explicitly requests deletion.

## Do not

- Do not edit launchd or Codex Plugin configuration manually.
- Do not modify Codex application files or code signatures.
- Do not bypass Hook review.
- Do not create a hidden Codex task or use another model for progress.
