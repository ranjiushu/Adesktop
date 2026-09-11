# 桌面交互设计（定稿）

> 本文固化桌面（`<section class="app-content">`）无限画布与对象选择交互的最终决策。
> 实现分阶段推进（见文末），本文是手势识别的唯一权威来源。

## 1. 术语

- **桌面** = `src/index.html` 中的 `<section class="app-content">`（应用主内容区）。
- **世界坐标** = 图标在无限画布中的固定位置 `(x, y)`，与屏幕/缩放无关，单位「世界像素」。
- **相机** = `{ x, y, zoom }`，描述视口左上角在世界中的位置与缩放因子。
- **屏幕坐标** = 视口内像素位置（`clientX/clientY`，视口左上角为原点）。

## 2. 坐标模型（世界坐标 + 相机，单层 transform）

- 每个图标有固定世界坐标 `(x, y)`。
- 相机 `{ x, y, zoom }`：`x/y` 是视口左上角对应的世界点，`zoom` 是缩放因子。

转换（纯函数，见 `desktop-camera.js`）：

```
屏幕 → 世界：worldX = camera.x + screenX / zoom
世界 → 屏幕：screenX = (worldX - camera.x) * zoom
```

DOM 结构（两层，只在 canvas 单节点上动 transform）：

```
section.app-content（桌面）
├── #desktop-viewport   overflow:hidden，手势监听层，touch-action:none
│   └── #desktop-canvas position:absolute，唯一动 transform 的层
│       ├── 背景网格（dot grid，随相机移动缩放）
│       └── #desktop-grid（图标层，绝对定位，坐标=世界坐标）
└── #status-text        浮层，不随画布变换（不参与平移缩放）
```

- `canvas` transform = `translate3d(-camera.x*zoom, -camera.y*zoom, 0) scale(zoom)`，`transform-origin: 0 0`。
- 缩放/平移时图标 DOM 完全不碰，浏览器只做合成层变换（GPU），不触发布局。
- 图标文字极端缩放时模糊是必然的，用 LOD 缓解（见 §6）。

## 3. 手势状态机（完整定稿）

### 识别框架

- 监听 `#desktop-viewport` 的 touch 三件套（`touchstart/move/end/cancel`），`{ passive: false }` + `touch-action: none`。
- **识别与动作解耦**：手势识别（状态机）只产出语义事件，动作处理器订阅语义事件。
- 指数突变是 bug 温床，规则固定：
  - 1→2 指：取消当前单指意图（框选/长按拿起均取消），切入双指 panzoom。
  - 2→1 指：退出 panzoom，剩余那根指进入 `dead`（直到抬起才清空），**绝不**误触发 tap/框选。
- **单指意图的强制终结路径（生命周期完整性）**：任何未完成的单指意图（框选/拿起/拖动）
  在 1→2 指切换或 `touchcancel`（系统接管，如来电/通知）时必须派发 `single-cancel`
  语义事件并复位状态机——这是拖动生命周期的「finally」收尾，否则 picked-up 视觉
  （放大 + 阴影）与框选矩形会滞留成悬浮残影。`singleCancel` 纯函数：只有
  marquee/pickedup/dragmove 相位才产出 `single-cancel`，pending/idle 无意图可取消。

### 单指（down 先判定起点命中类型：selected / icon / empty）

```
down ──────────────────────────────────────────────────
  │ 移动 > 6px：
  │   selected（已选中）→ drag-move 直接拿起（不必长按）
  │   icon / empty       → marquee 框选 → up 计算 AABB 交集
  │ 停住 500ms（< 6px）  → picked-up 拿起（震动 + 图标放大 1.1x + 阴影）
  │                         ├ 继续移动 → drag-move（图标跟随手指）
  │                         └ 不动 up  → drop（位移≈0 = 取消，弹回原位）
  │ 抬起 < 6px 且 < 500ms → tap → 300ms 双击窗口
  │ 任意相位遇 1→2 指 / touchcancel → single-cancel（收尾：回收拿起态/框选矩形）
  │                                   ├ 窗口内二击 → doubletap（打开）
  │                                   └ 窗口超时  → 确认 select / deselect
```

