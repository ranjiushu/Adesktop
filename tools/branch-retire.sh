#!/usr/bin/env bash
# 退休 topic 分支：合并确认 → 记入墓地 → 删除（防止后续误用）
# 用法: bash tools/branch-retire.sh <分支名> [--force]
#   正常情况（已 merge 回主线）无需参数；
#   内容以压缩/移植方式进入主线、或确认放弃时，加 --force。
#
# 分支模型（治理移植自 LexiCull，因地制宜：开发基线为 feat/dev）：
#   main       — 稳定发布分支（只接受 merge，禁止直接提交）
#   feat/dev   — 活跃开发基线（日常开发在此，topic 合并目标）
#   feat|fix|exp/<名> — 短命 topic 分支（合并后退休）
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
# MAINLINE 是 topic 分支的合并目标（活跃开发基线）
MAINLINE="feat/dev"
branch="${1:?用法: bash tools/branch-retire.sh <分支名> [--force]}"
force="${2:-}"

if [ "$branch" = "$MAINLINE" ] || [ "$branch" = "main" ]; then
  echo "长期分支 $branch 不可退休" >&2; exit 1
fi
if ! git rev-parse --verify --quiet "$branch" >/dev/null; then
  echo "分支 $branch 不存在" >&2; exit 1
fi
if [ "$force" != "--force" ] && ! git merge-base --is-ancestor "$branch" "$MAINLINE"; then
  echo "分支 $branch 未合并到 $MAINLINE。" >&2
  echo "若其内容已以压缩/移植方式进入主线，或确认放弃，请执行:" >&2
  echo "  bash tools/branch-retire.sh $branch --force" >&2
  exit 1
fi
echo "$branch" >> "$(git rev-parse --git-dir)/branch-graveyard"
git branch -D "$branch"
echo "已退休: $branch（记入 branch-graveyard，pre-commit/pre-push 将拦截其复活）"
