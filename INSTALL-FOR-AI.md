# Install Goal Progress for a user

Use the extracted macOS arm64 Release package.

## Install

Run from the Release directory:

```bash
./bin/goal-progress install --json
```

Read `ok`, `code`, `nextStep`, and `details`.

When `nextStep` requests a Codex restart, obtain user approval and run:

```bash
./bin/goal-progress install --json --restart-codex
```

When Hook review is required, ask the user to review Goal Progress in Codex. After confirmation,
run:

```bash
./bin/goal-progress doctor --json
./bin/goal-progress verify --json
```

An `ok: false` result includes the next supported recovery step.

## Maintain the installation

Repair reported components:

```bash
./bin/goal-progress repair --json
```

Upgrade from a new extracted Release:

```bash
./bin/goal-progress upgrade --json
```

Uninstall while preserving Goal history:

```bash
./bin/goal-progress uninstall --json --keep-history
```

Use `--delete-history` after the user explicitly requests history removal.

The bundled commands manage launchd, Plugin state, Hook review, Codex identity, and release
integrity.
