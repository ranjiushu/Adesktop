# Adesktop 更新日志

## Unreleased

### 选中态视觉重做（Windows / macOS 桌面范式：矩形选中块 + 强调色标签芯片）（2026-09-13）

- **动机**：旧选中态是 8% 淡色直角方块（`inset 8px`、`border-radius: 0`、无描边），
  在浅色点阵底上几乎看不出边界；列表视图只有一条强调色下边框，同样偏弱。
- **网格选中块**：改为 1px 强调色描边 + 14% 强调色底，尺寸按「左右间距 = 上下间距」反推——
  步进 100×116、单元 84×106，间距相等要求块宽高差恒为 16px（`W = 100 - G`、`H = 116 - G`）；
  取 `G = 14px` → 块 86×102（`inset: 2px -1px`），横向越过单元边界 1px 落在步进余量内。
  块边缘到内容：文字左右约 9px、上下约 7px（旧版贴着文字：左右 2px / 上下 4px）。
- **方角而非圆角**：块 / 标签芯片 / 列表左条 / 框选矩形统一方角，与全站 radius token（0）同一
  形状语言，避免「圆角高亮块 + 方角对话框」混搭。
- **标签芯片**：文件名文本外包一层 `.desktop-icon-name-text`，选中时铺强调色底 + 白字，
  配 `box-decoration-break: clone` **逐行**贴合——两行名 = 上下两块贴合文字的小方块
  （而非一整条 38px 色带），长名截断时省略号同样落在芯片内。
- **按压与选中分离**：`::before` 拆两条规则——未选中按压只铺 7% 淡底、不描边不给芯片，
  手指落下瞬间不再摆出完整选中态。
- **列表视图行**：整行 14% 强调色底 + 左侧 3px 强调条，行内不做选中块与名字芯片
  （连续整行高亮与行内芯片互相打架）。
- **单一取值来源**：新色值收进 `tokens.css` 的 `--color-select-surface / -border / -strong /
  -press / -marquee`；`strong` 取比 `--color-accent` 深一档的 `#2563eb`（芯片白字对比度
  5.2:1，13px 标签可读）。
- **验证**：新增 UI 视觉契约门禁 `tools/ui/selection-verify.js`（token / 块几何与**等间距
  不变量**（用 GRID_W/GRID_H 现场反推，改步进或改 inset 破坏等式即红）/ 标签芯片配色与逐行
  克隆 / 两行截断仍生效 / 未选中项无块 / 按压规则 / 列表行底与左条 / 框选）并接入
  `tools/verify-ui.sh`（随 `tools/verify.sh` 跑，步骤以脚本为准）。
- 交互文档同步：`docs/interaction.md` §4.1 选中态视觉（定稿）。

## 0.3.0（2026-09-13）

### 缩略图按需加载（刀 3：视口优先，进大目录不再排满整目录任务）（2026-09-13）

- **动机**：`render()` 无条件为目录内**每个**图片/视频图标请求缩略图——进 200 张图的目录就
  排 200 个 thumb 任务（桥层采样解码/首帧提取 + base64 传输 + JS 内存常驻），首屏可见的
  那十几个反而排在队尾。
- **视口优先派发**：`render()` 只为视口内（外扩半屏预取，`THUMB_OVERSCAN`）条目发请求；
  离屏条目不生成。实测同一目录首屏请求数从「等于条目数」降到「约一屏 + 半屏」。
- **滚动/平移按需补齐**：相机变化（手势拖动/惯性/滚动/Home 飞行）经
  `App.DesktopRender.scheduleVisibleThumbs` 节流（`THUMB_REFILL_MS`）派发新进入视口的条目。
- **防类型图标卡住**：同一路径只派发一次；每次渲染重建派发集合，使「等待中的缩略图落地时
  DOM 元素已被替换」能由下一次渲染重新派发（Thumbnail 侧 pending 合并 waiter）。
- **验证**：新增单元测试 `tests/test-desktop-thumb-viewport.js`（只派发视口内 / 滚动补齐 /
  不重复派发 / 重渲染重派发）与 E2E 门禁 `scripts/verify-thumb-viewport.js`（200 张图目录：
  首屏请求数 < 条目数 → 滚动中段补齐 → 滚动到底补齐末尾，已接入 `tools/verify.sh`）。
- 交互文档同步：`docs/interaction.md` 新增 6.1 缩略图按需加载（视口优先）。

### 目录导航性能（刀 2：进退目录秒开——清单缓存 + 根信息复用）（2026-09-13）

- **动机**：退出文件夹也要等加载，但父目录内容明明刚看过。取证发现退出走的是**完整刷新**：
  每次都向桥层取 rootInfo（SAF 模式下还要 `ensureTrash` 查一次目录）→ 读布局文件 → list →
  重建渲染，且非首屏刷新一律弹模态「加载中」——对一个已经看过的目录，这些等待都是白付的。
- **清单缓存（stale-while-revalidate）**：新增 `_dirCache`（path → items，LRU 上限 24 条）。
  导航命中时**同步渲染**（不等桥、不弹 loading），随后立即 `_revalidate` 向桥层重取对齐，
  内容有变才重渲染（四项字段全等即跳过，零打扰）。文件系统仍是唯一真相，缓存只是显示加速层。
- **根信息复用**：`_rootInfoCache` 缓存 rootInfo（会话内 rootName/mode/trashName/rootId/displayPath
  不随目录切换变化）——导航不再取，省一次桥往返。根授权变更/启动走非导航 refresh 仍取真实值。
- **loading 延迟显示**：导航类刷新 180ms 后才弹「加载中」（快目录不再闪一下）；超时仍在加载才弹，
  完成即关。带进度语义的变更操作（非导航）保持立即显示。
- **视图偏好切换只重渲染**：网格↔列表/排序变更不再走整轮 refresh（原先每切一次都闪模态「加载中」
  并白跑一次 list）——清单内容与视图偏好无关，`render()` 即可。
- **导航与非导航分流**：`refresh({nav:true})` = 进出/前进后退（可用缓存）；`refresh()` = 启动、
  根授权变更、文件操作后、视图偏好变更（强制取真相，不受缓存影响）。缓存不得遮蔽真相的契约
  写入 `docs/data-integrity.md`。
- **验证**：新增单元测试 `tests/test-desktop-nav-cache.js`（复用根信息 / 退出同步渲染 /
  未变不重渲染 / 对齐发现新增文件后重渲染 / loading 延迟与关闭 / 视图偏好只重渲染）与 E2E 门禁
  `scripts/verify-folder-nav.js`（已接入 `tools/verify.sh`）。

### 预览加载性能（刀 1：交互队列解耦 + 图片预览档）（2026-09-13）

