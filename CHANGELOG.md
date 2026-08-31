# Changelog

## 0.3.1

- Fix a startup fallback loop that could repeatedly open and close Codex.

## 0.3.0

- 🔌 **Start from the official Codex icon.** Goal Progress sets up the required CDP connection
  automatically. No extra command or manual setup is needed.
- 🔄 **Progress returns after a full quit.** Reopen an old task to restore its checklist, progress,
  Token count, and display settings. You do not need to be on a task with progress when you quit or
  start Codex.
- 🪟 **Multiple windows are now supported.** New windows, task links, and tasks opened in a new
  window connect automatically. Each window follows its own task. Switching or closing one window
  does not affect another.
- 🎉 **Update inside Codex.** Goal Progress checks for new versions automatically, and you can also
  check manually. Select **Update now** to download, verify, and install an update with real
  download progress.
- ⋯ **A new More menu.** The three-dot menu has **Version**, **Effects**, and **Display** sections.
  You can view the installed version, check for updates, open release notes, change animations, and
  choose a display position in one place.
- 🧩 **More reliable installs and updates.** Fixed early install failures and enabled the Hook
  required by the plugin. Interrupted downloads can be retried. Restarting no longer leaves updates
  stuck on **Restart required** because of recovery timing.
- 🛠️ **Cleaner code and better recovery.** Large files were split and repeated install, Doctor,
  and Verify code was reduced. Page reloads, task switches, and interrupted updates recover more
  reliably. Temporary files are removed after an update completes.
- 🤖 **A new cute robot logo.** Goal Progress now uses the new transparent robot icon.

## 0.2.2

- Support the latest Codex Goal row, sidebar task, and composer structure.
- Remove Goal Progress as soon as the native Goal completes instead of leaving a 100% card.
- Keep fixed progress at its verified native position during arbitrarily long composer input.
- Report component visibility from its real viewport and clipping intersections.
- Preserve the verified Goal identity through fallback so old progress cannot attach to a
  replacement Goal.
- Read Goal identity only from the stable objective text, excluding dynamic status and elapsed time.
- Follow the live native Goal left and right boundaries for fixed progress width.
- Remove stale Plugin cache versions after successful installs and upgrades.
- Keep active MCP sessions working across compatible updates without restarting Codex.

## 0.2.1

- Resolve the current Goal thread when a Hook session candidate is invalid or not loaded.
- Match Current, Paused, and Overall progress label weights to the live native Goal title.
- Follow task switches through page events instead of a permanent two-second Helper timer.
- Recover Renderer delivery immediately from WebSocket close events with bounded retries.
- Keep idle Goal Progress installations free of periodic visible-thread checks.

## 0.2.0

- Keep Goal Progress visible across Codex Desktop version changes.
- Select Native or managed fallback placement from the current Goal-row structure.
- Reuse one Host and one complete ViewModel while switching between display modes.
- Restore Goal Progress after returning to the task and after page lifecycle changes.
- Treat healthy fallback and retained states as valid Renderer delivery.
- Recover the latest Token and tracking state even when the Contract revision stays unchanged.
- Clean failed candidate injection and preserve the original native Host.

## 0.1.2

- Add a measured Goal-row Adapter for Codex Desktop `26.820.60940 (7119)`.
- Preserve fail-closed behavior for every unmeasured Codex Desktop version.

## 0.1.1

- One-line installation now follows `INSTALL_RESTART_REQUIRED`,
  `INSTALL_RESTART_PENDING`, and completed JSON protocol states.
- Reproducible SEA Helper builds no longer embed the local source or build path.
- Release assets include the matching Node.js license and generated production dependency notices.

## 0.1.0

- First public release.
- Deterministic checklist progress for native Codex Goals.
- Local Helper, MCP, Contract store, Core calculator, and isolated Renderer.
- Fixed and draggable floating layouts.
- Light, dark, accent, UI-size, and language adaptation.
- Verified one-line macOS installation with Release ZIP and SHA-256 assets.
- Reliable new-task identity recovery and transactional cross-version Plugin rollback.
- Plugin integrity anchored to the verified top-level Release manifest.
- Clear non-interactive installation errors and immediate restart failure handling.