命中类型（`desktop.js` 的 `hitTest`，同步回调供手势模块分流）：

- `selected`：落在已选中图标上，或落在选中组的 union AABB 内（含组内空隙，一整块）。
- `icon`：落在未选中图标上。
- `empty`：空白。

### 双指（平移 + 缩放并行，不做「平移 vs 捏合」二选一）

- 同一手势内同时计算：质心位移（平移）+ 指距比（缩放）。
- 每帧串联执行：先 `panBy`（质心位移），再 `pinchBy`（指距变化，锚点=当前质心）。

## 4. 手势 → 动作 映射（定稿）

| 手势 | 动作 |
|---|---|
| 双指拖动 / 捏合 | 平移 / 缩放镜头 |
| 单指拖动（已选中图标/组合） | 直接拿起移动（不必长按） |
| 单指拖动（空白/未选中图标） | 矩形框选 |
| 单击 | 选中 / 反选 |
| 双击 | 打开（文件 / 进入文件夹） |
| 长按图标 → 拿起 → 拖动 | 移动图标（已选中则整组拖动；拖动无极，放置时吸附+避让） |
| 按住 Viewer 拖动手柄 → 拖动 | **自动选中该 Viewer + 直接移动实体**（辅助拖动区，不必先点击/长按；轻点手柄 = 仅选中）。拿起判定以**按下起点**为命中基准（手柄命中区仅 6px 高，位移超阈值后移动点必出界，不能以移动点重新命中） |
| 拖动中 1→2 指 / touchcancel | **取消拖动**：图标还原起始位、拿起态回收，不落盘（取消 = 什么都没发生） |
| 选中非空 | Morph FAB **自动展开**为操作栏 |

### 选中态生命周期（Windows 原则）

参照 Windows Desktop：**选中态是临时、脆弱的状态**，许多行为会使其消失，不应长期驻留：

- 单击空白 / 框选空白 → 清空选中（现状）。
- 双击打开 / 进入文件夹 → 清空选中（现状）。
- **移动完成（drop moved=true）→ 清空选中** + 收起 FAB 操作栏（本次补齐）。
- **剪切/复制粘贴完成后 → 清空选中**（源路径已失效：cut 源已删、copy 目标已生成，
  避免「幽灵选中」残留操作栏）。
- **关闭 Morph FAB（原位点击 / 返回键 / 动作完成后收起）→ 清空选中**——「FAB 展开 ⇔ 选中态」
  语义收敛：selection 态下收起 FAB 即取消选中，不再设独立「取消/取消选择」按钮
  （取消 = FAB 原位 morph 为 × 后点击，见 fab-speed-dial.js collapse）。
- 原地拿起放下（moved=false）→ 选中保留（什么都没发生）。
- 拖动取消（single-cancel）→ 选中保留（取消 = 什么都没发生）。
- 后退/前进/上级目录 → 保留选中（Windows 按文件夹记忆选中态）。

## 5. Morph FAB 操作栏（选中态）

- 选中集合为空 → FAB 展开 `fab-set-preview`（新建/刷新/切换根目录，现状不变）。
- 选中集合非空 → FAB **自动展开** `fab-set-selection`（选中对象操作）。
- **FAB 展开 ⇔ 选中态一致**：关闭 Morph FAB（原位点击 × / 返回键 / 动作完成后收起）=
  取消选中；「取消」不设独立按钮，由 FAB 原位承担（图标 + → ×）。
- 选中态操作项与多选语义：

| 操作 | 单选 | 多选（框选） |
|---|---|---|
| 打开 | 打开文件 / 进入文件夹 | 禁用 |
| 重命名 | 可用 | 禁用（置灰） |
| 删除 | 可用 | 批量删除（需确认） |
| 属性 | 可用 | 可用（汇总） |

## 6. LOD（缩放降级）

| zoom 档位 | 表现 |
|---|---|
| ≥ 1 | 图标 + 文字正常显示 |
| 0.6 ~ 1 | 隐藏文字只留图标 |
| < 0.6 | 图标降密度（甚至合并为圆点），背景网格变稀 |

## 7. 参数初值（真机调，不碰结构）

