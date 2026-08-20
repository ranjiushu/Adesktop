# 文件查看器（File Viewer）架构决策

目标：**高性价比文件查看**——用尽可能少的代码复用 WebView 原生能力，先建立完整的「文件 → 查看器」闭环，不追求格式大而全。

## 三模块 × 两状态

InternalViewer 按文件语义分三个模块，每个模块都有两个状态：

| 模块 | kind | Viewer 态（画布实体） | 完整预览态（全屏新页面） |
|------|------|----------------------|------------------------|
| **text** 纯文本 | txt/log/ini/conf/cfg/csv/bat/sh | 3:4 竖版卡片，原地展开 | reader：字号缩放 + 自动换行 |
| **parsed** 文本解析 | md/json/html | 同 text（3:4 + 原地展开） | doc：成熟滚动渲染（md 排版/json 折叠树/html iframe） |
| **media** Web 友好媒体 | image/video/svg + audio | 图/视频/svg 原始比例；音频 3:4 封面卡片，均原地展开 | media：黑底 contain 全屏 |

- **Viewer 态**：画布实体（世界坐标定位），随画布 transform 平移/缩放；点击选中、
  拖动移动；手势照常作用于画布。
- **完整预览态**：`#viewer-fs-page` 独立新页面（相册式），返回键/页头返回退出回到原状态。
- **多实例**：`open()` 每次创建独立实例（各自 DOM/状态/拖动），同时打开多个互不干扰。
  同一时刻最多一个实例处于 fullscreen 态（`#viewer-fs-page` 为单例容器）。
- 纯函数可单测：`moduleFor`（kind→模块）、`cardIsPortrait`（是否 3:4）、
  `anchorRect`（原地展开矩形 + 视口夹取）、`cardSize34`（3:4 竖版尺寸）。

## 分层

```
文件图标（Desktop.openItem / FAB「打开」）
  └─ FileOpener（file-opener.js）类型判定 + 分派
       ├─ 内部格式 → InternalViewer（viewer.js，Overlay Layer 组件）
       │     ├─ text  纯文本 read → 渲染（TXT）
       │     ├─ parsed 解析渲染（MD / JSON / HTML）
       │     └─ media 媒体 resolveUri 流式（图片 / 视频 / 音频 / SVG）
       └─ 无法处理 → FileBridge.openExternal → Android ACTION_VIEW Intent
```

- **FileBridge 边界不变**：只做文件系统操作。新增 `resolveUri`（文件 → 可加载 URI）与
  `openExternal`（交外部应用）两个寻址/移交方法，仍属文件系统层，不掺 Viewer 业务。
- **InternalViewer 是独立通用组件**：不引用 Desktop（不持有画布/网格/布局状态），
  通过 `open({path,name,kind,anchor,camera,onFallback})` 与宿主协作。

## 支持格式（第一阶段）

| 类型 | 方式 |
|------|------|
| TXT / LOG / INI / CSV 等 | `FileAPI.read` → `<pre>`（UTF-8，10MB 护栏由桥内已有） |
| MD / Markdown | `FileAPI.read` → 自研 mini 渲染器（markdown.js，纯函数，零依赖） |
| JSON | `FileAPI.read` → JSON.parse → 可折叠树（`<details>`，textContent 构建防注入） |
| HTML / HTM | `FileAPI.read` + `resolveUri` → `iframe srcdoc` + `sandbox="allow-scripts"` |
| SVG | `FileAPI.read` → `data:image/svg+xml` 注入 `<img>`（img 内 SVG 不执行脚本） |
| JPG/PNG/WebP/GIF/BMP | `resolveUri` → `<img src=content://…>` |
| MP4/WebM 等 | `resolveUri` → `<video controls>` |
| MP3/M4A/WAV 等 | `resolveUri` → 3:4 封面卡片（占位封面 + `<audio controls>`） |
| 其他（PDF/DOCX/ZIP…） | `FileBridge.openExternal` → 系统应用 |

媒体一律 **URI 流式**（content:// 或 file://），不经 `read` 搬入 JS 内存；
内部预览失败时提供「用其他应用打开」兜底（onFallback → openExternal）。

## HTML 的 Java Bridge 隔离

HTML 在 WebView 内渲染，其脚本必须无法触达 `window.FileBridge`：

- `iframe srcdoc` + `sandbox="allow-scripts"`（**不带** `allow-same-origin`）
  → iframe 为 opaque origin，脚本跨源访问 `window.parent.FileBridge` 抛 SecurityError。