- **动机**：进入目录后打开文件（尤其全屏预览）体感「要等老半天」。取证得到两条独立原因：
  ① 桥层所有调用共用**单线程** executor，而进目录时前端会为目录内每个图片/视频图标发起
  `thumb`，用户随后的 `read`/`resolveUri` 被排在缩略图队尾（「一进目录，点什么都要等」）；
  ② 图片全屏预览直接加载原图，相机原图（12MP~50MP）每次打开都要解码几十 MB 位图
  （慢，且逼近 WebView 堆上限）
- **桥层队列解耦**：`thumb` 改走独立的 `BridgeContext.thumbExecutor`（仍单线程、不增并发，
  位图内存不受影响）；数据操作（`read`/`list`/`resolveUri`/`copy`/`move`…）保持原串行
  executor，传输取消标志与 copy/move 竞态语义不变——看图准备不再阻塞用户发起的操作
- **新增 `previewUri` 桥方法（图片预览档）**：`inSampleSize` 取 2 的幂采样解码到 1920px
  最长边（不过采样失真）→ JPEG 原子写 `cacheDir/previews`（key 含 path/mtime/size，文件改动
  自然失效；文件数超限按最旧修改时间回收）→ 返回 `file://` 缓存 URI（不经
  `evaluateJavascript` 传 base64 大串）；原图小于该尺寸直接返回原图 URI；
  非位图格式或生成失败报错 → 前端回退 `resolveUri` 原图
- **Viewer 图片挂载两档降级**：`previewUri` 优先，reject 或 `<img>` onerror 两级回退原图
  （WebView 策略差异下不丢功能）；视频/音频仍走 `resolveUri` 流式
- **真机可观测**：`ThumbnailService` 每次 thumb/preview 打一行 `Log.d` 计时
  （TAG `Thumbnail`：命中/生成 + 耗时 + 原图字节数），供下一刀「缩略图按需分批」取舍取证
- 契约与文档同步：`tests/test-bridge-contract.js`（方法面 +previewUri）、`types/global.d.ts`、
  `tools/ui/viewer-modules-verify.js`（预览档优先 + 两级回退断言）、
  `docs/bridge-and-data-contract.md`、`docs/architecture.md`、`docs/viewer.md`
  （含已知限制：预览档 1920px 上限，超出部分不做像素级放大）

### 开源准备（GPL-3.0）（2026-09-08）

- **新增 LICENSE**：GNU General Public License v3（全文本入库，README 附版权声明）
- **README 重写**：面向外部读者——特性/架构/构建/签名/测试/文档索引，移除内部工作区路径
  （`/workspace/AAA 安装包/`）与私有仓库交叉引用（`/workspace/lexicull`）
- **移除私有备份耦合**：`tools/cos-bundle-check.sh` / `tools/bundle-source.sh` /
  `tests/test-cos-bundle-check.sh` 从仓库剥离（含私有 COS 桶路径），`build-local.sh`
  步骤 6 同步移除（管线收敛为 5 步）；备份能力迁移到仓库外本地脚本
- **移除错放的 gifski 资产**：`gifski-web/` 子项目与 `android/build-gifski.sh`
  迁出本仓库（gifski 已有独立仓库 gifski-android）
- **正式签名通道**：`build.gradle` 新增 release signingConfig——存在
  `android/keystore.properties`（已 gitignore）时用正式签名，否则回退 debug keystore，
  明文 debug 密码不再承担发布职责
- 文档同步：`docs/build-pipeline.md`（删 COS 备份一节 + 归档路径泛化）、
  `docs/verification-matrix.md`、`docs/README.md`、`AGENTS.md`、post-commit 注释

### Viewer 选中模型统一（刀 2：Viewer 合入 C.selection，与文件同一套交互）（2026-08-20）

- **动机**：刀 1 摘掉了手柄，但 Viewer 仍用独立选中状态（per-instance `selected` 标志 + `selectOnly/deselectAll/anySelected/selectedInstance` 并行 API），与文件的 `C.selection` Set 各管各的——框选只能单选 Viewer、混合拖动不支持、FAB 特判 `viewerSel` 靠五处手势回调手动同步，仍是一类同步 bug 温床
- **Viewer 合入 `C.selection`**：选中视觉由 `applySelection` 统一驱动，并行管理器方法全部删除
- **手势全面统一**：hitTest 的 Viewer 命中归入 `selected`/`icon`（与文件同类型）；handleTap Viewer 点击/延迟反选与文件同一逻辑；marqueeEnd 混合多选（文件+Viewer 合并进同一 `C.selection`）；长按/直接拿起走 `startGroupDrag`（双轨：文件→网格拖、Viewer→实例拖）
- **混合组拖动**：`C.dragViewerTargets` 新增属性；`startGroupDrag` 分派文件+Viewer 双轨拖动；`handleDrag/handleDrop/handleSingleCancel` 并行处理两轨；落点：文件吸附+避让、Viewer 自由定位（各自 `endDrag` 持久化）
- **双击 Viewer = 全屏预览**（与「双击文件 = 打开」对称：已打开的文件再「打开」= 完整视图）
- **FAB 混合选中语义**：`C.selection` 含 Viewer 路径时显示「关闭预览」；恰好单选 Viewer 且无文件选中时显示「全屏预览」；文件操作作用于未锁定成员；关闭预览批量关闭选中 Viewer
- **`closeViewer` 改为批量关闭**（`C.selection` 中的 Viewer 路径，关闭后路径从 `C.selection` 移除，保留文件选中；`closedSet` 预快照避免关闭后 `hasPath` 返回 false 导致路径过滤条件反转）
- 测试同步：test-viewer-drag（统一选中模型全链路：C.selection.has 代替 per-instance selected）、test-desktop-viewerlink-lock（closeViewer 用 C.selection 代替 selectedViewerId）、三个 UI 验证批量替换已删除 API（anySelected/selectOnly/deselectAll → C.selection + applySelection/clearSelection + DesktopSelection.selectOnly）

### Viewer 交互模型统一（刀 1：摘手柄 + 静态预览）（2026-08-20）

- **动机**：Viewer 与文件是两套并行选中系统（C.selection vs 实例 selected 标志），
  靠五处手势特判手动同步；canvas 态内容交互（文本滚动/JSON 折叠/网页 iframe）与
  实体手势抢同一根手指；拖动手柄是为绕开这两者加的第五条输入路径，自身还带着
  屏幕层 DOM + 相机每帧同步 + rotation=90 换算的维护成本
- **拖动手柄整体删除**：拿起语义与文件图标统一后自然成立——已选中直接拖、
  未选中框选、长按选中+拿起；手柄 DOM/命中（handleAt/handleWorldRect）/
  相机同步（syncHandles × 4 处调用）/手势命中类型（viewer-handle）/CSS 全移除
