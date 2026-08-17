# Adesktop

以真实文件系统为基础的移动端空间化工作台。像 Windows 桌面：文件即对象，图标自由摆放，位置持久记忆。

技术栈与 LexiCull 相同：纯前端单文件 + Android WebView 壳，零框架零依赖。

## 定位

- **文件即真相**：一切数据（包括桌面布局）落真实文件系统，不做云端/数据库抽象
- **空间化**：图标在桌面自由摆放，位置/大小存元数据文件，重启还原
- **移动端优先**：触控交互、安全区适配、真机文件系统访问（Java Bridge）

## 结构

```
src/                     拆分源码（index.html + css/ + js/）
  index.html             应用骨架，__STYLE_PLACEHOLDER__ / __JS_PLACEHOLDER__ 占位
  css/                   样式（按 CSS_ORDER 拼接）
  js/                    逻辑（按 JS_ORDER 拼接，先定义后使用）
tools/                   构建脚本
  build-web.sh           src/ → dist/desktop.bundle.html
  minify-bundle.js       压缩 → dist/desktop.bundle.min.html
  build-local.sh         Android 全量构建 + 归档 APK
  verify.sh              提交前门禁
tests/                   测试套件（run-tests.sh 自动发现）
android/                 WebView 壳（Gradle 工程，包名 com.example.desktop 占位）
docs/                    文档
dist/                    构建产物（不入库）
```

## 构建

```bash
bash tools/build-web.sh        # 1. src/ → dist/desktop.bundle.html
node tools/minify-bundle.js    # 2. → dist/desktop.bundle.min.html
bash android/build-local.sh    # 3. 打包 APK 并归档到 /workspace/AAA 安装包/（滚动保留最新 10 个）
bash tools/verify.sh           # 提交前门禁
```

## 快速上手

1. 在 `src/js/` 新增模块，登记进 `tools/build-web.sh` 的 `JS_ORDER` / `CSS_ORDER`
2. `bash tools/build-web.sh` 构建并验证产物
3. 新增 `tests/test-*.js`，`bash tests/run-tests.sh` 运行

## 状态

- [x] 项目骨架初始化（src / tools / tests / android / git）
- [ ] 应用功能开发
- [x] 应用显示名（Adesktop）
- [x] 包名（com.ranjiushu.adesktop，与 LexiCull 同域名前缀）
