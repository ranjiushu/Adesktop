# Desktop 更新日志

## Unreleased

### FileBridge 拆分 7 模块（门面 + 委托）（2026-08-17）

- **FileBridge.java 1206 行 → 265 行薄门面**：22 个 `@JavascriptInterface` 方法签名一字
  不动（`window.FileBridge` API 面不变），实现按职责委托给新模块
- 新模块：`BridgeContext`（共享上下文 + 回调管道 + 路径工具）、`FileStore`（list/read/
  write/mkdir/delete/rename）、`TransferEngine`（move/copy/cancel + 进度上报 + 半成品清理）、
  `ThumbnailService`（缩略图）、`AppBridge`（已安装应用）、`ExternalOpen`（resolveUri/
  openExternal/openUrl）、`UploadBridge`（网页上传）
- 关键不变式：文件操作仍全部串行于 `BridgeContext` 同一单线程 executor；`cancelRequested`
  取消标志与 copy 循环竞态语义原样保留；`cancelTransfer` 仍不进 executor（尽快中止语义）
- 壳层零改动：`MainActivity` 的 `new FileBridge(this, webView, rootUri)` 签名不变；
  前端 `bridge.js`/`file-api.js`/测试套件零改动
- 验证：`verify.sh` 10/10 全绿 + Gradle assembleRelease 构建通过 + APK 归档

## Unreleased

### Viewer 拖动手柄（辅助拖动区）（2026-08-16）

- **新增拖动手柄**：每个 canvas 态 Viewer 卡片底部中心下方悬浮 36×6px 小横条
  （屏幕层固定尺寸不随画布 zoom 缩放，间距 14px，始终可见含未选中，选中变 accent 色）
- **按住手柄 = 自动选中 + 直接拖动**：不受选中态限制的辅助拖动入口——未选中 Viewer
  也直接拿起移动实体（不必先点击/长按），拖动结束选中保持、点外部取消；轻点手柄 =
  仅选中（与点击卡片语义一致，不改变现有选中/框选逻辑）
- **固定屏幕尺寸实现**：`handleScreenRect`（屏幕坐标渲染）/ `handleWorldRect`（世界
  坐标命中）纯函数，相机变化由 `syncHandles` 跟随（desktop.js onUpdate 每帧驱动），
  卡片移动/媒体自适应后 `applyCanvasRect` 同步；目录切换 suspend/resume、全屏进出
  时手柄同步隐藏/恢复；元素 pointer-events 穿透（命中全走手势层世界坐标判定）
- 手势接线：`hitTest` 手柄优先命中 → `viewer-handle` 类型；gesture 状态机
  `viewer-handle` 位移超阈值直接进入拖拽（不进框选）；`handleTap`/`handleLongPress`/
  `handleDragStart` 处理手柄（自动选中 + beginDrag）
- 测试/文档：`test-viewer.js` 增 handleScreenRect/handleWorldRect 纯函数断言；
  `viewer-entity-verify.js` 增 5b（手柄存在固定尺寸/未选中直接拖动/自动选中/轻点仅选中）；
  `docs/viewer.md` + `docs/interaction.md` 同步

### 画布缩放范围放宽 0.4~2.5 → 0.3~3（2026-08-16）

- `desktop-camera.js`：`ZOOM_MIN` 0.4 → 0.3、`ZOOM_MAX` 2.5 → 3（双指缩放/相机
  创建/动画端点统一过 `clampZoom`）
- 测试同步：`test-desktop-camera.js` 边界断言（0.3/3）、`test-desktop-gesture-dom.js`
  捏合 clamp 断言 scale(3)、`scripts/verify-home.js` 4c 注释修正为实际 zoom ≈2.56
  （旧上限 2.5 时被 clamp，新上限 3 下不再截断）
- 文档同步：`docs/interaction.md`（缩放范围 0.3 ~ 3 ×2 处）、
  `docs/bridge-and-data-contract.md`（`[0.3, 3]`）

### Viewer media 文件名栏改覆盖式（2026-08-16）

