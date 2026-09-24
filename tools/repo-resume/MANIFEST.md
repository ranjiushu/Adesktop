# tools/repo-resume —— repo-resume 植入清单

> 本文件由 repo-resume 技能的统一入口生成，**勿手改**。
> 本技能在一个仓库里的全部植入物只落在本目录与两个钩子块内；摘掉它们＝在技能侧跑一次
> `scripts/repo-resume.sh uninstall --repo <本仓>`（幂等）。

<!-- repo-resume:manifest
installed_at=20260924-195107
members=governance
hooksPath=.githooks
hook_pre_commit=entry-doc-governance
hook_post_commit=none
output=/workspace/projects/Adesktop/.git/entry-doc-pdf
files=tools/repo-resume/governance/SOURCE.md;tools/repo-resume/governance/guard.py;tools/repo-resume/governance/measure.py;
-->

## 装了哪些东西

| 位置 | 内容 |
|---|---|
| `tools/repo-resume/governance/` | 文档守卫本体（guard.py / measure.py / SOURCE.md） |
| `tools/repo-resume/print/` | 打印层本体（渲染器 + 配套，装了才有） |
| `.githooks/pre-commit` | 标记块 `repo-resume: entry-doc-governance` |
| `.githooks/post-commit` | 标记块 `repo-resume: entry-doc-print` |
| `git config core.hooksPath` | `.githooks` |
| 产出目录 | `/workspace/projects/Adesktop/.git/entry-doc-pdf`（缓存，可随时删，删了不影响功能） |

## 文件清单

```
tools/repo-resume/governance/SOURCE.md
tools/repo-resume/governance/guard.py
tools/repo-resume/governance/measure.py
```

## 怎么卸

```bash
bash <技能目录>/scripts/repo-resume.sh uninstall --repo <本仓>          # 保留产出目录
bash <技能目录>/scripts/repo-resume.sh uninstall --repo <本仓> --purge  # 连产出一起删
```

卸载顺序恒为「先摘钩子块、再删本体」：反了会留下 fail-closed 的半卸载态，把仓库锁住。
卸完跑 `scripts/repo-resume.sh check --repo <本仓>`，应报「未安装（零残留）」。
