// desktop-gesture.js 单指 pan 惯性 DOM 接线测试：快速甩动松手 → 相机继续滑行；慢拖松手 → 即停。
// 背景：物理核心（windowVelocity/inertiaStep/inertiaDone）已单测（test-desktop-inertia），
//       这里验证 touch 事件 → VelocityTracker 采样 → pan-end 触发惯性 → RAF 驱动相机的完整链路。
// 用可控时钟 + 手动 pump RAF 帧，保证确定性（不依赖真实时间流逝）。
// 用法: node test-desktop-inertia-dom.js [项目路径]   （由 run-tests.sh 调用）
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

// ── 最小 DOM stub + 可控时钟 ──
function makeEl(id, rect) {
  const handlers = {}
  return {
    id: id, rect: rect, style: {},
    clientWidth: rect.width, clientHeight: rect.height,
    addEventListener: function (type, fn) { (handlers[type] = handlers[type] || []).push(fn) },
    dispatch: function (type, ev) { (handlers[type] || []).forEach(function (fn) { fn(ev) }) },
    getBoundingClientRect: function () {
      const r = this.rect
      return { left: r.left, top: r.top, width: r.width, height: r.height, right: r.left + r.width, bottom: r.top + r.height }
    }
  }
}

const viewportEl = makeEl('desktop-viewport', { left: 0, top: 56, width: 412, height: 700 })
const canvasEl = makeEl('desktop-canvas', { left: 0, top: 56, width: 412, height: 700 })

// 可控时钟：_now()（RAF 用）与 toLocal 采样的 Date.now() 都读同一时钟，保证采样时间戳可信。
let CLOCK = 0
const rafQueue = []     // id → cb
let rafNextId = 1
const sandbox = {
  App: {},
  console: console,
  Date: { now: function () { return CLOCK } },
  performance: { now: function () { return CLOCK } },
  requestAnimationFrame: function (cb) { const id = rafNextId++; rafQueue[id] = cb; return id },
  cancelAnimationFrame: function (id) { delete rafQueue[id] },
  setTimeout: function () { return 0 },       // 长按计时器在本测试不触发（被 move/touchend 取消）
  clearTimeout: function () {},
  document: {
    getElementById: function (id) {
      if (id === 'desktop-viewport') return viewportEl
      if (id === 'desktop-canvas') return canvasEl
      return null
    }
  }
}
vm.createContext(sandbox)
for (const f of ['desktop-camera.js', 'desktop-gesture.js']) {
  vm.runInContext(fs.readFileSync(path.join(SRC_DIR, f), 'utf8'), sandbox, { filename: f })
}

const G = sandbox.App.DesktopGesture
const C = sandbox.App.DesktopCamera

function touch(id, x, y) { return { identifier: id, clientX: x, clientY: y } }
function tev(type, pts, changed) {
  return { type: type, touches: pts, changedTouches: changed || pts, preventDefault: function () {} }
}
function setClock(ms) { CLOCK = ms }
function advanceClock(ms) { CLOCK += ms }
// 手动 pump 一帧 RAF：拿出所有排队帧，推进 16ms 后逐个执行（flingFrame 读 performance.now）。
function pumpFrames(n) {
  for (let k = 0; k < n; k++) {
    advanceClock(16)
    const current = Object.keys(rafQueue).map(function (id) { return { id: id, cb: rafQueue[id] } }).filter(function (f) { return f.cb })
    for (const f of current) { delete rafQueue[f.id]; f.cb(CLOCK) }
  }
}

// 高级浏览模式 ON，命中空白 → 单指 pan
let hitType = 'empty'
let cam = C.create(0, 0, 1)
let updated = null
G.init({
  viewport: viewportEl, canvas: canvasEl, camera: cam,
  onUpdate: function (c) { updated = c; cam = c },
  onHitTest: function () { return hitType },
  onGestureStart: function () {}
})
G.setBrowseMode(true)

// ── 场景 1：快速甩动（+x 方向，末段速度 > 阈值）→ 松手后相机继续滑行 ──
setClock(0)
const camBeforeFast = cam.x
viewportEl.dispatch('touchstart', tev('touchstart', [touch(1, 200, 400)]))
advanceClock(20)
viewportEl.dispatch('touchmove', tev('touchmove', [touch(1, 225, 400)]))   // 过阈值 → pan-start
advanceClock(20)
viewportEl.dispatch('touchmove', tev('touchmove', [touch(1, 250, 400)]))   // pan
advanceClock(20)
viewportEl.dispatch('touchmove', tev('touchmove', [touch(1, 275, 400)]))   // pan
advanceClock(20)
viewportEl.dispatch('touchmove', tev('touchmove', [touch(1, 300, 400)]))   // pan
advanceClock(20)
viewportEl.dispatch('touchend', tev('touchend', [], [touch(1, 300, 400)])) // pan-end（末段 vx≈0.5>0.2）
const camAtRelease = cam.x
pumpFrames(10)   // 松手后 10 帧（~160ms），惯性应继续向右滑（cam.x 更负）
check(camAtRelease < camBeforeFast, '快速甩动：拖动期间相机已移动（cam.x 减小）')
check(cam.x < camAtRelease, '快速甩动松手后相机继续滑行（惯性生效），cam=' + cam.x + ' 释放时 ' + camAtRelease)

