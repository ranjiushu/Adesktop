# Desktop 更新日志

## 0.1.0（2026-08-13）

### 初始化与文件系统核心

- 项目骨架：src 拆分源码 + 构建管线（build-web/minify/verify）+ 测试套件 + Android WebView 壳
- 真实文件系统核心：SAF 授权根目录 + FileBridge（list/read/write/mkdir/delete/rename/rootInfo）
- 桌面渲染：以文件系统为数据源的图标网格

### 交互层

- Morph FAB：短按展开 Speed Dial（新建文件夹/新建文件/刷新/切换根目录），长按激活取景器
- 元素取景器（移植自 LexiCull）：长按 FAB 800ms 激活，DOM 元素选取与属性查看
- 顶栏汉堡 + Drawer 工具栏：根目录路径显示 + 文件系统操作
- 提交与构建信息面板：构建统计、提交历史、贡献热力图、仓库规模、更新日志

### 修复

- CSS 源码泄漏为 body 文本（index.html 注释误匹配占位符）
- FAB 与取景器工具栏重叠导致长按抬手误触「取消」
- git log 管道符转义（%x7c）导致提交列表注入为空
