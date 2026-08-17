# 文件操作契约（Operation Contract）

本文件是 Adesktop **文件操作语义**的权威清单：每个操作的前置条件、成功/失败/取消后的
文件系统状态与 UI 状态，以及 SAF / 私有两种后端的行为一致性。

与 `docs/bridge-and-data-contract.md`（桥**方法面**签名锁）互补：那份管「桥能调什么」，
本文件管「操作**应该把文件系统变成什么**」。

> 状态声明：本文件是**现状契约**——如实记录当前行为，包括已知缺陷（标注 [P0]/[P1]）。
> Core Hardening 周期修复这些缺陷后，**须同步回填本文件**（先定标、后施工、修完回填）。

## 一、通用不变式（所有操作共享）

### 1.1 路径约定

- 路径一律**相对根目录**（`''` = 根）；桥层拒绝绝对路径与 `..` 逃逸。
- 前端操作全部使用**完整相对路径**（含目录前缀）；选中集合、布局 key 均以完整路径为键。
- 回收站 = 根目录下隐藏文件夹 `.trash`（`BridgeContext.TRASH_NAME`），rootInfo 回传 `trashName`。

### 1.2 名称唯一性

- 真实文件系统不变式：**同一目录中，一个名字只能对应一个 entry**（Linux/Android 语义，
  不分文件/文件夹）。SAF 各 provider 与私有目录均应满足此不变式。
- 命名规划唯一入口（2026-08-17 收口，测试：`tests/test-clipboard.js` / `test-actions.js`）：
  `App.Clipboard.uniqueName(takenNames, desiredName, isDir)`——create / paste / 删除进回收站
  三处共用（`actions.js` 经 `_finalName` 薄封装调用）；占用键为 **name 单键**（不分类型，
  贴合真实 FS「一名字一 entry」）。
- 重名策略分两种（**均为有意行为，须锁进测试**）：
  - **拒绝**：`rename`——目标目录已存在同名项即报错，不自动加序号（Windows 风格）。
  - **自动加序号**：`create` / `paste` / `删除进回收站`——重名时生成「主名 序号.扩展名」。

### 1.3 传输串行与取消

- 所有文件操作经 `BridgeContext` 的**单线程 executor** 串行执行（同一时刻仅一个传输）。
- 取消 = `cancelTransfer()` 置 `ctx.cancelRequested` 标志（volatile，独立线程写入）；
  复制循环每 8KB/目录条目间检查标志，置位后尽快中止并清理半成品。
- **真移动（File.renameTo / DocumentsContract.moveDocument）为原子瞬间操作，取消对其无意义。**
- 批量取消语义（2026-08-17 修复，测试：`tests/test-actions.js` [P0] 用例）：
  - 用户取消 → JS 侧置 `cancelled` → **剩余项不再调度**（计入「已取消」而非失败）；
  - 当前正在传输的文件由桥层中止并清理半成品；
  - 结束态报「成功 N 项，已取消 M 项」，不弹失败列表；取消 ≠ 失败。

### 1.4 失败安全（不丢数据优先）

- 复制/移动的降级路径（copy+delete）**失败安全**：
  - 复制失败 → 源保留（可重试），目标半成品清理（目标原本不存在才删）。
  - 删源失败 → 目标已生成、源未删（重复，toast 告警，**不丢数据**）。
- 半成品清理附带向上清理本次创建的**空父目录**（`cleanupDst`）。

### 1.5 SAF / 私有双后端一致性

| 维度 | 私有（File） | SAF（DocumentFile） | 一致性 |
|------|-------------|--------------------|--------|
| 真移动 | `File.renameTo`（O(1) 原子） | `DocumentsContract.moveDocument`（provider 级） | 一致，均失败降级 copy+delete |
| 降级复制 | 流拷贝 + `setLastModified` 保留 mtime（失败即抛错） | 流拷贝；**无公开 API 设置 mtime** | [P1] **mtime 不一致**（降级路径下排序行为不同） |
| 重命名 | `File.renameTo`（newPath 含目录 = 跨目录移动） | `DocumentFile.renameTo`（仅同目录改名） | **已收紧（2026-08-17）**：桥层 `FileStore.rename` 校验 newPath 父目录 = oldPath 父目录，跨目录拒绝；JS `Actions.rename(path, newName)` 拒绝含 `/` 的 newName——两后端一致 |
| 路径校验 | `isUnderPrivateRoot` | `isSafeRelPath` + resolve | 一致 |

