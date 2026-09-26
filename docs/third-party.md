# 第三方来源台账

登记本仓库内**非自研**内容的来源与许可，回答一个问题：**哪部分代码 / 素材不能随意改许可，再分发时须遵守什么。**

## 规则

- 每引入一项第三方内容，在同一提交内登记一行；移除时同提交删行。
- 只记事实（来源、许可、是否随产物分发），不记本地绝对路径，不复制会漂移的版本号——版本以 `package.json` / `android/app/build.gradle` 的声明为唯一事实源。
- 自研代码不登记。从作者本人其它项目移植的代码不算第三方，登记一次并注明即可。
- 登记后不得删除来源署名：署名义务随产物一起分发。

## 清单

| 内容 | 位置 | 来源 | 许可 | 备注 |
|------|------|------|------|------|
| 类型图标数据 | `src/js/type-icons-data.js` | Material Design Icons（pictogrammers.com/library/mdi/） | Apache-2.0 | 随产物打进 bundle，文件头已注明来源与许可，署名不得删除 |
| Android 侧支持库 | `android/app/build.gradle` | androidx（documentfile / core） | Apache-2.0 | 官方支持库，随 APK 分发；版本以构建脚本声明为准 |
| npm 依赖（运行时 + 构建期） | `package.json` | puppeteer-core、typescript、terser、clean-css | Apache-2.0 / MIT / BSD-2-Clause | 仅构建与验证期使用，不进产物；引入新依赖前先核对许可并在此登记 |
| 自研移植代码 | `src/js/*.js` 中头部注释标注「移植自 LexiCull」者 | 作者本人的其它项目 | 版权归本项目作者 | 无第三方义务；检索方式：`grep -rl 移植自 src/js` |

## 引入第三方内容前的检查

1. 许可是否允许再分发，是否与 GPL-3.0 兼容（AGPL / 非商业 / 无许可一律不可引入）；
2. 是否有署名、NOTICE 保留或同许可传染义务，落到本表「备注」；
3. 是否需要随产物分发许可全文——需要时放入 `docs/` 并在本表登记。

引入第三方库另需用户批准（见 `AGENTS.md` 决策触发清单：默认零第三方依赖）。
