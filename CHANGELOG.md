# Desktop 更新日志

## 0.1.0（2026-08-13）

### 初始化与文件系统核心

- 项目骨架：src 拆分源码 + 构建管线（build-web/minify/verify）+ 测试套件 + Android WebView 壳
- 真实文件系统核心：SAF 授权根目录 + FileBridge（list/read/write/mkdir/delete/rename/rootInfo）
- 桌面渲染：以文件系统为数据源的图标网格

### 交互层

- Morph FAB：短按展开 Speed Dial（新建文件夹/新建文件/刷新/切换根目录），长按激活取景器
- Morph FAB 恢复初始形态（36px 圆形、距右 28px、20px 图标），Speed Dial 展开保留
- 底部工具栏（屏高 1/8）：5 个矢量图标按钮，中间加号弹出新建对话框，其余 UI 占位
- 新建对话框：输入名称，点「文件/文件夹」按钮按对应类型创建；
  名称原样使用（不自动补 .txt），重名自动加序号（含扩展名拆分）
- Drawer 手势（移植 LexiCull 手感）：底栏右划跟手拉出 + Drawer 上跟手关闭，
  松手决策（滑出 30% 宽度或末段速度 > 0.3px/ms 的 fling 语义）
- 元素取景器（移植自 LexiCull）：长按 FAB 800ms 激活，DOM 元素选取与属性查看
- 顶栏汉堡 + Drawer 工具栏：根目录路径显示 + 文件系统操作
- 提交与构建信息面板：构建统计、提交历史、贡献热力图、仓库规模、更新日志

### 修复

- CSS 源码泄漏为 body 文本（index.html 注释误匹配占位符）
- FAB 与取景器工具栏重叠导致长按抬手误触「取消」
- git log 管道符转义（%x7c）导致提交列表注入为空
- 原生桥命名空间错位：切换根目录与震动在真机失效（bridge.js 误用 Android.*，改走 FileBridge 并补 vibrate 桥）
- 系统返回键链路：不依赖 pushState 是否被 WebView 计入 canGoBack，改经 App.handleSystemBack 逐级消费（Drawer → 整页面板）
- 构建注入 JSON 未转义 `</`：提交信息/文件名含 `</script>` 可闭合 script 块，统一转义
- build-info 排序后详情索引错位（__origIdx 重渲染被覆盖）
- 私有目录越界校验前缀误判（/root 命中 /root2）、read 无大小上限（10MB 护栏）
- 新建对话框输入框无法触摸聚焦：bindPress 的 touchstart preventDefault 阻断
  触摸聚焦（INPUT/TEXTAREA/SELECT/contentEditable 豁免）
- 新建对话框打开后键盘不拉起：延迟聚焦脱离用户手势上下文，改为同步聚焦
  （加号 touchend 手势链内）+ 延迟补焦兜底；MainActivity 补 setNeedInitialFocus(true)，
  并在触摸 ACTION_UP 后 100ms 借手势窗口请求 IME（SHOW_IMPLICIT，Android 12+ 会丢弃
  非手势 showSoftInput；无输入框聚焦时 no-op）
- Drawer 开启震动移除（用户指定关闭开启/关闭震动反馈）
- 新建对话框创建/取消后自动收起键盘：close() 释放输入框焦点（blur），
  WebView 内核检测焦点离开自动隐藏 IME
- 「提交与构建」入口从 Drawer 底部固定区移入「操作」区（普通工具项，
  位于切换根目录之后），不再始终钉在 Drawer 底部
- Morph FAB 始终可见：z-index 提升至页面层最顶（1500/backdrop 1499/Speed Dial 1501，
  高于 Dialog 1300 / buildinfo 1200 / Drawer 1100），任意面板打开时 FAB 仍可见可点；
  移除取景器运行时注入的 z-index:1002!important 旧逻辑（该注入反把 FAB 压回 1002
  被 Dialog/buildinfo 盖住）
- SAF 创建文件自动追加 .txt：DocumentFile.createFile 固定传 text/plain，
  ExternalStorageProvider 按 MIME 补齐扩展名（无扩展名 → .txt、「哈哈哈.js」→
  「哈哈哈.js.txt」）；改为按扩展名映射 MIME（.js → application/javascript），
  无扩展名/未知扩展名传空 MIME（Provider 对空 MIME 不追加）

### 工程

- drawer-swipe 纯函数单测：segmentVelocity/windowVelocity/decideDrawerSettle（22 断言）
- verify-bottom-bar E2E：底栏渲染/对话框创建/手势跟手拉出/跟手关闭/小幅弹回（16 项）
- build-web.sh --strict 体积棘轮：超基线（dist/.size-baseline）130% 拦截膨胀
- JS 变量声明统一 var → let（P1 铁律）
- 构建信息面板无障碍：drawer/buildinfo 的 aria-hidden 随开关动态切换