结论：**「move(src,dst) 成功后最终 FS 状态一致」在真移动路径成立，在降级复制路径受
mtime 差异影响**——该差异已**文档化接受（2026-08-17）**，本轮不引入新机制
（SAF 无公开 API 设置 mtime；如未来需要可按 mtime 投影记录元数据，见 `docs/architecture.md` 分层）。

### 1.6 布局 / Home 快照的 root 隔离

- 布局（图标位置/相机）与 Home 快照是**相对当前根目录**的状态：key 为相对 root 的
  fullPath，切根 A→B 不得继承 A 的布局/相机/Home。
- 存储 key 带 rootId（2026-08-17 修复）：`desktop.layout.<rootId>.v1` / `desktop.home.<rootId>.v1`；
  `rootId` 由 rootInfo 返回（SAF = tree uri / 私有 = `'private'`）。
- 启动时序契约：`initLayout` 在 rootInfo 就绪前同步执行（rootId='' → 读旧 key），
  **refresh 拿到 rootId 后必须用 rootId key 重载布局/相机**（`_reloadLayoutForRoot`）——
  否则旧 key 被迁移删除后，第二次启动起布局丢失回自动排布（回归测试：
  `tests/test-desktop-layout-reload.js`）。切 root 场景同样触发重载。
- 旧版单根 key（`desktop.layout.v1` / `desktop.home.v1`）经 `migrateLegacy(rootId)`
  一次性迁移：首见 root 吸收旧数据后删除旧 key（幂等，测试：test-layout-store.js / test-home-store.js）。

## 二、操作契约表

### 2.1 create（新建文件夹 / 新建文件）

| 属性 | 契约 |
|------|------|
| 输入 | `name`（可为空 → 默认「新建文件夹」/「新建文件」）；当前目录 = 操作目标 |
| 前置 | 当前目录可列（list 用于重名规划）；名称非空或可回退默认名 |
| 成功 | 当前目录出现 `finalName`（重名自动加序号）；toast 显示实际创建名；refresh |
| 失败 | 目录不变；toast「创建失败: 原因」 |
| 取消 | 无取消（单步操作） |
| UI 状态 | 选中态不变；Loading 不出现 |
| 后端 | 私有：`File.createNewFile` / `mkdirs`；SAF：`createFile` / `createDirectory` |

现有测试：`tests/test-actions.js`（createFolder/createFile 桩层）。

### 2.2 rename

| 属性 | 契约 |
|------|------|
| 输入 | `oldPath`（完整相对路径）、`newName`（**纯文件名**，重命名限同目录） |
| 前置 | 单选；`newName` 非空、≠ 原名、**不含路径分隔符**（含 `/` 拒绝——跨目录 = move 管道，不走 rename）；目标未被 Viewer 锁定（`_isLocked` 拒绝，含锁定目录内子项）；目标目录**无同名**（重名拒绝，不自动加序号） |
| 成功 | 目录内 `oldPath` 消失、`newPath` 出现；布局 key 迁移（positions/bounds/selection 旧 key → 新 key）+ saveLayout + refresh（`applyRename` 内部完成）；toast「已重命名」 |
| 失败 | 目录不变（桥层失败：SAF renameTo 失败 / 私有 renameTo 失败）；toast「重命名失败」 |
| 取消 | 无取消（单步操作） |
| UI 状态 | 锁定文件拒绝时 toast 提示；成功 toast 后对话框关闭 |
| 后端 | 私有：`File.renameTo`（桥层校验父目录一致，跨目录拒绝）；SAF：`DocumentFile.renameTo`（仅同目录）——两后端一致 |

现有测试：`tests/test-desktop-applyrename.js`（布局 key 迁移）、`tests/test-actions.js`（重名拒绝）。

### 2.3 copy（复制 → 粘贴）

