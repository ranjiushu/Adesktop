// desktop-gesture.js DOM 接线集成测试：最小 DOM stub 验证双指 pan/zoom 完整链路
// 背景：核心数学已单测（test-desktop-camera / test-desktop-gesture），
//       这里验证 touch 事件 → 触点追踪 → 相机 → canvas transform 的接线正确性
// 用法: node test-desktop-gesture-dom.js [项目路径]   （由 run-tests.sh 调用）
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

// ── 最小 DOM stub ──
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

const sandbox = {
  App: {},
  console: console,
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

const camera = C.create()
let updated = null
G.init({ viewport: viewportEl, canvas: canvasEl, camera: camera, onUpdate: function (c) { updated = c } })

// 初始 transform
check(canvasEl.style.transform === 'translate3d(0px,0px,0) scale(1)',
  '初始 transform = translate3d(0px,0px,0) scale(1)')

// 场景 1：双指左上平移 50px（指距 70 不变）
viewportEl.dispatch('touchstart', tev('touchstart', [touch(1, 250, 500), touch(2, 320, 500)]))
viewportEl.dispatch('touchmove', tev('touchmove', [touch(1, 200, 450), touch(2, 270, 450)]))
viewportEl.dispatch('touchend', tev('touchend', []))
check(canvasEl.style.transform === 'translate3d(-50px,-50px,0) scale(1)',
  '双指平移 50px → translate3d(-50px,-50px,0) scale(1)，实际: ' + canvasEl.style.transform)

// 场景 2：双指捏合（指距 60 → 160，质心不动），放大越界 clamp 到 2.5
viewportEl.dispatch('touchstart', tev('touchstart', [touch(1, 200, 400), touch(2, 260, 400)]))
viewportEl.dispatch('touchmove', tev('touchmove', [touch(1, 150, 400), touch(2, 310, 400)]))
viewportEl.dispatch('touchend', tev('touchend', []))
check(canvasEl.style.transform.indexOf('scale(2.5)') >= 0,
  '捏合放大越界 clamp → scale(2.5)，实际: ' + canvasEl.style.transform)

// 场景 3：指数突变 2→1 指，剩指 dead 不误触发（重置后验证）
G.init({ viewport: viewportEl, canvas: canvasEl, camera: C.create() })
viewportEl.dispatch('touchstart', tev('touchstart', [touch(1, 200, 400), touch(2, 280, 400)]))
viewportEl.dispatch('touchend', tev('touchend', [], [touch(2, 280, 400)]))  // 只抬 id=2，剩 id=1
const before = canvasEl.style.transform
viewportEl.dispatch('touchmove', tev('touchmove', [touch(1, 100, 300)]))     // 剩指移动
check(canvasEl.style.transform === before,
  '2→1 指后剩指 dead，单指 move 不改变 transform')

if (failures > 0) {
  console.error('  [FAIL] desktop-gesture-dom 接线测试 ' + failures + ' 项失败')
  process.exit(1)
}
console.log('  [ok] desktop-gesture-dom 接线测试全部通过')