- **media 类（image/video/svg）文件名栏 = absolute 覆盖在卡片底部**：不参与 flex 占位，
  选中显示文件名时**不改变媒体缩放比例**（fitAspectRect 结果不动），盖住底部少量内容
  可接受；半透明深色浮层 + 白色标题保证可读性。viewer.js 新增 `canvasCardClass()`
  按 kind 给 canvas 态卡片加 `viewer-card-media` 标记类（audio 除外：3:4 封面卡片底部
  是原生播放控制条，保持占位式不遮挡）
- 文档/验证同步：`docs/viewer.md` 增 media 覆盖式说明；`viewer-modules-verify.js`
  新增 5b（media 覆盖式：未选中隐藏/absolute 覆盖/卡片尺寸与媒体比例不变）与
  5c（文档类仍占位式）断言

### Viewer 画布实体：文件名栏移至底部 + 未选中隐藏（2026-08-16）

- **文件名栏移到内容区下方**：canvas 态 Viewer 的 `.viewer-header` 用 CSS `order` 从卡片
  顶部改到内容区下方（DOM 顺序不变；全屏态 `.viewer-card-fullscreen` 不受影响仍为顶栏，
  返回按钮 + 工具条不变），分隔线改到栏上方
- **未选中隐藏文件名栏**：canvas 态未选中（打开初始/点外部取消/框选未命中）时整条文件名
  栏 `display: none`，内容区占满整卡；选中（点击/框选/长按）时显示——纯 CSS 随
  `viewer-card-selected` 类驱动，选中与拖动解耦（拖动必然已选中，拖动中保持可见；
  命中判定基于世界坐标 rect，显隐不影响手势/框选/拖动）
- 文档同步：`docs/viewer.md`「文件名栏在内容区下方 + 未选中隐藏」；
  `tools/ui/viewer-entity-verify.js` 增断言（未选中隐藏 / 选中时栏在内容区下方 / 取消隐藏）

### 网站快捷方式 + 网页文件上传桥（2026-08-16）

- **网站快捷方式**：`shortcut.js` 契约加 `website` 类型（url/label），新增
  `normalizeUrl`/`hostOf` 纯函数；`FileOpener.openShortcut` 分派 website →
  `InternalViewer` 画布内 iframe 打开
- **Viewer 加 website kind**：iframe `src` 直连远程网址，安全 sandbox 不含
  `allow-same-origin`（opaque origin 隔离顶层 Java 桥），`referrerpolicy=no-referrer`
  防 file:// 路径泄露；锚点取视觉中心 + 级联错位，接近全屏宽卡片（非 3:4）
- **桥层加 openUrl**：ACTION_VIEW 打开网址（网站加载失败兜底系统浏览器）
- **新建网站对话框**（`website-dialog.js`）：Drawer「新建网站」入口 → 网址 + 可选名称 →
  写 `<名称>.desktop`（type=website，重名自动加序号）
- **网站信任开关**：website 快捷方式加 `trusted` 字段；新建对话框勾选「信任该网站」→
  完整加载（可读写授权目录，用户显式接受风险）；未勾选保持 opaque origin 安全隔离
  （复杂 SPA 因 localStorage/cookie 被拒而白屏）
- **修复网页上传阻断**：sandbox 会阻止 iframe 内 `<input type=file>` 触发文件选择器
  （onShowFileChooser 不回调）；信任网站改为完全移除 sandbox（第三方 https iframe 与
  file:// 顶层跨域，同源策略天然隔离 Java 桥），恢复 localStorage/cookie/file chooser；
  加 logcat 诊断日志（tag `DesktopWebUpload`）
- **网页文件上传桥**（`web-upload.js`）：拖拽文件到 website iframe 松手 → 设为待上传 +
  toast 提示；网页触发 `<input type=file>` → 原生 `onShowFileChooser` 拦截 →
  弹确认「用待上传文件 / 重新选择」；桥层加 `completeUpload`/`chooseUploadFromSystem`/
  `cancelUpload`（resolveUri 回传 / 系统 GET_CONTENT 选择器 / 回传 null）
