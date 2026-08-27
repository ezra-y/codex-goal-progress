# Install Goal Progress for a user

This procedure installs the latest verified macOS arm64 Release and checks the running product.

## Confirm the platform

Run:

```bash
uname -s
uname -m
```

Continue when the results are `Darwin` and `arm64`.

## Download and verify the Release

```bash
goal_progress_install_dir="$(mktemp -d /tmp/codex-goal-progress-install.XXXXXX)"
cd "$goal_progress_install_dir"
curl -fL https://github.com/Ezra-Y/codex-goal-progress/releases/latest/download/codex-goal-progress-macos-arm64.zip -o codex-goal-progress-macos-arm64.zip
curl -fL https://github.com/Ezra-Y/codex-goal-progress/releases/latest/download/SHA256SUMS -o SHA256SUMS
grep '  codex-goal-progress-macos-arm64.zip$' SHA256SUMS | shasum -a 256 -c -
ditto -x -k codex-goal-progress-macos-arm64.zip .
```

The checksum command must print:

```text
codex-goal-progress-macos-arm64.zip: OK
```

## Install

Run:

```bash
cd "$goal_progress_install_dir/codex-goal-progress-macos-arm64"
./bin/goal-progress install --json
```

Read `ok`, `code`, `nextStep`, and `details`.

When `code` is `INSTALL_RESTART_REQUIRED`, ask the user for permission to restart Codex. After
approval, run:

```bash
./bin/goal-progress install --json --restart-codex
```

When `code` is `INSTALL_RESTART_PENDING`, wait for the command to finish its bounded polling.

## Review the Hook

When `hookReviewRequired` is `true`, ask the user to open `/hooks` in Codex and approve the
Goal Progress Hook. Continue after the user confirms the review.

## Verify

Run:

```bash
./bin/goal-progress doctor --json
./bin/goal-progress verify --json
```

Installation is complete when both commands return `"ok": true`.

If a command returns `"ok": false`, follow its single `nextStep`, then run Doctor and Verify
again.

## Report the result

Tell the user:

- the final install code
- the Doctor code
- the Verify code
- whether Codex restarted
- whether Hook review completed
