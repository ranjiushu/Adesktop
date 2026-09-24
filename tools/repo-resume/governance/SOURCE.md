# tools/repo-resume/governance —— 文档守卫（分发副本）

本目录由 repo-resume 技能（子技能 `entry-doc-governance`）的 `install-hook.sh` 写入，**请勿手改**：
手改会在下次安装时被覆盖，并让仓库与上游漂移。

- 上游：技能的 `entry-doc-governance/scripts/`（canonical）
- 落地面：本技能的全部植入物只在 `<仓库>/tools/repo-resume/` 一处；清单见同目录 `../MANIFEST.md`
- 更新：拿到新版技能目录后重跑 `install-hook.sh`（幂等，可反复执行）
- 校验：`install-hook.sh --check`（比对副本哈希 + 钩子块 + core.hooksPath）；未装时报「未安装」
- 卸载：`install-hook.sh --uninstall`（先摘钩子块再删本体，幂等；卸完 `--check` 应报「未安装」）
- 阈值与算法唯一事实源：本目录 `measure.py`（`python3 measure.py --print-policy`）