| 参数 | 初值 |
|---|---|
| tap/拖拽阈值 | 6px |
| 长按触发时长 | 500ms |
| 双击窗口 | 300ms |
| 缩放范围 | 0.1 ~ 10 |
| 长按触觉 | `vibrate(30)` |
| 拿起视觉 | 图标 scale 1.1 + 阴影，transition 120ms |

## 7.1 网格系统与放置避让

- 网格：origin (16,16) + step (100,116)，一格一图标，图标左上角对齐网格交点。
  （图标占位固定 106px，对齐 Windows/macOS 桌面模式：cell 与内容解耦——缩略图 48 /
  类型图标 36 / 名字两行 38px 都在占位内渲染，内容差异不改变占位尺寸；
  116px 步进留 10px 余量。选中高亮跟随固定占位，任何内容下都不重叠）
- 拖动**无极**（自由跟手），放置（`drop`）时 `snapToGrid` 吸附到最近交点。
- 避让（参考 iOS/Android 主屏「重叠者让位」）：移动组放期望位，与之重叠的静止图标按「右、下、左、上」顺序挤到最近空 cell（`desktop-grid.js` 纯函数）。

## 7.2 复制 / 剪切 / 粘贴（阶段 C 定稿，参照 Windows 剪贴板模型）

- **剪贴板模型**：`Clipboard = { mode: 'copy'|'cut', names: [...] }`，纯内存态（剪贴板语义，进程结束即失效，不做持久化，避免脏路径残留）。
- **复制/剪切时**：只记录路径列表，**文件纹丝不动**（同 Windows CF_HDROP 延迟执行模型）。复制无视觉标记；**剪切源图标半透明**（纯 UI 标记，文件仍真实存在，刷新不穿帮）。
- **粘贴时**：才真正执行文件操作——`copy` 模式 = 桥 `copy(src, dst)`；`cut` 模式 = 桥 `move(src, dst)`（真移动优先：私有模式 `File.renameTo` 原子移动 / SAF 模式 `DocumentsContract.moveDocument`，provider 不支持时桥层自动降级 copy+delete）。目标重名自动加序号（复用 `_uniqueName`）。
- **进度与取消**：复制/移动降级路径中，桥层按约 200ms 节流推送字节级进度（`__fbProgress`），
  对话框显示当前文件行（文件名 + 已拷贝/总量）；传输中提供「取消」按钮（`cancelTransfer`），
  取消后桥层清理本次创建的半成品（原本不存在的目标）。
- **失败汇总**：批量操作失败不中断，逐项收集；结束后失败项 >0 弹列表（成功 N / 失败 M + 每项原因）。
- **桥缺口**：需新增 `FileBridge.copy(srcPath, dstPath)`（Java 递归拷贝，支持目录）。
- **入口**：复制/剪切 = 选中态操作栏按钮；粘贴 = 预览态菜单按钮（剪贴板为空时点击提示）。

## 7.3 目录导航（阶段 C 定稿）

- 桌面**不再固定根目录**：以「当前目录」为视图范围，图标渲染 = `list(curPath)` 的结果。
- **进入文件夹**：双击文件夹图标 / 选中后点「打开」→ `nav.enter(curPath + '/' + name)`，刷新视图。
- **后退/前进**：底栏左侧两个按钮 = 后退（＜）/ 前进（＞），驱动历史栈 `{ stack, index }`（模块 `desktop-nav.js` 纯函数）：
  - `enter`：截断前进分支后压栈；`back`：index-1；`forward`：index+1。
  - 根目录不可后退、栈尾不可前进（按钮禁用态）。
- **布局 key 升级为完整路径**：`positions`/`bounds`/`iconEls` 的 key = `join(curPath, name)`（如 `docs/a.txt`），避免不同目录同名文件冲突；localStorage 旧数据（根目录短名 key）天然兼容（根目录下 `join('', name) === name`）。
- **剪贴板存完整路径**：跨目录粘贴时目标 = `join(curPath, uniqueName(...))`。
- **双击窗口**：300ms 内二击同一位置 → `doubletap`（打开）；超时 → 确认单击语义（`tap` 视觉即时选中，仅反选延迟）。

## 7.4 视图模式：Desktop 空间 vs Folder 容器（阶段 D 定稿）

