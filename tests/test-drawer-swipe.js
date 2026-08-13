// drawer-swipe.js 纯函数单元测试：vm 加载真实模块，验证速度采样与松手决策（移植自 LexiCull 的语义）
// 背景：手势松手决策（滑出 30% 或末段速度 > 0.3px/ms）决定 Drawer 开合，纯函数必须稳定
// 用法: node test-drawer-swipe.js [项目路径]   （由 run-tests.sh 调用）
'use strict'

const fs = require('fs')
const path = require('path')
const vm = require('vm')

const PROJECT = process.argv[2] || path.join(__dirname, '..')
const SRC = path.join(PROJECT, 'src', 'js', 'drawer-swipe.js')

let failures = 0
function check(cond, msg) {
  if (cond) {
    console.log('  [ok] ' + msg)
  } else {
    console.error('  [fail] ' + msg)
    failures++
  }
}
function approx(a, b, eps) {
  return Math.abs(a - b) <= (eps || 1e-9)
}

const source = fs.readFileSync(SRC, 'utf8')

const sandbox = {
  App: {},
  console: console
}
vm.createContext(sandbox)
vm.runInContext(source, sandbox, { filename: 'drawer-swipe.js' })

const S = sandbox.App.DrawerSwipe

// ── segmentVelocity：末段瞬时速度 ──
check(approx(S.segmentVelocity(100, 50), 2), 'segmentVelocity 100px/50ms = 2 px/ms')
check(approx(S.segmentVelocity(10, 10), 10 / 16), 'segmentVelocity 短窗口按 16ms 下限折算 (10/16)')
check(S.segmentVelocity(0, 0) === 0, 'segmentVelocity dt=0 → 0')
check(S.segmentVelocity(50, -5) === 0, 'segmentVelocity dt<0 → 0')
check(S.segmentVelocity(NaN, 50) === 0, 'segmentVelocity NaN → 0')
check(S.segmentVelocity(Infinity, 50) === 0, 'segmentVelocity Infinity → 0')
check(S.segmentVelocity('x', 50) === 0, 'segmentVelocity 非数字 → 0')

// ── windowVelocity：100ms 采样窗口速度 ──
check(S.windowVelocity([]) === 0, 'windowVelocity 空数组 → 0')
check(S.windowVelocity([{ px: 0, t: 0 }]) === 0, 'windowVelocity 单样本 → 0')
check(S.windowVelocity(null) === 0, 'windowVelocity null → 0')
check(approx(S.windowVelocity([
  { px: -200, t: 0 },
  { px: -100, t: 100 }
]), 1), 'windowVelocity 窗口内位移/时间 = 1 px/ms')
check(S.windowVelocity([
  { px: -200, t: 100 },
  { px: -100, t: 0 }
]) === 0, 'windowVelocity 时间回退 → 0')
check(S.windowVelocity([
  { px: -200, t: 0 },
  { x: -100, t: 100 }
]) === 0, 'windowVelocity 缺失 px 字段 → 0')

// ── decideDrawerSettle：松手决策 ──
check(S.decideDrawerSettle(0.5, 0) === 'open', '滑出 50% 无速度 → open')
check(S.decideDrawerSettle(0.2, 0) === 'close', '滑出 20% 无速度 → close')
check(S.decideDrawerSettle(0.1, 0.5) === 'open', '滑出 10% 但 0.5px/ms 甩出 → open（fling）')
check(S.decideDrawerSettle(0.4, 0.2) === 'open', '滑出 40% + 0.2px/ms → open')
check(S.decideDrawerSettle(0.3, 0) === 'close', '恰好 30% 不超阈值 → close')
check(S.decideDrawerSettle(0, 0.3) === 'close', '速度恰好 0.3 不超阈值 → close')
check(S.decideDrawerSettle(NaN, 0.9) === 'open', 'progress 非法时按 0，速度仍生效 → open')
check(S.decideDrawerSettle(0.5, 0, 0.6, 0.3) === 'close', '自定义 progress 阈值 0.6 → close')
check(S.decideDrawerSettle(0.2, 0, 0.1, 0.3) === 'open', '自定义 progress 阈值 0.1 → open')

if (failures > 0) {
  console.error('  [FAIL] drawer-swipe 纯函数测试 ' + failures + ' 项失败')
  process.exit(1)
}
console.log('  [ok] drawer-swipe 纯函数测试全部通过')
