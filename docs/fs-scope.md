# 文件系统范围（决策记录）

## 结论（2026-08-19 更新：全盘访问转正为主方案，内部使用）

**全盘访问（MANAGE_EXTERNAL_STORAGE）为主 + SAF 授权目录降级 + 应用私有目录兜底**

- 首次启动引导「授权访问手机存储」：Android 11+ 跳系统设置页手动开启
  （`ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION`）；Android 10 及以下弹
  `WRITE_EXTERNAL_STORAGE` 运行时权限（Manifest 带 `requestLegacyExternalStorage`）。
- 授权状态**动态检测**（`Environment.isExternalStorageManager()`），不持久化：
  权限被系统撤销后自动降级（有 SAF 授权用 SAF，否则私有目录），无需清理数据。
- **模式优先级：全盘 > SAF > 私有**——全盘授权后旧 SAF rootUri 保留但被遮蔽
  （`isSafMode() = allFilesRoot == null && rootUri != null`），所有操作走 File 分支；
  撤销全盘自动恢复 SAF 模式，无需重新授权。
- 授权变更（授予/撤销）在 `onResume` 检测 → 桥层切换模式 → 前端收到 `App.onRootChanged` 刷新。
- 授权引导为**应用内对话框**（说明 + 「去授权」按钮 → 跳系统设置页，不裸跳）：
  首次启动未授权时自动弹出（localStorage 标记 `all-files-prompted`，拒绝后不重复弹），
  Drawer「授权手机存储」入口同款；已授权时点击提示。
- **桌面根（Desktop Root）**：
  - 全盘模式下：桌面空间渲染的目录，默认 `Desktop`，
    通过 Drawer「桌面目录」使用系统 SAF 目录选择器（`ACTION_OPEN_DOCUMENT_TREE`）配置。
    选择器返回后原生保存授权并切换为 SAF 模式（`forceSafMode=true`），即使仍持有全盘权限也
    强制走 SAF 分支——这是为了能选择应用私有目录（如 `Android/data/...`）等仅 SAF 可访问的位置。
    布局/Home 按 SAF `rootId = <tree uri>` 隔离。
  - 若用户主动点击 Drawer「授权手机存储」并成功授权全盘，重置 `forceSafMode=false`，恢复全盘 File 模式。
  - 回收站（`.trash`）位于当前生效的桥层根下：SAF 模式 = 授权树根部；全盘模式 = 手机存储根。
- 用户未授权全盘时：有旧 SAF 授权（prefs 持久化）用 SAF；否则私有目录 `filesDir/root` 兜底，App 照常可用。
- 「授权手机存储」入口在 Drawer（`switch-root` action，桥层 `requestRootAccess`）。
- Drawer 头部实时显示当前来源（`drawer-root-mode`：手机存储 / 外部存储 / 应用私有目录）。

### 理由

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| 全盘访问（MANAGE_EXTERNAL_STORAGE） | 最像真桌面，任意路径，Drawer 资源管理器式导航（下载/文档/图片…）的地基；Download 等媒体顶级目录无需单独授权 | Play 上架受限（特殊权限审批）、安全风险大 | **主方案**（内部使用） |
| SAF 授权目录 | Play 合规、持久授权、用户可控、无需特殊权限 | 只能访问授权目录内；Download/DCIM 等顶级目录无法单独授权（系统限制）；SAF provider 性能慢于 File 直读 | 降级（全盘不可用时） |
| 应用私有目录 | 零权限、永远可用 | 用户不可见、卸载丢失、不可分享 | 兜底 |

### 已知限制

- **全盘权限仍无法访问 `Android/data` 与 `Android/obb`**（Android 11+ OS 级硬限制）——
  需要管理这些目录时只能走 SAF 授权其具体子目录（如 `Android/data/<pkg>`）。
- 桥层 File 分支 = `java.io.File` 直读（快于 SAF provider 一个量级），
  全盘模式下大目录列表/递归操作性能最优。

## 对前端的影响

- 所有文件路径为**相对根目录**的字符串，由 Java Bridge 解析，禁止前端拼绝对路径
- 路径校验在桥内：拒绝绝对路径、拒绝 `..` 逃逸
- 前端通过 `App.FileAPI`（Promise 封装）访问，与具体后端（全盘/SAF/私有）解耦
- `rootInfo.mode` 取值：`'all-files'`（全盘）/ `'saf'` / `'private'`；
  `rootInfo.rootId` = SAF tree uri / `'all-files'`（全盘模式）/ `'private'`（布局与 Home 快照隔离键）
- **视图模式（isFolderView）**：
  - all-files 模式：桌面空间 = 桌面根（默认 `Desktop`），
    其余目录（含手机存储根 `''`）都是 Folder 容器（资源管理器式浏览）；
    桌面空间「上级」= 手机存储根（folder 容器），手机存储根无上级
  - SAF/私有模式：根目录 `''` = 桌面空间（原语义不变）
- 布局/Home 按 `rootId` 隔离：切换根（SAF tree 变化 / 全盘与 SAF 互切）后布局不继承
  （见 operation-contract.md 1.6）
