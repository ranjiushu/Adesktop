# Adesktop

把 Android 文件系统变成一张可以自由摆放的桌面——文件即图标，位置持久记忆。

像整理电脑桌面一样整理手机文件：拖到哪里，就在哪里。布局、视角等元数据
以隐藏文件形式存在真实文件系统里，随目录迁移，重启还原。

纯前端单文件 + Android WebView 壳，**零框架、零第三方运行时依赖**。

## 特性

- **文件即真相**：一切数据（包括桌面布局）落在真实文件系统，不做云端/数据库抽象
- **空间化桌面**：图标自由摆放、框选、混合拖动，位置/相机等元数据以隐藏文件形式随目录迁移
- **内置文件查看器**：图片/音视频/文本/JSON/网页预览，桌面内小窗 + 全屏两级视图
- **文件操作**：复制/移动/重命名/删除/压缩等八类操作，SAF 授权目录 + 私有目录双后端
- **移动端优先**：触控手势状态机、安全区适配、edge-to-edge 沉浸式

## 技术架构

```
src/                     前端源码（index.html + css/ + js/，零依赖 vanilla JS）
tools/                   构建脚本（build-web.sh 拼接 → minify-bundle.js 压缩）
android/                 WebView 壳（Gradle 工程，包名 com.ranjiushu.adesktop）
  └── FileBridge         经 SAF（Storage Access Framework）访问真实文件系统，
                         以 @JavascriptInterface 暴露给前端，Promise 化调用
tests/                   单元测试 + 无头 Chromium E2E
docs/                    架构 / 桥协议 / 交互设计 / 数据完整性文档
```

构建产物是**单个 HTML 文件**（`dist/adesktop.bundle.min.html`），打进 APK assets，
WebView 加载后与 Java Bridge 交互。详见 `docs/architecture.md`、`docs/build-pipeline.md`。

## 构建

前置：Node.js ≥ 22、Android SDK（compileSdk 34）、JDK 17。

```bash
bash tools/build-web.sh        # 1. src/ → dist/adesktop.bundle.html
node tools/minify-bundle.js    # 2. → dist/adesktop.bundle.min.html
cd android && ./gradlew assembleRelease   # 3. → APK（R8 裁剪）
```

也可以一步完成（构建 + 归档 APK）：

```bash
bash android/build-local.sh
```

### 签名

默认使用 debug keystore 签名。正式发布请在 `android/keystore.properties`
中配置正式签名（该文件已被 gitignore）：

```properties
storeFile=my-release.jks
storePassword=...
keyAlias=...
keyPassword=...
```

## 测试

```bash
bash tests/run-tests.sh   # 单元测试套件（自动发现 test-*.js / test-*.sh）
bash tools/verify.sh      # 完整门禁：构建 + 类型检查 + 压缩 + lint + 测试 + E2E
```

## 文档

完整索引见 [`docs/README.md`](docs/README.md)（唯一权威清单）。核心入口：

- `docs/architecture.md` — 架构分层与桥接口协议
- `docs/interaction.md` — 桌面交互设计（坐标模型 / 手势状态机）
- `docs/data-integrity.md` — 「文件即真相」的数据完整性纪律

## License

[GPL-3.0](LICENSE) — Copyright (C) 2026 ranjiushu

本程序是自由软件：你可以在 GNU 通用公共许可证 v3 的条款下再分发和/或修改它。
衍生作品必须以相同协议开源。