- **canvas 态静态预览**：非音视频模块内容零交互（viewer-card-static：
  pointer-events:none + overflow:hidden）——Viewer 态 = 图片式预览，
  内容操作（滚动/阅读/网页）只在全屏预览态；视频/音频保留原生控件（唯一例外）；
  website 网页 canvas 态静态化（「拖到网页设待上传」走世界坐标命中不受影响）
- **bundle 瘦身约 10KB**（839977 → 829136）
- 测试同步：test-handle-drag.js 重写为 test-viewer-drag.js（新模型全链路回归）；
  test-viewer.js 手柄纯函数段移除（改断言 API 不存在）；viewer-entity-verify /
  viewer-modules-verify / viewer-folder-verify 同步新模型并修复陈旧断言
  （授权弹窗吃返回键/锁定角标已删/visualCenter→anchorRect）

### 画布缩放范围放宽 0.3~3 → 0.1~10（2026-08-20）

- **动机**：0.3~3 对 100×116 网格偏保守——放大端看不了缩略图细节、缩小端看不了稀疏
  桌面全局；根目录桌面位置本已无限（onClamp 只钳 folder 容器），唯一限制就是 zoom
- **边界仍是安全网而非手感**：下限 0.1 防 panBy 位移爆炸（zoom→0 时 dx/zoom 顶穿浮点
  精度），上限 10 防 translate3d 超大像素丢精度 + 缩略图位图放大发糊；真无穷不可行
  （CSS transform 与 double 都撑不住）
- **Home/fit 行为变化**：单文件一览 zoom 从 3 提到 3.55（恰好放下的 raw 值，不再被
  max 卡住）；max 10 在真实视口下永不触发（单图标 bw=116 → 需视口 ≥1160px）
- **极端飞行安全**：0.1↔10（100x zoom 比）新增单测——中心点轨迹线性（偏差 4.7e-13）、
  全程有限无 NaN、屏幕空间速度均匀（峰值/平均 2.07 ≤ 3.5，真感知指标）；世界空间
  均匀性指标在极端 zoom 比下失真（低 zoom 段 1 屏幕像素 = 10 世界单位），改测屏幕速度
- 文档同步：`docs/interaction.md`（缩放范围 ×2 处）、`docs/bridge-and-data-contract.md`
  （`[0.1, 10]`）；测试同步：test-desktop-camera / test-desktop-fit

### Viewer 重构为文件的「打开」状态（2026-08-20）

- **语义**：Viewer 不再是独立窗口实体，而是文件的「打开」状态——双击文件 =
  在原地变成 Viewer（图标退出网格，原格子释放为普通空格）；拖动 Viewer =
  拖动文件本身（无第二套坐标）；关闭 = 按窗口位置吸附最近网格格落位（被占
  自动避让），图标带 260ms 落位动画飞回格位
- **删除的协调代码**：图标→窗口单向锚定（syncRectForPath）、会话恢复贴窗对齐、
  锁定集合 `_lockedPaths` + 锁定角标、整理桌面「钉子户」占位避让——它们的共同
  前提（图标与窗口并存）已不存在；锁定改为派生态（InternalViewer 存在该路径
  实例即锁定），无状态可失步
- **整理桌面**：打开态文件不是网格成员——不参与、不留占位格（用户拍板方案），
  关闭时按窗口位置重新落位
- **原地展开**：text/parsed/website 打开不再弹到屏幕视觉中心 + 级联错位，
  改为卡片左上锚定图标位置，超视口自动夹回可视区（anchorRect 纯函数）
- **folder 容器不变**：全屏预览保持原样（不退出网格、不持久化）
- **website 快捷方式**：打开期间图标同样退出网格（顺带移除旧「预览中允许删除
  .desktop」的 MVP 妥协）
- 测试：重写 test-viewer-lock-sync / test-desktop-viewerlink-lock（打开态生命周期），
  test-viewer.js 锚点断言 → anchorRect 夹取，viewer E2E 断言改「图标退出网格」；
  verify.sh 16 项门禁全绿

### 类型图标升级为 Material 彩色瓷砖（MT 管理器风格，2026-08-19）

- **图标源**：Material Design Icons（Apache-2.0，Pictogrammers）官方字形 + 彩色圆角方块，
  白色字形 = MT/NP/ApktoolM 三款工具同款图标风格（已拆包证实其文件图标即 Material 字形）；
  16 个 kind 各一个瓷砖，标准语义色（pdf 红 / word 蓝 / excel 绿 / ppt 橙 / image 青 / audio 粉…）
- **目录图标**：经典黄色 Material folder 字形（非瓷砖），与 MT 管理器一致
- **三级解析**：扩展名精确匹配 → kind 瓷砖 → 线条占位；trash/shortcut/unknown 保持线条版
  （stroke currentColor，随主题自适应）；全彩瓷砖自带颜色，浅色/深色/自定义主题通用
- **新模块**：`src/js/type-icons-data.js`（16 个瓷砖，由 `tools/gen-type-icons-data.js` 生成，
  已登记 JS_ORDER）；`TypeIcons.iconFor(name,isDir)` / `kindSvg(kind)` API，
  渲染层 `desktop-render.js` 文件图标改走扩展名解析
- **构建**：bundle 827KB → 840KB（+1.5%）；verify.sh 16 项门禁全绿

### 桌面目录改用系统 SAF 授权选择器（2026-08-19）

- **移除固定路径 + 手动输入**：Drawer「桌面目录」不再弹出常见目录 chips + 自定义输入框，
  改为直接调用系统 `ACTION_OPEN_DOCUMENT_TREE` 目录选择器
- **支持应用私有目录**：通过 SAF 授权任意 DocumentsProvider 暴露的目录
  （如经 MT 管理器注入文件提供器后暴露的应用 data 目录），选择后该目录成为新的桌面根
- **forceSafMode 机制**：用户主动选择 SAF 目录后，即使仍持有全盘权限也强制走 SAF 分支
  （保证所选目录生效）；主动点击「授权手机存储」并成功授权全盘后重置，恢复全盘 File 模式
- **桥层变更**：`FileBridge.requestDesktopDir()` + `App.bridge.requestDesktopDir()` 新增；
  `MainActivity` 处理 `REQ_DESKTOP_DIR` 并持久化 `rootUri`/`forceSafMode`；
  `BridgeContext.isSafMode()` 支持 `forceSafMode` 遮蔽全盘；`rootInfo` 优先返回 SAF 模式
- **前端清理**：移除 `desktop-dir-dialog` HTML/CSS/JS；更新 `docs/fs-scope.md`、
  `docs/bridge-and-data-contract.md`、测试 `test-bridge.js`
- **构建**：verify.sh 16 项门禁全绿，APK 归档 `/workspace/AAA 安装包`