- 契约锁同步：`test-bridge-contract.js` 登记 openUrl + 三个上传桥方法；
  `docs/bridge-and-data-contract.md` 同步；新增 `test-web-upload.js`

### Drawer/FAB 精简（2026-08-16）

- **Drawer 移除 4 项操作**：新建文件夹、新建文件、刷新、设为默认视角（新建/刷新仍保留在
  FAB Speed Dial；设为默认视角功能保留为 `App.Actions.setDefaultView` API，仅移除 UI 入口）
- **FAB Speed Dial 移除「切换根目录」**（保留 Drawer 内「切换根目录」入口）
- **Drawer 剩余图标 emoji → 矢量图标**：切换根目录（folder-move）、已安装应用（smartphone，新增）、
  提交与构建（wrench，新增）；sprite 新增 `icon-smartphone`/`icon-wrench` 并登记 icons.js _NAMES
- 同步适配：drawer.js 移除已删 action 分支；fab-speed-dial.js 移除 switch-root case；
  verify-home E2E 场景 5 改为直调 `App.Actions.setDefaultView()`（按钮移除后仍验证 fallback 写入）

### 矢量图标系统移植（2026-08-16）

- **图标系统统一**（移植 LexiCull 同构方案）：`index.html` 顶部新增隐藏 SVG sprite
  （`<symbol id="icon-{kebab}">`，70 个图标 = LexiCull 全集 61 个 + Desktop 特有 9 个：
  arrow-left/right/up、home、file、refresh-cw、maximize、scissors、music），
  新增 `src/js/icons.js`（`App.icons.get(name, opts)` + 命名访问 `App.icons.<name>`，
  输出 `<svg><use href="#icon-xxx"/></svg>`），ES6 重写（禁 var）
- **25 处手写内联 SVG 全部收编**：顶栏汉堡/三点、底部栏后退/前进/新建/Home/上级目录、
  Drawer 关闭、BuildInfo/AppList 返回、FAB 加号/叉、Speed Dial 全部 14 个操作图标、
  Viewer 返回键与音频大图标——统一为 sprite `<use>` 引用，零手写 path
- **新增 `tests/test-icons.js`**：生成器纯函数（get/命名访问/kebab/class 转义）+
  sprite symbol 与 `_NAMES` 双向一致性校验（缺一即 FAIL），新图标必须两处同步登记
- 文档 `docs/build-pipeline.md` 新增「图标系统」约定小节

### 弹窗/对话框模块优化 + 提交与构建页修复（2026-08-16）

- **弹窗模块统一约定**（`dialog.js`/`dialog.css`）：弹窗为矩形（直角）卡片；不设
  「取消/关闭」按钮，关闭途径 = 系统返回键 / 点击遮罩空白；弹窗正文可长按选择复制
  （`user-select: text`）。`App.Dialog` 新增打开栈 + `handleBack()`：系统返回键
  （`handleSystemBack` 第一优先级）关闭栈顶弹窗，弹窗可多层嵌套逐级关闭
- 新建/重命名/添加快捷方式确认框移除「取消」按钮（关闭走返回键/点空白），
  新建对话框按钮布局由三列改双列（文件 + 文件夹）
- **提交与构建详情弹窗重构**：文件/提交详情改用统一 `.dialog` 模板（此前手写内联样式
  14px 圆角、点击弹窗本体即关闭——长按选字被打断，文字不可复制的根因）；移除「关闭」
  按钮；点遮罩空白或系统返回键关闭（先关弹窗、面板保持打开）
- **弹窗信息准确化**：提交时间/文件创建·修改时间由 git UTC（`+0000`）原样显示改为
  转北京时间（+08:00）展示，与构建时间口径一致（此前差 8 小时的「信息不准确」根因）
