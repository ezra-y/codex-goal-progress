---
id: other-20260827-01
type: other
status: active
version: v1
created_at: 2026-08-27
updated_at: 2026-08-27 11:15
refs: [decision-20260827-01]
---
# Compatibility

## Release

| Component | Current value |
|---|---|
| Goal Progress | `0.2.0` |
| Goal Contract | schema v2 |
| IPC | protocol v4 |
| UI Intent | protocol v2 |
| Page Host | v53 |
| Helper runtime | Node SEA v24.19.0 |

## Platforms

| Platform | Availability |
|---|---|
| macOS arm64 | Packaged and verified |
| macOS x86_64 | Roadmap |
| Windows | Roadmap |
| Linux | Roadmap |

The packaged macOS build is verified on macOS `26.5 (25F71)`.

## Codex Desktop

| Version | Verification |
|---|---|
| `26.818.21641 (6849)` | Fixture and regression coverage |
| `26.818.31338 (6892)` | Fixture and regression coverage |
| `26.818.41509 (6962)` | Fixture and regression coverage |
| `26.818.61809 (7019)` | Fixture and real-page coverage |
| `26.820.60940 (7119)` | Fixture and real-page coverage |

The long-lived macOS locator also runs on newer Codex versions. A matching task uses native
placement when the Goal row is available and managed fallback placement when the row changes.

## Installation

| Item | Current behavior |
|---|---|
| Package | macOS arm64 ZIP |
| Helper | Self-contained executable |
| Plugin | Local Codex marketplace |
| Hook review | User review after installation or Hook changes |
| CDP | Loopback address, random port, verified process ownership |
| Repair | Component-level repair for Helper, Plugin, Hook, and CDP state |
| Removal | Installer-managed cleanup with local Goal history preserved |

## Current product surface

The current release includes Goal activation, local checklist tracking, deterministic progress,
Token display, Native and fallback placement, task switching, lifecycle recovery, dark and light
themes, reduced motion, and Chinese, English, Icelandic, and Arabic UI.