打开文件夹后，视图从「空间」切换为「容器」——两者是**同一套手势识别与选择系统**，仅画布语义不同：

| 维度 | 根目录 = Desktop（空间） | 子文件夹 = Folder（容器） |
|---|---|---|
| 画布 | 无限，可平移 + 缩放（0.1~10） | 有界纸面（白底），zoom 锁 1、x 锁 0，**只能上下滚动**且 y 钳制画布边界（`clampToBounds`） |
| 排布 | 自由摆放（持久化位置优先 + 自动网格） | 自动排布，不读/不写持久化位置 |
| 视图 | 无 | 网格（4 列自适应视口宽）/ 列表（单列行，56px 行高），顶栏菜单切换 |
| 排序 | 无 | 按名称/修改日期/类型/大小 + 升降序（`folder-sort.js`），顶栏菜单切换 |
| 图标拖动 | 长按拿起移动（网格吸附 + 避让）；**拖动中命中文件夹 → 实时标签「文件将移入 XXX 文件夹」，松手 = 移入文件夹（桥 move，真移动优先，移动语义）** | **长按拿起移动**；命中文件夹图标 → 移入该文件夹（桥 move，真移动优先）；未命中 → 还原原位（folder 位置自动排布，不吸附不落盘） |
| 单指空白拖动 | 框选 | 框选（沿用 Desktop，不引入滚动） |
| 单指图标拖动 | 已选中直接拿起 / 未选中框选 | 框选（多选保留） |
| 双指拖动 | 平移 + 缩放并行 | **滚动**（pan，y 钳制画布边界；x 锁 0、zoom 锁 1） |
| 相机 | 持久化，返回根恢复 | 每次进入重置到顶 (0,0,1)，不持久化 |

- **顶栏右上菜单**：排列方式（4 项 + 方向切换）+ 视图（网格/列表）。根目录下置灰（仅提示「打开文件夹后可用」），进入子文件夹后可选。偏好经 `view-store.js` 全局持久化。
- **手势沿用 Desktop**：单指 tap/双击/框选/长按与根目录完全一致（folder 中长按图标 = 拿起，拖到文件夹图标移入，未命中还原）；双指 = 滚动（pan 钳制 + zoom 锁 1），由 gesture 层 `onClamp` 回调每帧钳制，保证 transform 与相机状态一致。
- **拖动语义（已实现）**：容器内长按图标进入「移动」模式，拖到目标文件夹上放下 = 移动文件（桥 `move`：真移动优先——私有 `File.renameTo` / SAF `moveDocument`，provider 不支持时降级 copy + delete 源）；拖动中实时标签提示目标文件夹，未命中文件夹则还原原位（folder 位置自动排布，无吸附/落盘语义）。
- **切换相机策略**：进入文件夹前快照根相机（`rootCamera`）；返回根目录恢复；进入/切换文件夹重置 `(0,0,1)`。

## 7.5 Home：位置快照与默认视角（定稿）

**Home 的定位**：Camera 的默认起点和用户返回 Desktop 核心区域的空间锚点——不是真实文件夹或文件对象。无限空间必须存在一个容易理解的归属位置，否则用户可能失去方向感。

- **入口**：底栏右 1 按钮（Home，房子图标）。仅桌面空间（根目录）可用——子文件夹（Folder 容器）内禁用（相机是滚动态，快照无意义），随 `refresh` 更新禁用态。
- **长按 Home（500ms）**：记录当前桌面空间的相机 `{x, y, zoom}` 为位置快照（震动 + toast 反馈）。再次长按覆盖。
- **点按 Home**：相机平滑过渡（400ms）回到快照位置；无快照 → 回到默认视角；默认视角也未设置 → 出厂视角 `(0,0,1)`。
- **启动（重新进入）**：启动相机优先级 = Home 快照 > 默认视角 > 上次布局视角 > 出厂 `(0,0,1)`（`initLayout` 决策 + `rootCamera` 基准）。Home 是 Camera 的默认起点：设置过快照后，每次进入桌面空间都落在快照位。
- **默认视角**：Drawer「设为默认视角」操作项 = 把当前桌面相机设为默认视角（Home 无快照时的兜底）。未设置时出厂视角即兜底。
- **持久化**：`localStorage['desktop.home.v1']`（模块 `home-store.js`）：
  ```json
  { "version": 1, "home": { "x": 0, "y": 0, "zoom": 1 }, "fallback": { "x": 0, "y": 0, "zoom": 1 } }
  ```
  home 与 fallback 互不覆盖；zoom 超范围数据在应用时由 `DesktopCamera.create()` 钳制。
