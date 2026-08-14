# 构建管线

与 LexiCull 同构：`src/` 拆分源码 → 单文件 bundle → 压缩 → Android assets → APK。

## 顺序（P0 铁律，不可调换不可跳过）

```
1. bash tools/build-web.sh        src/ → dist/desktop.bundle.html
2. node tools/minify-bundle.js    → dist/desktop.bundle.min.html
3. bash android/build-local.sh    复制 min 产物 → assets/index.html → gradlew assembleRelease（R8 混淆）→ 归档 APK
```

## 安装包归档（滚动保留）

- `android/build-local.sh` 步骤 5 调用 `tools/collect-apk.sh`
- 归档到 `/workspace/AAA 安装包/`，命名 `Desktop_v<版本>_<时间戳>.apk`（时间戳精确到秒）
- **滚动保留最新 10 个**（按 mtime，仅清理本脚本命名模式，手动放入的文件不受影响）
- release 构建同步归档 R8 `mapping.txt` 到 `<归档目录>/mapping/`（同样保留 10 个）

## COS bundle 周期备份（每 25 提交）

- `android/build-local.sh` 步骤 6 调用 `tools/cos-bundle-check.sh`
- 触发标准：当前提交总数 − 上次上传时提交总数 ≥ 25（状态记录在 `.git/cos-bundle-count`，
  与构建频率解耦：无论何时构建，只要距上次上传累计满 25 个提交就补传一次）
- 产物：`git bundle create --all` → `cos://backup-data/desktop-git/desktop-<时间戳>.bundle`，
  COS 上保留最近 50 个
- 幂等：状态文件保证同一周期只上传一次；coscli 缺失/上传失败时仅告警不阻断构建，
  且不更新状态（下个周期自动重试，不丢备份窗口）
- 与 LexiCull 同款方案（`tools/cos-bundle-check.sh`），Desktop 独立 bucket 路径

## 拼接清单（JS_ORDER / CSS_ORDER）

`tools/build-web.sh` 头部定义拼接顺序：

- JS：先定义后使用（namespace 最先、入口 main 最后），模块间全局引用依赖此顺序
- CSS：tokens（设计变量）最先，壳样式随后

**新增源文件必须登记进对应 ORDER**，否则 `check_order_completeness` 反向完整性自检会拦截构建。

## 构建注入

build-web.sh 每次构建注入到 JS 尾部（`var` 声明，避免被 minify mangle 影响）：

| 变量 | 说明 |
|------|------|
| `BUILD_COUNT` | 构建次数（dist/.build-count 持久化递增） |
| `BUILD_TIMESTAMP` | 构建时间（Asia/Shanghai） |

## 产物校验

- build-web.sh：占位符残留 / style+script 个数 / DOCTYPE / 注入变量存在
- `--check` 模式：临时构建对比现有产物，判断是否需要重建（pre-commit 钩子调用）
- tests/test-smoke.js：bundle 结构与关键内容冒烟

## 体积控制

- minify-bundle.js：terser(JS) + clean-css(CSS)，顶层标识符不 rename（toplevel:false）
- 体积棘轮（build-web.sh --strict）：本次产物超过基线（dist/.size-baseline）130% 判为膨胀并拦截；
  严格模式构建后更新基线（verify.sh 与提交前门禁均以 --strict 运行）
- 每次 minify 输出体积对比，异常增长需在提交信息说明

## Android 壳

- 最小壳：`android.app.Activity` + WebView
- 依赖策略：最小化（理念，非绝对零依赖）——androidx.documentfile（SAF 文件访问）、
  androidx.core（edge-to-edge WindowInsets 安全区注入，与 LexiCull 同款）；
  避免引入重框架/UI 库，前端保持零第三方依赖
- 包名占位 `com.example.desktop`，发布前确认后全局替换
- APK 构建在 ARM64 环境需 QEMU 转发（aapt2/aapt/zipalign 包装器），见 android/build-local.sh
