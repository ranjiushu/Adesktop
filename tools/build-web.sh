#!/usr/bin/env bash
# =============================================================================
# build-web.sh — 将 src/ 下的拆分源码合并为单文件 dist/desktop.bundle.html
#
# 用法: bash tools/build-web.sh [--strict]
# 功能: 1) 拼接 JS/CSS 2) 注入构建变量 3) 产物结构验证
#       验证失败则中止，不会覆盖 dist/desktop.bundle.html
#
# 注入变量（构建时注入到 JS 尾部，每次构建自动更新）：
#   BUILD_COUNT     — 构建次数（从 dist/.build-count 持久化文件递增）
#   BUILD_TIMESTAMP — 构建时间（Asia/Shanghai, ISO 8601）
#
# 拼接清单：新增 src/js/*.js 或 src/css/*.css 必须登记到 JS_ORDER/CSS_ORDER，
# 否则完整性自检会拦截构建（防「新文件忘登记 → 代码不进产物」）。
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SRC_DIR="$SCRIPT_DIR/src"
OUTPUT="$SCRIPT_DIR/dist/desktop.bundle.html"
mkdir -p "$(dirname "$OUTPUT")"

JS_ORDER=(
  namespace.js utils.js bridge.js toast.js dialog.js loading.js file-api.js clipboard.js double-tap.js
  desktop-nav.js desktop-selection.js folder-sort.js
  desktop-grid.js folder-layout.js layout-store.js view-store.js home-store.js desktop-camera.js desktop-gesture.js desktop.js
  view-menu.js actions.js fab-speed-dial.js drawer.js drawer-swipe.js build-info.js inspector.js
  ui.js ime-adapter.js bottom-bar.js create-dialog.js rename-dialog.js main.js
)

CSS_ORDER=(
  tokens.css shell.css desktop.css fab.css drawer.css bottom-bar.css dialog.css
  buildinfo.css contribution.css toast.css loading.css view-menu.css
)

