# 构建管线

与 LexiCull 同构：`src/` 拆分源码 → 单文件 bundle → 压缩 → Android assets → APK。

## 顺序（P0 铁律，不可调换不可跳过）

```
1. bash tools/build-web.sh        src/ → dist/adesktop.bundle.html
2. node tools/minify-bundle.js    → dist/adesktop.bundle.min.html
3. bash android/build-local.sh    复制 min 产物 → assets/index.html → gradlew assembleRelease（R8 混淆）→ 归档 APK
```

## 安装包归档（滚动保留）

- `android/build-local.sh` 步骤 5 调用 `tools/collect-apk.sh`
- 归档到 `/workspace/AAA 安装包/`，命名 `Adesktop_v<版本>_<时间戳>.apk`（时间戳精确到秒）
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
- 与 LexiCull 同款方案（`tools/cos-bundle-check.sh`），Adesktop 独立 bucket 路径

## 拼接清单（JS_ORDER / CSS_ORDER）

`tools/build-web.sh` 头部定义拼接顺序：

- JS：先定义后使用（namespace 最先、入口 main 最后），模块间全局引用依赖此顺序
- CSS：tokens（设计变量）最先，壳样式随后

**新增源文件必须登记进对应 ORDER**，否则 `check_order_completeness` 反向完整性自检会拦截构建。

## 图标系统（sprite + App.icons）

- **单一事实来源**：`src/index.html` 顶部隐藏 SVG sprite（`<symbol id="icon-{kebab}">`）
- **生成器**：`src/js/icons.js`（`App.icons.get(name, opts)` 与命名访问 `App.icons.<name>`，
  输出 `<svg><use href="#icon-xxx"/></svg>`），移植自 LexiCull 同构方案
- **新增图标两步**：在 sprite 加 `<symbol id="icon-xxx">` + 在 `icons.js` 的 `_NAMES` 登记 camelCase 名
  （`tests/test-icons.js` 双向校验 sprite symbol 与 _NAMES 一一对应，缺一即 FAIL）
- 规范：24×24 viewBox、2px stroke、`currentColor`、round caps/joins（Material Design Outlined 风格）

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
- 依赖策略：零第三方依赖（理念，非绝对禁止）——androidx.documentfile（SAF 文件访问）、
  androidx.core（edge-to-edge WindowInsets 安全区注入，与 LexiCull 同款）属可接受常规依赖；
  避免引入重框架/UI 库，前端保持零第三方依赖
- 包名 `com.ranjiushu.adesktop`
- APK 构建在 ARM64 环境需 QEMU 转发（aapt2/aapt/zipalign 包装器），见 android/build-local.sh

## 类型检查（渐进式 @ts-check）

- **路线**：不写 `.ts` 源文件，JS 文件头部加 `// @ts-check` 注释，由 `tsc --noEmit` 检查
  （tsconfig `allowJs: true`），仅类型检查、零构建侵入（build-web.sh 只拼接 JS_ORDER 登记文件）
- **命令**：`npm run typecheck`（= `tsc --noEmit`）；verify.sh 门禁内置该步骤
  （缺 typescript 时 SKIP，与 minify 同策略）
- **类型声明**：`types/global.d.ts` 定义全局类型（AppCamera / Position2D / FbResult / 桥签名 /
  HTMLElement 扩展等），仅供类型检查，不参与构建
- **覆盖现状**：41/52 个 src/js 模块已收编（数据/状态/逻辑/桥/编排层）；手势/渲染/UI 表现层
  模块等下次改动时顺手补——类型检查对手感/时序类 bug 收益低，真机手感测试才是防线
- **新增模块约定**：给模块加 `// @ts-check` 后，先在 `types/global.d.ts` 补全局类型，
  再跑 `npm run typecheck` 清零报错
