# Desktop 文档索引

| 文档 | 说明 |
|------|------|
| `build-pipeline.md` | 构建管线（src → bundle → min → APK），JS_ORDER/CSS_ORDER 约定 |
| `architecture.md` | 架构分层（WebView 壳 / FileBridge / 前端模块）与桥接口协议 |
| `data-integrity.md` | 数据完整性纪律（文件即真相：元数据统一出口 / 防幽灵 positions / 桥层契约） |
| `fs-scope.md` | 文件系统范围决策（SAF 授权目录为主 + 私有目录兜底） |
| `interaction.md` | 桌面交互设计定稿（坐标模型 / 手势状态机 / 目录导航 / 视图模式 / Loading Feedback） |
| `viewer.md` | 文件查看器架构决策（FileOpener 分派 / InternalViewer / HTML 桥隔离 / 锚点跟随） |

技术栈基准：`/workspace/lexicull`（同构参考，禁止直接复制其业务代码）。