| 属性 | 契约 |
|------|------|
| 输入 | `copySelection(entries)` → 剪贴板 `{mode:'copy', entries}`；`paste()` → `{mode:'copy', entries}` |
| 前置 | 源未被锁定（含锁定目录内子项）；剪贴板可写/非空；目标目录可列 |
| 成功 | 源保持不变；目标目录出现每个条目的 `dstName`（重名自动加序号）；toast「已粘贴 N 项」；clearSelection + refresh |
| 失败 | 单项目失败**不中断**，收集进失败列表；结束后 toast「已粘贴 N 项，失败 M 项」+ 失败列表弹窗；成功项保留 |
| 取消 | 当前文件中止 + 清理半成品；**剩余项不再调度**（取消后停止，见 1.3） |
| UI 状态 | Loading 显示字节级进度（当前文件行 + 总进度）+ 取消按钮；结束后 clearSelection（Windows 原则：源路径失效即清空选中）+ refresh |
| 后端 | `TransferEngine.copy`：递归流拷贝 + 节流进度；私有保留 mtime / SAF 不保留（见 1.5） |

### 2.4 move（剪切 → 粘贴 / 拖入文件夹）

| 属性 | 契约 |
|------|------|
| 输入 | `cutSelection(entries)` → 剪贴板 `{mode:'cut', entries}`；`paste()`；`moveIntoFolder(entries, dirPath)` |
| 前置 | 源未被锁定；剪贴板非空；目标目录可列 |
| 成功 | `srcPath` 消失、`dstPath` 出现（重名自动加序号）；布局 key 迁移（applyMoves）+ saveLayout + refresh；toast「已移动 N 项」；**剪贴板清空**（`keepClipboard` 场景如拖入文件夹除外） |
| 失败 | 单项目失败不中断；复制失败源保留（可重试）；删源失败目标已生成（重复，告警）；结束后失败列表弹窗 |
| 取消 | 当前文件中止 + 清理半成品；**剩余项不再调度**（取消后停止，见 1.3） |
| UI 状态 | cut 源图标半透明标记（render 时 `Clipboard.isCut`）；Loading + 取消按钮；结束后 clearSelection + refresh |
| 后端 | `TransferEngine.move`：真移动优先（私有 `renameTo` / SAF `moveDocument`），失败降级 copy+delete；降级路径 mtime 差异见 1.5。**SAF 改名语义（2026-08-17 修复）**：`moveDocument` 无目标名参数，仅当 `src leaf == dst leaf` 时走 provider 真移动；重名规划后需改名（`dst leaf != src leaf`）一律 copy+delete——前端规划的目标名不被 provider 无视 |

### 2.5 delete（= 移入回收站，安全删除）

| 属性 | 契约 |
|------|------|
| 输入 | `deleteSelection(entries)` |
| 前置 | 已授权（`trashName` 非空，未授权拒绝）；**回收站自身不可删**；未被锁定；无回收站名拒绝 |
| 成功 | 源从原目录消失，出现在 `.trash/`（重名自动加序号——**同名多次删除会加序号**，恢复不保证原名）；布局 key 迁移 + refresh；toast「已删除 N 项」 |
| 失败 | 同 move 失败语义（复用移动管道，`keepClipboard: true` 不清用户剪贴板） |
| 取消 | 同 move 取消语义（见 1.3：剩余项不再调度） |
| UI 状态 | Loading「正在删除」；结束后 clearSelection + refresh |
| 后端 | 无独立桥方法——前端组装为 `move(entries, .trash)`（真移动优先，O(1) 秒删大文件夹）。桥层 `delete` 方法 = **永久删除**（低层能力，前端业务禁止调用，见 bridge-and-data-contract.md 1.4） |

### 2.6 restore（恢复 = 回收站内 move，无独立 API）

| 属性 | 契约 |
|------|------|
| 输入 | 回收站内选中 entries → `cutSelection` → 目标目录 `paste()` |
| 前置 | 在 `.trash` 目录内（`inTrash`）；未被锁定 |
| 成功 | 条目从 `.trash` 移回目标目录；目标目录重名 → **自动加序号（不还原原名）**；布局迁移 + refresh |
| 失败/取消 | 与 move 完全一致（复用同一管道） |
| UI 状态 | 与 move 一致（Loading / 取消 / 失败列表 / clearSelection） |
| 说明 | 现状无「一键还原到原目录」能力（不记录删除前路径元数据）；恢复 = 用户手动移动。本轮**不新增能力**，契约如实记录 |

