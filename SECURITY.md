# Security policy

## Report a vulnerability

Use GitHub's private vulnerability reporting or a private Security Advisory for this repository.
Do not open a public issue containing exploit details, credentials, private files, or user data.

Include:

- affected version and platform;
- a minimal reproduction;
- expected and observed behavior;
- impact;
- any temporary mitigation.

## Security boundaries

Goal Progress must not:

- modify Codex application files or code signing;
- read private React state or private JavaScript chunks;
- expose its local IPC socket to the network;
- trust a Token count that cannot be attributed to the current Goal;
- write Hook trust for the user;
- send Goal content to an external progress model.

The detailed model is in [THREAT-MODEL.md](docs/quality/THREAT-MODEL.md).
