# Security policy

## Report a vulnerability

Use GitHub private vulnerability reporting or a private Security Advisory. Include:

- affected version and platform;
- a minimal reproduction;
- expected and observed behavior;
- impact;
- a temporary mitigation when available.

Private reporting keeps exploit details, credentials, local files, and user data within the
security review.

## Security design

| Area | Design |
|---|---|
| Codex integration | Local Plugin, reviewable Hooks, and a verified loopback CDP connection |
| State | Local application-support directory with one Helper writer |
| IPC | User-local Unix socket with restricted permissions |
| Goal identity | Exact task matching before ViewModel display and Token attribution |
| Renderer | Isolated Web Component receiving a display-only ViewModel |
| Hook trust | User review through Codex |
| Recovery | Doctor, Verify, Repair, Disable, and Uninstall commands |

See [Architecture](docs/ARCHITECTURE.md) for the complete data flow.