### Viewer 状态持久化 + 矩形设计语言（2026-08-19）

- **Viewer 持久化（只能手动关闭）**：画布态 Viewer 的打开状态 + 世界坐标位置经
  新增 `ViewerStore`（viewer-store.js）持久化——localStorage 缓存 + 桌面空间隐藏
  文件 `.adesktop-viewers.json`（文件即真相，随目录迁移）；打开/关闭/拖动结束/
  媒体自适应落盘（InternalViewer.setPersistListener 注入，desktop-viewer-link
  负责）；app 重启后恢复上次会话的 Viewer（原位置 + 文件重新锁定），已删文件记录
  跳过；folder 全屏预览不持久化；「一键关闭所有 Viewer」为规划中扩展
- **矩形设计语言**：全应用圆角归零（tokens --radius-sm/md → 0 + 全部 CSS 直写
  半径清零）——快照列表/顶栏菜单/Viewer 卡片/对话框/抽屉/Toast 等统一直角矩形；
  FAB 圆形按钮除外（矩形语言针对圆角矩形，非圆形元素）
- **单测**：test-viewer-store.js 17 项（往返/过滤/隔离/文件写入）；**E2E**：
  verify-viewer.js 11 项（启动恢复位置/拖动落盘/手动关闭清空/reload 不复活/
  陈旧记录跳过/直角断言）；verify.sh 15 → 16 项门禁

### 循环演示 + 字母/页码编号 + 列表滚动防误触（2026-08-19）

- **循环演示（去掉「演示模式」概念）**：桌面空间存在快照时，底栏前进/后退直接按
  全部分组扁平顺序循环翻页——无第一页/最后一页概念、无边界禁用；从「当前页」进入
  （已访问快照 / 相机匹配到的最近快照，从未进入时前进 = 第 1 页、后退 = 最后一页）；
  无快照或文件夹视图时前进/后退仍走目录历史导航
- **当前页高亮**：呼出快照列表时「当前页」高亮（相机匹配锚定）；点击任意快照
  快速跳转并成为当前页
- **字母编号 + 页码**：添加快照时分配字母编号（页代码 A..Z → AA..，最小未使用，
  随快照稳定——拖动排序/移动分组不改变，删除后复用）；页码 = 全分组扁平顺序
  （排序后自动更新）；列表行左侧字母徽标（当前页强调色）+ 右侧「第 N 页」
- **列表滚动防误触**：参考 LexiCull——位移 > 10px 或手指滑出行外视为滚动/滑动，
  不再触发点击飞行/选中（原滑动也会被当作点击）
- **E2E**：verify-snapshot-sheet.js 25 → 33 项（循环环绕前进/后退、当前页高亮、
  滑动不算点击、字母编号随快照不变 + 页码随排序更新）；单测 +10 项（code 分配/
  回填/复用/排序不变）；verify.sh 15/15 全绿

### Home 与演示快照彻底分离（2026-08-19）

- **Home 独立锚点**：Home = 独立的空间锚点（HomeStore，含竖/横屏槽位），与快照列表完全解耦——
  长按底栏 Home = 添加快照（进快照列表，纯演示快照）；点按 Home = 回 Home 锚点
  （home > fallback > 出厂）；顶栏右上角菜单「设为 Home」= 设置 Home 锚点
- **快照列表去 Home 位概念**：列表首项不再等于 Home，无 snapshot-home 高亮，打开面板
  默认第一个分组；插入位置（顶部/底部）仅决定新快照插入顺序；演示模式独立
- **顶栏菜单精简**：排列方式/视图 section 只在子文件夹显示（Desktop 无限画布无排序/
  视图语义直接隐藏）；设为 Home / 高级浏览 / 切换画布方向始终在 Desktop 可用
- **启动相机**：reload 启动 = fallback > 上次布局 > 出厂，快照不再影响启动位置
- **存储**：移除 SnapshotStore.setHome（Home 位快照语义废弃）；HomeStore 恢复为
  Home 锚点的唯一真相
- **E2E**：verify-home.js 22 项（长按 Home 记录快照不触发锚点类 / 点按回出厂 /
  reload 落默认视角 / 清快照无影响）；verify-snapshot-sheet.js 25 项（无 Home 高亮 /
  设为 Home 写 HomeStore）；verify.sh 15 项全绿（含 8 套 E2E）

### 修复拖拽手势冲突 + Morph FAB 层级（2026-08-19）

- **拖拽不跟手/面板跟随关闭（根因）**：面板下滑关闭手势在列表 scrollTop=0 时无条件接管
  touchmove——drag-sort 拖拽时它也位移面板 + preventDefault，两者打架（阻力感 + 面板被拖走）。
  修复：touchstart/touchmove 检测 `dragSort.isDragSortActive()`，拖拽中面板让权（不位移、
  不拦截），drag-sort 全权接管
- **边缘智能滚动修正**：`edgeInsetBottom` 由「10vh 底栏估算」改为实际 footer 关闭条高度
  + 安全区（列表可视底缘即滚动生效边缘，手指搭关闭条也吃到越界加速）
- **Morph FAB 始终最高层级**：移除「快照面板打开时 FAB 隐藏」规则——FAB（z-index 1500）
  始终浮于面板（650）之上可见可点（LexiCull 同款）；操作模式 morph 为 关闭(close) + 操作按钮不变
- **E2E**：`verify-snapshot-sheet.js` 扩展至 23 项——新增「长按拖拽排序生效 + 拖拽中
  面板 transform 不变（不跟随关闭）+ 拖拽后操作模式保持」、FAB 始终可见断言；
  verify.sh 15 项全绿（含 8 套 E2E）

### 快照面板操作模式：长按拖拽排序 + FAB 多选批量操作（2026-08-19）

- **面板高度 70%**：参考 MT 管理器，固定 50vh → 70vh（更多快照可见）
- **操作模式（参考 LexiCull）**：长按快照行（500ms，10px 容差）进入——FAB 从右下角
  morph 展开（删除 / 移动 / 关闭(close) 退出）；长按行不松手直接拖拽排序（整行可拖，去掉原拖动把手）
- **多选**：操作模式下单击行切换选中（蓝色高亮），再次长按行可拖动排序（拖动时清空选中）
- **删除**：FAB「删除」确认后批量删除选中快照，删除后自动退出操作模式
- **批量移动**：FAB「移动」→ 面板内浮层列出目标分组 → 点击迁移并自动切到目标分组 tab
- **FAB 语义收敛**：快照面板打开时 FAB 隐藏；操作模式浮现为 关闭图标（点击 = 退出操作模式 +
  收起）；退出/删除/移动后自动还原
- **拖动排序**：drag-sort 引擎 isActive 绑定操作模式；边缘智能滚动（edgeZone/edgeInset
  内缩到底栏上方，手指搭底栏也吃到越界加速）与 LexiCull 同源