- **视觉**：已记录快照时 Home 图标强调色（`home-has-snapshot`），提示「快照存在，点按即回」。
- **边界**：Home 不覆盖 `rootCamera`——从文件夹返回仍恢复进文件夹前的视角，Home 只负责「现在」的空间锚点。
- **切换动画**：视角切换为平滑飞行——`lerpCentered` 单一连续飞行曲线（van Wijk & Nuij 平滑 zoom-pan 算法，Leaflet `flyTo` 同款数学：tanh 曲线走 center + cosh 曲线走 zoom；远距离放大时先 zoom-out 让路再 zoom-in，近距离放大/缩放下 zoom 单调），400ms RAF 驱动。zoom 变化走 easeOut 弧长参数化（起步轻快、收尾平滑，Leaflet 同款手感），zoom 不变退化为 easeInOutCubic 与 `lerp` 一致（纯平移，缓入缓出）。无分段（不断续）、无骤停（不震）、数学上屏幕内图标**中心点**全程不出界。动画中开始手势（`onGestureStart`）或目录切换（`applyCameraForPath`）即打断，手势直控优先，动画永不与手势抢相机。

## 7.6 高级浏览模式（阶段 E 定稿）

**定位**：一种「浏览优先」的相机操控模式——把单指拖动从「框选/拿起」切换为「平移画布（桌面）/ 滚动目录（文件夹）」，适合查看大量文件时单手浏览；需要精细操作（框选、拖移）时可临时切回普通语义，不必反复开关。

- **开关**：顶栏「排列与视图」菜单底部「高级浏览模式」勾选项（`.view-menu-browse`，`data-browse="advanced"`）。**始终可用**——根目录下其余菜单项置灰（`setEnabled(false)`）时，本项走独立处理器 `_onBrowseToggle`，不受 `_enabled` 限制。
- **生效条件（effective）**：`effective = 高级浏览 ON && 非临时操作模式`。`syncBrowseMode()` 同步到手势层 `App.DesktopGesture.setBrowseMode(effective)`。任一条件不满足 → 手势回退普通语义。
- **单指拖动 → pan 而非框选**：`_browseMode` 为真时，单指 move 超阈值（`> 6px`）且命中 `empty`（空白）或 `icon`（未选中图标）→ 进入 `pan` 相位（`pan-start` / `pan`），而非 `marquee` 框选。桌面空间 = 平移画布（world 坐标）；文件夹容器 = 滚动目录（沿用 §7.4 的 y 钳制 + x/zoom 锁）。命中 `selected`（已选中文件）仍走 `dragmove` 拿起移动——浏览模式不改变「拖已选中项」的移动语义。
- **pan 松手惯性（动量，阶段 G）**：高级浏览模式下，单指 pan 松手（`pan-end`）时，按 **末段速度**（VelocityTracker 语义，100ms 窗口，与 Drawer 同款）判断是否触发惯性。采用 **iOS `UIScrollView.DecelerationRate` 标准模型**（速度每毫秒乘以保留比例 `v(t)=v0·d^t`；`normal=0.998` 长列表手感 / `fast=0.99` 图片查看器"滑一小段即平滑停"手感）。本需求取 `fast=0.99`，并配套三处成熟做法：①停止阈值降到 `0.005 px/ms`（≈每帧 0.08px，视觉不可见才停 → 杜绝"抽刀急停"）；②时长上限放宽为 `3000ms`（纯防死循环兜底，靠指数衰减自然平滑收尾）；③速度上限 `4 px/ms`（Android `VelocityTracker.maxVelocity` 标准做法，防极用力甩导致滚太远）。慢拖松手速度低于阈值（`0.2 px/ms`）→ 跟手即停，不滑行。桌面空间无边界钳制（惯性自由衰减）；文件夹容器受 `onClamp` 边界钳制（撞到上下边界时该轴速度清零，防推墙抖动）。**打断**：任何新手势落下（`onStart`）、`touchcancel`、目录切换（`setCamera`）都立即取消惯性——绝不让惯性/动画与手势抢相机（用户一碰或目录一切换就归直控）。实现：`desktop-gesture.js` 纯函数（`windowVelocity`/`inertiaStep`/`inertiaDone`）+ RAF 驱动。仅高级浏览模式 pan 相位生效，其他手势（框选/拖动/双指）不受影响。
- **双击空白 → 临时操作模式**：高级浏览 ON 时，双击空白（300ms 双击窗口内二击无图标位置）→ 切换 `_tempNormalMode` 进入/退出「临时操作模式」（toast + 震动反馈）。进入临时模式时 `effective = false`，单指拖动恢复框选/拿起语义，方便临时做选择；再次双击空白退出，回到纯浏览 pan。打断条件（`exitTempMode`）：返回 / 打开 Drawer / 目录导航 / 再次双击空白。
- **偏好持久化**：`view-store.js` 的 `advancedBrowse`（默认 `false`，缺失/非法回退 false）。`setAdvancedBrowse(on)` 切换时合并写入 `ViewStore.save`，写入失败 toast「浏览模式保存失败」；启动时 `initLayout` 读回 `_advancedBrowse = !!prefs.advancedBrowse` 并同步到手势层。
- **与阶段 D 的关系**：浏览模式只改手势语义，不触碰位置持久化；进入/退出浏览模式不改变相机与图标世界坐标。

