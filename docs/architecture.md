# 架构

## 定位

以真实文件系统为基础的移动端空间化工作台（Windows Desktop 隐喻）。

## 架构分层

```
┌─────────────────────────────────────────────┐
│ 前端（dist/adesktop.bundle.min.html）         │
│  ├─ DesktopUI  桌面渲染：图标网格/自由摆放    │
│  ├─ layout.js  布局元数据读写（隐藏文件）     │
│  └─ FileAPI    文件操作 Promise 封装         │
├─────────────────────────────────────────────┤
│ Java Bridge（MainActivity + FileBridge）     │
│  └─ @JavascriptInterface：list/read/write/   │
│     mkdir/rename/delete/meta                │
├─────────────────────────────────────────────┤
│ Android 文件系统                             │
│  └─ SAF 授权目录 / 应用私有目录（方案待定）    │
└─────────────────────────────────────────────┘
```

## 核心原则

- **文件即真相**：桌面布局、应用配置一律落文件系统隐藏文件（如 `.desktop/layout.json`），不依赖 localStorage 持久化业务状态
- **异步桥**：Java Bridge 全部异步回调（webView.post），前端 Promise 封装，禁止同步文件 IO
- **桥的最小面**：FileBridge 只做文件系统操作，不掺业务逻辑；业务全在前端
- **零框架**：同 LexiCull，ES6+ 手写，无第三方运行时依赖

## 桥接口草案（待定稿）

| 方法 | 说明 |
|------|------|
| `list(path)` | 列目录，返回 [{name, isDir, size, mtime}] |
| `read(path)` | 读文本（UTF-8）；大文件走分片 |
| `write(path, content)` | 写文本（原子：临时文件+rename） |
| `mkdir(path)` / `delete(path)` | 目录/文件操作 |
| `rename(old, new)` | 重命名/移动 |
| `resolveUri(path)` | 文件 → WebView 可直接加载的 URI（content:// / file://），媒体流式访问用 |
| `previewUri(path)` | 图片全屏预览档：采样解码到屏幕级尺寸（1920px）缓存后返回 URI；小图直接返回原图，非位图格式报错 |
| `thumb(path)` | 缩略图（256px 最长边，磁盘缓存 + data URI；图片采样解码 / 视频首帧提取） |
| `openExternal(path)` | 交外部应用打开（ACTION_VIEW + MIME + 读授权；无可用应用报错） |
| `meta(path)` | 单文件元数据 |
| `rootInfo(cb)` | 根目录信息 {rootName, mode: saf\|all-files\|private} |
| `requestRootAccess()` | 引导全盘授权（Android 11+ 跳系统设置页 / Android 10 及以下弹运行时权限） |

## 文件系统范围（决策中）

见 `docs/fs-scope.md`：全盘访问（主方案）/ SAF 授权目录 / 私有目录兜底。