- **弹窗点击即复制**：提交与构建详情弹窗「点击谁就复制谁」——标题（文件名/提交信息）、
  路径、完整 Hash、作者·时间、行数/字数/创建/修改值、变更统计、文件行均可点按复制
  （复制内容 = 该元素文本，文件行/按钮复制纯路径），统一吐司提示「已复制…」；
  可点区域带 :active 按压反馈，长按选字不受影响
- **源码规模排序标签修复**：切换排列方式（行数/名称/修改时间）此前点击不生效——
  `bindSortChips` 未把新排序键写回 `opts.sortKey`，重渲染仍按旧键排序
- **更新日志渲染重构**：构建期 python 迷你渲染器（不支持 `###` 标题、列表续行被拆段）
  改为注入 `CHANGELOG_MD` 原文、运行时由 `App.Markdown` 渲染（h1-h6/多行列表项/
  有序列表/引用/代码/链接统一支持）；`App.Markdown` 新增多行列表项续行合并
- **更新日志容器宽度对齐**：sticky 折叠头负 margin 外扩 4px/边导致与屏幕宽度不一致，
  改为与内容列对齐；容器横向 padding 归零与上方卡片同宽。展开后内容级横向溢出修复：
  CHANGELOG 含超长无空格 ASCII token（如 `folder/trash/text/...` 斜杠串），默认换行规则
  不在 `/` 处断行、横向撑宽滚动容器（展开后整页可左右滑动、内容被裁），
  `.changelog-container` 开启 `overflow-wrap: anywhere` 任意字符断行根治

### 工程（治理移植，2026-08-15）

- 分支治理升级为三级模型 `main ← feat/dev ← topic`：`feat/infinite-canvas` 并入
  成为首个开发基线并退休；`tools/branch-retire.sh` + `.git/branch-graveyard` 墓地
  机制（复活被 pre-commit/pre-push 拦截）
- 钩子三防线扩展：pre-commit 墓地拦截、pre-push 墓地复活 + main 非 merge 直推拦截、
  post-commit 领先 main ≥50 预警
- 提交前门禁升级 `tools/verify.sh`：env-check → build --strict → minify → lint →
  测试套件 → E2E×5（home/drawer/bottom-bar/buildinfo/fab-inspector 既有资产接入），
  机器可读 PASS/FAIL 摘要
- 新增 `tools/lint.sh`：构建一致性 / 文档链接 / CHANGELOG（结构 + 禁 emoji）/
  头部注释 / var 纪律
- AGENTS.md 治理升级（P1 纪律补齐、决策触发清单细化）；新增数据纪律文档
  `docs/data-integrity.md`（文件即真相：元数据统一出口防幽灵 positions、桥层契约）
- 探针 `probe-repo.sh` 参数化，自动识别 LexiCull / Desktop

### 已安装应用（Application Shortcut）

- **Shortcut File 契约**（`shortcut.js`）：快捷方式 = 真实文件（`.desktop` 扩展名 + JSON 内容），
  `type` 字段区分 `application`（应用快捷方式，`package` 稳定引用）与 `file`（文件快捷方式，
  持久化 SAF URI，预留）；文件即真相——可复制/移动/删除、随 Desktop 文件夹一起迁移
- **已安装应用工具**（`app-list.js/css`）：Drawer「已安装应用」→ 全屏搜索面板（第三方/系统分段 +
  确认框）→ 点按生成 `<应用名>.desktop` 快捷方式文件，重名自动加序号
- **桥层**：`FileBridge.listApps`（PackageManager 查询 launcher 应用）/ `launchApp`
  （getLaunchIntentForPackage 拉起，UI 线程 startActivity）；AndroidManifest 声明
  `<queries>` MAIN+LAUNCHER（Android 11+ 包可见性，比 QUERY_ALL_PACKAGES 更受限）
- **双击拉起**：`FileOpener` 分派 `.desktop` → 读 JSON → `type=application` 时 `launchApp`；
  解析/启动失败 toast 提示不崩溃
