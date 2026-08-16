# 桥与数据契约清单

本文件不是新规范，是把散落在 `FileBridge.java`、`src/js/file-api.js`、`src/js/bridge.js`、
`docs/architecture.md`、`docs/data-integrity.md` 里的规则收拢成一份**可对照的清单**。

用途：改桥协议或数据形状前先看这份清单；改完须同步更新本文件与
`tests/test-bridge-contract.js`（本清单的机器可读版）。两处不一致时，测试变红拦截提交。

## 一、桥契约（FileBridge）

前端与文件系统的唯一通道是 `window.FileBridge`（Java 桥，`@JavascriptInterface`）。
前端经两层封装访问：

- `App.bridge`（`src/js/bridge.js`）：`vibrate` / `requestRootAccess`，无回调、同步触发
- `App.FileAPI`（`src/js/file-api.js`）：其余文件操作，Promise 化 + 回调协议

### 1.1 方法面

| 前端调用 | 桥方法 | 参数（除 cbId 外） | 成功返回 | 说明 |
|---------|--------|-------------------|---------|------|
| `FileAPI.rootInfo()` | `rootInfo` | 无 | `RootInfo` | 根目录信息 |
| `FileAPI.list(path)` | `list` | `path` | `FsEntry[]` | 列目录 |
| `FileAPI.read(path)` | `read` | `path` | `string` | 读文本，单次上限 10 MB |
| `FileAPI.write(path, content)` | `write` | `path, content` | `true` | 原子写（临时文件 + rename） |
| `FileAPI.mkdir(path)` | `mkdir` | `path` | `boolean` | 建目录，返回是否新建 |
| `FileAPI.del(path)` | `delete` | `path` | `true` | 移入回收站（安全删除，不彻底删） |
| `FileAPI.rename(old, new)` | `rename` | `oldPath, newPath` | `true` | 重命名 / 移动 |
| `FileAPI.copy(src, dst)` | `copy` | `srcPath, dstPath` | `true` | 复制 |
| `FileAPI.resolveUri(path)` | `resolveUri` | `path` | `uri` | 转 WebView 可直接加载的 URI |
| `FileAPI.thumb(path)` | `thumb` | `path` | `file://` URI | 缩略图（磁盘缓存） |
| `FileAPI.openExternal(path)` | `openExternal` | `path` | `true` | 交外部应用打开，无可用应用时报错 |
| `FileAPI.openUrl(url)` | `openUrl` | `url` | `true` | 用系统浏览器打开网址（网站快捷方式加载失败兜底） |
| `FileAPI.completeUpload(paths)` | `completeUpload` | `paths` | `true` | 网页上传：回传待上传文件路径（resolveUri 后回传网页） |
| `FileAPI.chooseUploadFromSystem()` | `chooseUploadFromSystem` | 无 | `true` | 网页上传：弹系统文件选择器（GET_CONTENT 单选） |
| `FileAPI.cancelUpload()` | `cancelUpload` | 无 | `true` | 网页上传：取消（回传 null） |
| `FileAPI.listApps()` | `listApps` | 无 | `AppEntry[]` | 查询 launcher 应用列表 |
| `FileAPI.launchApp(pkg)` | `launchApp` | `pkg` | `true` | 启动指定包名应用 |
| `FileAPI.appIcon(pkg)` | `appIcon` | `pkg` | `data:image/png;base64,...` | 应用图标 base64 |
| `App.bridge.vibrate(ms)` | `vibrate` | `ms` | 无回调 | 震动，时长钳制 1–500 ms |
| `App.bridge.requestRootAccess()` | `requestRootAccess` | 无 | 无回调 | 触发原生弹授权选择器 |

关键映射（隐藏契约，最易改坏）：**前端 `del` 对应桥方法 `delete`**（不是 `remove`）。

### 1.2 回调协议

- 前端 `FileAPI` 调 `FileBridge[method](...args, cbId)`，`cbId` 由 `file-api.js` 自动生成（`'cb1'`、`'cb2'`…）。
- Java 完成后执行 `evaluateJavascript("window.__fbResolve('cbId', {ok:true,data:...} | {ok:false,error:'...'})")`。
- `window.__fbResolve` 由 `file-api.js` 运行时注册，`{ok:false}` 时 `error` 字段透传为 Promise reject 的 message。
- 前端默认超时 10 秒（`call()` 的 `timeoutMs || 10000`）。

### 1.3 返回形状

| 形状 | 字段 | 说明 |
|------|------|------|
| `FsEntry` | `name, isDir, size, mtime` | 目录的 `size` 恒为 0 |
| `RootInfo` | `rootName, mode, displayPath, trashName` | `mode` 取值 `'saf' \| 'private'`；`trashName` 恒为 `'.trash'` |
| `AppEntry` | `package, label, isSystem` | `isSystem` 含系统预装与更新过的系统应用 |

### 1.4 路径与安全约束

- 路径一律**相对根目录**；`''` 表示根目录本身。
- 桥层拒绝绝对路径与 `..` 逃逸（`resolve()` 内的 `isSafeRelPath` 校验）。
- `read` 单次上限 10 MB（防大文件整读 OOM）。
- `delete` = 移入根目录下隐藏文件夹 `.trash`，不做彻底删除。

## 二、数据契约（元数据形状）

元数据以隐藏文件 / `localStorage` 形式持久化。写入必须走统一出口
（`layout-store` / `home-store` 的 `save*`），禁止绕过 store 裸改缓存对象
（push / splice / 改属性会污染内存投影，造成幽灵 positions 崩溃）。

| store | key | 形状 | 关键语义 |
|-------|-----|------|---------|
| `LayoutStore` | `desktop.layout.v1` | `{version:1, icons:{name:{x,y}}, camera:{x,y,zoom}}` | `icons` 的 key 是**文件名**（非 fullPath）；`camera` 为世界坐标 |
| `HomeStore` | `desktop.home.v1` | `{version:1, home?:{x,y,zoom}, fallback?:{x,y,zoom}}` | `home` 优先于 `fallback`；两者都无回出厂 `(0,0,1)` |
| `ViewStore` | `desktop.view.v1` | `{version:1, viewStyle, sortBy, sortDir, advancedBrowse}` | `viewStyle` 取 `'grid' \| 'list'`；`sortBy` 取 `name/mtime/type/size`；`sortDir` 取 `1 \| -1` |

### 2.1 相机不变式（运行时契约，类型系统拦不住）

- `Camera = {x, y, zoom}`：`x/y` 为**视口左上角对应的世界点**，`zoom` 为缩放因子。
- `zoom` 范围 `[0.4, 2.5]`（`ZOOM_MIN` / `ZOOM_MAX`）；NaN 回退 1。
- 构造一律经 `DesktopCamera.create()`，其内部已钳制；禁止裸写 `{x,y,zoom}`。

## 三、变更规则（改契约必须同步）

改桥签名或数据形状时，**同一次提交**须适配以下位置：

1. `android/app/src/main/java/com/example/desktop/FileBridge.java`（壳）
2. `src/js/file-api.js`（前端桥封装）
3. `src/js/bridge.js`（若涉及 `vibrate` / `requestRootAccess`）
4. `tests/test-fileapi.js` / `tests/test-bridge.js`（行为测试）
5. `tests/test-bridge-contract.js` + 本文件（契约锁，两处必须同步更新）
