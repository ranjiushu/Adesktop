# Adesktop

以真实文件系统为基础的移动端空间化工作台（Windows Desktop 隐喻：文件即对象、图标自由摆放、位置可记忆）。纯前端单文件 + Android WebView 壳，零框架零第三方依赖，包名 `com.ranjiushu.adesktop`。文件系统访问经 Java Bridge（`@JavascriptInterface`）暴露给前端，Promise 化调用；桌面布局等元数据以隐藏文件形式存于文件系统，保持「文件即真相」。

开发基线是 `feat/dev`（日常 commit、topic 合流目标）；`main` 是发布线，只走 `merge --no-ff`，需用户批准。

## 会话启动

```bash
bash /workspace/ops/probes/probe-repo.sh /workspace/projects/Adesktop   # 分支/同步/产物年龄/一致性/墓地
git status && git log --oneline -3                         # 工作区上下文
```

信息权威顺序：本文件铁律 > docs/ 规范 > 探针实测 > 记忆，冲突时以前者为准。

## 铁律

### 底线（违反即毁工作成果，绝无例外）

1. `dist/` 只由构建管线写入：改代码改 `src/`，随后 `tools/build-web.sh` 重建
2. 回退改动用可逆手段（`git stash`、`git checkout -- <路径>`）；`git reset --hard` 会丢未提交代码，任何场景不用
3. App 数据是用户资产：清数据必须先获用户许可
4. 构建按 `tools/build-web.sh` → `minify-bundle.js` → Gradle 串行执行，顺序不可调换、不可跳过
5. 提交前 `tools/verify.sh` 全绿（步骤以脚本为准）

### 代码纪律

<!-- 同构节:begin p1-code -->
- 数据写入路径显式处理失败：返回 false + 持久告警，不留空 `catch(e){}`
- 文档与注释用纯文本，emoji 只出现在 UI 字符串里
- JS 写 ES6+（`const`/`let`/箭头/async-await/模板字符串），存量 `var` 随改随换
<!-- 同构节:end -->
- 桌面交互视觉先参考 Windows/macOS 成熟模式：图标占位（cell）尺寸固定统一、与内容解耦，布局尺寸不随内容撑开（踩坑教训见 `docs/interaction.md` 网格一节）

### 流程纪律

<!-- 同构节:begin p1-process -->
- 历史回滚用 git 原生手段（revert / stash / 仓库外快照），不建长期 backup/archive 分支或标签
- 改 `src/` 后必须构建；有意义的改动后 commit（中文，Conventional Commits）
- topic 分支完成后当天 `merge --no-ff` 回 `feat/dev` 并 `tools/branch-retire.sh` 退休
- 稳定性优先于省时优化：真机实测不稳定的捷径不得自作主张引入，先问或按稳定路径做
<!-- 同构节:end -->

### 验证纪律

<!-- 同构节:begin p1-verify -->
- 真机 UI 验证交用户，助手边界 = 无头 Chromium E2E + 单元测试 + logcat
- E2E 首次启动类 seed 须 `page.evaluateOnNewDocument` 注入（导航前）；`file://` 下 `history.back()` 回 `about:blank` 干扰采样，避免依赖
<!-- 同构节:end -->
- 改存储布局/桥协议/模块边界的提交须同提交适配 `tests/` 验证套件

## 常用命令

| 命令 | 说明 |
|------|------|
| `tools/build-web.sh` | src/ → dist/adesktop.bundle.html（`--strict` 体积棘轮） |
| `node tools/minify-bundle.js` | 压缩 → dist/adesktop.bundle.min.html |
| `npm run typecheck` | 渐进式类型检查（tsc --noEmit，覆盖 `@ts-check` 模块） |
| `android/build-local.sh` | 全量构建，归档 APK 到 `/workspace/AAA 安装包/`（滚动保留最新 10 个 + R8 mapping） |
| `tools/verify.sh` | 提交前门禁（步骤以脚本为准） |
| `tools/lint.sh` | 代码检查（构建一致性/文档链接/CHANGELOG/头部注释/var 纪律） |
| `tests/run-tests.sh` | 测试套件（自动发现 test-*.js / test-*.sh） |

## 分支治理