# ── 颜色 ──
RED=''; GREEN=''; NC=''; YELLOW=''
if [[ -t 1 ]]; then
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
fi
fail() { echo -e "${RED}[FAIL]${NC} $1"; exit 1; }
ok()   { echo -e "${GREEN}[OK]${NC}   $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

STRICT_MODE=false
for arg in "$@"; do
  [[ "$arg" == "--strict" ]] && STRICT_MODE=true
done

# ── 前置检查：所有源文件存在 ──
check_files_exist() {
  local missing=0
  for f in "${JS_ORDER[@]}"; do
    [[ -f "$SRC_DIR/js/$f" ]] || { echo "  [缺失] src/js/$f"; missing=1; }
  done
  for f in "${CSS_ORDER[@]}"; do
    [[ -f "$SRC_DIR/css/$f" ]] || { echo "  [缺失] src/css/$f"; missing=1; }
  done
  [[ -f "$SRC_DIR/index.html" ]] || { echo "  [缺失] src/index.html"; missing=1; }
  [[ $missing -eq 0 ]] || fail "源文件缺失，中止构建"
  ok "所有源文件存在"
}

# ── 反向完整性检查：src 目录内文件必须全部纳入拼接清单 ──
list_contains() {
  local target="$1" f
  for f in "${@:2}"; do
    [[ "$f" == "$target" ]] && return 0
  done
  return 1
}

check_order_completeness() {
  local missing=0 f base
  for f in "$SRC_DIR"/js/*.js; do
    base=$(basename "$f")
    if ! list_contains "$base" "${JS_ORDER[@]}"; then
      echo "  [缺失登记] src/js/$base 未纳入 JS_ORDER"
      missing=1
    fi
  done
  for f in "$SRC_DIR"/css/*.css; do
    base=$(basename "$f")
    if ! list_contains "$base" "${CSS_ORDER[@]}"; then
      echo "  [缺失登记] src/css/$base 未纳入 CSS_ORDER"
      missing=1
    fi
  done
  [[ $missing -eq 0 ]] || fail "存在未纳入拼接清单的源文件（新文件须加入 JS_ORDER/CSS_ORDER 才能进入构建）"
  ok "拼接清单完整（src/js ${#JS_ORDER[@]} 个 / src/css ${#CSS_ORDER[@]} 个）"
}

# ── 拼接 JS ──
concat_js() {
  local tmp="$1"
  > "$tmp"
  for f in "${JS_ORDER[@]}"; do
    cat "$SRC_DIR/js/$f" >> "$tmp"
    printf '\n' >> "$tmp"
  done
  ok "JS 拼接完成 ($(wc -c < "$tmp") bytes)"
}

# ── 拼接 CSS ──
concat_css() {
  local tmp="$1"
  > "$tmp"
  for f in "${CSS_ORDER[@]}"; do
    cat "$SRC_DIR/css/$f" >> "$tmp"
  done
  ok "CSS 拼接完成 ($(wc -c < "$tmp") bytes)"
}

# ── 验证 JS 语法 ──
verify_js_syntax() {
  local js_file="$1"
  if command -v node &>/dev/null; then
    if node --check "$js_file" 2>&1; then
      ok "JS 语法正确"
    else
      fail "JS 语法错误（详见上方输出）"
    fi
  else
    warn "未找到 node，跳过 JS 语法检查"
  fi
}

# ── 注入构建变量 ──
# 变量与 LexiCull 同名（GIT_COMMIT_COUNT/GIT_AHEAD_MAIN/GIT_BRANCH 等），
# 便于移植其构建信息页；非 git 仓库时降级默认值。
# 扩展数据（RECENT_COMMITS 增强/CONTRIBUTION_GRID/SOURCE_STATS/FILE_STATS/
# NON_SOURCE_STATS/CHANGELOG_HTML）由 tools/build-stats.sh 追加注入。
inject_vars() {
  local js_file="$1"
  local count=1
  [[ -f "$SCRIPT_DIR/dist/.build-count" ]] && count=$(cat "$SCRIPT_DIR/dist/.build-count")
  count=$((count + 1))
  echo "$count" > "$SCRIPT_DIR/dist/.build-count"
  local ts
  ts=$(TZ=Asia/Shanghai date +"%Y-%m-%d %H:%M:%S %z" 2>/dev/null || date +"%Y-%m-%d %H:%M:%S")

  local commit_count=0 ahead_main=0 branch="unknown"
  if command -v git &>/dev/null && git -C "$SCRIPT_DIR" rev-parse --git-dir >/dev/null 2>&1; then
    commit_count=$(git -C "$SCRIPT_DIR" rev-list --count HEAD 2>/dev/null || echo 0)
    ahead_main=$(git -C "$SCRIPT_DIR" rev-list --count main..HEAD 2>/dev/null || echo 0)
    branch=$(git -C "$SCRIPT_DIR" symbolic-ref --short HEAD 2>/dev/null || echo "unknown")
  fi

  local first_ts="$ts"
  if [[ -f "$SCRIPT_DIR/dist/.first-build-timestamp" ]]; then
    first_ts=$(cat "$SCRIPT_DIR/dist/.first-build-timestamp")
  else
    echo "$ts" > "$SCRIPT_DIR/dist/.first-build-timestamp"
  fi

  cat >> "$js_file" <<EOF
var BUILD_COUNT=${count};
var BUILD_TIMESTAMP='${ts}';
var GIT_COMMIT_COUNT=${commit_count};
var GIT_AHEAD_MAIN=${ahead_main};
var GIT_BRANCH='${branch}';
var FIRST_BUILD_TIMESTAMP='${first_ts}';
EOF

  # 扩展注入（提交详情/热力图/文件统计/更新日志）
  bash "$SCRIPT_DIR/tools/build-stats.sh" "$SRC_DIR" "$SCRIPT_DIR" "$js_file"

  ok "注入构建变量（build ${count} @ ${ts}，commits=${commit_count}，branch=${branch}）"
}

# ── 验证注入变量存在 ──
verify_injections() {
  local js_file="$1"
  for var in BUILD_COUNT BUILD_TIMESTAMP GIT_COMMIT_COUNT GIT_AHEAD_MAIN GIT_BRANCH \
    FIRST_BUILD_TIMESTAMP RECENT_COMMITS CONTRIBUTION_GRID SOURCE_STATS FILE_STATS \
    NON_SOURCE_STATS CHANGELOG_HTML; do
    grep -q "var ${var}=" "$js_file" || fail "注入变量缺失: ${var}"
  done
  ok "注入变量均已存在于产物中"
}

# ── 构建 HTML ──
build_html() {
  local css_tmp="$1" js_tmp="$2" output="$3"
  local css_content
  css_content=$(cat "$css_tmp")
  > "$output"
  while IFS= read -r line; do
    case "$line" in
      *__STYLE_PLACEHOLDER__*) printf '%s\n' "$css_content" ;;
      *__JS_PLACEHOLDER__*)    cat "$js_tmp" ;;
      *)                       printf '%s\n' "$line" ;;
    esac
  done < "$SRC_DIR/index.html" > "$output"
  # 防回归：占位符字符串不得出现在 HTML 注释等非注入位置——
  # 曾踩坑：index.html 首行注释含 __STYLE_PLACEHOLDER__ 字面量被通配误匹配，
  # CSS 被输出到 DOCTYPE 之前，真机渲染成 body 文本（一长串 CSS 源码）。
  if head -c 12 "$output" | grep -qv '<'; then
    fail "产物不以 HTML 标签开头——占位符疑似被注释行误匹配"
  fi
  ok "HTML 构建完成 ($(wc -c < "$output") bytes)"
}

# ── 验证产物结构 ──
verify_output() {
  local output="$1"
  local errors=0

  # 1. 没有残留占位符
  if grep -q '__STYLE_PLACEHOLDER__\|__JS_PLACEHOLDER__' "$output"; then
    echo "  [残留] 产物中存在未替换的占位符"
    errors=1
  fi

  # 2. 恰好一个 <style> + 一个 <script>
  local style_open style_close script_open script_close
  style_open=$(grep -c '<style>'  "$output" 2>/dev/null || echo 0)
  style_close=$(grep -c '</style>' "$output" 2>/dev/null || echo 0)
  script_open=$(grep -c '<script>' "$output" 2>/dev/null || echo 0)
  script_close=$(grep -c '</script>' "$output" 2>/dev/null || echo 0)
  [[ $style_open -eq 1 ]]  || { echo "  [结构] <style> 个数: $style_open (期望 1)"; errors=1; }
  [[ $style_close -eq 1 ]] || { echo "  [结构] </style> 个数: $style_close (期望 1)"; errors=1; }
  [[ $script_open -eq 1 ]] || { echo "  [结构] <script> 个数: $script_open (期望 1)"; errors=1; }
  [[ $script_close -eq 1 ]]|| { echo "  [结构] </script> 个数: $script_close (期望 1)"; errors=1; }

  # 3. 包含 DOCTYPE 声明
  grep -q '<!DOCTYPE html>' "$output" || { echo "  [结构] 缺少 DOCTYPE"; errors=1; }

  [[ $errors -eq 0 ]] || fail "产物结构验证失败"
  ok "产物结构验证通过"
}

# ── 一致性检查模式（--check）：临时构建与当前产物对比 ──
check_consistency() {
  local tmp_js tmp_css tmp_output
  tmp_js=$(mktemp -p /tmp desktop-check-js-XXXXXXXX.js)
  tmp_css=$(mktemp -p /tmp desktop-check-css-XXXXXXXX.css)
  tmp_output=$(mktemp -p /tmp desktop-check-XXXXXXXX.html)
  concat_js "$tmp_js" &>/dev/null
  concat_css "$tmp_css" &>/dev/null
  build_html "$tmp_css" "$tmp_js" "$tmp_output" &>/dev/null
  rm -f "$tmp_css"
  if diff -I 'var BUILD_TIMESTAMP=' -I 'var BUILD_COUNT=' \
    -I 'var GIT_COMMIT_COUNT=' -I 'var GIT_AHEAD_MAIN=' -I 'var GIT_BRANCH=' \
    -I 'var RECENT_COMMITS=' -I 'var FIRST_BUILD_TIMESTAMP=' \
    -I 'var CONTRIBUTION_GRID=' -I 'var SOURCE_STATS=' -I 'var FILE_STATS=' \
    -I 'var NON_SOURCE_STATS=' -I 'var CHANGELOG_HTML=' \
    -q "$tmp_output" "$OUTPUT" &>/dev/null; then
    echo "[check] src/ 与 dist/desktop.bundle.html 一致"
    rm -f "$tmp_js" "$tmp_output"
    exit 0
  else
    echo "[check] src/ 与 dist/desktop.bundle.html 不一致——需要重建"
    rm -f "$tmp_js" "$tmp_output"
    exit 1
  fi
}

# ── 体积棘轮（--strict）：超过基线 30% 判为膨胀 fail；strict 构建后更新基线 ──
size_gate() {
  local output="$1"
  local baseline_file="$SCRIPT_DIR/dist/.size-baseline"
  local size
  size=$(wc -c < "$output" | tr -d ' ')
  if [[ ! -f "$baseline_file" ]]; then
    echo "$size" > "$baseline_file"
    ok "体积棘轮：首次构建，基线建立 ($size bytes)"
    return 0
  fi
  local baseline
  baseline=$(cat "$baseline_file")
  if [[ $STRICT_MODE == true ]]; then
    local limit=$((baseline * 130 / 100))
    if (( size > limit )); then
      fail "体积膨胀：$size bytes > 基线 $baseline 的 130%（$limit）——疑似大块内容重复拼入，请检查"
    fi
    echo "$size" > "$baseline_file"
    ok "体积棘轮：$size bytes（基线 $baseline，+$(( (size - baseline) * 100 / baseline ))%）"
  else
    warn "体积棘轮：$size bytes（基线 $baseline，--strict 时超 130% 将拦截）"
  fi
}

# ══════════════════════════ 主流程 ══════════════════════════
echo "================================================"
echo "  Desktop 构建（src/ → dist/desktop.bundle.html）"
echo "================================================"

[[ "$*" == *--check* ]] && check_consistency

check_files_exist
check_order_completeness

TMP_JS=$(mktemp -p /tmp desktop-js-XXXXXXXX.js)
TMP_CSS=$(mktemp -p /tmp desktop-css-XXXXXXXX.css)

concat_js "$TMP_JS"
verify_js_syntax "$TMP_JS"
inject_vars "$TMP_JS"
verify_injections "$TMP_JS"

concat_css "$TMP_CSS"
build_html "$TMP_CSS" "$TMP_JS" "$OUTPUT"

rm -f "$TMP_JS" "$TMP_CSS"

verify_output "$OUTPUT"
size_gate "$OUTPUT"
echo "================================================"
echo "  构建完成: $OUTPUT"
echo "================================================"