- 无头 Chromium 实测：iframe 内脚本 `try { window.parent.FileBridge }` 捕获到 SecurityError
  （data-leak = BRIDGE_BLOCKED），Java 桥不可达。
- 网络/弹窗/顶层导航默认被 sandbox 禁止（如需表单/弹窗能力后续按需放开）。

## Desktop 空间（根目录）中的 Viewer（文件的「打开」状态）

**核心语义（2026-08-20 重构）**：Viewer 不是独立窗口实体，而是**文件的「打开」状态**
——打开：文件在原地变成 Viewer（图标退出网格渲染，原格子当场释放为普通空格）；
拖动 Viewer = 拖动文件本身（位置真相 = Viewer 世界矩形，无第二套坐标）；
关闭：Viewer 变回图标——按窗口位置吸附最近网格格落位（被占自动避让），
图标带着落位动画（260ms）飞入格位。旧「两个实体」时代的协调代码整体删除：
图标→窗口单向锚定（syncRectForPath）、会话恢复贴窗对齐、锁定集合 + 🔒 角标、
整理桌面的「钉子户」占位避让——它们的共同前提（图标与窗口并存）已不存在。

- **持久化（Viewer 只能通过手动关闭）**：打开状态 + 世界坐标矩形经
  `App.ViewerStore`（viewer-store.js）持久化——localStorage 缓存 +
  桌面空间目录隐藏文件 `.adesktop-viewers.json`（文件即真相，随目录迁移）。
  打开/关闭/拖动结束/媒体自适应都会触发落盘（`InternalViewer.setPersistListener`
  注入，见 desktop-viewer-link.js `init`）；同一监听兼做**桌面实体集合 diff**
  （集合变化 → 网格重渲染：图标退场/重现；拖动/自适应只改矩形不重渲染）。
  app 重启后 `restoreViewers`（refresh 列表加载后调用）恢复上次会话的打开态
  Viewer：持久化矩形原样恢复（无贴窗对齐——位置真相唯一），文件已删除/不在
  当前目录的记录跳过。folder 容器内的全屏预览不持久化（随退出关闭）。
  关闭 Viewer 的唯一途径 = 手动（Morph FAB「关闭预览」）。
- **打开 = 退出网格**：打开态文件不是网格成员——不渲染图标、不参与布局/排序/
  框选/碰撞/整理；其原格子是普通空格（整理桌面自然填掉）。DOM 上 Viewer 位于
  `#desktop-canvas` 内 grid 之后（z-index 5），天然遮挡其背后的文件（被盖住的
  图标不参与框选）。
- **画布实体，具备实体基本性质**（与文件图标手势统一）：
  - **打开不选中**：打开文件动作不触发选中，Viewer 初始为未选中态。
  - **点击/框选触发选中（单选）**：点击 Viewer = 单选选中该实例（其余取消，
    accent 边框视觉）；框选划过未选中 Viewer = 触发选中；点击外部 = 取消选中，
    **Viewer 保持打开**。
  - **选中可直接拖动**：已选中 Viewer 拖动 = 直接拿起移动实体；未选中 Viewer
    拖动 = 框选（不直接拿起）；长按未选中 = 先选中再拿起。
  - **长按/拖动 = 移动实体**：`beginDrag → moveBy → endDrag`（世界坐标位移，
    `shiftRect` 纯函数）；拖动取消（1→2 指 / touchcancel）还原到拖动起点。
  - **随画布 transform 平移/缩放**：世界坐标定位（left/top/width/height），
    零相机同步代码。
- **尺寸**（按模块）：
  - text/parsed：**3:4 竖版卡片**（`cardSize34`，宽:高=3:4，约束视口内尽量大）；
  - media 图/视频/svg：满屏初始 → 加载后按固有宽高比自适应（`fitAspectRect`，中心点不变）；
  - media 音频：3:4 封面卡片（占位封面 + 原生播放控制）。
- **原地展开（锚点）**：canvas 态卡片左上锚定**图标位置**（anchor = 图标左上世界
  坐标，即 `C.positions[path]`）——「文件变成 Viewer」的视觉兑现；卡片超出视口时
  自动夹回可视区（`anchorRect` 纯函数：16px 边距 + 顶部栏预留 96px，zoom 换算；
  rotation=90 方向复杂跳过夹取）。此前 text/parsed 的视觉中心锚点 + 级联错位
  （窗口凭空出现时代的产物）已删除。