- **应用图标**：`FileBridge.appIcon`（Drawable→48dp PNG→base64 data URI，自适应图标 draw 兜底）
  内嵌进快捷方式 JSON（自包含可迁移）；桌面经 `Thumbnail.requestShortcutIcon` 渐进替换类型图标；
  列表 IntersectionObserver 懒加载（仅可视区 +300px，数百应用不一次性传输）
- **类型图标**：`.desktop` → `shortcut` 类型（四宫格 SVG），图标显示名剥离扩展名
- **修复**：外部文件打开后不再永久锁定（返回契约区分 Viewer 实例 / 外部分派）；快捷方式图标失败
  可重试（不再永久缓存 failed）；回收站显示为「回收站」且可重定位（禁止移入文件夹）；子文件夹
  幽灵 positions 导致的拖动崩溃
- 测试：`test-shortcut` / `test-app-list` / `test-desktop-drop-stale-positions` 新增，
  `test-file-opener` / `test-type-icons` 扩展

### 类型图标系统 + 缩略图服务（Type Icons & ThumbnailService）

- **类型图标系统**（`type-icons.js` + `type-icons.css`）：按文件名/目录判定 18 类语义
  （folder/trash/text/markdown/json/html/code/image/video/audio/archive/pdf/word/excel/
  ppt/font/executable/unknown），返回内联 SVG（stroke=currentColor，Feather 风格零依赖），
  替换原 emoji 图标（文件夹/文档/回收站）
- **类型语义色**：同一形态（如 fileText）下靠颜色区分相近类型（text 蓝 / md 紫 / json 橙 /
  code 青 / image 绿 / pdf 红 / archive 黄褐 …），`.type-icon.type-{kind}` 控制 currentColor
- **缩略图服务（ThumbnailService，`thumbnail.js`）**：与 Desktop 核心引擎解耦——File 对象
  不含缩略图状态，desktop.js / selection / layout-store 只关心 name/path/type/position；
  「能否缩略图 + 获取 + 缓存 + 请求去重」全部收敛在 `App.Thumbnail`
- **桥层缩略图（`FileBridge.thumb`）**：图片采样解码（BitmapFactory inSampleSize，大图不全量加载、
  内存可控）/ 视频首帧提取（MediaMetadataRetriever）→ 缩放到 256px 最长边 → JPEG 写磁盘缓存
  （cacheDir/thumbs，key = path@mtime@size，文件修改后自然失效）→ 返回 file:// URI
- **渐进式获取**：render 先画类型图标（fallback 基线）→ `Thumbnail.request` 异步命中/生成
  → 成功替换为真缩略图；命中缓存（ready）立即回调、失败缓存（failed）立即回退、同路径
  并发请求合并（pending 去重，避免重复 thumb/解码）
- **缩略图范围**：图片（image 类型，含 SVG 渲染预览 / GIF 首帧）+ 视频（video 类型，首帧提取）；
  `canThumbnail(kind)` 基于类型判定放行 image + video
- **失败回退**：桥层 thumb 失败（reject，解码失败）或 img 加载失败（onerror）均回退类型图标
- 测试：`test-type-icons`（类型判定/SVG 生成）、`test-thumbnail`（可缩略图判定/缓存命中/
  请求去重/失败回退/视频路径），无头 E2E `tools/ui/type-icons-verify.js`（类型 SVG + 图片/视频
  缩略图 + 失败回退）

### 回收站（安全删除）

- **回收站 = 根目录下的真实隐藏文件夹 `.trash`**（文件即真相）：桥层 `rootInfo` 幂等
  ensure 存在并返回 `trashName`，前端不硬编码名字；数据永远落在文件系统，用户在
  其他文件管理器也能直接看到/取回
- **删除 = 移入回收站**（安全删除，不做彻底删除）：`actions.deleteSelection` 复用移动
  管道（copy+del 源，SAF 无跨目录 rename），重名自动加序号、两阶段进度、复制失败保留源
- **回收站图标渲染**：根目录特判回收站图标 + `is-trash` 次色名（区别于普通文件夹图标），
  子文件夹视图不渲染（回收站只锚定根目录）
