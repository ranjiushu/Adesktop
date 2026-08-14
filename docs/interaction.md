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
| 选中非空 | Morph FAB **自动展开**为操作栏 |

## 5. Morph FAB 操作栏（选中态）

- 选中集合为空 → FAB 展开 `fab-set-preview`（新建/刷新/切换根目录，现状不变）。
- 选中集合非空 → FAB **自动展开** `fab-set-selection`（选中对象操作）。
- 选中态操作项与多选语义：

| 操作 | 单选 | 多选（框选） |
|---|---|---|
| 打开 | 打开文件 / 进入文件夹 | 禁用 |
| 重命名 | 可用 | 禁用（置灰） |
| 删除 | 可用 | 批量删除（需确认） |
| 属性 | 可用 | 可用（汇总） |
| 取消选择 | 清空 | 清空 |

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
| 缩放范围 | 0.4 ~ 2.5 |
| 长按触觉 | `vibrate(30)` |
| 拿起视觉 | 图标 scale 1.1 + 阴影，transition 120ms |

## 7.1 网格系统与放置避让

- 网格：origin (16,16) + step (100,92)，一格一图标，图标左上角对齐网格交点。
- 拖动**无极**（自由跟手），放置（`drop`）时 `snapToGrid` 吸附到最近交点。
- 避让（参考 iOS/Android 主屏「重叠者让位」）：移动组放期望位，与之重叠的静止图标按「右、下、左、上」顺序挤到最近空 cell（`desktop-grid.js` 纯函数）。

## 7.2 复制 / 剪切 / 粘贴（阶段 C 定稿，参照 Windows 剪贴板模型）

- **剪贴板模型**：`Clipboard = { mode: 'copy'|'cut', names: [...] }`，纯内存态（剪贴板语义，进程结束即失效，不做持久化，避免脏路径残留）。
- **复制/剪切时**：只记录路径列表，**文件纹丝不动**（同 Windows CF_HDROP 延迟执行模型）。复制无视觉标记；**剪切源图标半透明**（纯 UI 标记，文件仍真实存在，刷新不穿帮）。
- **粘贴时**：才真正执行文件操作——`copy` 模式 = 桥 `copy(src, dst)`；`cut` 模式 = `copy + delete` 源（SAF 无跨目录 rename，统一 copy+delete）。目标重名自动加序号（复用 `_uniqueName`）。
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

## 10. 手势冲突边界

| 现有手势 | 冲突 | 结论 |
|---|---|---|
| Drawer 右滑（底栏） | 区域不同 | 无冲突，保持 `#bottom-bar` 自己的监听 |
| `bindPress`（按钮） | 区域不同 | 无冲突 |
| FAB 长按 800ms 取景器 | FAB 在 viewport 外，长短按判据不同 | 无冲突 |
