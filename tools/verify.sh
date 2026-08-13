#!/usr/bin/env bash
# =============================================================================
# verify.sh — 提交前门禁
#   1) build-web.sh --strict   （构建 + 完整性 + 产物结构）
#   2) minify-bundle.js        （压缩产物，验证压缩管线可用）
#   3) run-tests.sh            （测试套件）
# 任何一步失败则 exit 1，禁止带红提交。
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SCRIPT_DIR"

echo ""
echo "═══ 步骤 1/3: 构建（--strict） ═══"
bash tools/build-web.sh --strict || exit 1

echo ""
echo "═══ 步骤 2/3: 压缩产物 ═══"
node tools/minify-bundle.js || exit 1

echo ""
echo "═══ 步骤 3/3: 测试套件 ═══"
bash tests/run-tests.sh || exit 1

echo ""
echo "══════════════════════════════"
echo "  verify 全绿，可以提交"
echo "══════════════════════════════"