<!-- 同构节:begin branch-governance -->
```
main ←── merge --no-ff only ── feat/dev ←── topic 分支
  (稳定发布)                       (日常开发)       (短命，当天合流)
```

**日常开发**：单文件小改直接 commit 到 `feat/dev`；跨文件/实验性改动开 topic：

```bash
git checkout -b feat/xxx feat/dev
# ...开发...
git checkout feat/dev && git merge --no-ff feat/xxx -m "merge: <摘要>"
bash tools/branch-retire.sh feat/xxx
```

> 长周期/实验性任务可开独立 worktree（置于 `/workspace/ops/wt/`，用完合流回主线并 `worktree remove`），规范见 `/skills/toolchain-skills/git-workflow/SKILL.md`「Work Tree 使用规范」。

**发布**（仅用户批准后执行）：

```bash
git checkout main && git merge --no-ff feat/dev -m "merge: <版本摘要>"
git push origin main && git checkout feat/dev
```

**钩子保护**（`.githooks/`，`git config core.hooksPath .githooks` 启用）：

| 钩子 | 拦截 |
|------|------|
| pre-commit | 墓地分支复活、`main` 直提、`src/` 与产物不一致、`AGENTS.md` 信息密度超限 |
| commit-msg | 纯英文提交（merge 除外） |
| pre-push | 分支命名违规、墓地复活、`main` 非 merge 推送 |
| post-commit | 领先 `main` ≥50 时预警 |

**退休**：`branch-retire.sh` 记入 `.git/branch-graveyard`；`main` 和 `feat/dev` 不可退休，快照用 `git bundle` 导出仓库外。
<!-- 同构节:end -->

## 数据关键约束

- 数据真相在文件系统，「文件即真相」：用户文件即对象，元数据（位置/相机/快照）以隐藏文件形式随目录迁移；内存中的 File 对象和缓存只是投影。
- 元数据写入走统一出口（`layout-store`/`home-store` 的 `save*`）：绕过 store 直改缓存（push、splice、改属性）会污染内存投影，造成幽灵 positions 崩溃。
- 删除/移动时同步清理元数据，防孤儿记录；目录切换/刷新加代际守卫（路径快照 + seq），过期响应不写入布局。
- 前端与文件系统的唯一通道是 `FileBridge`：改签名须同提交适配 `android/` 壳 + `src/js/bridge.js` + `tests/test-bridge.js`，详见 `docs/data-integrity.md`。

## 决策触发清单

改动前先查对应文档（全量清单见 [docs/README.md](docs/README.md)）：

| 场景 | 查阅 / 执行 |
|------|------------|
| 加工具脚本 / 拆分源文件 | `tools/build-web.sh` 的 JS_ORDER/CSS_ORDER + 完整性自检（`docs/build-pipeline.md`） |
| 改构建 / 产物结构 / 构建注入 | `docs/build-pipeline.md` |
| 改模块间调用 | 保持 JS_ORDER 顺序依赖，先定义后使用（`docs/architecture.md`） |
| 改桥协议 / FileBridge 签名 | `docs/architecture.md` + `docs/data-integrity.md`（桥层契约），须同提交适配壳层/bridge.js/测试 |
| 改布局元数据 / 相机 / 快照 | `docs/data-integrity.md`（统一出口 + 防幽灵 positions），配套 `test-layout-store`/`test-home-store` |
| 改桌面交互 / 手势 / 视图 | `docs/interaction.md`，配套对应单测（test-desktop-gesture 等）+ E2E（`scripts/verify-*.js`） |
| 改文件查看器 / FileOpener | `docs/viewer.md`，配套 `test-viewer`/`test-file-opener` |
| 改文件系统范围 / SAF | `docs/fs-scope.md`，配套 `test-bridge`/`test-fileapi` |
| 给 js 模块加 `// @ts-check` / 扩展 `types/global.d.ts` | 跑 `npm run typecheck`（渐进式类型检查，见 `docs/build-pipeline.md`） |
| 引入第三方库 | 需用户批准，默认零第三方依赖（androidx 官方支持库属可接受常规依赖） |

## 参考

文档索引在 `docs/README.md`（唯一权威清单）；仓库地图在 `docs/repo-map.md`（逐源文件行数与职责，构建时自动生成，不入库）。
