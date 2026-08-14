#!/usr/bin/env bash
# collect-apk.sh 行为测试：归档命名 / R8 mapping 归档 / 滚动保留最新 10 个 / 命名模式隔离
# 全程使用临时目录，不触碰真实归档目录（/workspace/AAA 安装包）。
# 用法: bash tests/test-collect-apk.sh
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COLLECT="$PROJECT_ROOT/tools/collect-apk.sh"

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

# ── 准备临时项目结构（假产物） ──
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
PROJ="$TMP/project"
OUT="$TMP/AAA 安装包"
mkdir -p "$PROJ/android/app/build/outputs/apk/release"
mkdir -p "$PROJ/android/app/build/outputs/mapping/release"
mkdir -p "$OUT"

echo 'versionName "0.1.0"' > "$PROJ/android/app/build.gradle"
echo "fake-apk" > "$PROJ/android/app/build/outputs/apk/release/app-release.apk"
echo "fake-mapping" > "$PROJ/android/app/build/outputs/mapping/release/mapping.txt"

# 预置 13 个旧包（mtime 递增：00001 最旧 … 00013 最新）
for i in $(seq 1 13); do
  f="$OUT/Desktop_v0.1.0_20260810_000$(printf '%02d' "$i").apk"
  echo "old-$i" > "$f"
  touch -d "2026-08-10 00:00:$(printf '%02d' "$i")" "$f"
done
# 手动放入目录、不属于本脚本命名模式的文件（必须不受清理影响）
echo "keep" > "$OUT/Desktop-history-backup-20260810.bundle"
echo "keep" > "$OUT/manual-note.txt"

echo "═══ test-collect-apk.sh：归档与滚动清理 ═══"

# ── 1. 归档行为 ──
check "新 APK 归档到目标目录" bash "$COLLECT" "$OUT"
NEW_APK=$(ls -t "$OUT"/Desktop_*.apk | head -1)
check "归档命名匹配 Desktop_v<版本>_<时间戳>" bash -c "[[ \"$(basename "$NEW_APK")\" =~ ^Desktop_v0\.1\.0_[0-9]{8}_[0-9]{6}\.apk$ ]]"
check "R8 mapping 归档到 mapping/ 子目录" bash -c "ls \"$OUT/mapping/\" | grep -q '^Desktop_v0\.1\.0_.*\.mapping\.txt$'"

# ── 2. 滚动保留 ──
COUNT=$(ls "$OUT"/Desktop_*.apk | wc -l)
check "Desktop_*.apk 恰好保留 10 个（实际 $COUNT）" bash -c "[[ $COUNT -eq 10 ]]"
check "最旧的 3 个（00001/00002/00003）已被清理" bash -c "! ls \"$OUT\" | grep -qE '0000[123]\.apk$'"
check "次新的旧包（00013）仍在保留列表" bash -c "ls \"$OUT\" | grep -q '00013\.apk$'"
check "最新归档的时间戳为构建当日" bash -c "[[ \"$(basename "$NEW_APK")\" =~ ^Desktop_v0\.1\.0_$(date +%Y%m%d)_ ]]" 

# ── 3. 命名模式隔离（手动文件不受影响） ──
check "手动放入的 history bundle 保留" bash -c "[[ -f \"$OUT/Desktop-history-backup-20260810.bundle\" ]]"
check "手动放入的 manual-note.txt 保留" bash -c "[[ -f \"$OUT/manual-note.txt\" ]]"
check "mapping/ 子目录内也保留 1 个" bash -c "[[ \$(ls \"$OUT/mapping/\" | wc -l) -eq 1 ]]"

echo ""
echo "═══════════════════════════════════════"
echo "  结果: $PASS 通过, $FAIL 失败"
echo "═══════════════════════════════════════"
[[ $FAIL -eq 0 ]]