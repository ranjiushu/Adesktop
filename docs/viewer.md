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

## Desktop 空间（根目录）中的 Viewer

- Viewer **不属于网格**：位于 `#desktop-viewport` 内、画布之上的 `#viewer-layer`
  （z-index 8，高于框选矩形 4 / 拿起图标 6），不参与布局、排序、框选、碰撞。
- **锚点跟随**：以被打开文件的世界坐标（`positions[path]`）为锚，卡片中心对齐锚点；
  画布平移/缩放/Home 飞行时 `syncCamera(camera)` 同步（hook：手势 onUpdate、
  animateCameraTo 帧、applyCameraForPath）。
- **尺寸接近屏幕尺度，不随世界缩放**：卡片 = 视口宽 - 2×16、高 - 64（让位顶栏/底栏），
  zoom 变化只改位置不改尺寸。
- **打开瞬间**：锚点不可见（可见面积 < 30%）时居中定位，保证首屏可见。
- **交互拦截**：viewer-layer 在 capture 阶段 stopPropagation 触摸事件，桌面手势层收不到；
  内部滚动/媒体控件正常。
- **关闭恢复**：暂停媒体、清空 iframe、清空内容、隐藏层；文件与画布状态完全恢复。

## 目录（folder 容器）中的 Viewer

同一 InternalViewer，宿主形态不同：anchor=null → `immersive` 占满内容区，
表现为沉浸式/全屏查看（不另写一套「打开器」）。返回键关闭 Viewer，目录上下文保持。

## 返回键链路

`App.handleSystemBack`：查看器打开 → 关闭查看器（最优先）→ Drawer → 面板 → 文件导航后退。

## 状态与测试

- 纯函数（可单测）：`Markdown.render/inline/safeUrl`、`FileOpener.kindFor/extOf`、
  `InternalViewer.calcCardRect/immersiveRect/visibleRatio/jsonToNodes`
- 单元测试：`tests/test-markdown.js` / `tests/test-file-opener.js` / `tests/test-viewer.js`
- 无头 UI 验证（注入模拟 FileBridge）：`tools/ui/viewer-verify.js`（锚定/跟随/缩放/关闭/JSON/HTML 隔离/TXT）
  + `tools/ui/viewer-folder-verify.js`（沉浸式 + 返回键 + 目录保持）

## 已知限制（本阶段接受）

- Markdown：无表格/嵌套列表/图片/HTML 直通；链接点击提示「暂不支持跳转」
- HTML：SAF 模式下同目录相对资源无法解析（file:// 模式注入 `<base>` 可加载）
- 文本仅 UTF-8（桥内 read 编码固定）
- 视频播放依赖系统内核支持的编解码（失败走外部应用兜底）
