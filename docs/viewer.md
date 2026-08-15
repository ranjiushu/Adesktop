# 文件查看器（File Viewer）架构决策

目标：**高性价比文件查看**——用尽可能少的代码复用 WebView 原生能力，先建立完整的「文件 → 查看器」闭环，不追求格式大而全。

## 三模块 × 两状态

InternalViewer 按文件语义分三个模块，每个模块都有两个状态：

| 模块 | kind | Viewer 态（画布实体） | 完整预览态（全屏新页面） |
|------|------|----------------------|------------------------|
| **text** 纯文本 | txt/log/ini/conf/cfg/csv/bat/sh | 3:4 竖版卡片，视觉中心展开 | reader：字号缩放 + 自动换行 |
| **parsed** 文本解析 | md/json/html | 同 text（3:4 + 视觉中心） | doc：成熟滚动渲染（md 排版/json 折叠树/html iframe） |
| **media** Web 友好媒体 | image/video/svg + audio | 图/视频/svg 原始比例；音频 3:4 封面卡片 | media：黑底 contain 全屏 |

- **Viewer 态**：画布实体（世界坐标定位），随画布 transform 平移/缩放；点击选中、
  拖动移动；手势照常作用于画布。
- **完整预览态**：`#viewer-fs-page` 独立新页面（相册式），返回键/页头返回退出回到原状态。
- **多实例**：`open()` 每次创建独立实例（各自 DOM/状态/拖动），同时打开多个互不干扰。
  同一时刻最多一个实例处于 fullscreen 态（`#viewer-fs-page` 为单例容器）。
- 纯函数可单测：`moduleFor`（kind→模块）、`cardIsPortrait`（是否 3:4）、
  `anchorIsCenter`（是否视觉中心）、`cardSize34`（3:4 竖版尺寸）、`visualCenter`（相机中心世界点）。

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

## Desktop 空间（根目录）中的 Viewer（画布实体）

- Viewer **不属于网格**：不参与布局、排序、框选、碰撞；DOM 上位于
  `#desktop-canvas` 内 grid 之后（z-index 5），天然遮挡其背后的文件。
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
- **锚点**（按模块）：text/parsed 打开瞬间锚点 = **视觉中心**（相机中心世界坐标，
  `visualCenter`，保证首屏居中）；media 锚点 = 文件位置（不可见面积 < 30% 时才移视觉中心兜底）。
  **级联错位**：视觉中心类（text/parsed）每次打开向右下偏移 24px（Windows 窗口风格），
  打开多个自然错开。
- **文件锁定（Windows 式）**：被 Viewer 打开的文件进入锁定状态（图标 🔒 标记）——
  禁止复制/剪切/重命名/移动（拖入文件夹），**拖动摆放（改布局位置）仍可**；
  关闭对应 Viewer 即解除。多实例：多个文件可同时锁定（`Set` 集合）。
- **框选遮挡**：被 Viewer 覆盖的文件图标不参与框选（Viewer 遮挡语义）。
- **桌面手指依旧有效**：不拦截触摸——单指拖动/框选/双击/双指缩放照常作用于画布，
  不在 Viewer 内部创作独立交互模型；Viewer 只是遮挡其背后的文件。
- **顶栏只有文件名**（canvas 态无任何按钮）；全屏入口在 Morph FAB（Viewer 选中时
  展开 全屏预览 / 关闭预览，文件操作隐藏）。打开未选中时 FAB 收起，点击 Viewer
  选中后 FAB 才展开预览操作。

## 完整预览 = 相册式独立新页面（#viewer-fs-page）

- FAB「全屏预览」→ 像相册打开某张照片/某个视频一样，进入独立的 `#viewer-fs-page`
  （`fixed inset 0; z-index 1200` 覆盖全视口，FAB 隐藏）——**不绑定 Viewer 概念**：
  - media（图片/视频/音频/SVG）：黑底沉浸、内容 contain 居中自适应；
  - doc（MD/JSON/HTML）：浅色阅读排版；
  - **text 的 reader 工具条**（仅纯文本完整预览态显示）：字号缩放（A−/A+，0.8~2.0 步进 0.2）
    + 自动换行开关（`pre-wrap` ↔ `pre` 横向滚动）。
- 页头：返回按钮 + 文件名（媒体态半透明深色、文档态浅色）。
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
  （文件操作隐藏，预览焦点模式）；文件选中时恢复 打开/复制/剪切/重命名/取消选择。
- **关闭预览** = 关闭「选中的」Viewer + 解除其文件锁定（`Desktop.closeViewer` 出口）。
- **取消选中 ≠ 关闭**：点 Viewer 外部取消 Viewer 选中（脆弱/临时），Viewer 与锁定保持。
- **返回键**：`App.handleSystemBack` 优先级——全屏态 Viewer → 退出全屏；有选中
  （Viewer 或文件）→ 取消选中；Drawer → 面板 → 文件导航后退。**返回键不关闭 Viewer**
  （Viewer 是画布实体，关闭走 FAB「关闭」，删除语义）。

## 状态与测试

- 纯函数（可单测）：`Markdown.render/inline/safeUrl`、`FileOpener.kindFor/extOf`、
  `InternalViewer.moduleFor/cardIsPortrait/anchorIsCenter/cardSize34/visualCenter/
  visibleRatio/fitAspectRect/jsonToNodes/rectHitWorld`
- 单元测试：`tests/test-markdown.js` / `tests/test-file-opener.js` / `tests/test-viewer.js`
- 无头 UI 验证（注入模拟 FileBridge）：
  - `tools/ui/viewer-verify.js`：画布实体定位/transform 跟随/点击不反选/全屏新页面/
    FAB 关闭/返回键/HTML 隔离/各类型渲染
  - `tools/ui/viewer-entity-verify.js`：实体交互性质——点击选中/拖动位移/取消还原/
    全屏进出/位置保留/选中态绑定关闭
  - `tools/ui/viewer-folder-verify.js`：folder 全屏新页面 + 返回键退出关闭 + 目录保持
  - `tools/ui/viewer-modules-verify.js`：三模块 × 两状态——3:4 卡片/视觉中心锚点/
    reader 工具条（缩放+换行）/音频封面卡片/框选触发选中/模块映射

## 已知限制（本阶段接受）

- Markdown：无表格/嵌套列表/图片/HTML 直通；链接点击提示「暂不支持跳转」
- HTML：SAF 模式下同目录相对资源无法解析（file:// 模式注入 `<base>` 可加载）
- 文本仅 UTF-8（桥内 read 编码固定）
- 视频播放依赖系统内核支持的编解码 + WebView 硬件加速
  （manifest 已加 `android:hardwareAccelerated="true"`；失败走外部应用兜底）
- 音频封面为占位图标（不解码内嵌封面，符合「不自行实现媒体解码器」原则）
- 画布实体在低 zoom 下内容随实体缩小（实体行为）；需要阅读时点「全屏预览」