// ── 场景 1b：惯性必须逐帧衰减（防"匀速无限滑"回归）──
// 2026-08-25 真机反馈"几乎无限滑、无摩擦力"——根因是 inertiaStep 衰减后的速度
// 从未写回 _flingVel，导致每帧都用同一初始速度匀速滑动。这里采样相邻两帧位移
//（间隔相同 dt），断言后一帧位移 < 前一帧（速度在真正衰减）。若该 bug 复发，
// 两帧位移相等 → 本断言失败。
function camDistance(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) }
// 复现一次快速甩动，然后逐帧记录滑行位移
setClock(0)
rafQueue.length = 0
rafNextId = 1
G.setCamera(C.create(0, 0, 1))
viewportEl.dispatch('touchstart', tev('touchstart', [touch(1, 200, 400)]))
advanceClock(20)
viewportEl.dispatch('touchmove', tev('touchmove', [touch(1, 225, 400)]))
advanceClock(20)
viewportEl.dispatch('touchmove', tev('touchmove', [touch(1, 250, 400)]))
advanceClock(20)
viewportEl.dispatch('touchmove', tev('touchmove', [touch(1, 275, 400)]))
advanceClock(20)
viewportEl.dispatch('touchmove', tev('touchmove', [touch(1, 300, 400)]))
advanceClock(20)
viewportEl.dispatch('touchend', tev('touchend', [], [touch(1, 300, 400)]))
// 取第 1、2、3 帧位移（每帧 +16ms）
function frameDx() {
  const t0 = { x: cam.x, y: cam.y }
  advanceClock(16)
  // 手动执行一帧 RAF（对应 flingFrame）
  const keys = Object.keys(rafQueue).filter(function (id) { return rafQueue[id] })
  for (const id of keys) { const cb = rafQueue[id]; delete rafQueue[id]; cb(CLOCK) }
  return camDistance(t0, { x: cam.x, y: cam.y })
}
const dx1 = frameDx()
const dx2 = frameDx()
const dx3 = frameDx()
check(dx2 < dx1 && dx3 < dx2, '惯性逐帧衰减（速度真正变小，非匀速滑）：帧位移 ' +
  dx1.toFixed(4) + ' > ' + dx2.toFixed(4) + ' > ' + dx3.toFixed(4))

// ── 场景 2：慢拖（速度低于阈值）→ 松手即停，不触发惯性 ──
// 不重复 init（那会注册第二套事件监听，处理同一事件两次）。用 setCamera 取消场景 1 残留惯性
// 并复位相机；先清空 RAF 队列，再走慢拖流程。
rafQueue.length = 0
rafNextId = 1
setClock(0)
G.setCamera(C.create(0, 0, 1))   // 取消 inertia + 复位相机（onUpdate 已同步 cam）
const camBeforeSlow = cam.x
viewportEl.dispatch('touchstart', tev('touchstart', [touch(1, 200, 400)]))
advanceClock(100)   // 每一个 move 间隔 100ms（慢拖）
viewportEl.dispatch('touchmove', tev('touchmove', [touch(1, 208, 400)]))   // 过阈值 → pan-start
advanceClock(100)
viewportEl.dispatch('touchmove', tev('touchmove', [touch(1, 214, 400)]))   // pan（14px/100ms = 0.14 < 0.2）
advanceClock(100)
viewportEl.dispatch('touchend', tev('touchend', [], [touch(1, 214, 400)])) // pan-end
const camAtSlowRelease = cam.x
pumpFrames(6)
check(cam.x <= camAtSlowRelease + 1e-9, '慢拖松手即停（不触发惯性），cam=' + cam.x + ' 释放时 ' + camAtSlowRelease)

if (failures > 0) {
  console.error('  [FAIL] desktop-inertia-dom 惯性接线测试 ' + failures + ' 项失败')
  process.exit(1)
}
console.log('  [ok] desktop-inertia-dom 惯性接线测试全部通过')
