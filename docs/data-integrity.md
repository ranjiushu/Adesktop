# 数据完整性纪律（文件即真相）

> 治理移植自 LexiCull `docs/5-data/data-integrity.md` 的**原则**，落地为 Adesktop 自己的模型。
> LexiCull 的数据真相在 localStorage（白名单重建 + `save*` 出口）；**Adesktop 的数据真相在文件系统**——
> 桌面布局等元数据以隐藏文件形式存于文件系统，「文件即真相」。约束语义不同，不可照搬其代码。

## 一、真相分层

| 层 | 载体 | 读写出口 | 说明 |
|---|---|---|---|
| 用户数据 | 文件系统（SAF 授权目录 / 私有目录） | `FileBridge`（list/read/write/mkdir/delete/rename/rootInfo） | 用户文件即对象，前端不持有副本 |
| 布局元数据 | 隐藏文件（`.adesktop-layout.json`，位于桌面空间目录内，随目录存在） | `layout-store.js`（localStorage 降级为缓存，文件为真相） | 位置/相机/布局等桌面状态 |
| 会话状态 | 内存 + `localStorage` | 各 store 的 `load*` / `save*` | 视图偏好/排序等非真相状态，可重建 |

**铁律：用户数据的唯一真相在文件系统。前端内存中的 File 对象、缓存、选中态都只是投影。**

### 显示加速缓存（非真相，可丢弃）

- `desktop-persist.js` 的**目录清单缓存**（`_dirCache`）与**根信息缓存**（`_rootInfoCache`）只服务于
  导航秒开（进退目录同步渲染、省一次 rootInfo 桥往返），不参与任何写入路径，也不跨进程存活。
- 契约：用缓存渲染后**立即**向桥层重取一次对齐（stale-while-revalidate）；清单内容有变才重渲染
  ——缓存允许短暂陈旧（毫秒级），但不得长期遮蔽真相；对齐失败静默保持缓存渲染，下次导航/操作再对齐。
- 因此只有导航类刷新（`refresh({nav:true})`）走缓存捷径；**启动 / 根授权变更 / 文件操作后 /
  视图偏好变更**一律走 `refresh()`（非导航）= 强制向文件系统取真相。
- 回归护栏：`tests/test-desktop-nav-cache.js`（缓存命中同步渲染 / 对齐发现新增文件后重渲染 /
  loading 延迟显示）、`scripts/verify-folder-nav.js`（E2E 门禁）。

## 二、元数据写入纪律（防幽灵 positions）

- 布局写入必须走 `layout-store` / `home-store` 的统一出口（`savePositions` / `saveCamera` 等），
  禁止绕过 store 裸改缓存对象（`push` / `splice` / 改属性）——幽灵 positions 崩溃即由此类旁路引入
- **持久化 ≠ 落盘**：内存状态变更后必须显式调用保存出口；仅改内存不保存 = 下次启动丢失
- 删除/移动文件时同步清理其元数据记录（`onDelete` / `onMove` 挂钩），防止孤儿记录
- 目录切换/刷新加代际守卫（`refresh 竞态守卫`：路径快照 + seq），过期响应不得写入布局

## 三、写入失败处理（P1 铁律）

- 数据写入路径禁止空 `catch(e){}`，失败必须：
  1. 返回 `false`（调用方可感知）
  2. 持久告警（toast 提示，不静默吞掉）
- 批量操作（复制/移动/删除）失败时保留源：移动走桥 `move`（真移动优先，失败自动降级 copy+del，复制失败不得删源），
  复制失败不得删源——用户文件不可因半途失败而丢失
- 复制保留源 mtime（私有模式 `setLastModified` 可靠；SAF 模式 DocumentsContract 公开 API 无设置
  mtime 的方法——updateDocument 为隐藏 API 有政策风险，故 SAF 复制不保留时间戳）
- 失败/取消清理半成品：目标原本不存在且操作失败 → 递归删除本次创建的目标

## 四、桥层契约（FileBridge）

- 前端与文件系统的唯一通道是 `FileBridge`（`@JavascriptInterface` Promise 化），
  禁止前端绕过桥直接操作文件（无此能力也不得引入其他通道）
- 桥方法签名变更/新增 = 模块边界变更，须同提交适配：
  - `android/` 壳层（Java 实现）
  - `src/js/bridge.js`（Promise 封装）
  - `tests/test-bridge.js`（契约单测）
- 越界校验：私有目录前缀匹配必须精确（`/root` 不得命中 `/root2`），read 有大小上限护栏

## 五、Schema 变更纪律

- 元数据/桥返回值新增字段：须同步更新消费者（store/render 层），避免静默忽略
- 字段命名/类型变更：检查是否影响已落盘元数据（旧数据兼容读取），
  破坏性变更须有迁移路径（读旧写新）
- 数据格式文档见 `docs/fs-scope.md`（范围决策）与 `docs/architecture.md`（桥接口协议）

## 六、验证

- 单元测试：`test-layout-store` / `test-home-store` / `test-bridge` / `test-fileapi` 等
- E2E：`scripts/verify-home.js`（位置快照持久化）、`scripts/verify-folder-nav.js`（目录导航秒开）、
  `tools/ui/*-verify.js`（缩略图/回收站/查看器）
- 新增元数据读写路径时，须配套测试覆盖「写入 → 重载 → 读回」闭环
