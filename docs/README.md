# Adesktop 文档索引

| 文档 | 说明 |
|------|------|
| `build-pipeline.md` | 构建管线（src → bundle → min → APK），JS_ORDER/CSS_ORDER 约定 + 渐进式类型检查（@ts-check） |
| `architecture.md` | 架构分层（WebView 壳 / FileBridge / 前端模块）与桥接口协议 |
| `bridge-and-data-contract.md` | 桥与数据契约清单（FileBridge 方法面 / 回调协议 / 元数据形状，人读版，机器版见 test-bridge-contract.js） |
| `operation-contract.md` | 文件操作契约（八类操作的前置/后置/失败/取消语义 + SAF/私有双后端一致性清单，现状契约含已知缺陷标注） |
| `verification-matrix.md` | 文件操作真机验收矩阵（SAF/private 双后端等价 × 15 场景手工验收清单，Core Hardening 落地产物） |
| `data-integrity.md` | 数据完整性纪律（文件即真相：元数据统一出口 / 防幽灵 positions / 桥层契约） |
| `fs-scope.md` | 文件系统范围决策（SAF 授权目录为主 + 私有目录兜底） |
| `interaction.md` | 桌面交互设计定稿（坐标模型 / 手势状态机 / 目录导航 / 视图模式 / 旋转画布 / Loading Feedback） |
| `viewer.md` | 文件查看器架构决策（FileOpener 分派 / InternalViewer / HTML 桥隔离 / 锚点跟随） |
| `repo-map.md` | 仓库地图（逐源文件行数 + 职责，构建时自动生成，不入库） |

