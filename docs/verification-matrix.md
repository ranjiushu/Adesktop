# 文件操作真机验收矩阵（Operation Contract Verification Matrix）

Core Hardening 周期留下的**真机手工验收清单**（`docs/operation-contract.md` 测试矩阵 #11
的落地产物）。背景：TransferEngine / FileStore 依赖 Android `DocumentFile`/`ContentResolver`，
JVM 单测成本高，故 SAF/private 双后端等价的最终确认以真机验收为准。

## 用法

1. 真机安装最新 APK（构建归档目录中的最新产物）。
2. 按行执行「验收方法」，对照「预期」在「结果」列打勾（✓/✗/备注）。
3. 完成后把结果回填本节（或告知助手回填），失败的项记入「问题」。

前置：准备两个根目录（SAF 授权目录 A / 私有目录兜底时跳过 SAF 列），构造测试文件
`foo.txt`（含内容）、`sub/` 文件夹、`报告.txt`。

## 双后端等价（每个场景 SAF 与私有各过一遍）

| # | 操作 | 验收方法 | 预期（SAF） | 预期（私有） | 结果 |
|---|------|---------|------------|-------------|------|
| 1 | move 同名 | `A/foo.txt` 剪切 → 粘贴到 `B/`（B 无 foo.txt） | 真移动（moveDocument），目标 `B/foo.txt`，布局 key 迁移 | 真移动（renameTo），目标 `B/foo.txt` | |
| 2 | move 重名 | `A/foo.txt` 剪切 → 粘贴到 `B/`（B 已有 foo.txt） | 目标 `B/foo 2.txt`（**copy+delete 改名路径**，2026-08-17 修复） | 目标 `B/foo 2.txt`（renameTo 改名） | |
| 3 | move 目录 | `A/sub/` 剪切 → 粘贴到 `B/` | 整目录移动，内部文件齐全 | 同左 | |
| 4 | delete | 选中 `foo.txt` 删除 | 进入 `.trash/foo.txt`（重名自动加序号） | 同左 | |
| 5 | 重复删除同名 | 再删 `B/foo.txt` | `.trash` 内不覆盖（`foo 2.txt`） | 同左 | |
| 6 | restore | 回收站内选中 → 剪切 → 粘贴回原目录 | 移回，重名自动加序号（不还原原名） | 同左 | |
| 7 | rename 同目录 | `报告.txt` → `报告2.txt` | 成功，图标位置保留（applyRename 迁移布局 key） | 同左 | |
| 8 | rename 跨目录 | 重命名对话框输入 `sub/b.txt` | JS 拒绝 toast（名称不能含路径分隔符） | 同左 | |
| 9 | copy 重名 | 复制 `foo.txt` 到已有 `foo.txt` 的目录 | `foo 2.txt` | 同左 | |
| 10 | copy 大文件进度 | 复制 100MB+ 文件 | Loading 显示字节进度 + 可取消 | 同左 | |
| 11 | 批量取消（P0 修复） | 批量粘贴 10 个文件，第 3 个时点取消 | 第 3 个中止 + 半成品清理；**4 起不再启动**；toast「已移动 2 项，已取消 8 项」（非失败列表） | 同左 | |
| 12 | 批量失败续跑 | 批量粘贴 10 个，其中 1 个源已删 | 失败项汇总弹窗，其余 9 个继续 | 同左 | |
| 13 | 删除大文件夹 | 删除含大量文件的文件夹 | 真移动 O(1) 秒删（回收站） | 同左 | |
| 14 | 切根布局隔离（root-id 修复） | 根 A 摆放图标 + 设 Home 快照 → 切换根 B | B 是默认布局（不继承 A 的图标位置/相机/Home）；切回 A 布局仍在 | 同左（私有↔SAF 互切也可验） | |
| 15 | mtime 观察（已知差异） | 复制文件后看目标「修改时间」 | **不保留**（SAF 无公开 API 设置 mtime，已文档化接受） | 保留源 mtime | |

## 备注

- #11 与 #12 是本周期两个关键修复的真机验证：批量取消语义（c59808c）、失败续跑（原语义，测试已锁）。
- #14 验证 root-id 隔离（3247a5c）：`desktop.layout.<rootId>.v1` / `desktop.home.<rootId>.v1`。
- #2 验证 SAF 真移动改名缝隙修复（c2878c5）：`src leaf != dst leaf` 时 SAF 走 copy+delete 而非 moveDocument。
- 若某行 SAF 与私有预期不一致：视为 P0 语义回归，优先处理（契约见 docs/operation-contract.md）。
