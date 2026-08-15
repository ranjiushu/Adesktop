// desktop-nav.js 单元测试：目录历史栈（进入/后退/前进）+ 路径工具
// 用法: node test-desktop-nav.js [项目路径]   （由 run-tests.sh 调用）
'use strict'

const fs = require('fs')
const path = require('path')
const vm = require('vm')

const PROJECT = process.argv[2] || path.join(__dirname, '..')
const SRC = path.join(PROJECT, 'src', 'js', 'desktop-nav.js')

let failures = 0
function check(cond, msg) {
  if (cond) {
    console.log('  [ok] ' + msg)
  } else {
    console.error('  [fail] ' + msg)
    failures++
  }
}

const sandbox = { App: {}, console: console }
vm.createContext(sandbox)
vm.runInContext(fs.readFileSync(SRC, 'utf8'), sandbox, { filename: 'desktop-nav.js' })

const N = sandbox.App.DesktopNav

// ── 初始状态 ──
let nav = N.create()
check(N.current(nav) === '', '初始路径 = 根目录（空串）')
check(N.canBack(nav) === false, '初始不可后退')
check(N.canForward(nav) === false, '初始不可前进')

// ── 进入子目录 ──
nav = N.enter(nav, 'docs')
check(N.current(nav) === 'docs', '进入 docs')
check(N.canBack(nav) === true, '进入后可以后退')
check(N.canForward(nav) === false, '进入后不可前进（前进分支已截断）')

nav = N.enter(nav, 'docs/sub')
check(N.current(nav) === 'docs/sub', '进入 docs/sub')

// ── 后退 / 前进 ──
nav = N.back(nav)
check(N.current(nav) === 'docs', '后退 → docs')
check(N.canForward(nav) === true, '后退后可前进')
nav = N.back(nav)
check(N.current(nav) === '', '后退 → 根目录')
check(N.canBack(nav) === false, '根目录不可再后退')
nav = N.back(nav)
check(N.current(nav) === '', '越界后退保持根目录（防御）')
nav = N.forward(nav)
check(N.current(nav) === 'docs', '前进 → docs')
nav = N.forward(nav)
check(N.current(nav) === 'docs/sub', '前进 → docs/sub')
nav = N.forward(nav)
check(N.current(nav) === 'docs/sub', '越界前进保持末尾（防御）')

// ── 进入新分支截断前进历史 ──
nav = N.back(nav)
nav = N.back(nav)              // 现在在根
nav = N.enter(nav, 'photos')   // 从根进入新目录
check(N.current(nav) === 'photos', '从根进入 photos')
check(N.canForward(nav) === false, '新分支截断旧前进历史（photos 后不可前进到 docs/sub）')
nav = N.back(nav)
check(N.current(nav) === '', '后退回根')

// ── 路径工具 ──
check(N.join('', 'a.txt') === 'a.txt', 'join 根目录不拼接斜杠')
check(N.join('docs', 'a.txt') === 'docs/a.txt', 'join 子目录拼接')
check(N.parent('docs/sub') === 'docs', 'parent 子目录')
check(N.parent('a.txt') === '', 'parent 根目录文件 → 空串')
check(N.parent('') === '', 'parent 空串 → 空串')
check(N.basename('docs/a.txt') === 'a.txt', 'basename 子目录文件')
check(N.basename('a.txt') === 'a.txt', 'basename 根目录文件')
check(N.basename('') === '', 'basename 空串')

if (failures > 0) {
  console.error('  [FAIL] desktop-nav 测试 ' + failures + ' 项失败')
  process.exit(1)
}
console.log('  [ok] desktop-nav 测试全部通过')
