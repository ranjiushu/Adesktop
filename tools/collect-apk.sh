#!/usr/bin/env bash
# [常驻] APK 收集归档：构建完成后把安装包复制到外部目录，滚动保留最新 10 个
# ═══════════════════════════════════════════════════════════════
# 用法: bash tools/collect-apk.sh [目标目录]
# 默认目标: <项目根>/../AAA 安装包（当前环境即 /workspace/AAA 安装包）
# 命名: Adesktop_v<versionName>_<YYYYMMDD_HHMMSS>.apk
#       —— 时间戳精确到秒，避免固定名 app-release.apk 互相覆盖
# 保留: 仅清理本脚本命名模式（Adesktop_*.apk），按 mtime 保留最新 10 个，
#       手动放入目录的其他文件不受影响
# 关联: android/build-local.sh 构建完成后调用；与 LexiCull tools/collect-apk.sh 同款方案
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 项目根：默认 = 脚本所在仓库（构建时调用）；测试可经 ADESKTOP_PROJECT_ROOT 指向临时项目，
# 否则测试会读到真实仓库的版本号/产物（曾致 test-collect-apk 断言随版本号漂移）
PROJECT_ROOT="${ADESKTOP_PROJECT_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
OUT_DIR="${1:-$PROJECT_ROOT/../AAA 安装包}"
KEEP=10

# ── 1. 定位最新 APK 产物（release 优先，取修改时间最新） ──
APK_SRC=$(find "$PROJECT_ROOT/android/app/build/outputs/apk" -name '*.apk' -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-)
if [ -z "$APK_SRC" ]; then
  echo "[FAIL] 未找到 APK 产物（android/app/build/outputs/apk/ 为空）"
  exit 1
fi

# ── 2. 命名：版本号（build.gradle）+ 时间戳 ──
VERSION=$(grep -oP 'versionName\s+"\K[^"]+' "$PROJECT_ROOT/android/app/build.gradle" 2>/dev/null | head -1 || true)
[ -n "$VERSION" ] || VERSION="unknown"
TS=$(date +%Y%m%d_%H%M%S)

mkdir -p "$OUT_DIR"
DEST="$OUT_DIR/Adesktop_v${VERSION}_${TS}.apk"
cp "$APK_SRC" "$DEST"
echo "[OK] 安装包已收集: $DEST ($(du -h "$DEST" | cut -f1))"

# ── 3. R8 mapping 归档：release（R8 混淆）构建同步归档 mapping.txt ──
#    混淆后崩溃堆栈为混淆名，排查依赖 mapping 还原
case "$APK_SRC" in
  */release/*)
    MAPPING="$PROJECT_ROOT/android/app/build/outputs/mapping/release/mapping.txt"
    if [ -f "$MAPPING" ]; then
      MAP_DIR="$OUT_DIR/mapping"
      mkdir -p "$MAP_DIR"
      MAP_DEST="$MAP_DIR/Adesktop_v${VERSION}_${TS}.mapping.txt"
      cp "$MAPPING" "$MAP_DEST"
      echo "[OK] R8 mapping 已归档: $MAP_DEST ($(du -h "$MAP_DEST" | cut -f1))"
      mapfile -t OLD_MAPS < <(find "$MAP_DIR" -maxdepth 1 -name 'Adesktop_*.mapping.txt' -printf '%T@ %p\n' 2>/dev/null | sort -rn | tail -n +$((KEEP + 1)) | cut -d' ' -f2-)
      for old in "${OLD_MAPS[@]}"; do
        rm -f "$old"
        echo "[CLEAN] 移除旧 mapping: $(basename "$old")"
      done
    fi
    ;;
esac

# ── 4. 滚动保留最新 KEEP 个（仅匹配本脚本命名模式，mtime 排序） ──
mapfile -t OLD_APKS < <(find "$OUT_DIR" -maxdepth 1 -name 'Adesktop_*.apk' -printf '%T@ %p\n' 2>/dev/null | sort -rn | tail -n +$((KEEP + 1)) | cut -d' ' -f2-)
for old in "${OLD_APKS[@]}"; do
  rm -f "$old"
  echo "[CLEAN] 移除旧安装包: $(basename "$old")"
done

echo "[OK] 归档目录: $OUT_DIR（保留最新 ${KEEP} 个）"
