# 文件查看器（File Viewer）架构决策

目标：**高性价比文件查看**——用尽可能少的代码复用 WebView 原生能力，先建立完整的「文件 → 查看器」闭环，不追求格式大而全。

## 分层

```
文件图标（Desktop.openItem / FAB「打开」）
  └─ FileOpener（file-opener.js）类型判定 + 分派
       ├─ 内部格式 → InternalViewer（viewer.js，Overlay Layer 组件）
       │     ├─ 文本类 read → 渲染（TXT / MD / JSON / SVG）
       │     └─ 媒体类 resolveUri 流式（图片 / 视频 / 音频 / HTML）
       └─ 无法处理 → FileBridge.openExternal → Android ACTION_VIEW Intent
```

- **FileBridge 边界不变**：只做文件系统操作。新增 `resolveUri`（文件 → 可加载 URI）与
  `openExternal`（交外部应用）两个寻址/移交方法，仍属文件系统层，不掺 Viewer 业务。
- **InternalViewer 是独立通用组件**：不引用 Desktop（不持有画布/网格/布局状态），
  通过 `open({path,name,kind,anchor,immersive,onFallback})` + `syncCamera(camera)` 与宿主协作。

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
| MP3/M4A/WAV 等 | `resolveUri` → `<audio controls>` |
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
- **画布实体，具备实体基本性质**：
  - **点击 = 选中**：命中 Viewer 矩形 → 文件保持选中态（选中视觉 = accent 边框 +
    文件 selected），点击不穿透（不清空选中、不触发框选起点）。
  - **长按/拖动 = 移动实体**：`beginDrag → moveBy → endDrag`（世界坐标位移，
    `shiftRect` 纯函数）；拖动取消（1→2 指 / touchcancel）还原到拖动起点。
  - **随画布 transform 平移/缩放**：世界坐标定位（left/top/width/height），
    零相机同步代码。
- **尺寸接近屏幕尺度**：世界尺寸 = 视口宽 - 2×16、视口高 - 96（zoom=1 时贴近屏幕）。
- **桌面手指依旧有效**：不拦截触摸——单指拖动/框选/双击/双指缩放照常作用于画布，
  不在 Viewer 内部创作独立交互模型；Viewer 只是遮挡其背后的文件。
- **打开瞬间**：锚点不可见（可见面积 < 30%）时移到视口中心的世界点，保证首屏可见。
- **顶栏只有一个「全屏预览」按钮**（canvas 态）；全屏按钮亦在 Morph FAB
  选中态操作栏（Viewer 打开时 FAB 只显示 全屏预览 + 关闭预览）。
- **选中态绑定**：打开 = 文件选中（与文件相同的选中/未选中状态）；
  取消选择 = 同时关闭预览；关闭后暂停媒体、清空 iframe、内容清空，文件与画布状态恢复。

## 全屏 = 独立新页面（#viewer-fs-page）

- 「全屏预览」按钮 / FAB「全屏预览」→ Viewer 进入 `#viewer-fs-page`：
  `position: fixed; inset: 0; z-index: 1200`，覆盖整个视口（含顶栏/底栏），
  仿佛打开简洁的新页面；FAB 隐藏（fab-hidden），页头显示返回按钮 + 文件名。
- **退出回到原页面状态**：返回键 / 页头返回按钮 →
  - 桌面空间：回到画布实体预览态（内容与实体位置保留）；
  - folder 容器：关闭 Viewer 回到目录列表（目录上下文保持）。
- 进入时 `history.pushState({_viewerFs})`（buildinfo 同款模式）；返回键链路：
  MainActivity canGoBack → popstate → exitFullscreen；handleSystemBack 兜底。

## 目录（folder 容器）中的 Viewer（直接全屏）

同一 InternalViewer，anchor=null → 打开即进入全屏新页面，退出 = 关闭，
不另写一套「打开器」。

## 关闭链路（Morph FAB / 返回键）

- **Morph FAB 选中态操作栏**：Viewer 打开时显示「全屏预览」「关闭预览」两项
  （文件操作隐藏，预览焦点模式）；Viewer 关闭后恢复 打开/复制/剪切/重命名/取消选择。
- **取消选择** = 同时关闭预览（Viewer 与文件选中态绑定）。
- **返回键**：`App.handleSystemBack` 查看器优先（全屏 → 退出全屏；预览 → 关闭）
  → Drawer → 面板 → 文件导航后退。

## 状态与测试

- 纯函数（可单测）：`Markdown.render/inline/safeUrl`、`FileOpener.kindFor/extOf`、
  `InternalViewer.calcCardRect/immersiveRect/visibleRatio/jsonToNodes`
- 单元测试：`tests/test-markdown.js` / `tests/test-file-opener.js` / `tests/test-viewer.js`
- 无头 UI 验证（注入模拟 FileBridge）：
  - `tools/ui/viewer-verify.js`：画布实体定位/transform 跟随/点击不反选/全屏新页面/
    FAB 关闭/返回键/HTML 隔离/各类型渲染
  - `tools/ui/viewer-entity-verify.js`：实体交互性质——点击选中/拖动位移/取消还原/
    全屏进出/位置保留/选中态绑定关闭
  - `tools/ui/viewer-folder-verify.js`：folder 全屏新页面 + 返回键退出关闭 + 目录保持

## 已知限制（本阶段接受）

- Markdown：无表格/嵌套列表/图片/HTML 直通；链接点击提示「暂不支持跳转」
- HTML：SAF 模式下同目录相对资源无法解析（file:// 模式注入 `<base>` 可加载）
- 文本仅 UTF-8（桥内 read 编码固定）
- 视频播放依赖系统内核支持的编解码 + WebView 硬件加速
  （manifest 已加 `android:hardwareAccelerated="true"`；失败走外部应用兜底）
- 画布实体在低 zoom 下内容随实体缩小（实体行为）；需要阅读时点「全屏预览」
