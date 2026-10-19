#!/usr/bin/env bash
# 一键编译并运行 QA 单元测试（在项目根目录执行：bash qa/run-tests.sh）
# 实际编译/运行逻辑在 qa/run-tests.mjs（用 esbuild JS API 传 alias，规避 Git Bash 路径改写）。
set -euo pipefail

cd "$(dirname "$0")/.."
node qa/run-tests.mjs
