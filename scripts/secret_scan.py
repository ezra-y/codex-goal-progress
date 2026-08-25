#!/usr/bin/env python3
"""泄密扫描：在将进入版本库的文本文件里查密钥模式。命中即退出非零（pre-commit 会拦提交）。

只扫 git 跟踪/暂存的文件；.env 本来就被 gitignore，不在扫描范围——这正是它该待的地方。
误报处理：确认不是密钥后，把该行加上注释标记 secret-scan-ok 即可放行。
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

PATTERNS = [
    (r"sk-[A-Za-z0-9_-]{20,}", "OpenAI/Anthropic 风格 key"),
    (r"AKIA[0-9A-Z]{16}", "AWS Access Key"),
    (r"ghp_[A-Za-z0-9]{36}", "GitHub Token"),
    (r"xox[bpars]-[A-Za-z0-9-]{10,}", "Slack Token"),
    (r"-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----", "私钥块"),
    (r"""(?i)(api[_-]?key|secret|token|password)\s*[:=]\s*["'][A-Za-z0-9_\-]{16,}["']""", "硬编码凭据"),
]
TEXT_EXTS = {".py", ".ts", ".js", ".tsx", ".jsx", ".json", ".md", ".yaml", ".yml", ".toml",
             ".sh", ".env.example", ".txt", ".html", ".css", ".cfg", ".ini"}


def tracked_files() -> list[Path]:
    out = subprocess.run(["git", "ls-files", "--cached", "--others", "--exclude-standard"],
                         cwd=ROOT, capture_output=True, text=True)
    return [ROOT / line for line in out.stdout.splitlines() if line.strip()]


def main() -> int:
    hits = []
    for path in tracked_files():
        if path.suffix.lower() not in TEXT_EXTS or not path.exists():
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        for lineno, line in enumerate(text.splitlines(), 1):
            if "secret-scan-ok" in line:
                continue
            for pattern, label in PATTERNS:
                if re.search(pattern, line):
                    hits.append(f"{path.relative_to(ROOT)}:{lineno}  [{label}]")

    if hits:
        print("✗ 疑似密钥入库：")
        for h in hits:
            print("  -", h)
        print("真密钥 → 移入 .env；误报 → 该行加注释 secret-scan-ok")
        return 1
    print("✓ 泄密扫描通过")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
