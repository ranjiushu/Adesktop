// desktop-gesture.js 单指手势 DOM 接线集成测试：tap/框选/长按 经 touch 事件 → 回调世界坐标
// 背景：单指状态机已单测，这里验证 DOM 事件 → 识别 → 世界坐标回调 的完整链路
// 用法: node test-desktop-single-dom.js [项目路径]   （由 run-tests.sh 调用）
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
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
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

let hitTypeMode = 'empty'
const got = { tap: [], marqueeStart: [], marqueeLive: [], marqueeEnd: [], longpress: [], dragStart: [], drag: [], drop: [] }
G.init({
  viewport: viewportEl, canvas: canvasEl, camera: C.create(),
  onHitTest: function () { return hitTypeMode },
  onTap: function (w) { got.tap.push(w) },
  onMarqueeStart: function (w) { got.marqueeStart.push(w) },
  onMarqueeLive: function (a, b) { got.marqueeLive.push([a, b]) },
  onMarqueeEnd: function (a, b) { got.marqueeEnd.push([a, b]) },
  onLongPress: function (w) { got.longpress.push(w) },
  onDragStart: function (w) { got.dragStart.push(w) },
  onDrag: function (w) { got.drag.push(w) },
  onDrop: function (w, moved) { got.drop.push({ w: w, moved: moved }) }
})

;(async () => {
  // ── tap：单指按下抬起（位移 0）→ onTap，世界 = 局部（camera 0,0,1）──
  viewportEl.dispatch('touchstart', tev('touchstart', [touch(1, 200, 100)]))
  viewportEl.dispatch('touchend', tev('touchend', [], [touch(1, 200, 100)]))
  check(got.tap.length === 1, 'tap 触发 onTap 一次')
  if (got.tap.length) {
    check(Math.abs(got.tap[0].x - 200) < 1e-9 && Math.abs(got.tap[0].y - 44) < 1e-9,
      'tap 世界坐标 = (200, 44)（减去 viewport top 56），实际: ' + JSON.stringify(got.tap[0]))
  }

  // ── marquee：按下后移动 > 6px → marquee-start，再移 → marquee-live，抬起 → marquee-end ──
  viewportEl.dispatch('touchstart', tev('touchstart', [touch(1, 100, 100)]))
  viewportEl.dispatch('touchmove', tev('touchmove', [touch(1, 130, 140)]))
  check(got.marqueeStart.length === 1, '位移 > 6px 触发 onMarqueeStart')
  viewportEl.dispatch('touchmove', tev('touchmove', [touch(1, 160, 180)]))
  check(got.marqueeLive.length === 1, '框选进行中触发 onMarqueeLive')
  viewportEl.dispatch('touchend', tev('touchend', [], [touch(1, 160, 180)]))
  check(got.marqueeEnd.length === 1, '抬起触发 onMarqueeEnd')
  if (got.marqueeEnd.length) {
    const start = got.marqueeEnd[0][0]
    const end = got.marqueeEnd[0][1]
    check(Math.abs(start.x - 100) < 1e-9 && Math.abs(start.y - 44) < 1e-9 &&
          Math.abs(end.x - 160) < 1e-9 && Math.abs(end.y - 124) < 1e-9,
      'marquee-end 起点(100,44) 终点(160,124)，实际: ' + JSON.stringify(got.marqueeEnd[0]))
  }

  // ── longpress：按住不动 500ms → onLongPress（世界 = 按下点）──
  viewportEl.dispatch('touchstart', tev('touchstart', [touch(1, 250, 200)]))
  await new Promise(function (r) { setTimeout(r, 550) })
  check(got.longpress.length === 1, '长按 500ms 触发 onLongPress')
  if (got.longpress.length) {
    check(Math.abs(got.longpress[0].x - 250) < 1e-9 && Math.abs(got.longpress[0].y - 144) < 1e-9,
      'longpress 世界坐标 = (250, 144)，实际: ' + JSON.stringify(got.longpress[0]))
  }

  // ── 长按后拖动 → onDrag，抬起 → onDrop moved=true ──
  viewportEl.dispatch('touchmove', tev('touchmove', [touch(1, 280, 240)]))
  check(got.drag.length === 1, '长按拿起后 move 触发 onDrag')
  viewportEl.dispatch('touchend', tev('touchend', [], [touch(1, 280, 240)]))
  check(got.drop.length === 1 && got.drop[0].moved === true, '长按拖动后抬起 → onDrop moved=true')

  // ── 已选中拖动直接拿起：hitType=selected，位移超阈值 → onDragStart（不必长按）──
  const dragCountBefore = got.drag.length
  const dropCountBefore = got.drop.length
  hitTypeMode = 'selected'
  viewportEl.dispatch('touchstart', tev('touchstart', [touch(1, 200, 200)]))
  viewportEl.dispatch('touchmove', tev('touchmove', [touch(1, 220, 200)]))
  check(got.dragStart.length === 1, 'selected 拖动 → onDragStart 一次（直接拿起）')
  if (got.dragStart.length) {
    check(Math.abs(got.dragStart[0].x - 220) < 1e-9 && Math.abs(got.dragStart[0].y - 144) < 1e-9,
      'drag-start 世界坐标 (220, 144)，实际: ' + JSON.stringify(got.dragStart[0]))
  }
  viewportEl.dispatch('touchmove', tev('touchmove', [touch(1, 240, 200)]))
  check(got.drag.length === dragCountBefore + 1, 'drag-start 后 move → onDrag 增加一次')
  viewportEl.dispatch('touchend', tev('touchend', [], [touch(1, 240, 200)]))
  check(got.drop.length === dropCountBefore + 1 && got.drop[got.drop.length - 1].moved === true,
    '拖动后抬起 → onDrop moved=true')

  if (failures > 0) {
    console.error('  [FAIL] desktop-single-dom 单指接线测试 ' + failures + ' 项失败')
    process.exit(1)
  }
  console.log('  [ok] desktop-single-dom 单指接线测试全部通过')
})().catch(function (e) {
  console.error('ERROR:', e && e.message)
  process.exit(1)
})
