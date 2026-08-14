// double-tap.js 单元测试：双击窗口判定（同一对象 300ms 内二击）+ 反选延迟窗口
// 用法: node test-double-tap.js [项目路径]   （由 run-tests.sh 调用）
'use strict'

const fs = require('fs')
const path = require('path')
const vm = require('vm')

const PROJECT = process.argv[2] || path.join(__dirname, '..')
const SRC = path.join(PROJECT, 'src', 'js', 'double-tap.js')

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
vm.runInContext(fs.readFileSync(SRC, 'utf8'), sandbox, { filename: 'double-tap.js' })

const D = sandbox.App.DoubleTap
const T0 = 1000000

// ── 首次 tap：不构成双击，记录状态 ──
let st = D.create()
let r = D.hit(st, 'a.txt', T0, 300)
check(r.double === false, '首次 tap 非双击')
check(r.state && r.state.name === 'a.txt' && r.state.time === T0, '首次 tap 记录状态')

// ── 300ms 内二击同一对象 → 双击 ──
r = D.hit(r.state, 'a.txt', T0 + 150, 300)
check(r.double === true, '窗口内二击同一对象 → 双击')
check(r.state === null, '双击后状态清空')

// ── 窗口内二击不同对象 → 非双击（各自独立）──
st = D.create()
r = D.hit(st, 'a.txt', T0, 300)
r = D.hit(r.state, 'b.txt', T0 + 100, 300)
check(r.double === false, '窗口内二击不同对象 → 非双击')
check(r.state && r.state.name === 'b.txt', '状态更新为最新 tap 对象')

// ── 超过窗口 → 非双击 ──
st = D.create()
r = D.hit(st, 'a.txt', T0, 300)
r = D.hit(r.state, 'a.txt', T0 + 301, 300)
check(r.double === false, '超过 300ms 二击同一对象 → 非双击')

// ── 空白（name=null）不参与双击 ──
st = D.create()
r = D.hit(st, null, T0, 300)
r = D.hit(r.state, null, T0 + 100, 300)
check(r.double === false, '空白二击不构成双击')

// ── 默认窗口 300 ──
st = D.create()
r = D.hit(st, 'a.txt', T0, undefined)
r = D.hit(r.state, 'a.txt', T0 + 299, undefined)
check(r.double === true, '默认窗口 300ms 内二击 → 双击')

// ── within：反选延迟窗口辅助 ──
st = D.create()
r = D.hit(st, 'a.txt', T0, 300)
check(D.within(r.state, 'a.txt', T0 + 100, 300) === true, '窗口内 within → true')
check(D.within(r.state, 'a.txt', T0 + 301, 300) === false, '超时 within → false')
check(D.within(r.state, 'b.txt', T0 + 100, 300) === false, '不同对象 within → false')
check(D.within(null, 'a.txt', T0, 300) === false, '无状态 within → false')

if (failures > 0) {
  console.error('  [FAIL] double-tap 测试 ' + failures + ' 项失败')
  process.exit(1)
}
console.log('  [ok] double-tap 测试全部通过')