- **存储**：SnapshotStore 新增 `move(data, fromGroupId, toGroupId, ids)` 批量移动
- **E2E**：`verify-snapshot-sheet.js` 扩展至 20 项（70vh/长按进入/FAB morph/多选/
  批量删除/移动浮层/FAB 关闭(close) 退出）；verify.sh 15 项全绿（含 8 套 E2E）

### 快照面板分组改为 Tab 切换（2026-08-19）

- **分组标签栏**：不同分组不再混排在同一列表——分组标签横排在列表顶部
  （`#snapshot-tabs`，可横向滚动），列表只渲染当前分组快照
- **切换方式**：点击标签切换；列表内左右滑动切换（|dx| > 60px 且水平分量占优，
  与列表垂直滚动、拖动排序互不干扰，到边界停留保护）
- **分组管理**：标签栏末尾 + 新建分组；长按标签重命名/删除分组（删除连同组内快照）；
  新建分组后自动切到新分组 tab
- **E2E**：`verify-snapshot-sheet.js` 扩展至 17 项（标签渲染/默认选中 Home 分组/
  点击切换/左右滑动/边界保护）；verify.sh 15 项全绿（含 8 套 E2E）

### 快照面板 MVP 改造：分组 + 固定高度（2026-08-19）

- **面板交互参考 MT 管理器**：快照面板固定高度 = 视口 50%（不再跟手展开全屏），
  呼出时屏幕上半部分有半透明遮罩（点遮罩关闭）；面板底部新增「关闭」按钮条；
  全面板区域支持手势下滑关闭（header/footer/列表顶部起始，与列表滚动协调）
- **快照分组（v3 存储）**：`snapshot-store.js` 升级 version 3——分组列表全局共用
  （不随横竖屏拆分），每个方向（竖屏/横屏）的每个分组下各自保存快照；
  支持新建/重命名/删除分组（删除分组连同组内快照）；快照在分组内拖动排序；
  新快照默认插入 Home 分组（插入位置 top/bottom 仍全局生效）
- **兼容迁移**：v2 双槽位 / v1 扁平数据自动迁入「默认分组」；旧版 `HomeStore` 兜底迁移
  仅在整份数据无任何快照时触发，避免横竖屏切换覆盖已有另一方向快照
- **测试**：`test-snapshot-store.js` 重写覆盖分组 CRUD/方向隔离/v2/v1 迁移（47 项）；
  新增 `scripts/verify-snapshot-sheet.js` E2E（面板 50vh/遮罩/关闭按钮/分组渲染/Home 高亮）；
  verify.sh 14 项全绿（含 8 套 E2E）

### 演示快照 + 演示模式（2026-08-19）

- **演示快照面板**：底栏区域垂直上滑跟手呼出快照列表；列表显示快照名称与缩放层级；
  点击切换快照（相机平滑飞行）；长按拖动把手重排顺序
- **Home 语义迁移到快照列表**：长按底栏 Home 在当前方向（竖屏/横屏）快照列表的 Home
  位插入新快照；点按 Home 飞回当前方向 Home 位；新快照插入位置可在快照菜单切换
  （顶部/底部，默认顶部）
- **快照存储**：`snapshot-store.js` 独立模块，version 2 结构 `{portrait, landscape}` 双槽位
  按画布方向隔离；持久化走 localStorage + 桌面空间目录 `.adesktop-snapshots.json`（文件为真相）；
  兼容旧版 `HomeStore.home/fallback` 自动生成初始快照
- **演示模式**：快照面板三点菜单开启；开启后底栏前进/后退切换为「下一个/上一个快照」，
  到边界禁用并吐司提示，吐司内提供「回到第一页/最后一页」快速跳转
- **拖动排序引擎**：移植 LexiCull `drag-sort.js`（FLIP 智能避让 + 边缘自动滚动）到 Adesktop，
  用于快照列表排序
- **吐司增强**：`toast.js` 新增 `showAction(msg, actionText, onAction)`，支持带操作按钮的
  Snackbar 样式吐司；普通吐司超时保持 1800ms，操作吐司 3500ms
- **测试**：新增 `test-snapshot-store.js`（竖横屏隔离/CRUD/插入位置/Home 位/兼容迁移）、
  `test-toast-action.js`；更新 `verify-home.js`/`verify-rotate.js` 适配 SnapshotStore 存储结构

### 修复布局持久化 + 布局落目录文件 + 整理桌面（2026-08-19）

- **修复布局持久化被破坏（根因）**：refresh 的 positions 清理按「key 无 '/'」判定根级——
  桌面根改 `Desktop/` 后 fullPath 全含 '/'，每次刷新清空全部已保存位置。
  修复：按「当前目录前缀 + 无更深段」判定直接子项；虚拟回收站（key=`.trash` 桥层根固定串）特判保留
- **布局真相落目录文件**：桌面空间布局（图标位置 + 相机）双写——`.adesktop-layout.json`
  （位于桌面空间目录内，**文件为真相**）+ localStorage（降级为缓存，启动/迁移兼容）；
  refresh 串行读文件覆盖缓存，切换桌面根 = 读新目录数据文件——布局随目录存在，
  不因 rootId/切换桌面根丢失；`migrateLegacy` 兼容旧 localStorage 数据（文件未生成前兜底）
- **布局文件不渲染**：`.adesktop-layout.json` 为隐藏元数据，渲染时过滤
- **整理桌面（Morph FAB 新增）**：`desktop-organize.js` 纯函数（可单测）——
  文件夹在前（名称升序）、文件按扩展名字母序分组（组内名称升序）；
  锚定相机可见区域左上角铺满网格：竖屏列优先（从上到下）、横屏行优先（从左到右）；
  仅桌面空间可用（folder 自动排布无整理语义）；整理后双写持久化
- **测试**：test-desktop-organize.js（19 项）；test-desktop-root.js 扩展布局文件
  读写/过滤断言（36 项）；verify.sh 13/13 全绿（含 6 套 E2E）
- 文档同步：data-integrity.md / operation-contract.md 布局存储说明更新

### 桌面根可配置 + 应用内授权对话框（2026-08-19）

- **桌面根（Desktop Root）**：all-files 模式桌面空间渲染的目录默认 `Desktop`，
  Drawer「桌面目录」可配置（常见目录：手机存储根/Desktop/下载/文档/图片/相机/音乐/电影
  + 自定义相对路径，校验拒绝绝对路径/`..`/空段）
- **rootId 隔离升级**：`all-files:<桌面根>`——切桌面根即切换布局/Home 域（不继承摆放）；
  启动 curPath 初始化为桌面根，导航栈同步重建
