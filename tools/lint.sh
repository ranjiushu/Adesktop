#!/usr/bin/env bash
# Desktop 全面代码检查脚本（治理移植：LexiCull lint 因地制宜版）
# ═══════════════════════════════════════════════════════════════
#  检查项: 构建一致性 + 文档链接 + CHANGELOG 结构 + 头部注释 + var 纪律
#  已剔除 LexiCull 特有项（squircle/djLint/j2lint/ASI 边界/data.js 健康）
#  用法: bash tools/lint.sh
# ═══════════════════════════════════════════════════════════════
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(dirname "${BASH_SOURCE[0]}")")" && pwd)"
cd "$SCRIPT_DIR"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "  ${GREEN}[OK]${NC} $1"; }
fail() { echo -e "  ${RED}[FAIL]${NC} $1"; }
warn() { echo -e "  ${YELLOW}[WARN]${NC} $1"; }

TOTAL_FAIL=0

echo "═══════════════════════════════════════════════════"
echo "  Desktop 全面代码检查"
echo "═══════════════════════════════════════════════════"
echo ""

# ── 检查 0: 构建一致性 ──
echo "── [0/5] 构建一致性 ──"
if bash "$SCRIPT_DIR/tools/build-web.sh" --check > /dev/null 2>&1; then
  ok "src/ 与 dist/desktop.bundle.html 一致"
else
  fail "源文件与产物不一致——请运行 bash tools/build-web.sh"
  ((TOTAL_FAIL++))
fi
echo ""

# ── 检查 1: 文档链接 ──
echo "── [1/5] 文档链接 ──"
python3 << 'PYEOF' || ((TOTAL_FAIL++))
import os, re, sys
root = os.getcwd()
md_files = []
for dirpath, _, filenames in os.walk('.'):
    if '.git' in dirpath or 'node_modules' in dirpath:
        continue
    for f in filenames:
        if f.endswith('.md'):
            md_files.append(os.path.join(dirpath, f))
broken = []
link_re = re.compile(r'\[([^\]]*)\]\(([^)#\s]+)(#[^)]*)?\)')
for mf in sorted(md_files):
    with open(mf, encoding='utf-8') as fh:
        for i, line in enumerate(fh, 1):
            for m in link_re.finditer(line):
                url = m.group(2)
                if url.startswith(('http://', 'https://', 'mailto:')):
                    continue
                target = os.path.normpath(os.path.join(os.path.dirname(mf), url))
                if not os.path.exists(target):
                    broken.append(f'{mf}:{i}: [{m.group(1)}]({url})')
if broken:
    print(f'  [FAIL] {len(broken)} 个失效链接（共检查 {len(md_files)} 个 md 文件）:')
    for b in broken[:10]:
        print(f'    {b}')
    sys.exit(1)
else:
    print(f'  [OK] 全部 {len(md_files)} 个 md 文件链接有效')
PYEOF
echo ""

# ── 检查 2: CHANGELOG 结构 ──
echo "── [2/5] CHANGELOG 结构 ──"
if [ ! -f "$SCRIPT_DIR/CHANGELOG.md" ]; then
  fail "CHANGELOG.md 不存在"
  ((TOTAL_FAIL++))
else
  if grep -qE '^## (Unreleased|[0-9]+\.)' "$SCRIPT_DIR/CHANGELOG.md"; then
    ok "CHANGELOG 含 Unreleased 或版本区块"
  else
    fail "CHANGELOG 缺少 '## Unreleased' 或版本标题"
    ((TOTAL_FAIL++))
  fi
  # 禁 emoji（P1：文档/注释禁止 emoji，UI 字符串例外）
  if grep -P '[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]' "$SCRIPT_DIR/CHANGELOG.md" > /dev/null 2>&1; then
    fail "CHANGELOG 含 emoji（文档禁 emoji）"
    ((TOTAL_FAIL++))
  else
    ok "CHANGELOG 无 emoji"
  fi
fi
echo ""

# ── 检查 3: 头部注释规范 ──
echo "── [3/5] 头部注释规范 ──"
NOHEAD=0
for f in "$SCRIPT_DIR"/src/js/*.js; do
  [ -f "$f" ] || continue
  if ! head -1 "$f" | grep -qE '^/\*'; then
    echo "  [FAIL] $(basename "$f") 首行非 /* 注释"
    NOHEAD=1
  fi
done
if [ "$NOHEAD" = "0" ]; then
  ok "src/js 全部以 /* 头部注释开头"
else
  ((TOTAL_FAIL++))
fi
echo ""

# ── 检查 4: var 纪律（JS ES6+，禁止新增 var；构建注入变量豁免） ──
echo "── [4/5] var 纪律 ──"
VAR_HITS=$(grep -rnE '\bvar\s+[A-Za-z_$]' "$SCRIPT_DIR"/src/js/ 2>/dev/null | \
  grep -vE 'BUILD_|GIT_|FIRST_|RECENT_|CONTRIBUTION_|SOURCE_|FILE_|NON_SOURCE_|CHANGELOG_MD' || true)
if [ -z "$VAR_HITS" ]; then
  ok "src/js 无裸 var（构建注入变量豁免）"
else
  echo "$VAR_HITS" | head -10
  fail "发现裸 var（须改用 const/let）"
  ((TOTAL_FAIL++))
fi
echo ""

# ── 汇总 ──
echo "═══════════════════════════════════════════════════"
if [ "$TOTAL_FAIL" = "0" ]; then
  echo "  lint 全部通过"
else
  echo "  lint 失败: $TOTAL_FAIL 项"
fi
echo "═══════════════════════════════════════════════════"
exit $(( TOTAL_FAIL > 0 ? 1 : 0 ))