## 7.7 旋转画布（阶段 F 定稿）

**定位**：画布整体顺时针旋转 90° 的视图变换——「像转一张纸」，图标/文字/背景点阵随画布一起转（文字侧躺），
再次点击转回 0°。只旋转画布视觉与坐标映射，**不改变**相机位置/缩放、图标世界坐标、布局持久化数据。

- **开关**：顶栏「排列与视图」菜单底部「切换画布方向」勾选项（`.view-menu-rotate`，`data-rotate="toggle"`）。
  勾选标记为 MD 风格 check 图标（`icon-check` symbol，非文字 ✓）。
  **与其余项相反的可用性**——根目录（Desktop 空间）可用，子文件夹（Folder 容器）禁用
  （`setEnabled(true)` 时 `disabled`；旋转对有限画布滚动容器无意义）。仿高级浏览模式走独立处理器 `_onRotateToggle`。
- **状态存储**：`camera.rotation`（0 或 90）。旋转是瞬时两态切换（无过渡动画），
  `App.Desktop.toggleRotate()` 以当前 x/y/zoom 重建相机对象（带 rotation）→ `DesktopGesture.setCamera` 重放
  transform → `InternalViewer.syncHandles` 重算手柄。`App.Desktop.isRotated()` 供菜单勾选态。
- **切换落在目标方向槽位**：每次切换画布方向，相机自动落到**目标方向**的 Home 槽位
  （竖屏切横屏读 `landscapeHome`/`landscapeFallback`，横屏切回竖屏读 `home`/`fallback`；
  快照优先 > 默认视角）——「切到哪个方向就用哪个方向的槽位」。旋转是绕视口中心的，
  落在目标方向槽位保证旋转后视角可预期；目标方向无槽位时保持当前位置只转方向。
- **数学核心（`desktop-camera.js` 纯函数，rotation 透传）**：
  - `transform/applyTo(camera, el, vw, vh)`：rotation=90 时生成
    `translate3d(c.y*zoom + (vw+vh)/2, -c.x*zoom + (vh-vw)/2, 0) rotate(90deg) scale(zoom)`——
    绕视口中心顺时针旋转（推导：世界 p → scale → rotate → translate 矩阵链，视口中心不动点）。
  - `screenToWorld/worldToScreen(sx, sy, camera, vw, vh)`：旋转时先绕视口中心逆旋转屏幕坐标
    （`(x,y) → (y,-x)`）再走原公式 / 反之（`(x,y) → (-y,x)`）。保证旋转后点击/框选/拖拽命中准确。
  - `panBy`：rotation=90 时屏幕位移先逆旋转（`Δc = (dy, -dx)/zoom` 修正），拖拽方向跟手。
  - `pinchBy`：rotation=90 时锚点屏幕坐标先逆旋转再代入，锚点世界坐标不动。
  - `lerp/lerpCentered/flightPath/clampToBounds`：透传起点 rotation（Home 动画/目录切换期间保持旋转态，
    不会中途闪回正）。
