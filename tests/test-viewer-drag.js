// Viewer 实体拖动回归测试（2026-08-20 刀 1：拖动手柄删除后的新交互模型）。
// 背景：手柄原是「两套选中模型」的补丁（未选中 Viewer 拖动 = 框选，需辅助入口
// 直接拿起）。交互模型与文件图标统一后手柄删除，Viewer 拖动手势 = 文件手势：
//   - 已选中 Viewer：按下位移超阈值 → 直接拿起（viewer-selected → beginDrag）
//   - 未选中 Viewer：按下拖动 → 框选（不拿起）；框选结束命中 → 选中
//   - 未选中 Viewer：长按 → 选中 + 拿起（与文件图标一致）
// 驱动方式：真实 Desktop + 真实手势层（vm 最小 DOM stub）+ InternalViewer 桩
// （无 handleAt/syncHandles——手柄 API 已移除，手势层不得再调用），touch 事件走完整链路。
// 用法: node test-viewer-drag.js [项目路径]   （由 run-tests.sh 调用）
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

// ── 最小 DOM stub（render + 手势监听，同 test-desktop-drop-selection）──
function makeClassList() {
  return {
    _set: {},
    add: function (c) { this._set[c] = true },
    remove: function (c) { delete this._set[c] },
    contains: function (c) { return !!this._set[c] }
  }
}
function makeIconEl() {
  return {
    offsetWidth: 84, offsetHeight: 76,
    classList: makeClassList(),
    style: {}, appendChild: function () {},
    _attrs: {},
    setAttribute: function (k, v) { this._attrs[k] = v },
    getAttribute: function (k) { return this._attrs[k] }
  }
}
let createdIcons = []
function makeGridEl() {
  const el = {
    _html: '', children: [], classList: makeClassList(), style: {},
    get innerHTML() { return el._html },
    set innerHTML(v) { el._html = v; el.children = []; createdIcons = [] },
    appendChild: function (node) { createdIcons.push(node); el.children.push(node) }
  }
  return el
}
function makeViewportEl(rect) {
  const handlers = {}
  return {
    clientWidth: rect.width, clientHeight: rect.height,
    style: {}, classList: makeClassList(),
    addEventListener: function (type, fn) { (handlers[type] = handlers[type] || []).push(fn) },
    dispatch: function (type, ev) { (handlers[type] || []).forEach(function (fn) { fn(ev) }) },
    getBoundingClientRect: function () {
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height,
        right: rect.left + rect.width, bottom: rect.top + rect.height }
    }
  }
}

const gridEl = makeGridEl()
const viewportEl = makeViewportEl({ left: 0, top: 56, width: 412, height: 700 })
const canvasEl = { style: {}, classList: makeClassList() }
const els = {
  'desktop-grid': gridEl,
  'desktop-viewport': viewportEl,
  'desktop-canvas': canvasEl,
  'desktop-marquee': { style: {} }
}

const fsTree = { '': [{ name: 'a.txt', isDir: false, size: 1, mtime: 2 }] }
const sandbox = {
  App: {},
  console: console,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  Date: Date,
  Promise: Promise,
  document: {
    getElementById: function (id) { return els[id] || null },
    createElement: function (tag) { return makeIconEl() }
  },
  localStorage: { getItem: function () { return null }, setItem: function () {} },
  navigator: {}
}
sandbox.window = sandbox
sandbox.App.bridge = { vibrate: function () {} }
sandbox.App.toast = { show: function () {} }
sandbox.App.Dialog = { open: function () {}, close: function () {} }
sandbox.App.Loading = { showTag: function () {}, hideTag: function () {}, show: function () {}, hide: function () {} }
sandbox.App.Actions = { moveIntoFolder: function () {} }
sandbox.App.FileAPI = {
  rootInfo: function () { return Promise.resolve({ rootName: 'Test', mode: 'private', displayPath: '内部存储/Test' }) },
  list: function (p) { return Promise.resolve((fsTree[p || ''] || []).slice()) }
}
sandbox.App.HomeStore = { load: function () { return null }, saveHome: function () { return true }, saveFallback: function () { return true } }
sandbox.App.ViewStore = { load: function () { return { viewStyle: 'grid', sortBy: 'name', sortDir: 1 } }, save: function () { return true } }
sandbox.App.ViewMenu = { setEnabled: function () {} }
sandbox.App.fabSpeedDial = { setSelection: function () {} }
sandbox.App.Drawer = { updatePath: function () {} }
sandbox.App.BottomBar = { updateNavButtons: function () {} }
sandbox.App.Clipboard = { isCut: function () { return false } }
sandbox.App.ViewerStore = { load: function () { return [] }, save: function () { return true } }

// ── InternalViewer 桩：一个 canvas 态实例（无手柄 API——已随刀 1 移除）──
const beginDragCalls = []
const moveByCalls = []
const endDragCalls = []
const selectOnlyCalls = []
const cardRect = { x: 100, y: 200, w: 200, h: 280 }
const stubInst = {
  id: 'v1',
  selected: false,
  dragging: false,
  getMode: function () { return 'canvas' },
  isSelected: function () { return this.selected },
  beginDrag: function (w) { beginDragCalls.push(w); this.dragging = true; return true },
  moveBy: function (w) { moveByCalls.push(w) },
  endDrag: function () { endDragCalls.push(true); this.dragging = false },
  cancelDrag: function () { this.dragging = false },
  isDragging: function () { return this.dragging }
}
function pointInCard(wx, wy) {
  return wx >= cardRect.x && wx <= cardRect.x + cardRect.w && wy >= cardRect.y && wy <= cardRect.y + cardRect.h
}
sandbox.App.InternalViewer = {
  topmostAt: function (wx, wy) { return pointInCard(wx, wy) ? stubInst : null },
  rectHit: function (rect) {
    const r = cardRect
    const hit = !(r.x + r.w < rect.x || rect.x + rect.w < r.x || r.y + r.h < rect.y || rect.y + rect.h < r.y)
    return hit ? stubInst : null
  },
  selectOnly: function (id) { selectOnlyCalls.push(id); stubInst.selected = true },
  anySelected: function () { return stubInst.selected },
  deselectAll: function () { stubInst.selected = false },
  selectedInstance: function () { return stubInst.selected ? stubInst : null },
  draggingInstance: function () { return stubInst.dragging ? stubInst : null },
  setPersistListener: function () {},
  list: function () { return [] },
  open: function () {},
  closeById: function () {}
}

