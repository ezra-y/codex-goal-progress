# Changelog

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