- **拖入回收站**：复用拖入文件夹命中逻辑，实时标签显示「将移入回收站」（而非
  「移入 XXX 文件夹」）
- **回收站守卫**：回收站自身不可删除/重命名/复制/剪切/拖动（锚定根目录）；进入
  回收站视图后删除/剪切/重命名入口整体禁用（只读，防二次删除嵌套）；选中含回收站时
  FAB 文件操作隐藏只留「打开」
- **进入回收站查看**：双击回收站 = 作为普通 Folder 容器查看被删文件
- 测试：`test-actions` 补 `deleteSelection` 用例（回收站守卫/未授权拒绝/混入过滤），
  无头 E2E `tools/ui/recycle-verify.js` 验证渲染 + 删除闭环 + 进入回收站

### 文件查看器（File Viewer）

- **FileOpener 分派**（`file-opener.js`）：按扩展名选择 InternalViewer（内部查看）或
  ExternalIntent（外部应用）；FileBridge 边界不变，只新增两个文件系统方法：
  `resolveUri`（文件 → WebView 可直接加载的 URI，媒体流式访问，不搬入 JS 内存）+
  `openExternal`（ACTION_VIEW 交外部应用，无可用应用报错提示）
- **InternalViewer 通用组件**（`viewer.js` + `viewer.css`）：TXT 纯文本 / MD 基础渲染 /
  JSON 可折叠树 / HTML 沙箱渲染 / SVG / 图片 / 视频 / 音频；内部预览失败提供
  「用其他应用打开」兜底
- **HTML 查看隔离 Java Bridge**：iframe srcdoc + sandbox（无 allow-same-origin → opaque
  origin），脚本跨源访问 window.FileBridge 抛 SecurityError，无头实测 BRIDGE_BLOCKED
- **Desktop 空间画布实体模式**：Viewer 是放置在画布上的世界坐标实体（不属于网格，
  不参与布局/排序/框选/碰撞），随画布 transform 平移/缩放，无需相机同步；
  桌面手指依旧有效（不拦截触摸，不创作独立交互模型），DOM 遮挡使其背后的文件点不到
- **实体基本性质**：点击 Viewer = 选中实体（脆弱/临时：点外部取消选中，Viewer 保持打开）；
  长按/拖动 = 移动实体位置（世界坐标位移，取消还原）；点击不穿透
- **文件锁定（Windows 式）**：被 Viewer 打开的文件锁定——禁止复制/剪切/重命名/
  移动（拖入文件夹），拖动摆放（改布局位置）仍可；关闭 Viewer 即解除
- **全屏 = 相册式独立新页面**（#viewer-fs-page：媒体黑底 contain 居中 / 文档浅色阅读，
  不绑定 Viewer 概念）；退出回到原页面状态——桌面空间回画布实体（内容与位置保留），
  folder 容器关闭回目录；pushState 支持系统返回键
- **媒体自适应比例**：图片/视频/SVG 打开后按固有宽高比调整实体尺寸（fitAspectRect，
  约束视口内、中心点不变），非固定比例
- **Morph FAB 预览焦点模式**：Viewer 实体选中时操作栏只显示「全屏预览」「关闭预览」
  （全屏按钮已从 Viewer 顶栏收纳进 FAB）；文件选中时显示文件操作
- **Markdown mini 渲染器**（`markdown.js`，纯函数零依赖）：标题/列表/代码块/粗斜体/链接/引用，
  先整体转义再行内标记（防注入），javascript: 等危险协议链接拒绝
- 返回键链路：查看器打开时返回键 = 关闭查看器（最优先），目录上下文保持

### 交互层

- **Loading Feedback 系统**（独立组件 `App.Loading`，`loading.js` + `loading.css`）：
  - 目录切换/刷新 → 居中对话框 + 不确定进度（条纹滑动），弱化「先切视图再变目录」的中间态突兀感
  - 粘贴/移动多文件 → 对话框 + 双进度条：阶段进度（复制/删除源）+ 总进度（分阶段整体）
  - 拖入文件夹 → 顶栏靠下实时标签「文件将移入 XXX 文件夹」（跟手提示，不弹对话框）
  - 对话框统一矩形卡片（border-radius 4px）+ 宽 76vw（占屏幕 70%~80%）
