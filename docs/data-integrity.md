# 数据完整性纪律（文件即真相）

> 治理移植自 LexiCull `docs/5-data/data-integrity.md` 的**原则**，落地为 Desktop 自己的模型。
> LexiCull 的数据真相在 localStorage（白名单重建 + `save*` 出口）；**Desktop 的数据真相在文件系统**——
> 桌面布局等元数据以隐藏文件形式存于文件系统，「文件即真相」。约束语义不同，不可照搬其代码。

## 一、真相分层

| 层 | 载体 | 读写出口 | 说明 |
|---|---|---|---|
| 用户数据 | 文件系统（SAF 授权目录 / 私有目录） | `FileBridge`（list/read/write/mkdir/delete/rename/rootInfo） | 用户文件即对象，前端不持有副本 |
| 布局元数据 | 隐藏文件（`.desktop-*` 形式，随目录迁移） | `layout-store.js` / `home-store.js` | 位置/相机/快照等桌面状态 |
| 会话状态 | 内存 + `localStorage` | 各 store 的 `load*` / `save*` | 视图偏好/排序等非真相状态，可重建 |

**铁律：用户数据的唯一真相在文件系统。前端内存中的 File 对象、缓存、选中态都只是投影。**

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
- 批量操作（复制/移动/删除）失败时保留源（两阶段：先 copy 后 del 源），
  复制失败不得删源——用户文件不可因半途失败而丢失

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
- E2E：`scripts/verify-home.js`（位置快照持久化）、`tools/ui/*-verify.js`（缩略图/回收站/查看器）
- 新增元数据读写路径时，须配套测试覆盖「写入 → 重载 → 读回」闭环
