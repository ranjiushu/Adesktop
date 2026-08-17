#!/usr/bin/env bash
# 完整验证门禁（治理移植：LexiCull verify 框架因地制宜版）
# ═══════════════════════════════════════════════════════════════
#  Adesktop - 提交前验证门禁
#  按序执行: env-check → build --strict → minify-bundle → lint → 测试套件 → E2E × 5
#  任何一步失败则 exit 1。输出机器可读 PASS/FAIL 摘要。
#  用法: bash tools/verify.sh
# ═══════════════════════════════════════════════════════════════
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(dirname "${BASH_SOURCE[0]}")")" && pwd)"
cd "$SCRIPT_DIR"

PASS=0
FAIL=0
RESULTS=()

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

run_step() {
  local label="$1"
  shift
  local log="/tmp/verify-$(echo "$label" | tr ' /' '__').log"
  echo -n "  ${label} ... "
  if "$@" > "$log" 2>&1; then
    echo -e "${GREEN}PASS${NC}"
    ((PASS++))
    RESULTS+=("PASS|$label")
  else
    echo -e "${RED}FAIL${NC}"
    echo "  ── $label 日志尾部（完整: $log）──"
    tail -30 "$log" | sed 's/^/  | /'
    ((FAIL++))
    RESULTS+=("FAIL|$label")
  fi
}

echo "═══════════════════════════════════════════════════"
echo "  Adesktop 提交前验证"
echo "═══════════════════════════════════════════════════"
echo ""

# Step 0: 环境自检——把「静默失效」变成显式 FAIL
echo -n "  env-check ... "
ENV_ERR=""
[ "$(git config core.hooksPath)" = ".githooks" ] || ENV_ERR="core.hooksPath 未设为 .githooks（分支治理钩子未启用！执行: git config core.hooksPath .githooks）"
if [ -z "$ENV_ERR" ]; then
  echo -e "${GREEN}PASS${NC}"
  ((PASS++)); RESULTS+=("PASS|env-check")
else
  echo -e "${RED}FAIL${NC}（$ENV_ERR）"
  ((FAIL++)); RESULTS+=("FAIL|env-check")
fi

# Step 1: 完整构建 + 体积棘轮门禁
run_step "build --strict" bash tools/build-web.sh --strict

# Step 2: 压缩产物（真机实际加载的版本，E2E 针对它验证）
if [ -f "$SCRIPT_DIR/node_modules/terser/package.json" ] && [ -f "$SCRIPT_DIR/node_modules/clean-css/package.json" ]; then
  run_step "minify-bundle" node "$SCRIPT_DIR/tools/minify-bundle.js"
  MIN_BUNDLE="$SCRIPT_DIR/dist/adesktop.bundle.min.html"
else
  echo "  minify-bundle ... SKIP（缺 terser/clean-css，先 npm install）"
  RESULTS+=("SKIP|minify-bundle")
  MIN_BUNDLE="$SCRIPT_DIR/dist/adesktop.bundle.html"
fi

# Step 3: 代码质量
run_step "lint" bash tools/lint.sh

# Step 4: 测试套件
run_step "tests" bash "$SCRIPT_DIR/tests/run-tests.sh"

# Step 5: E2E 门禁（无头 Chromium 实地验证压缩产物，真机实际加载版本）
# 无可用 Chromium 时 SKIP（与 LexiCull 同策略：单次环境缺失不判回归）
export CHROME_PATH="${CHROME_PATH:-/root/.cache/ms-playwright/chromium_headless_shell-1234/chrome-linux/headless_shell}"

e2e_step() {
  local label="$1" script="$2"
  echo -n "  $label ... "
  DESKTOP_BUNDLE="$MIN_BUNDLE" node "$SCRIPT_DIR/$script" > "/tmp/verify-$label.log" 2>&1
  local _rc=$?
  if [ $_rc -eq 0 ]; then
    echo -e "${GREEN}PASS${NC}"
    ((PASS++)); RESULTS+=("PASS|$label")
  elif [ $_rc -eq 2 ]; then
    echo "SKIP（无可用 Chromium）"
    RESULTS+=("SKIP|$label")
  else
    echo -e "${RED}FAIL${NC}"
    cat "/tmp/verify-$label.log"
    ((FAIL++)); RESULTS+=("FAIL|$label")
  fi
}

# 已存在的 E2E 脚本资产（scripts/verify-*.js），接入门禁防回归
e2e_step "home-e2e"        scripts/verify-home.js
e2e_step "drawer-e2e"      scripts/verify-drawer.js
e2e_step "bottom-bar-e2e"  scripts/verify-bottom-bar.js
e2e_step "buildinfo-e2e"   scripts/verify-buildinfo.js
e2e_step "fab-inspector-e2e" scripts/verify-fab-inspector.js
e2e_step "rotate-e2e"      scripts/verify-rotate.js

# ── 摘要 ──
echo ""
echo "═══════════════════════════════════════════════════"
echo -e "  结果: ${GREEN}${PASS} 通过${NC}, ${RED}${FAIL} 失败${NC}"
echo "═══════════════════════════════════════════════════"
echo ""

# 机器可读输出
for r in "${RESULTS[@]}"; do
  echo "[VERIFY] $r"
done

exit $(( FAIL > 0 ? 1 : 0 ))