- **拖入文件夹**（桌面空间 + 子文件夹容器）：
  - 拖动图标命中文件夹 → 实时标签提示目标；松手 = 移入（copy+del 源，移动语义，目标名自动加序号）
  - 未命中文件夹 → 桌面空间吸附排布 / folder 容器还原原位
  - 拖动取消（1→2 指 / touchcancel）→ 标签同步回收（无残留）
- **refresh 竞态守卫**：目录切换/刷新加代际守卫（发起时路径快照 + seq 丢弃过期响应），
  修复快速连续导航时旧 list 结果迟到覆盖新路径状态——「退到最外层位置乱（布局像初次启动）」+
  「先切视图再变目录」的时序错乱
- **重命名重名预检**：先查后改，目标目录存在同名项即拒绝（统一 SAF/私有模式行为，
  防止私有模式 renameTo 静默覆盖）
- **系统返回键驱动文件后退**：Drawer/ViewMenu/BuildInfo 均未打开时，子目录内返回键 =
  后退一级（历史栈），根目录才交还壳退出
- **弹窗显隐独立模块** `App.Dialog`（`dialog.js`）：CreateDialog / RenameDialog / Loading
  三处弹窗显隐 + aria 状态单点管理（原各自操作 classList/aria 重复实现）

- 选中态生命周期对齐 Windows 原则（选中态临时/脆弱，动作后即失效）：
  移动完成（drop moved=true）→ 清空选中 + 收起 FAB 操作栏；剪切/复制粘贴完成后 →
  清空选中（源路径已失效，杜绝「幽灵选中」残留）；原地放下与拖动取消保留选中。
- 单指手势状态机补齐强制终结路径（生命周期完整性）：1→2 指切换或 touchcancel 时
  派发 single-cancel 语义事件——回收 picked-up 视觉（放大+阴影）与框选矩形、
  拖起图标还原起始位、不落盘（取消 = 什么都没发生）。修复拖动中第二指落下 /
  touchcancel 后「悬浮阴影」滞留的泄漏（此前仅 drop 终结拖动，cancel 路径无收尾）。
- 底栏高度缩短（12.5vh → 10vh）后的残留布局对齐：FAB / Speed Dial / toast 的
  距底公式从 calc(12.5vh + 16px) 同步为 calc(10vh + 16px)，并移除多余的
  --safe-bottom 叠加（底栏总高已含安全区内衬，重复叠加会让 FAB 悬高 2.5vh +
  安全区高度）；app-shell 底部留白改为纯 10vh——修复沉浸式设备上
  底栏与视口之间 24px 级的空白缝隙。
- Home 位置快照（底栏右 1 按钮，utils 新增 bindPressSplit 长短按分流）：长按记录当前
  桌面相机为快照，点按回到快照状态；无快照时回默认视角（Drawer「设为默认视角」可设置），
  均未设置时回出厂视角 (0,0,1)。Home 仅桌面空间可用（子文件夹容器内禁用）；已记录快照时
  Home 图标强调色提示。重启启动相机优先级：Home 快照 > 默认视角 > 上次布局视角 > 出厂，
  根目录相机基准 = 启动视角。修复：设置快照后重启图标位置丢失回默认——initLayout 中
  图标恢复误入「无快照」分支，改为无条件恢复（Home 快照只决定相机，不决定图标位置）；
  test-desktop-nav-dom 补 HomeStore stub + 防回归断言，verify-home 补拖动持久化 E2E
