# Desktop

以**真实文件系统**为基础的移动端空间化工作台（Windows Desktop 隐喻：文件即对象、图标自由摆放、位置可记忆）。
纯前端单文件 + Android WebView 壳。零框架零依赖。
文件系统访问经 Java Bridge（`@JavascriptInterface`）暴露给前端，Promise 化调用；
桌面布局等元数据以隐藏文件形式存于文件系统，保持「文件即真相」。
包名占位 `com.example.desktop`（发布前确认）。

- **开发基线**: `feat/dev`（日常 commit，topic 合流目标）
- **发布线**: `main`（仅 `merge --no-ff`，需用户批准，禁止主动合流）

## 会话启动

```bash
bash /workspace/probes/probe-repo.sh /workspace/Desktop   # 仓库动态（分支/同步/产物年龄/一致性/墓地）
git status && git log --oneline -3     # 工作区上下文
```

信息权威顺序：**本文件铁律 > docs/ 规范 > 探针实测 > 记忆**。冲突时以前者为准。

## 铁律

### P0（违反即毁，绝无例外）

1. **禁止直接编辑 `dist/`** —— 改 `src/` 后 `tools/build-web.sh` 重建
2. **禁止 `git reset --hard`** —— 不可逆丢代码
3. **禁止未经用户许可清 App 数据**
4. **构建顺序不可变**：`build-web.sh` → `minify-bundle.js` → Gradle（串行，不可调换不可跳过）
5. **提交前 `tools/verify.sh` 全绿**（build --strict + minify + lint + 测试 + E2E × 5）

### P1（当次会话内纠正）

- 数据写入路径禁止空 `catch(e){}`，失败必须返回 false + 持久告警
- 文档/注释禁止 emoji（UI 字符串例外）
- 禁止以恢复旧状态为目的建长期 backup/archive 分支或标签
- 改 `src/` 后必须构建；有意义的改动后 commit（中文，Conventional Commits）
- topic 分支完成后当天 `merge --no-ff` 回 `feat/dev` 并 `branch-retire.sh` 退休
- 改存储布局/桥协议/模块边界的提交须同提交适配 `tests/` 验证套件
- JS 用 ES6+（`const`/`let`/箭头/async-await/模板字符串），禁止新增 `var`
- 真机 UI 验证交用户，助手边界 = 无头 Chromium E2E + 单元测试 + logcat
- 数据真相在文件系统：布局/相机等元数据必须走 `layout-store`/`home-store` 统一出口，
  禁止裸改缓存对象（幽灵 positions 崩溃教训，详见 `docs/data-integrity.md`）
- E2E 首次启动类 seed 须 `page.evaluateOnNewDocument` 注入（导航前）；
  `file://` 下 `history.back()` 回 `about:blank` 干扰采样，避免依赖

## 常用命令

| 命令 | 说明 |
|------|------|
| `bash tools/build-web.sh` | src/ → dist/desktop.bundle.html（--strict 体积棘轮） |
| `node tools/minify-bundle.js` | 压缩 → dist/desktop.bundle.min.html |
| `bash android/build-local.sh` | 全量构建 + 归档 APK 到 /workspace/AAA 安装包/（滚动保留最新 10 个 + R8 mapping）+ 每 25 提交 COS bundle 备份 |
| `bash tools/verify.sh` | 提交前门禁（env-check + build --strict + minify + lint + 测试 + E2E × 5） |
| `bash tools/lint.sh` | 代码检查（构建一致性/文档链接/CHANGELOG/头部注释/var 纪律） |
| `bash tests/run-tests.sh` | 测试套件（自动发现 test-*.js / test-*.sh） |
| `bash tools/branch-retire.sh <分支>` | 退休 topic 分支（`--force` 跳过合并检查） |

## 分支治理

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

**发布**（仅用户批准后执行）：

```bash
git checkout main && git merge --no-ff feat/dev -m "merge: <版本摘要>"
git push origin main && git checkout feat/dev
```

**钩子保护**（`.githooks/`，`git config core.hooksPath .githooks` 启用）：
pre-commit 拦截墓地分支复活、`main` 直提、`src/` 与 `dist/` 不一致；commit-msg 拦截纯英文提交（merge 除外）；
pre-push 拦截分支命名违规 + 墓地复活 + `main` 非 merge 推送；post-commit 领先 `main` ≥50 预警。

**退休**：`branch-retire.sh` 记入 `.git/branch-graveyard`，`main` 和 `feat/dev` 不可退休。快照用 `git bundle` 导出仓库外。

## 数据关键约束

- **数据真相在文件系统**：「文件即真相」——用户文件即对象，元数据（位置/相机/快照）以隐藏文件
  形式存于文件系统随目录迁移；内存中的 File 对象/缓存只是投影
- **元数据写入必须走统一出口**（`layout-store`/`home-store` 的 `save*`），禁止绕过 store 裸改缓存
  对象（push/splice/改属性会污染内存投影，造成幽灵 positions 崩溃）
- **删除/移动同步清理元数据**，防孤儿记录；目录切换/刷新加代际守卫（路径快照 + seq），
  过期响应不得写入布局
- **桥层契约**：前端与文件系统唯一通道是 `FileBridge`，改签名须同提交适配
  `android/` 壳 + `src/js/bridge.js` + `tests/test-bridge.js`，详见 `docs/data-integrity.md`

## 决策触发清单

改动前先查对应文档：

| 场景 | 查阅 / 执行 |
|------|------------|
| 加工具脚本 / 拆分源文件 | `tools/build-web.sh` 的 JS_ORDER/CSS_ORDER + 完整性自检（`docs/build-pipeline.md`） |
| 改构建 / 产物结构 / 构建注入 | `docs/build-pipeline.md` |
| 改模块间调用 | 保持 JS_ORDER 顺序依赖，先定义后使用（`docs/architecture.md`） |
| 改桥协议 / FileBridge 签名 | `docs/architecture.md` + `docs/data-integrity.md`（桥层契约），须同提交适配壳层/bridge.js/测试 |
| 改布局元数据 / 相机 / 快照 | `docs/data-integrity.md`（统一出口 + 防幽灵 positions），配套 `test-layout-store`/`test-home-store` |
| 改桌面交互 / 手势 / 视图 | `docs/interaction.md`，配套对应单测（test-desktop-gesture 等）+ E2E（scripts/verify-*.js） |
| 改文件查看器 / FileOpener | `docs/viewer.md`，配套 `test-viewer`/`test-file-opener` |
| 改文件系统范围 / SAF | `docs/fs-scope.md`，配套 `test-bridge`/`test-fileapi` |
| 引入第三方库 / TypeScript | 需用户批准，默认零框架零依赖（androidx 官方支持库属可接受常规依赖） |

## 参考

- **文档索引**：`docs/README.md`
- **构建管线**：`docs/build-pipeline.md`
- **数据纪律**：`docs/data-integrity.md`
- **架构分层**：`docs/architecture.md`
- 技术栈基准：`/workspace/lexicull`（同构参考，禁止直接复制其业务代码）
