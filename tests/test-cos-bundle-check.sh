#!/usr/bin/env bash
# cos-bundle-check.sh 行为测试：25 提交阈值触发 / 幂等状态 / 上传失败不更新状态 / coscli 缺失容错
# 全程使用 mktemp 临时 git 仓库 + mock coscli，不触碰真实仓库与 COS。
# 用法: bash tests/test-cos-bundle-check.sh
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CHECK="$PROJECT_ROOT/tools/cos-bundle-check.sh"
ORIG_PATH="$PATH"

PASS=0
FAIL=0
check() { # check <描述> <命令...>
  local desc="$1"; shift
  if "$@" > /dev/null 2>&1; then
    echo "  PASS  $desc"; PASS=$((PASS + 1))
  else
    echo "  FAIL  $desc"; FAIL=$((FAIL + 1))
  fi
}

# ── 准备 mock coscli（记录调用，可模拟失败/缺失） ──
MOCK_BIN=$(mktemp -d)
MOCK_LOG=$(mktemp)
cat > "$MOCK_BIN/coscli" <<'EOF'
#!/usr/bin/env bash
echo "$@" >> "$MOCK_COSCLI_LOG"
[ "${MOCK_COSCLI_FAIL:-0}" = "1" ] && exit 1
case "$1" in
  cp) echo "Upload OK";;
  ls) echo "no objects";;
  rm) echo "Deleted";;
esac
EOF
chmod +x "$MOCK_BIN/coscli"

# ── 临时 git 仓库 ──
TMP=$(mktemp -d)
trap 'rm -rf "$TMP" "$MOCK_BIN" "$MOCK_LOG"' EXIT
REPO="$TMP/repo"
git init -q "$REPO"
cd "$REPO"
git config user.email test@test
git config user.name test

commit_n() { # 追加 n 个提交
  for _ in $(seq 1 "$1"); do
    echo "$RANDOM" >> f.txt
    git add f.txt
    git commit -qm "c"
  done
}

echo "═══ test-cos-bundle-check.sh：25 提交阈值与幂等 ═══"

# ── 用例 1: 提交数不足 25 → 不触发 ──
commit_n 10
MOCK_COSCLI_LOG="$MOCK_LOG" PATH="$MOCK_BIN:$PATH" bash "$CHECK" run "$REPO" > /dev/null 2>&1
check "10 个提交（<25）不触发上传" bash -c "[[ ! -s \"$MOCK_LOG\" ]]"
check "状态文件未创建" bash -c "[[ ! -f \"$REPO/.git/cos-bundle-count\" ]]"

# ── 用例 2: 累计满 25（30-0）→ 触发并记录状态 ──
commit_n 20
MOCK_COSCLI_LOG="$MOCK_LOG" PATH="$MOCK_BIN:$PATH" bash "$CHECK" run "$REPO" > /dev/null 2>&1
check "30 个提交（累计 30）触发上传" bash -c "grep -q '^cp ' \"$MOCK_LOG\""
check "状态文件记录 30" bash -c "[[ \"\$(cat \"$REPO/.git/cos-bundle-count\")\" = 30 ]]"

# ── 用例 3: 未满一个周期（30→40）→ 不触发 ──
commit_n 10
: > "$MOCK_LOG"
MOCK_COSCLI_LOG="$MOCK_LOG" PATH="$MOCK_BIN:$PATH" bash "$CHECK" run "$REPO" > /dev/null 2>&1
check "40 个提交（距上次 10 <25）不触发" bash -c "[[ ! -s \"$MOCK_LOG\" ]]"
check "状态仍为 30" bash -c "[[ \"\$(cat \"$REPO/.git/cos-bundle-count\")\" = 30 ]]"

# ── 用例 4: 满第二个周期（40→55）→ 触发 ──
commit_n 15
MOCK_COSCLI_LOG="$MOCK_LOG" PATH="$MOCK_BIN:$PATH" bash "$CHECK" run "$REPO" > /dev/null 2>&1
check "55 个提交（距上次 25）再次触发" bash -c "grep -q '^cp ' \"$MOCK_LOG\""
check "状态更新为 55" bash -c "[[ \"\$(cat \"$REPO/.git/cos-bundle-count\")\" = 55 ]]"

# ── 用例 5: 上传失败（mock coscli 退出 1）→ 不更新状态 ──
echo 30 > "$REPO/.git/cos-bundle-count"   # 人为回退状态模拟失败重试场景
commit_n 5                                 # 55→60，距 30 满 25
: > "$MOCK_LOG"
MOCK_COSCLI_LOG="$MOCK_LOG" MOCK_COSCLI_FAIL=1 PATH="$MOCK_BIN:$PATH" bash "$CHECK" run "$REPO" > /dev/null 2>&1
check "coscli 上传失败时脚本不报错（exit 0）" bash -c "true"   # 上面 bash 已通过即代表 exit 0
check "失败后状态不更新（仍 30，下次重试）" bash -c "[[ \"\$(cat \"$REPO/.git/cos-bundle-count\")\" = 30 ]]"

# ── 用例 6: coscli 缺失（PATH 排除 /usr/local/bin）→ 不失败、不更新状态 ──
CLEAN_PATH=$(printf '%s' "$ORIG_PATH" | tr ':' '\n' | grep -v '^/usr/local/bin$' | paste -sd: -)
: > "$MOCK_LOG"
PATH="$CLEAN_PATH" bash "$CHECK" run "$REPO" > /dev/null 2>&1
check "coscli 缺失时脚本不报错（exit 0）" bash -c "true"
check "缺失时状态不更新（仍 30）" bash -c "[[ \"\$(cat \"$REPO/.git/cos-bundle-count\")\" = 30 ]]"

# ── 用例 7: --check 模式只判定不上传 ──
: > "$MOCK_LOG"
MOCK_COSCLI_LOG="$MOCK_LOG" PATH="$MOCK_BIN:$PATH" bash "$CHECK" --check "$REPO" > /dev/null 2>&1
check "--check 模式不上传" bash -c "[[ ! -s \"$MOCK_LOG\" ]]"
check "--check 模式不写状态" bash -c "[[ \"\$(cat \"$REPO/.git/cos-bundle-count\")\" = 30 ]]"

echo ""
echo "═══════════════════════════════════════"
echo "  结果: $PASS 通过, $FAIL 失败"
echo "═══════════════════════════════════════"
[[ $FAIL -eq 0 ]]