- Home 复位平滑飞行动画（van Wijk & Nuij 飞行曲线，Leaflet flyTo 同款数学）：单一连续
  cosh/tanh 路径（先 zoom-out 后 zoom-in），无分段（不断续）、无骤停（不震）、数学上
  屏幕内图标全程不出界（全量扫描 0px）；lerpCentered 锚定屏幕中心世界点 + 接收真实
  时间比例 k（内部统一缓动），zoom 不变退化为 lerp；easeInOutCubic 起步/收尾斜率 0
  （无弹射）；动画中手势/目录切换即打断（onGestureStart 回调），手势直控优先。
  演进说明：曾用缓出曲线（起步弹射）、三段式（段切换断续）均被单一飞行曲线取代。
  test-desktop-camera 补防出界复现案例 + 飞行均匀性断言，verify-home 补 zoom 变化 E2E
- 高级浏览模式（阶段 E）：顶栏「排列与视图」菜单底部新增「高级浏览模式」勾选项
  （view-menu，始终可用不受根目录置灰控制）——单指拖动空白/未选中图标从「框选」切换为
  平移画布（桌面）/ 滚动目录（文件夹），手势层 `_browseMode` 控制 empty/icon 命中进入
  pan 相位而非 marquee；已选中文件仍走拿起移动。双击空白进入/退出「临时操作模式」
  （effective = 高级浏览 ON && 非临时模式），临时切回框选/拿起语义便于精细操作；偏好经
  view-store `advancedBrowse` 持久化。docs/interaction.md 补 §7.6 定稿 + 阶段表 E 行
- 沉浸式状态栏/导航栏（参考 LexiCull 方案）：edge-to-edge 内容延伸，状态栏/导航栏
  透明，安全区经 WindowInsets 注入 CSS 变量（safe-top / safe-bottom / panel-bottom）
- 系统栏图标明暗由壳层统一控制（浅色主题 → 深色图标），手势临时栏
- 新建/重命名对话框：键盘弹出时自动上移到键盘上方（ime-open）

### 修复

- 修复 API 30 以下设备启动闪退（VerifyError：直接引用 API 30 的
  WindowInsetsController，已统一改走 androidx 兼容类）

### 构建与体积

- release 开启 R8 裁剪 + shrinkResources：APK 1.49MB → 149KB（-89.7%）
- build-local.sh 归档 release 产物（dev keystore 临时签名，发布前换正式）
- 安装包归档滚动保留最新 10 个（tools/collect-apk.sh）：按时间戳命名 + 自动清理旧包，
  手动放入目录的文件不受影响；release 构建同步归档 R8 mapping 到 mapping/ 子目录
- COS bundle 周期备份（tools/cos-bundle-check.sh）：每累计 25 个提交自动上传 git bundle
  到 cos://backup-data/desktop-git/，构建管线步骤 6 触发，上传失败不阻断构建且不丢周期

## 0.2.0（2026-08-14）

### 交互层

- 视图模式（阶段 D）：根目录 = Desktop 空间（无限画布现状不变）；打开文件夹后 = Folder 容器
- 顶栏右上新增排列/视图菜单：根目录下置灰，子文件夹中可选
- 排列方式：按名称/修改日期/类型/大小 + 升降序切换（folder-sort 纯函数）
- 视图切换：网格（4 列自适应视口）/ 列表（单列行 + 大小/文件夹元信息）
- 容器画布：zoom 锁 1、x 锁 0、y 钳制边界，只能上下滚动（clampToBounds + gesture 层 onClamp 每帧钳制）
- 手势沿用 Desktop：单指 tap/双击/框选一致；双指 = 滚动（有界）；长按图标 = 选中 + 移动文件占位吐司
- 相机策略：进文件夹重置到顶，返回根恢复根相机；容器布局不持久化
- 视图/排序偏好持久化（view-store，全局）

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
- 提交与构建页对齐 LexiCull：构建概览补「首次构建/跨度」行并统一文案与单位
  （建构次数/当前版本/领先main 红色阈值），仓库规模补「文件总数/工具/脚本/测试/
  配置行数/md 文档字数」行；工具与 Markdown 区块顺序对齐；更新日志箭头改 ▶ 前缀；
  doc 条形图支持字数排序；卡片改白底+行高 24px（对齐 LexiCull 质感）
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