vm.createContext(sandbox)
// 按 JS_ORDER 加载真实模块（同 test-desktop-drop-selection；viewer.js 太重不加载，
// InternalViewer 以桩替代——desktop-render/viewer-link 均为防御式调用）
for (const f of ['namespace.js', 'desktop-nav.js', 'double-tap.js', 'desktop-selection.js',
  'folder-sort.js', 'desktop-grid.js', 'folder-layout.js', 'layout-store.js', 'view-store.js',
  'home-store.js', 'desktop-camera.js', 'desktop-gesture.js', 'desktop-core.js', 'desktop-render.js',
  'desktop-browse-mode.js', 'desktop-navigation.js', 'desktop-persist.js', 'desktop-viewer-link.js',
  'desktop-gesture-handlers.js', 'desktop.js']) {
  vm.runInContext(fs.readFileSync(path.join(SRC_DIR, f), 'utf8'), sandbox, { filename: f })
}

const D = sandbox.App.Desktop
function touch(id, x, y) { return { identifier: id, clientX: x, clientY: y } }
function tev(type, pts, changed) {
  return { type: type, touches: pts, changedTouches: changed || pts, preventDefault: function () {} }
}
// 世界坐标 → 屏幕事件坐标（viewport top=56，camera (0,0,1)：世界 = 局部屏幕坐标）
function screen(wx, wy) { return { x: wx, y: wy + 56 } }
function sleep(ms) { return new Promise(function (res) { setTimeout(res, ms) }) }

;(async function () {
  D.initGesture()
  await D.refresh()

  const cardCenter = { x: cardRect.x + cardRect.w / 2, y: cardRect.y + cardRect.h / 2 }

  // ── 场景 1：已选中 Viewer → 按下位移 7px（超 TAP_THRESHOLD=6）→ 直接拿起 ──
  stubInst.selected = true
  let p = screen(cardCenter.x, cardCenter.y)
  viewportEl.dispatch('touchstart', tev('touchstart', [touch(1, p.x, p.y)]))
  viewportEl.dispatch('touchmove', tev('touchmove', [touch(1, p.x, p.y + 7)]))
  check(beginDragCalls.length === 1, '已选中 Viewer + 位移 7px → beginDrag 一次（选中即可直接拖动，无需手柄）')
  viewportEl.dispatch('touchmove', tev('touchmove', [touch(1, p.x, p.y + 40)]))
  check(moveByCalls.length === 1, '拖动继续 → moveBy 跟随')
  viewportEl.dispatch('touchend', tev('touchend', [], [touch(1, p.x, p.y + 40)]))
  check(endDragCalls.length === 1 && !stubInst.dragging, '抬起 → endDrag 收尾')

  // ── 场景 2：未选中 Viewer → 按下拖动 = 框选（不拿起）；框选结束命中 → 选中 ──
  stubInst.selected = false
  beginDragCalls.length = 0
  selectOnlyCalls.length = 0
  p = screen(cardCenter.x, cardCenter.y)
  viewportEl.dispatch('touchstart', tev('touchstart', [touch(1, p.x, p.y)]))
  viewportEl.dispatch('touchmove', tev('touchmove', [touch(1, p.x + 60, p.y + 60)]))
  check(beginDragCalls.length === 0, '未选中 Viewer + 拖动 → 框选（不直接拿起，与文件图标一致）')
  viewportEl.dispatch('touchend', tev('touchend', [], [touch(1, p.x + 60, p.y + 60)]))
  check(selectOnlyCalls.length === 1 && selectOnlyCalls[0] === 'v1', '框选结束命中 Viewer → 选中该实例')

  // ── 场景 3：未选中 Viewer → 长按 = 选中 + 拿起（与文件图标一致）──
  stubInst.selected = false
  beginDragCalls.length = 0
  selectOnlyCalls.length = 0
  endDragCalls.length = 0
  p = screen(cardCenter.x, cardCenter.y)
  viewportEl.dispatch('touchstart', tev('touchstart', [touch(1, p.x, p.y)]))
  await sleep(600)   // LONGPRESS_MS = 500
  check(selectOnlyCalls.length === 1 && stubInst.selected, '长按未选中 Viewer → 先选中')
  check(beginDragCalls.length === 1, '长按未选中 Viewer → 拿起（beginDrag）')
  viewportEl.dispatch('touchmove', tev('touchmove', [touch(1, p.x + 30, p.y + 30)]))
  viewportEl.dispatch('touchend', tev('touchend', [], [touch(1, p.x + 30, p.y + 30)]))
  check(endDragCalls.length === 1, '长按拖动抬起 → endDrag 收尾')

  if (failures > 0) {
    console.error('  [FAIL] test-viewer-drag Viewer 拖动回归 ' + failures + ' 项失败')
    process.exit(1)
  }
  console.log('  [ok] test-viewer-drag Viewer 拖动回归全部通过')
})().catch(function (e) {
  console.error('  [FAIL] test-viewer-drag 异常: ' + e.message)
  console.error(e.stack)
  process.exit(1)
})
