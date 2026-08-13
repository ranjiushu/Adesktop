# 架构

## 定位

以真实文件系统为基础的移动端空间化工作台（Windows Desktop 隐喻）。

## 架构分层

```
┌─────────────────────────────────────────────┐
│ 前端（dist/desktop.bundle.min.html）         │
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
| `meta(path)` | 单文件元数据 |

## 文件系统范围（决策中）

见 `docs/fs-scope.md`：SAF 授权目录 / 全盘访问 / 私有目录，待用户确认。
