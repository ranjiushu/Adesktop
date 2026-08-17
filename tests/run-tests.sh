#!/usr/bin/env bash
# Adesktop 测试套件运行器
# 用法: bash run-tests.sh
# 递归发现 tests/ 下所有 test-*.js / test-*.sh，汇总 PASS/FAIL。
# 任何测试失败则 exit 1。
# ============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT="${1:-$(cd "$SCRIPT_DIR/.." && pwd)}"

if [[ ! -d "$PROJECT/src/js" ]]; then
  echo "[无效] 项目路径: $PROJECT"
  exit 2
fi

cd "$PROJECT"

TESTS=()
for f in "$SCRIPT_DIR"/test-*.js; do [[ -f "$f" ]] && TESTS+=("$f"); done
for f in "$SCRIPT_DIR"/test-*.sh; do [[ -f "$f" ]] && TESTS+=("$f"); done

if [[ ${#TESTS[@]} -eq 0 ]]; then
  echo "[提示] 未发现测试文件"
  exit 0
fi

PASS=0
FAIL=0
FAILED_TESTS=()

echo "═══════════════════════════════════════════════════"
echo "  Adesktop 测试套件 (${#TESTS[@]} 个文件)"
echo "═══════════════════════════════════════════════════"

for test_file in "${TESTS[@]}"; do
  name="$(realpath --relative-to="$SCRIPT_DIR" "$test_file")"
  printf "  %-50s " "$name"
  case "$test_file" in
    *.sh)
      if bash "$test_file" > /dev/null 2>&1; then
        echo "PASS"; ((PASS++))
      else
        echo "FAIL"; ((FAIL++)); FAILED_TESTS+=("$name")
      fi
      ;;
    *.js)
      pushd "$(dirname "$test_file")" > /dev/null
      if node "$(basename "$test_file")" "$PROJECT" > /dev/null 2>&1; then
        echo "PASS"; ((PASS++))
      else
        echo "FAIL"; ((FAIL++)); FAILED_TESTS+=("$name")
      fi
      popd > /dev/null
      ;;
  esac
done

echo ""
echo "═══════════════════════════════════════════════════"
echo "  结果: $PASS 通过, $FAIL 失败"
echo "═══════════════════════════════════════════════════"

if [[ $FAIL -gt 0 ]]; then
  echo ""
  echo "失败文件:"
  for f in "${FAILED_TESTS[@]}"; do
    echo "  * $f"
  done
  exit 1
fi
exit 0
