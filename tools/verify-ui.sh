#!/usr/bin/env bash
# verify-ui.sh — UI 实地验证门禁（无头 Chromium + 安全区断言）
# ═══════════════════════════════════════════════════════════════
#  由 tools/verify.sh 调用（G1：把 UI 回归从"LLM 自觉跑"升级为"机器强制"）。
#  沉浸式安全区三变量注入验证（verify-insets.js + judge 路径模式断言）。
#  断言失败 → exit 1 → verify.sh run_step 捕获。
#  无 Chromium 环境自动 SKIP。
#  用法: bash tools/verify-ui.sh
# ═══════════════════════════════════════════════════════════════
set -uo pipefail
cd "$(dirname "$(dirname "${BASH_SOURCE[0]}")")"

VERIFY="/skills/toolchain-skills/ui-verify/scripts/verify-insets.js"
HTML="dist/adesktop.bundle.min.html"

if [ ! -x "/workspace/chrome/arm64/chrome-headless-shell-linux-arm64/chrome-headless-shell" ] && [ -z "${CHROME_PATH:-}" ]; then
  echo "SKIP（无可用 Chromium）"
  exit 0
fi
[ -f "$HTML" ] || { echo "[FAIL] 缺少 $HTML —— 先跑 build-web.sh"; exit 1; }

echo "── 沉浸式安全区断言（safe-top 41.2 / safe-bottom 24 / panel-bottom 300）──"
node "$VERIFY" "$HTML" \
  --safe-top 41.2px --safe-bottom 24px --panel-bottom 300px \
  --assert "base.header.paddingTop == 41.2px" \
  --assert "base.bottomBar.paddingBottom == 24px" \
  --assert "nc.gap == nc.gapTop (tol 1)"
