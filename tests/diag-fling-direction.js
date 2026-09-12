// 临时诊断脚本：复现"持续快速滑 → 反向弹回"。真实 desktop-gesture + DOM stub + 可控时钟。
// 重点：真正触发 fling RAF 循环，逐帧跟踪 cam.x，构造"末段回勾/急停"看是否产生负速度反向滑。
'use strict'
const fs = require('fs'); const path = require('path'); const vm = require('vm')
const PROJECT = process.argv[2] || path.join(__dirname, '..')
const SRC_DIR = path.join(PROJECT, 'src', 'js')

function makeEl(id, rect) {
  const handlers = {}
  return { id, rect, style: {}, clientWidth: rect.width, clientHeight: rect.height,
    addEventListener: function (t, fn) { (handlers[t] = handlers[t] || []).push(fn) },
    dispatch: function (t, ev) { (handlers[t] || []).forEach(function (fn) { fn(ev) }) },
    getBoundingClientRect: function () { const r = this.rect; return { left: r.left, top: r.top, width: r.width, height: r.height, right: r.left + r.width, bottom: r.top + r.height } } }
}
const viewportEl = makeEl('desktop-viewport', { left: 0, top: 56, width: 412, height: 700 })
const canvasEl = makeEl('desktop-canvas', { left: 0, top: 56, width: 412, height: 700 })

let CLOCK = 0
const rafQueue = {}; let rafNextId = 1
const sandbox = {
  App: {}, console,
  Date: { now: function () { return CLOCK } },
  performance: { now: function () { return CLOCK } },
  requestAnimationFrame: function (cb) { const id = rafNextId++; rafQueue[id] = cb; return id },
  cancelAnimationFrame: function (id) { delete rafQueue[id] },
  setTimeout: function () { return 0 }, clearTimeout: function () {},
  document: { getElementById: function (id) { if (id === 'desktop-viewport') return viewportEl; if (id === 'desktop-canvas') return canvasEl; return null } }
}
vm.createContext(sandbox)
for (const f of ['desktop-camera.js', 'desktop-gesture.js']) vm.runInContext(fs.readFileSync(path.join(SRC_DIR, f), 'utf8'), sandbox, { filename: f })
const G = sandbox.App.DesktopGesture; const C = sandbox.App.DesktopCamera
function touch(id, x, y) { return { identifier: id, clientX: x, clientY: y } }
function tev(t, p, c) { return { type: t, touches: p, changedTouches: c || p, preventDefault: function () {} } }

let cam = C.create(0, 0, 1)
function reset() {
  Object.keys(rafQueue).forEach(function (k) { delete rafQueue[k] })
  rafNextId = 1; CLOCK = 0
  G.init({ viewport: viewportEl, canvas: canvasEl, camera: C.create(0,0,1),
    onUpdate: function (c) { cam = c }, onHitTest: function () { return 'empty' }, onGestureStart: function () {} })
  G.setBrowseMode(true)
}
function flingFrames(n) {
  const xs = [cam.x]
  for (let k = 0; k < n; k++) {
    CLOCK += 16
    const ids = Object.keys(rafQueue).filter(function (id) { return rafQueue[id] })
    for (const id of ids) { const cb = rafQueue[id]; delete rafQueue[id]; cb(CLOCK) }
    xs.push(cam.x)
  }
  return xs
}
// 滑 frames 帧（每帧 dxEach/16ms），末段可选 extra 帧的回勾（dxHook 每帧）
function swipe(frames, dxEach, hookFrames, dxHook) {
  let x = 200
  viewportEl.dispatch('touchstart', tev('touchstart', [touch(1, x, 400)]))
  for (let i = 0; i < frames; i++) { CLOCK += 16; x += dxEach; viewportEl.dispatch('touchmove', tev('touchmove', [touch(1, x, 400)])) }
  for (let i = 0; i < (hookFrames || 0); i++) { CLOCK += 16; x += (dxHook || 0); viewportEl.dispatch('touchmove', tev('touchmove', [touch(1, x, 400)])) }
  CLOCK += 16
  viewportEl.dispatch('touchend', tev('touchend', [], [touch(1, x, 400)]))
}
function report(label, xs) {
  const dir = xs[xs.length-1] < xs[0] ? '向右(正常)' : (xs[xs.length-1] > xs[0] ? '向左(反向!)' : '静止')
  console.log(' [' + label + '] cam.x:', xs.map(function(v){return v.toFixed(0)}).join(' → '), '| 末' + dir)
}

console.log('=== A 持续 +x 快滑(30×+20)，无回勾 ===')
reset(); swipe(30, 20, 0, 0); report('A', flingFrames(8))

console.log('=== B 持续 +x 快滑，末段回勾 3 帧(-30/帧) ===')
reset(); swipe(30, 20, 3, -30); report('B', flingFrames(8))

console.log('=== C 持续 +x 快滑，末段急停(0 位移 4 帧) ===')
reset(); swipe(30, 20, 4, 0); report('C', flingFrames(8))