- **锁定 = 派生态（Windows 式）**：打开态文件禁止复制/剪切/重命名/移动（拖入
  文件夹）；关闭对应 Viewer 即恢复。锁定无独立集合——`isLockedPath(path)` 直接
  查询 InternalViewer 是否存在该路径的打开实例，天然不会失步；实例关闭即解除。
  **整理桌面**：打开态文件不是网格成员——不参与整理、不留占位格（原格子是普通
  空格，整理自然填掉）；其它文件拖动/避让无需特殊处理（打开态文件无图标无边界，
  不参与网格碰撞）。
- **框选遮挡+混合多选**：被 Viewer 覆盖的文件图标不参与框选（Viewer 遮挡语义）；Viewer 世界矩形与框选矩形相交 → 加入 `C.selection`（支持框选同时选中多个 Viewer + 文件）。
- **桌面手指依旧有效**：不拦截触摸——单指拖动/框选/双击/双指缩放照常作用于画布，
  不在 Viewer 内部创作独立交互模型；Viewer 只是遮挡其背后的文件。
- **文件名栏在内容区下方**（canvas 态：底部信息条，无任何按钮，仅文件名）；全屏入口在
  Morph FAB（`C.selection` 含 Viewer 路径时展开 关闭预览 / 恰好单选 Viewer 时 显示全屏预览）。
  **混合选中 FAB**：`C.selection` 同时含文件+Viewer 时，文件操作作用于未锁定成员、锁定项跳过并
  toast 提示；关闭预览批量关闭 `C.selection` 中的 Viewer。点击 Viewer 外部 = 清空 `C.selection`（FAB 收起）。
- **未选中隐藏文件名栏**：canvas 态 Viewer 未选中时整条文件名栏隐藏（含边框/背景），
  内容区占满整卡；选中（点击/框选/长按）时显示。拖动必然已选中，文件名栏拖动全程可见
  （命中判定基于世界坐标 rect，含整卡区域，显隐不影响手势）。
- **media 类（图/视频/SVG）文件名栏 = 覆盖式**：选中时文件名栏以半透明浮层 absolute
  覆盖在卡片底部——不参与 flex 占位，**不改变媒体缩放比例**（fitAspectRect 结果不动），
  盖住底部少量内容可接受。audio 例外（3:4 封面卡片底部是原生播放控制条，保持占位式
  不遮挡）。
- **静态预览（2026-08-20 交互模型统一）**：canvas 态**非音视频模块内容零交互**
  （`viewer-card-static`：内容区 `pointer-events:none` + `overflow:hidden`）——
  Viewer 态就是「图片式预览」，选中/多选/移动等实体手势与文件图标完全一致；
  内容操作（滚动/阅读/网页交互）只在全屏预览态。**视频/音频保留原生控件**
  （唯一例外，不标记 static）。website 网页 canvas 态同样静态化（海报），
  「拖文件到网页设待上传」走世界坐标命中、不受影响。
- **拖动手柄已删除（2026-08-20）**：手柄原是「两套选中模型」的补丁（未选中 Viewer
  拖动 = 框选，需辅助入口直接拿起）。交互模型与文件图标统一后拿起语义自然成立——
  **已选中直接拖、未选中长按拿起**，与文件图标同一套手势，手柄及其基础设施
  （屏幕层 DOM/相机每帧同步/rotation=90 换算/手势命中分支）整体移除。

## 完整预览 = 相册式独立新页面（#viewer-fs-page）

- FAB「全屏预览」→ 像相册打开某张照片/某个视频一样，进入独立的 `#viewer-fs-page`
  （`fixed inset 0; z-index 1200` 覆盖全视口，FAB 隐藏）——**不绑定 Viewer 概念**：
  - media（图片/视频/音频/SVG）：黑底沉浸、内容 contain 居中自适应；
  - doc（MD/JSON/HTML）：浅色阅读排版；
  - **text 的 reader 工具条**（仅纯文本完整预览态显示）：字号缩放（A−/A+，0.8~2.0 步进 0.2）
    + 自动换行开关（`pre-wrap` ↔ `pre` 横向滚动）。
- 页头：返回按钮 + 文件名（媒体态半透明深色、文档态浅色）。
- **安全区**：`#viewer-fs-page` 让出 `--safe-top`（状态栏）与 `--safe-bottom`
  （导航栏）——卡片内容不顶到刘海/手势条；媒体态黑底铺满全屏（含安全区），
  内容 contain 居中在安全区内。
