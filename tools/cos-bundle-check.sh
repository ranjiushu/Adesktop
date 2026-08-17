#!/usr/bin/env bash
# [常驻] COS bundle 周期备份：每累计 25 个提交自动上传一次 git bundle 到腾讯云 COS
# ═══════════════════════════════════════════════════════════════
# 用法:
#   bash tools/cos-bundle-check.sh             # 检查并（必要时）上传
#   bash tools/cos-bundle-check.sh --check     # 仅打印判定结果，不上传
#   bash tools/cos-bundle-check.sh [仓库路径]   # 指定仓库（测试用）
#
# 触发标准: 当前提交总数 - 上次上传时提交总数 >= 25（默认，可用环境变量
#           COS_BUNDLE_THRESHOLD 覆盖）。状态记录在 <仓库>/.git/cos-bundle-count。
#           —— 与构建频率解耦：无论何时构建/提交，只要距上次上传累计满 25 个
#              提交就补传一次；上传失败不更新状态，下次重试。
# 产物:     git bundle create --all → cos://backup-data/adesktop-git/adesktop-<时间戳>.bundle
# 保留:     COS 上保留最近 50 个（KEEP 可经 COS_BUNDLE_KEEP 覆盖）
# 幂等:     构建管线（build-local.sh 步骤 6）与 post-commit hook 双触发点共用本脚本，
#           状态文件保证同一周期只上传一次。
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT="${2:-$(cd "$SCRIPT_DIR/.." && pwd)}"
MODE="${1:-run}"
THRESHOLD="${COS_BUNDLE_THRESHOLD:-25}"
KEEP="${COS_BUNDLE_KEEP:-50}"
SLUG="adesktop"
COS_DIR="cos://backup-data/adesktop-git"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info() { echo -e "${GREEN}[OK]${NC}   $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; }

cd "$PROJECT"
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  fail "非 git 仓库: $PROJECT"
  exit 1
fi

GIT_DIR="$(git rev-parse --git-dir)"
STATE_FILE="$GIT_DIR/cos-bundle-count"

# ── 1. 计算距上次上传的提交差 ──
CUR=$(git rev-list --count HEAD 2>/dev/null || echo 0)
LAST=0
if [ -f "$STATE_FILE" ]; then
  LAST=$(head -1 "$STATE_FILE" | tr -d '[:space:]' || echo 0)
fi
DELTA=$((CUR - LAST))
if [ "$DELTA" -lt 0 ]; then DELTA=0; fi  # 历史重写后提交数回退，视为 0

if [ "$DELTA" -lt "$THRESHOLD" ]; then
  echo "  ↪ COS bundle: 距上次上传 $DELTA 个提交（阈值 $THRESHOLD），跳过"
  exit 0
fi

echo "  ↪ COS bundle: 距上次上传 $DELTA 个提交（阈值 $THRESHOLD），触发上传"
if [ "$MODE" = "--check" ]; then
  echo "  （--check 模式，仅判定不执行）"
  exit 0
fi

# ── 2. 创建 bundle ──
TIMESTAMP=$(date '+%Y%m%d-%H%M%S')
BUNDLE_PATH="/tmp/${SLUG}-bundle-${TIMESTAMP}.bundle"
if ! git bundle create "$BUNDLE_PATH" --all 2>/dev/null; then
  warn "bundle 创建失败，跳过本轮（不更新状态，下次重试）"
  rm -f "$BUNDLE_PATH"
  exit 0
fi

# ── 3. 上传 COS（coscli 缺失或失败均不阻断构建，且不更新状态） ──
if ! command -v coscli >/dev/null 2>&1; then
  warn "coscli 未安装，跳过 COS 上传（不更新状态）"
  rm -f "$BUNDLE_PATH"
  exit 0
fi

if ! coscli cp "$BUNDLE_PATH" "$COS_DIR/${SLUG}-${TIMESTAMP}.bundle" 2>/dev/null; then
  warn "COS 上传失败（可能无网络或凭据不可用），不更新状态，下次重试"
  rm -f "$BUNDLE_PATH"
  exit 0
fi

# ── 4. 清理旧 bundle（保留最近 KEEP 个；ls 无匹配/网络异常时不阻断） ──
coscli ls "$COS_DIR/" 2>/dev/null | grep -oP "${SLUG}-\d{8}-\d{6}\.bundle" | sort | head -n -"$KEEP" | \
  while read -r OLD; do coscli rm "$COS_DIR/$OLD" -f >/dev/null 2>&1 || true; done || true

# ── 5. 更新状态 ──
echo "$CUR" > "$STATE_FILE"
BUNDLE_SIZE=$(ls -lh "$BUNDLE_PATH" | awk '{print $5}')
rm -f "$BUNDLE_PATH"
info "COS bundle 已上传: $COS_DIR/${SLUG}-${TIMESTAMP}.bundle（$BUNDLE_SIZE，保留 $KEEP 个）"
