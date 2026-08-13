// desktop-gesture.js 单指手势状态机单元测试：tap/框选/长按拿起/拖移 的判定与转换
// 背景：单指手势按「时间/位移」赛跑（先到先得），状态转换是触摸手感 bug 的高发区
// 用法: node test-desktop-single-gesture.js [项目路径]   （由 run-tests.sh 调用）
'use strict'

const fs = require('fs')
const path = require('path')
const vm = require('vm')

const PROJECT = process.argv[2] || path.join(__dirname, '..')
const SRC_DIR = path.join(PROJECT, 'src', 'js')

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
for (const f of ['desktop-camera.js', 'desktop-gesture.js']) {
  vm.runInContext(fs.readFileSync(path.join(SRC_DIR, f), 'utf8'), sandbox, { filename: f })
}

const G = sandbox.App.DesktopGesture

// ── singleDown ──
let sg = G.singleDown(100, 100, 0)
check(sg.phase === 'pending' && sg.startX === 100 && sg.startY === 100, 'singleDown → pending(100,100)')

// ── singleMove：位移 < 阈值 → 无效果，保持 pending ──
let r = G.singleMove(sg, 103, 100)
check(r.sg.phase === 'pending' && r.effect.type === 'none', '位移 3px < 6px → 保持 pending，无效果')

// ── singleMove：位移 > 阈值 → marquee-start ──
r = G.singleMove(sg, 110, 100)
check(r.sg.phase === 'marquee' && r.effect.type === 'marquee-start', '位移 10px > 6px → marquee-start')
check(r.effect.x === 100 && r.effect.y === 100, 'marquee 起点 = 按下点 (100,100)')

// ── singleMove：marquee 中 → marquee-live ──
r = G.singleMove(r.sg, 120, 80)
check(r.effect.type === 'marquee-live' && r.effect.startX === 100 && r.effect.startY === 100 && r.effect.x === 120 && r.effect.y === 80,
  'marquee 中 move → marquee-live（起点固定，当前点更新）')

// ── singleLongPress：pending 未动 → longpress + pickedup ──
sg = G.singleDown(50, 50, 0)
r = G.singleLongPress(sg)
check(r.sg.phase === 'pickedup' && r.effect.type === 'longpress', 'pending 未动 → longpress + pickedup')

// ── singleLongPress：已转 marquee → none ──
sg = G.singleDown(50, 50, 0)
sg = G.singleMove(sg, 60, 50).sg  // 转 marquee
r = G.singleLongPress(sg)
check(r.effect.type === 'none' && r.sg.phase === 'marquee', '已转 marquee 后长按 → none（不拿起）')

// ── singleMove：pickedup → dragmove + drag ──
sg = G.singleDown(50, 50, 0)
sg = G.singleLongPress(sg).sg  // pickedup
r = G.singleMove(sg, 60, 70)
check(r.sg.phase === 'dragmove' && r.effect.type === 'drag' && r.effect.x === 60 && r.effect.y === 70,
  'pickedup 后 move → dragmove + drag')

// ── singleUp：pending 未动 → tap ──
sg = G.singleDown(10, 10, 0)
r = G.singleUp(sg, 11, 10)
check(r.effect.type === 'tap' && r.effect.x === 11 && r.effect.y === 10, 'pending 未动 up → tap')

// ── singleUp：pending 但位移超（兜底）→ marquee-end ──
sg = G.singleDown(10, 10, 0)
r = G.singleUp(sg, 30, 10)
check(r.effect.type === 'marquee-end', 'pending 位移超 up → marquee-end（兜底）')

// ── singleUp：marquee → marquee-end ──
sg = G.singleDown(10, 10, 0)
sg = G.singleMove(sg, 30, 20).sg
r = G.singleUp(sg, 40, 25)
check(r.effect.type === 'marquee-end' && r.effect.startX === 10 && r.effect.startY === 10 && r.effect.x === 40 && r.effect.y === 25,
  'marquee up → marquee-end')

// ── singleUp：pickedup 未动 → drop moved=false ──
sg = G.singleDown(10, 10, 0)
sg = G.singleLongPress(sg).sg
r = G.singleUp(sg, 10, 10)
check(r.effect.type === 'drop' && r.effect.moved === false, 'pickedup 未动 up → drop moved=false')

// ── singleUp：dragmove → drop moved=true ──
sg = G.singleDown(10, 10, 0)
sg = G.singleLongPress(sg).sg
sg = G.singleMove(sg, 30, 40).sg
r = G.singleUp(sg, 30, 40)
check(r.effect.type === 'drop' && r.effect.moved === true, 'dragmove up → drop moved=true')

// ── 阈值可配置 ──
sg = G.singleDown(0, 0, 0)
r = G.singleMove(sg, 20, 0, { tapThreshold: 30 })
check(r.sg.phase === 'pending', '自定义 tapThreshold=30，20px 仍 pending')

// ── hitType 分流：selected 拖动 → 直接拿起；icon/empty 拖动 → 框选 ──
sg = G.singleDown(100, 100, 0, 'selected')
r = G.singleMove(sg, 110, 100)
check(r.sg.phase === 'dragmove' && r.effect.type === 'drag-start', 'selected 拖动 → drag-start（直接拿起）')
sg = G.singleDown(100, 100, 0, 'icon')
r = G.singleMove(sg, 110, 100)
check(r.sg.phase === 'marquee' && r.effect.type === 'marquee-start', 'icon 拖动 → marquee-start（框选）')
sg = G.singleDown(100, 100, 0, 'empty')
r = G.singleMove(sg, 110, 100)
check(r.sg.phase === 'marquee' && r.effect.type === 'marquee-start', 'empty 拖动 → marquee-start（框选）')

if (failures > 0) {
  console.error('  [FAIL] desktop-single-gesture 单指状态机测试 ' + failures + ' 项失败')
  process.exit(1)
}
console.log('  [ok] desktop-single-gesture 单指状态机测试全部通过')
