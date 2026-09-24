# tools/guards —— 文档守卫（分发副本）

本目录由 repo-resume 技能（子技能 `entry-doc-governance`）的 `install-hook.sh` 写入，**请勿手改**：
手改会在下次安装时被覆盖，并让仓库与上游漂移。

- 上游：技能的 `entry-doc-governance/scripts/`（canonical）
- 更新：拿到新版技能目录后重跑 `install-hook.sh`（幂等，可反复执行）
- 校验：`install-hook.sh --check`（比对副本哈希 + 钩子块 + core.hooksPath）
- 阈值与算法唯一事实源：本目录 `measure.py`（`python3 measure.py --print-policy`）
