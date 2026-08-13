// clipboard.js 单元测试：剪贴板状态机（复制/剪切标记）+ 粘贴目标名规划纯函数
// 用法: node test-clipboard.js [项目路径]   （由 run-tests.sh 调用）
'use strict'

const fs = require('fs')
const path = require('path')
const vm = require('vm')

const PROJECT = process.argv[2] || path.join(__dirname, '..')
const SRC = path.join(PROJECT, 'src', 'js', 'clipboard.js')

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
vm.runInContext(fs.readFileSync(SRC, 'utf8'), sandbox, { filename: 'clipboard.js' })

const C = sandbox.App.Clipboard

// ── 初始状态 ──
check(C.get() === null, '初始剪贴板为空 (get → null)')
check(C.has() === false, '初始 has() → false')

// ── 复制 ──
check(C.set('copy', ['a.txt', 'b.txt']) === true, 'set copy 成功')
let cb = C.get()
check(cb && cb.mode === 'copy' && cb.names.length === 2, 'get 返回 {mode:copy, names:[a.txt,b.txt]}')
check(C.has() === true, '复制后 has() → true')
check(C.isCut('a.txt') === false, 'copy 模式下 isCut → false')
check(C.isCut('x.txt') === false, '未在剪贴板的名字 isCut → false')

// ── 剪切 ──
check(C.set('cut', ['a.txt']) === true, 'set cut 成功')
check(C.isCut('a.txt') === true, 'cut 模式下 isCut(a.txt) → true')
check(C.isCut('b.txt') === false, 'cut 模式不在列表的名字 → false')

// ── 覆盖语义：新 set 覆盖旧 ──
C.set('copy', ['c.txt'])
check(C.get().names.length === 1 && C.get().names[0] === 'c.txt', '重新 set 覆盖旧剪贴板')

// ── 非法 mode 拒绝 ──
check(C.set('paste', ['a.txt']) === false, '非法 mode 拒绝')
check(C.set(undefined, ['a.txt']) === false, 'undefined mode 拒绝')

// ── clear ──
C.clear()
check(C.get() === null && C.has() === false, 'clear 后清空')
check(C.isCut('a.txt') === false, 'clear 后 isCut → false')

// ── 防御：set 时 names 复制（外部改动不影响剪贴板） ──
const src = ['a.txt', 'b.txt']
C.set('cut', src)
src.push('c.txt')
check(C.get().names.length === 2, 'set 时深拷贝 names（外部 push 不影响）')

// ── planPaste：粘贴目标名规划（重名自动加序号，文件区分扩展名） ──
// 桌面现状 items：a.txt, a 2.txt, 文件夹, 文件夹 2
const items = [
  { name: 'a.txt', isDir: false },
  { name: 'a 2.txt', isDir: false },
  { name: '文件夹', isDir: true },
  { name: '文件夹 2', isDir: true }
]

// 复制 a.txt → 目标 a 3.txt（跳过 a 2）
let plan = C.planPaste({ mode: 'copy', names: ['a.txt'] }, items)
check(plan.length === 1 && plan[0].src === 'a.txt' && plan[0].dst === 'a 3.txt',
  '复制 a.txt → a 3.txt（自动加序号），实际: ' + JSON.stringify(plan))

// 复制文件夹 → 文件夹 3
plan = C.planPaste({ mode: 'copy', names: ['文件夹'] }, items)
check(plan.length === 1 && plan[0].src === '文件夹' && plan[0].dst === '文件夹 3',
  '复制文件夹 → 文件夹 3，实际: ' + JSON.stringify(plan))

// 复制多个 → 各自独立规划
plan = C.planPaste({ mode: 'copy', names: ['a.txt', '文件夹'] }, items)
check(plan.length === 2 && plan[0].dst === 'a 3.txt' && plan[1].dst === '文件夹 3',
  '多选复制各自独立规划')

// 无冲突 → 原名
plan = C.planPaste({ mode: 'copy', names: ['b.txt'] }, items)
check(plan.length === 1 && plan[0].dst === 'b.txt', '无重名 → 目标原名')

// 同名同类型判断：文件不占文件夹的号（a.txt 不挡 文件夹）
plan = C.planPaste({ mode: 'copy', names: ['a.txt', '文件夹', 'a.txt'] }, items)
check(plan[0].dst === 'a 3.txt' && plan[2].dst === 'a 4.txt',
  '剪贴板内自身也去重（重复源 → a 3 / a 4）')

// 空剪贴板 → 空计划
plan = C.planPaste(null, items)
check(plan.length === 0, '空剪贴板 → 空计划')

if (failures > 0) {
  console.error('  [FAIL] clipboard 测试 ' + failures + ' 项失败')
  process.exit(1)
}
console.log('  [ok] clipboard 测试全部通过')
