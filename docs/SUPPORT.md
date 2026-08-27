# Support

This page lists the published platform and runtime surfaces.

## Platform

| Surface | Current value |
|---|---|
| Operating system | macOS |
| Architecture | Apple Silicon arm64 |
| Application | Codex Desktop |
| Helper runtime | Node SEA v24.19.0 |
| Goal Contract | schema v2 |
| IPC | protocol v4 |
| Renderer UI intent | protocol v2 |

## Interface adaptation

| Capability | Behavior |
|---|---|
| Theme | Reads live Codex light, dark, system, surface, foreground, and accent tokens |
| Font size | Reads the live Codex font token and derives layout continuously |
| Locale | Reads the live Codex document locale and selects a matching built-in catalog |
| Locale fallback | Uses English UI copy and locale-aware number formatting |
| Text direction | Reads live LTR or RTL direction |
| Placement | Native, managed fallback, fixed, and draggable floating views |
| Motion | Default motion, explicit pause, and `prefers-reduced-motion` |

Font regression tests cover 11, 14, 16, and 20 px.

## Installation results

A healthy installation returns:

```text
INSTALL_OK or INSTALL_ALREADY_CURRENT
DOCTOR_OK
VERIFY_OK
```

Use `nextStep` from the JSON result when a command requests another action.

## Product roadmap

The current roadmap includes:

- Developer ID signing and Apple notarization
- a native Goal-row activation shortcut
- an end-user checklist editor
- project checklist file watching
- expanded Token and context details
- additional platform packages