- **退出回到原页面状态**：返回键 / 页头返回按钮 →
  - 桌面空间：回到画布实体预览态（内容与实体位置保留）；
  - folder 容器：关闭 Viewer 回到目录列表（目录上下文保持）。
- 进入时 `history.pushState({_viewerFs})`（buildinfo 同款模式）；返回键链路：
  MainActivity canGoBack → popstate → exitFullscreen；handleSystemBack 兜底。

## 目录（folder 容器）中的 Viewer（直接全屏）

同一 InternalViewer，anchor=null → 打开即进入全屏新页面，退出 = 关闭，
不另写一套「打开器」。目录切换：canvas 态 Viewer（根目录打开的画布实体）保留
（隐藏于 folder 视图，退回根目录恢复）；全屏态 Viewer 退出全屏。

## 关闭链路（Morph FAB / 返回键）

- **Morph FAB（Viewer 实体选中时）**：显示「全屏预览」「关闭预览」两项
  （文件操作隐藏，预览焦点模式）；文件选中时恢复 打开/复制/剪切/重命名（取消选择已移除——
  FAB 展开 ⇔ 选中一致：关闭 Morph FAB 即取消选中）。
- **关闭预览** = 批量关闭 `C.selection` 中的 Viewer：实例关闭 → onClose（`handleViewerClosed`）
  按窗口位置吸附落位回网格 + 落位动画 → 实体集合 diff 触发图标重现（`Desktop.closeViewer` 出口）。
- **取消选中 ≠ 关闭**：点 Viewer 外部清空 `C.selection`（文件+Viewer 统一），Viewer 与锁定保持。
- **返回键**：`App.handleSystemBack` 优先级——全屏态 Viewer → 退出全屏；`C.selection`
  非空 → 清空选中（文件+Viewer 统一）；Drawer → 面板 → 文件导航后退。**返回键不关闭 Viewer**
  （Viewer 是画布实体，关闭走 FAB「关闭」，删除语义）。

## 状态与测试

- 纯函数（可单测）：`Markdown.render/inline/safeUrl`、`FileOpener.kindFor/extOf`、
  `InternalViewer.moduleFor/cardIsPortrait/anchorRect/cardSize34/
  visibleRatio/fitAspectRect/jsonToNodes/rectHitWorld`
- 单元测试：`tests/test-markdown.js` / `tests/test-file-opener.js` / `tests/test-viewer.js` /
  `tests/test-viewer-drag.js`（无手柄新模型全链路：选中直接拖/未选中框选/长按拿起）/
  `tests/test-desktop-viewerlink-lock.js`（打开态生命周期：派生锁定/落位/集合 diff 渲染/落位动画）/
  `tests/test-viewer-lock-sync.js`（打开态集成：双击打开图标退场/整理不参与/关闭落位避让）
- 无头 UI 验证（注入模拟 FileBridge）：
  - `tools/ui/viewer-verify.js`：画布实体定位/transform 跟随/点击不反选/全屏新页面/
    FAB 关闭/返回键/HTML 隔离/各类型渲染
  - `tools/ui/viewer-entity-verify.js`：实体交互性质——点击选中/拖动位移/取消还原/
    全屏进出/位置保留/选中态绑定关闭/静态预览（canvas 零交互 ⇄ 全屏可交互）
  - `tools/ui/viewer-folder-verify.js`：folder 全屏新页面 + 返回键退出关闭 + 目录保持
  - `tools/ui/viewer-modules-verify.js`：三模块 × 两状态——3:4 卡片/原地展开锚点/
    reader 工具条（缩放+换行）/音频封面卡片/框选触发选中/模块映射

## 已知限制（本阶段接受）

- Markdown：无表格/嵌套列表/图片/HTML 直通；链接点击提示「暂不支持跳转」
- HTML：SAF 模式下同目录相对资源无法解析（file:// 模式注入 `<base>` 可加载）
- 文本仅 UTF-8（桥内 read 编码固定）
- 视频播放依赖系统内核支持的编解码 + WebView 硬件加速
  （manifest 已加 `android:hardwareAccelerated="true"`；失败走外部应用兜底）
- 音频封面为占位图标（不解码内嵌封面，符合「不自行实现媒体解码器」原则）
- 文本自动换行为主流单词边界换行（`overflow-wrap: break-word` + `word-break: normal`），
  长单词不拆散、超长行在容器边缘断开
- 画布实体在低 zoom 下内容随实体缩小（实体行为）；canvas 态内容不滚动不交互
  （静态预览）——阅读/滚动/网页操作一律进「全屏预览」