- **viewer 手柄**：`handleScreenRect/handleWorldRect` 适配 rotation——旋转后卡片视觉底部 = 原右边缘中心，
  手柄贴新视觉底部；命中测试基准同步（世界坐标，与手势层 toWorld 一致）。
- **坐标换算签名变化**：`screenToWorld/worldToScreen/applyTo/transform` 增加可选 `vw/vh` 参数
  （旋转中心 = 视口中心），未传时 behavior 与旧版一致（rotation=0 或视口缺失时退化）。
  调用方：手势层 `toWorld/commit`（用 `_viewportW/H` 缓存）、框选 `showMarquee`（`C.viewportWidth/Height`）、
  viewer `syncHandle`（`_layer.clientWidth/Height`）。
- **不持久化**：旋转是临时视图状态（toggle 语义），不入 `view-store`/`layout-store`；刷新/重载回正。
- **Home 槽位按方向分**：竖屏（rotation=0）与横屏（rotation=90）各有独立的 Home 快照/默认视角槽位
  （`home-store.js` version 2：顶层 `home`/`fallback` = 竖屏，`landscapeHome`/`landscapeFallback` = 横屏；
  version 1 旧数据顶层字段天然就是竖屏槽位，零迁移）。切换画布方向后：长按 Home 记录到当前方向槽位、
  点按 Home 恢复到当前方向槽位、底栏 Home 高亮按当前方向槽位有无快照显示。两套槽位互不覆盖。

## 8. 位置持久化（当前：localStorage 临时方案）

- 存 `localStorage['desktop.layout.v1']`（模块 `layout-store.js`）：

```json
{ "version": 1,
  "camera": { "x": 0, "y": 0, "zoom": 1 },
  "icons": { "docs": { "x": 220, "y": 80 }, "report.txt": { "x": 120, "y": 80 } } }
```

- 条目以**名字**为 key：文件删/改名 → 布局条目自然失效，回退自动排布，不报错。
- 新文件无条目 → 自动排布（网格铺开）。
- 拖放结束（`drop`）写盘；写入失败 toast 告警（铁律：写入路径不吞错）。
- camera 也持久化，下次进入回到上次视角。
- 最终仍以「文件即真相」为准：后续迁移到根目录隐藏文件 `.desktop-layout.json`（见 architecture.md）。

## 9. 实施阶段（每阶段可独立验收，测试先行）

| 阶段 | 内容 | 验收 |
|---|---|---|
| A 无限画布 | viewport/canvas + camera 纯变换 + 双指 pan/zoom + 背景网格 + 图标世界坐标 | 双指平移缩放跟手 |
| B 选择+移动 | 单击选中/反选 + 框选 + 长按拿起拖移 + FAB 自动展开操作栏 | 单选/框选/拖移正常 |
| C 打开+操作 | 双击打开 + 操作栏动作（重命名/复制/剪切/粘贴，桥 `copy` 新增） | 双击开、操作栏可用、粘贴落盘 |
| D 持久化 | `.desktop-layout.json` 读写 | 重启恢复视角与摆放 |
| E 高级浏览 | view-menu 勾选开关 + 单指拖动任意位置平移/滚动 + 双击空白临时操作模式 + 偏好持久化（`view-store.js` `advancedBrowse`） | 开关生效、单指拖动平移、双击空白切换临时模式、重启记忆偏好 |

## 10. 手势冲突边界

| 现有手势 | 冲突 | 结论 |
|---|---|---|
| Drawer 右滑（底栏） | 区域不同 | 无冲突，保持 `#bottom-bar` 自己的监听 |
| `bindPress`（按钮） | 区域不同 | 无冲突 |
| FAB 长按 800ms 取景器 | FAB 在 viewport 外，长短按判据不同 | 无冲突 |
