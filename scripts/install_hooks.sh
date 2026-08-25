#!/bin/sh
# 启用 .githooks/（新机器 clone 后跑一次）
set -eu
cd "$(dirname "$0")/.."
git config core.hooksPath .githooks
chmod +x .githooks/pre-commit
echo "已启用 pre-commit 三检查"