### 2.7 open

| 属性 | 契约 |
|------|------|
| 输入 | `item = {name, path}`；anchor（桌面空间世界坐标，null = 沉浸式） |
| 前置 | 文件存在；类型可由 `FileOpener.kindFor` 分派 |
| 成功 | 内部 Viewer 打开（text/markdown/json/html/svg/image/video/audio/website）→ 文件路径**加入锁定集合**（Windows 式：锁定期间 rename/copy/cut/delete 拒绝，含锁定目录内子项）；外部应用（unknown 类型）→ `openExternal` 分派，**不锁定**；`.desktop` 快捷方式 → launchApp / website iframe，不锁定 |
| 失败 | 内部预览失败 → onFallback 交外部应用；无可用应用 → toast「无法打开」 |
| 取消 | Viewer 关闭（FAB 关闭预览）→ 解除文件锁定（`closeViewer`） |
| UI 状态 | 锁定视觉同步（`updateLockedVisual`/syncFab）；关闭后解锁 |
| 后端 | `read`（文本类）/ `resolveUri`（媒体流式）/ `openExternal`（ACTION_VIEW）/ `openUrl`（浏览器兜底） |

现有测试：`tests/test-file-opener.js`（kindFor 分派）、`tests/test-desktop-viewerlink-lock.js`（锁定）。

## 三、命名规划器（唯一入口）

- 唯一入口：`App.Clipboard.uniqueName(takenNames, desiredName, isDir)`（2026-08-17 收口）。
  - `takenNames`：目标目录全部 entry 的 name 数组（**不分类型**）；
  - 文件拆主名/扩展名（「报告.txt」→「报告 2.txt」），文件夹整体加序号（「新建文件夹 2」）；
  - 调用方：`actions.js::_finalName`（create）、`clipboard.js::planPaste`（paste / delete 进回收站）；
  - `rename` 保持「重名拒绝」语义不变（不调用本入口，见 2.2）。

## 四、测试矩阵（映射 + 待补）

| # | 不变式/行为 | 现有测试 | 状态 |
|---|------------|---------|------|
| 1 | create 重名加序号 | test-actions.js | 已有 |
| 2 | paste 重名加序号（planPaste 纯函数） | test-clipboard.js | 已有 |
| 3 | rename 重名拒绝 | test-actions.js | 已有 |
| 4 | 批量失败不中断（失败收集 + 汇总） | test-actions.js | 已有 |
| 5 | 取消防抖（cancelTransfer 只发一次） | test-actions.js | 已有 |
| 6 | **取消后停止调度剩余项（3 以后不再启动）** | test-actions.js [P0] 用例 | **已修（2026-08-17）** |
| 7 | 唯一入口 uniqueName 三处共用 + planPaste 键改 name | test-clipboard.js / test-actions.js | **已修（2026-08-17）** |
| 8 | rename 跨目录拒绝（两后端一致） | test-actions.js（newName 含 / 拒绝）+ FileStore.java 同目录校验 | **已修（2026-08-17）** |
| 9 | delete 进 .trash 重名加序号 / 回收站自身不可删 / 未授权拒绝 | test-actions.js | 已有 |
| 10 | open 锁定 / 解锁 | test-desktop-viewerlink-lock.js | 已有 |
| 11 | SAF/private 双后端等价（Operation Contract Test） | SAF move 改名语义已修（TransferEngine leafOf 分支）；mtime 差异已文档化接受；Java 侧依赖 Android，退化为真机手工验收矩阵（待生成） | 部分完成 |

## 五、变更规则

改本文件涉及的操作语义（前置/后置/失败/取消/后端行为）时，**同一次提交**须同步：

1. 本文件（现状契约回填）
2. 对应实现（`src/js/actions.js` / `clipboard.js` / Java `TransferEngine` / `FileStore`）
3. 对应测试（`tests/test-actions.js` / `test-clipboard.js` / 新增契约测试）
4. 若涉及桥方法面：`docs/bridge-and-data-contract.md` + `tests/test-bridge-contract.js`