- **视图模式调整**：all-files 模式下手机存储根（`''`）也是 Folder 容器（资源管理器式），
  桌面空间「上级」= 手机存储根（goUp 可达），手机存储根无上级
- **虚拟回收站**：`.trash` 在桥层根（手机存储根），桌面空间附加虚拟图标
  （key 固定 `.trash`，打开/删除守卫/位置持久化天然匹配）；全盘根 folder 内为实体条目
- **应用内授权对话框**：不再裸跳系统设置页——首次启动未授权弹「授权手机存储」引导
  （说明 + 去授权按钮 → 系统设置页），localStorage 标记防重复弹；Drawer 入口同款；
  已授权时点击提示「已授权手机存储」；E2E 内存桩（mode=mock）不弹（非合法枚举守卫）
- **原生简化**：MainActivity 移除 onCreate 自动跳设置页与 prefs 标记（前端驱动）
- **测试**：新增 test-desktop-root.js（29 项：isFolderView 判定/启动初始化/rootId 拼装/
  saveDesktopRoot 校验/虚拟回收站）
- 文档同步：fs-scope.md 桌面根与授权流程、operation-contract.md rootId 取值

### 修复：全盘授权不生效 + 升级用户不弹引导（2026-08-19）

- **模式优先级 Bug（根因）**：`isSafMode()` 原为 `rootUri != null`——升级用户保留旧 SAF
  授权时，全盘授权后 `allFilesRoot` 被旧 rootUri 遮蔽，桥层永远走 SAF 分支，全盘永不生效。
  修复：`isSafMode() = allFilesRoot == null && rootUri != null`（全盘 > SAF > 私有），
  resolve/ensureTrash/rootInfo 同步统一（rootInfo 判断顺序 all-files 优先）
- **升级引导 Bug**：启动引导条件原为 `!allFilesGranted && rootUri == null`——已有旧 SAF
  授权的用户永远不弹引导。修复：条件改为「无全盘权限 && 未提示过」（prefs 标记
  `all_files_prompted`，拒绝后不重复弹；Drawer「授权手机存储」可再进）
- **设置页跳转加固**：`ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION` 优先 package 定位，
  部分 ROM 不支持时退回列表页（双保险）

### 全盘访问转正：授权手机存储（2026-08-19）

- **主方案切换**：文件系统来源从「SAF 授权目录」改为「全盘访问（MANAGE_EXTERNAL_STORAGE）」——
  首次启动引导授权（Android 11+ 跳系统设置页 / Android 10 及以下运行时权限），
  授权状态动态检测不持久化，被撤销自动降级（SAF → 私有目录），App 永远可用
- **桥层三模式**：`BridgeContext` 引入 SAF / all-files / private 三态，
  File 分支根参数化为 `fileRoot()`（全盘优先，私有兜底）——`FileStore`/`TransferEngine`
  的私有模式代码零重写复用；越界校验泛化为 `isUnderFileRoot`
- **rootInfo 扩展**：`mode='all-files'`、`rootId='all-files'`（固定串）、`rootName='手机存储'`；
  前端 drawer.js 来源显示适配（手机存储/外部存储/应用私有目录）
- **权限变化热切换**：`onResume` 检测全盘授权授予/撤销 → 桥层切模式 + `App.onRootChanged`
  通知前端刷新（首次授权从设置页返回即生效，无需重启）
- **Drawer 入口语义**：「切换根目录」→「授权手机存储」（桥 `requestRootAccess` 改引导全盘）；
  SAF 选择器保留为降级路径代码（`REQ_OPEN_DOC_TREE` 处理仍在）
- **已知限制记录**：全盘权限仍无法访问 `Android/data`、`Android/obb`（Android 11+ 硬限制）；
  全盘 rootId 固定串 → 从旧 SAF 目录切到全盘后布局不继承（rootId 隔离语义）
- **文档同步**：fs-scope.md 决策记录重写、bridge-and-data-contract.md / operation-contract.md /
  architecture.md 的 mode/rootId 契约更新

### Morph FAB「取消」语义收敛：FAB 展开 ⇔ 选中态一致（2026-08-19）

- **关闭 Morph FAB = 取消选中**：selection 态下收起 FAB（原位点击 × / 动作完成后收起）
  即清空选中（Viewer 实体 deselectAll + 文件 clearSelection）——「展开 ⇔ 选中」状态一致，
  消除「FAB 已收起但选中仍在」的幽灵操作栏
- **移除「取消选择」独立按钮**（index.html clear-selection）：取消由 FAB 原位承担
  （图标 + → ×），不再新增取消按钮；同步删除 fab-speed-dial.js `clear-selection` 动作分支
- **清理死代码**：删除 `close-speed-dial` action（LexiCull 移植遗留的独立取消按钮入口，
  HTML 中无对应按钮，纯残留）
- **联动适配**：fab-context-probe 场景 D/E 断言（回收站选中 → 仅「打开」；回收站内 →
  打开/复制）；viewer-verify / interaction.md / viewer.md / move-target.js 注释与操作表同步
- **E2E 补断言**：verify-fab-inspector 新增「FAB 原位点击 = 收起 + 取消选中」

### 工程：仓库目录改名 Desktop → Adesktop（2026-08-19）

- 项目目录 `/workspace/Desktop` → `/workspace/Adesktop`（与包名/产物名/APK 命名对齐）
- 硬编码路径清理：AGENTS.md 探针路径更新；tools/ui ×4 探针由写死 `/workspace/Desktop`
  改为相对路径 `path.join(__dirname, '..', '..', 'dist', ...)`（目录再移动不失效）
- **注意**：`.git/objects` 内 lazy-object 符号链接为绝对路径，目录改名会断链
  （`fatal: bad object HEAD`）——已全部重建为**同目录相对链接**，今后 mv 不再受影响

### 弹窗宽度收敛为设计 token：--dialog-width（2026-08-19）

- **tokens.css 新增 `--dialog-width: 86.5vw`**（占屏幕 80%~90%），dialog.css /
  move-target.css 由字面值改为 `var(--dialog-width)`——弹窗宽度从此单一来源，
  调宽度只改一处全局生效（根治此前 76vw / 84vw 双魔数不一致的历史问题）
- **注释不再携带魔法值**：loading.css ×2 / index.html 注释由「86.5vw」改为引用
  `var(--dialog-width)`，改值后注释不会过期

### 弹窗宽度加宽：76vw → 86.5vw（2026-08-19）

- **通用弹窗基座**（`dialog.css` `.dialog`）：宽 76vw → 86.5vw（占屏幕 80%~90%），
  max-width 420px → 480px 同步按比例放宽；覆盖新建/重命名/网站/AppList 确认/上传确认/
  转移失败/加载进度等全部 `.dialog` 系弹窗（loading.css 复用）
