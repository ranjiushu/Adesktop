#!/usr/bin/env bash
# bundle-source.sh — 将 Desktop 源码打包成 zip，排除编译产物
# 用法: ./tools/bundle-source.sh [输出目录]
#   默认输出到 /workspace/AAA 安装包/

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEFAULT_OUT="/workspace/AAA 安装包"
OUT_DIR="${1:-$DEFAULT_OUT}"

TIMESTAMP="$(date +%Y%m%d-%H%M)"
ZIP_NAME="Desktop-source-${TIMESTAMP}.zip"
OUT_PATH="${OUT_DIR}/${ZIP_NAME}"

mkdir -p "$OUT_DIR"

echo "📦 正在打包 Desktop 源码..."
echo "   排除: dist/ node_modules/ build/ .gradle/ .git/"

cd "$REPO_ROOT"
zip -r "$OUT_PATH" . \
  -x "dist/*" \
  -x "node_modules/*" \
  -x ".git/*" \
  -x "*/build/*" \
  -x "android/.gradle/*" \
  -x "coscli.log" \
  -x "coscli_output/*" \
  -q

SIZE="$(du -h "$OUT_PATH" | cut -f1)"
echo "✅ 打包完成: ${OUT_PATH} (${SIZE})"
