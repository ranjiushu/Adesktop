# Desktop

以**真实文件系统**为基础的移动端空间化工作台（Windows Desktop 隐喻：文件即对象、图标自由摆放、位置可记忆）。
纯前端单文件 + Android WebView 壳。零框架零依赖。
文件系统访问经 Java Bridge（`@JavascriptInterface`）暴露给前端，Promise 化调用；
桌面布局等元数据以隐藏文件形式存于文件系统，保持「文件即真相」。
包名占位 `com.example.desktop`（发布前确认）。

- **发布线**: `main`（仅 `merge --no-ff`，需用户批准，禁止主动合流）
- **开发基线**: 日常开发直接 commit 到 `main` 之外的 topic 分支（`feat/` / `fix/`），或按需建立 `feat/` 长期基线

## 会话启动

```bash
bash /workspace/probes/probe-repo.sh   # 仓库动态（针对 lexicull，Desktop 同样适用）
cd /workspace/Desktop && git status && git log --oneline -3
```

信息权威顺序：**本文件铁律 > docs/ 规范 > 探针实测 > 记忆**。冲突时以前者为准。

## 铁律

### P0（违反即毁，绝无例外）

1. **禁止直接编辑 `dist/`** —— 改 `src/` 后 `tools/build-web.sh` 重建
2. **禁止 `git reset --hard`** —— 不可逆丢代码
3. **禁止未经用户许可清 App 数据**
4. **构建顺序不可变**：`build-web.sh` → `minify-bundle.js` → Gradle（串行，不可调换不可跳过）
5. **提交前 `tools/verify.sh` 全绿**（build --strict + 产物结构校验 + 测试套件）

### P1（当次会话内纠正）

- 数据写入路径禁止空 `catch(e){}`，失败必须返回 false + 持久告警
- 文档/注释禁止 emoji（UI 字符串例外）
- 禁止以恢复旧状态为目的建长期 backup/archive 分支或标签
- 改 `src/` 后必须构建；有意义的改动后 commit（中文，Conventional Commits）
- JS 用 ES6+（`const`/`let`/箭头/async-await/模板字符串），禁止新增 `var`
- 真机 UI 验证交用户，助手边界 = 无头 Chromium E2E + 单元测试 + logcat
- 新源文件必须登记进 `tools/build-web.sh` 的 `JS_ORDER` / `CSS_ORDER`，否则不进产物

## 常用命令

| 命令 | 说明 |
|------|------|
| `bash tools/build-web.sh` | src/ → dist/desktop.bundle.html（--strict 体积棘轮生效） |
| `node tools/minify-bundle.js` | 压缩 → dist/desktop.bundle.min.html |
| `bash android/build-local.sh` | 全量构建 + 归档 APK 到 /workspace/AAA 安装包/（滚动保留最新 10 个 + R8 mapping）+ 每 25 提交 COS bundle 备份 |
| `bash tools/verify.sh` | 提交前门禁（build --strict + minify + 测试） |
| `bash tests/run-tests.sh` | 测试套件（自动发现 test-*.js / test-*.sh） |

## 分支治理

```
main ←── merge --no-ff only ── topic 分支
  (稳定发布)                      (短命，完成即合流)
```

**日常开发**：单文件小改直接 commit 到当前 topic；跨文件/实验性改动开新 topic：

```bash
git checkout -b feat/xxx main
# ...开发...
git checkout main && git merge --no-ff feat/xxx -m "merge: <摘要>"
```

**发布**（仅用户批准后执行）：

```bash
git checkout main && git merge --no-ff <topic> -m "merge: <版本摘要>"
git push origin main
```

**钩子保护**（`.githooks/`，`git config core.hooksPath .githooks` 启用）：
pre-commit 拦截 `main` 直提 + `src/` 与 `dist/` 不一致；commit-msg 拦截纯英文提交（merge 除外）；pre-push 拦截分支命名违规。

## 决策触发清单

| 场景 | 查阅 / 执行 |
|------|------------|
| 加工具脚本 / 拆分源文件 | `tools/build-web.sh` 的 JS_ORDER/CSS_ORDER + 完整性自检 |
| 改构建 / 产物结构 | `docs/build-pipeline.md` |
| 改模块间调用 | 保持 JS_ORDER 顺序依赖，先定义后使用 |
| 引入第三方库 / TypeScript | 需用户批准，默认零框架零依赖 |

## 参考

- **文档索引**：`docs/README.md`
- **构建管线**：`docs/build-pipeline.md`
- 技术栈基准：`/workspace/lexicull`（同构参考，禁止直接复制其业务代码）