- **移动目标弹窗**（`move-target.css` `.move-target-dialog`）：84vw → 86.5vw，与通用弹窗统一
- **注释/文案同步**：loading.css ×2、index.html 弹窗注释的「76vw」引用同步更新

### 治理补课：类型检查进门禁 + 改名残留清理 + 术语统一（2026-08-19）

- **类型检查进门禁**：`tools/verify.sh` 新增 typecheck 步骤（tsc --noEmit，缺 typescript 时
  SKIP 与 minify 同策略）；AGENTS.md 铁律/常用命令/决策表同步（E2E 数修正为 ×6，原 ×5 过期）；
  docs/build-pipeline.md 新增「类型检查（渐进式 @ts-check）」章节
- **改名残留清理**（2026-08-17 改名轮遗漏项）：AGENTS.md 包名占位 `com.example.desktop`、
  常用命令 dist/desktop.bundle.html ×2、README 产物名 ×2 + 包名占位、android/settings.gradle
  `rootProject.name = "Desktop"`、.githooks/pre-commit 报错消息、docs/build-pipeline.md 包名占位句
- **术语统一**：「零依赖」→「零第三方依赖」（项目理念层：AGENTS.md / README / build-pipeline.md
  依赖策略 / loading.js 注释）；模块级语义保留（markdown.js「纯函数零依赖」、测试「零依赖运行」）
- **保留**：功能语义命名不动（`App.Desktop*` 命名空间、`desktop-*.js` 模块、「Desktop 空间
  vs Folder 容器」等桌面隐喻）——是产品概念，非项目名

### 项目改名：Desktop → Adesktop（Android Desktop，2026-08-17）

- **包名**：`com.example.desktop` → `com.ranjiushu.adesktop`（9 个 Java 类目录迁移 + build.gradle namespace/applicationId + AndroidManifest + proguard keep 规则同步）
- **应用显示名**：strings.xml app_name / index.html `<title>` / `App.NAME` 统一为 Adesktop；主题 `Theme.Desktop` → `Theme.Adesktop`
- **构建产物**：`dist/desktop.bundle.html` → `dist/adesktop.bundle.html`（build-web.sh / minify-bundle.js / verify.sh / lint.sh / build-local.sh / E2E scripts / tools/ui 探针 / test-smoke 同步）
- **APK 命名**：归档 `Adesktop_v<版本>_<时间戳>.apk`（collect-apk.sh + test-collect-apk.sh）；COS bundle slug `desktop` → `adesktop`
- **文档/工具**：README / AGENTS / docs 标题、build-stats repo-map 标题、bundle-source 打包名、探针 probe-repo.sh Desktop 分支识别同步
- **保留**：功能语义命名（`App.Desktop*` 命名空间、`desktop-*.js` 模块、`desktop-grid` 等 CSS 类、「Desktop 空间 vs Folder 容器」）不动——是产品概念（桌面隐喻），非项目名

### E2E 修复：buildinfo 断言脱节 + home 双击窗口边界（2026-08-17）

- **fix(buildinfo-e2e)**：33c5d44 重构文件详情弹窗（grid 键值对精简为一行 sizeLine）
  后移除 `.build-detail-value` 元素，但 E2E 3d2 段仍点击该元素 → null.click 稳定失败。
  断言跟进新结构：标题/路径/简介（data-toast=已复制简介）三连击复制验证
- **fix(home-e2e)**：doubleTap 两击间隔 sleep(150) + CDP 触摸派发延迟 = 实际 274~320ms，
  恰卡在 300ms 双击窗口边界，偶发判为普通 tap（未进子文件夹 → Home 未禁用）。
  间隔缩短至 80ms（实测两击 206~227ms），稳定落在窗口内

### 弹窗按钮样式全局统一：文字式 + 取消靠左/主操作靠右（2026-08-17）

- **按钮样式泛化**：移动目标弹窗的简约文字式按钮（无边框无底色、主操作强调色加粗、
  次操作次要色）从 `move-target.css` 局部覆盖提升为 `dialog.css` 通用默认样式，全部
  弹窗（新建/重命名/网站/AppList 确认/上传确认/转移失败/移动目标）统一采用
- **布局统一**：双按钮弹窗改为「取消靠左 + 主操作靠右」两端对齐（`dialog-actions-pair`
  由等分双列改为 space-between）；新建弹窗新增左侧「取消」按钮，文件/文件夹并排靠右
- **禁用态泛化**：移动弹窗 `move-confirm-invalid` 专用类改为通用
  `.dialog-btn[aria-disabled="true"]` 置灰样式（点击仍派发，由业务侧拦截吐司）
- **触控目标**：文字式按钮保持 min-height 44px 触控区

### Morph FAB 增强：槽位布局 / 移动文件 / 悬浮球拖拽（2026-08-17）

- **P0 修复：展开菜单空洞 + 按钮叠 FAB**：位移规则原用 `:nth-child(n)` 固定编号，
  `display:none` 元素仍占序号 → 按上下文隐藏按钮后菜单出现空洞（剪贴板空隐藏粘贴、
  Viewer 选中、回收站守卫等场景）；selection 集第 8 个按钮缺位移规则叠在 FAB 上。
  改为槽位类（slot-1..8）由 JS 按可见顺序重排（`_applySlots`，用 offsetParent 判可见，
  规避 computed display 对隐藏祖先后代返回自身值的 Chrome 行为）；FAB 状态机收敛为
  单一 `_state` + `_syncContext` 集中按钮显隐；返回键消费展开的菜单
- **feat：移动文件**：FAB selection 菜单新增「移动」→ 目标文件夹选择器（级联浏览 +
  面包屑，移植 LexiCull 移动交互）→ 复用真移动管道（进度/取消/失败汇总/清选中/刷新）。
  守卫：源所在目录 / 自身与子文件夹（循环移动）/ 锁定文件；底部按钮固定「取消/确认」，
  目标不可移动时确认变灰、点击吐司原因（不用 disabled，保证吐司可触发）
- **feat：FAB 悬浮球拖拽定位**：按住左右滑动切换左/右档位（甩动判定优先、就近吸附 +
  spring 动画 + 原位/对侧幽灵占位），位置持久化 localStorage 刷新保持；菜单展开 /
  取景器激活 / 弹窗打开时禁拖，与短按展开、长按取景器三手势协调（touchcancel 作废
  点击 + 取消长按 timer）
- **回归探针 ×4**：tools/ui/fab-gap-probe / fab-context-probe / move-target-probe /
  fab-drag-probe（无头 Chromium + CDP 触摸序列，mock 文件系统跑守卫与流程断言）

### 旋转画布 review 修复（2026-08-17）

