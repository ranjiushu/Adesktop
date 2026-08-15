// shortcut.js 纯函数单元测试：快捷方式文件契约（扩展名判定 / JSON 解析 / 元信息构建 / 文件名净化）
// 用法: node test-shortcut.js [项目路径]   （由 run-tests.sh 调用）
'use strict'

const fs = require('fs')
const path = require('path')
const vm = require('vm')

const PROJECT = process.argv[2] || path.join(__dirname, '..')
const SRC = path.join(PROJECT, 'src', 'js', 'shortcut.js')

let failures = 0
function check(cond, msg) {
  if (cond) console.log('  [ok] ' + msg)
  else { console.error('  [fail] ' + msg); failures++ }
}

const source = fs.readFileSync(SRC, 'utf8')
const sandbox = { App: {}, console: console }
vm.createContext(sandbox)
vm.runInContext(source, sandbox, { filename: 'shortcut.js' })

const S = sandbox.App.Shortcut

// ── isShortcutName ──
check(S.isShortcutName('微信.desktop') === true, '微信.desktop → 快捷方式')
check(S.isShortcutName('微信.DESKTOP') === true, '大写 .DESKTOP 归一化')
check(S.isShortcutName('微信.txt') === false, '非 .desktop → 非快捷方式')
check(S.isShortcutName('noext') === false, '无扩展名 → 非快捷方式')
check(S.isShortcutName('.desktop') === false, '点开头隐藏文件 → 非快捷方式（无主名）')

// ── parseShortcut: application ──
const meta = S.parseShortcut(JSON.stringify({ type: 'application', package: 'com.tencent.mm', label: '微信', isSystem: false }))
check(meta.type === 'application' && meta.package === 'com.tencent.mm' && meta.label === '微信',
  'application 解析字段齐全')

// 缺 package → 抛错
let threw = false
try { S.parseShortcut('{"type":"application"}') } catch (e) { threw = true }
check(threw, 'application 缺 package 抛错')

// 非法 JSON → 抛错
threw = false
try { S.parseShortcut('not-json') } catch (e) { threw = true }
check(threw, '非法 JSON 抛错')

// 未知 type → 抛错
threw = false
try { S.parseShortcut('{"type":"weird"}') } catch (e) { threw = true }
check(threw, '未知 type 抛错')

// 空 label 回退 package
const fallbackMeta = S.parseShortcut(JSON.stringify({ type: 'application', package: 'com.x.y' }))
check(fallbackMeta.label === 'com.x.y', 'application 缺 label 回退 package')

const iconMeta = S.parseShortcut(JSON.stringify({ type: 'application', package: 'a.b', icon: 'data:image/png;base64,xx' }))
check(iconMeta.icon === 'data:image/png;base64,xx', 'application 解析 icon 字段')

// ── parseShortcut: file（预留） ──
const fm = S.parseShortcut(JSON.stringify({ type: 'file', label: 'a.pdf', uri: 'content://x' }))
check(fm.type === 'file' && fm.uri === 'content://x', 'file 类型预留解析')

// ── buildAppShortcut ──
const built = S.buildAppShortcut({ package: 'a.b', label: 'A', isSystem: true })
check(built.indexOf('"type":"application"') >= 0, 'buildAppShortcut 含 type=application')
check(built.indexOf('"package":"a.b"') >= 0, 'buildAppShortcut 含 package')
check(built.indexOf('"isSystem":true') >= 0, 'buildAppShortcut 含 isSystem')

const builtIcon = S.buildAppShortcut({ package: 'a.b', label: 'A', icon: 'data:image/png;base64,yy' })
check(builtIcon.indexOf('"icon":"data:image/png;base64,yy"') >= 0, 'buildAppShortcut 内嵌 icon')
const builtNoIcon = S.buildAppShortcut({ package: 'a.b', label: 'A' })
check(builtNoIcon.indexOf('"icon"') < 0, 'buildAppShortcut 无 icon 不写入字段')

// ── sanitizeFileName ──
check(S.sanitizeFileName('微信', 'fb') === '微信', '普通中文标签保留')
check(S.sanitizeFileName('a/b:c*d?', 'fb') === 'a b c d', '非法字符剥离为空格')
check(S.sanitizeFileName('  ', 'com.fb') === 'com.fb', '空标签回退 package')
check(S.sanitizeFileName('...foo...', 'fb') === 'foo', '首尾点剥离')
check(S.sanitizeFileName('foo  bar', 'fb') === 'foo bar', '连续空白折叠')
check(S.sanitizeFileName(null, 'com.fb') === 'com.fb', 'null 标签回退 package')

if (failures > 0) { console.error('  [FAIL] shortcut 测试 ' + failures + ' 项失败'); process.exit(1) }
console.log('  [ok] shortcut 测试全部通过')
process.exit(0)