- **P0 修复：goHome 横屏闪回竖屏**：`goHome()` 创建目标相机时未传 rotation
  （`DesktopCamera.create()` 第四参缺省 → rotation=0），横屏点 Home 动画落点
  rotation=0 导致画布闪回竖屏。修复：传 `C.camera.rotation`；`animateCameraTo`
  改为浅拷贝 target 防 mutate 调用方对象
- **P1 修复：saveLayout 不持久化 rotation**：`saveLayout` 写入相机缺 rotation 字段，
  崩溃恢复后按 rotation=0 重建相机——横屏状态下 app 被杀重启，相机 x/y 是横屏视角
  但 rotation=0，视口显示完全不同的区域。修复：写入 `rotation` + `_loadLayoutAndCamera`
  恢复时透传 `saved.camera.rotation`
- **P1 修复：handleWorldRect 旋转命中矩形错乱**：rotation=90 时返回的矩形
  宽=HANDLE_W/z 高=HANDLE_H/z（轴对齐横条），但实际手柄在世界空间是竖条
  （屏幕逆旋转后宽高互换）。修复：`handleWorldRect` 增加 `vw/vh` 参数，旋转态
  先算屏幕矩形再逆变换回世界坐标（精确互逆）；`handleHitTest` 级联传视口尺寸；
  无 vw/vh 时退化旧逻辑（防御路径）
- **P2 修复**：folder clamp 构造的对象缺 `rotation` 字段（补 `rotation: 0`）；
  CSS `.view-menu-check` 残留 `font-style`/`font-weight`（SVG 图标无需）
- **E2E 新增场景 4.6**：横屏下点 Home 按钮 → 断言 rotation 保持 90 + 落在横屏槽位
  （P0-1 回归守卫，此前 E2E 仅用菜单切换方向未覆盖 goHome 路径）

### 切换画布方向：落在目标方向槽位（2026-08-17）

- **修正落位语义**：此前切换方向读的是**当前方向**槽位再旋转（旋转后落在「当前
  方向 Home 位置 + 新方向」），未真正回到目标方向的 Home 位置。
  现改为读**目标方向**（next）槽位——竖屏切横屏读 `landscapeHome`/`landscapeFallback`，
  横屏切回竖屏读 `home`/`fallback`；相机直接落在目标方向槽位的 x/y/zoom + 目标方向
  rotation；目标方向无槽位时保持当前位置只转方向
- **E2E 增强**：verify-rotate.js 场景 4.5 区分两槽位位置（横屏再平移后记录 P2 ≠ 竖屏
  槽位 P1），断言「切回竖屏落在 P1」「再切横屏落在 P2（rotation=90）」——真实验证
  「切到哪个方向就落在哪个方向的槽位」
- **文档**：interaction.md 7.7 切换语义改为「落在目标方向槽位」+ CHANGELOG

### 切换画布方向：MD 勾选图标 + 先回 Home 再转方向（2026-08-17）

- **菜单勾选标记改 MD 图标**：view-menu 各勾选项（网格/列表/高级浏览模式/切换画布方向）
  从文字对勾（`<i class="view-menu-check">`）改为 MD 风格 SVG check 图标
  （`icon-check` symbol，`<svg class="view-menu-check"><use href="#icon-check"/></svg>`）
- **切换方向先回 Home**：每次切换画布方向，先自动回到**当前方向**的 Home 槽位
  （快照优先 > 默认视角 > 出厂 (0,0,1)）再旋转——旋转是绕视口中心的，停在任意位置
  旋转后看到的区域完全不同；先回 Home 保证旋转后落在当前方向的 Home 视角（位置可预期）。
  无 Home 槽位时保持当前位置只转方向
- **验证**：verify-rotate.js E2E 新增「勾选标记为 #icon-check」+「切换后相机位置保持/回 Home」断言

### 切换画布方向 + 横屏/竖屏 Home 槽位（2026-08-17）

- **菜单项改名**：「旋转画布 90°」→「切换画布方向」（语义更清晰，仍是 0↔90 toggle）
- **Home 槽位按画布方向分**：竖屏（rotation=0）与横屏（rotation=90）各有独立的
  Home 快照/默认视角槽位（`home-store.js` version 2）：
  - 顶层 `home`/`fallback` = 竖屏槽位（version 1 旧数据天然就是竖屏，零迁移）
  - `landscapeHome`/`landscapeFallback` = 横屏槽位（rotation=90 时读写）
  - 切换画布方向后：长按 Home 记录到当前方向槽位、点按 Home 恢复到当前方向槽位、
    底栏 Home 高亮按当前方向槽位有无快照显示；两套槽位互不覆盖
- **调用点**：`captureHome`/`captureDefaultView`/`goHome`（desktop-navigation）、
  启动相机恢复（desktop-persist）、Home 高亮（bottom-bar）均透传 `C.camera.rotation`
- **验证**：`test-home-store` 新增双槽位读写/独立/兼容用例；`verify-rotate.js` E2E
  新增竖屏/横屏快照独立场景（长按记录 → 切换方向高亮跟随 → 互不覆盖）

### 旋转画布 90°（2026-08-17）

- **新增「旋转画布 90°」菜单项**（顶栏「排列与视图」菜单底部，`.view-menu-rotate`）：
  点一下画布绕视口中心顺时针旋转 90°（含图标/文字/背景点阵一起转，像转一张纸），
  再点一下逆时针转回 0°；只旋转画布视觉与坐标映射，相机位置/缩放、图标世界坐标、布局数据不变
- **旋转数学核心**（`desktop-camera.js`）：camera 增加 `rotation` 字段（0/90），
  `transform/applyTo` 生成 `translate3d(...) rotate(90deg) scale(zoom)` 绕视口中心旋转；
  `screenToWorld/worldToScreen/panBy/pinchBy` 全链路旋转适配（屏幕↔世界坐标互逆，
  拖拽跟手、捏合锚点不动），`lerp/lerpCentered/clampToBounds` 透传 rotation
  （Home 动画/目录切换保持旋转态不闪回正）
- **坐标换算签名扩展**：`screenToWorld/worldToScreen/applyTo/transform` 增加可选 `vw/vh`
  （旋转中心 = 视口中心），未传时行为与旧版一致（向后兼容）；手势层/viewer 手柄/框选同步传入
- **viewer 拖动手柄适配旋转**：`handleScreenRect/handleWorldRect` 按旋转后卡片视觉底部
  （原右边缘中心）定位/命中
- **可用性**：根目录（桌面空间）可用，子文件夹（folder 容器）禁用；旋转状态不持久化
  （临时 toggle，刷新回正）
- **验证**：`test-desktop-camera`/`test-desktop-gesture`/`test-viewer` 新增旋转用例；
  新增 `scripts/verify-rotate.js` E2E（旋转 toggle + 勾选态 + folder 禁用）接入 verify.sh

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
