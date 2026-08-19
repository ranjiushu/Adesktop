// Viewer 拖动手柄「按住即拖动」回归测试（修复：拿起判定以按下起点为基准）。
// 背景：手柄命中区仅 6px 高（HANDLE_H），TAP_THRESHOLD=6px——按下后位移一旦
// 超过阈值触发 drag-start，移动后点必然移出手柄矩形；旧实现用【移动后】点重新
// handleAt 命中，几乎必然拿不起，表现为「手柄点不动/拖不动」。
// 修复后 drag-start 携带按下起点（sx/sy），handleDragStart 以起点命中 → 拿得起。
// 驱动方式：真实 Desktop + 真实手势层（vm 最小 DOM stub）+ InternalViewer 桩
// （handleAt 复刻 viewer.js handleWorldRect 判定），touch 事件走完整链路。
// 用法: node test-handle-drag.js [项目路径]   （由 run-tests.sh 调用）
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

// ── InternalViewer 桩：一个 canvas 态实例 + handleAt（复刻 viewer.js handleWorldRect）──
const HANDLE_W = 36
const HANDLE_H = 6
const HANDLE_GAP = 14
function handleWorldRect(rect, camera) {
  const z = camera.zoom || 1
  const gap = HANDLE_GAP / z, w = HANDLE_W / z, h = HANDLE_H / z
  const cx = rect.x + rect.w / 2
  const top = rect.y + rect.h + gap
  return { x: cx - w / 2, y: top, w: w, h: h }
}
const handleAtCalls = []      // handleAt 收到的世界点（验证命中基准 = 按下起点）
const beginDragCalls = []
const selectOnlyCalls = []
const cardRect = { x: 100, y: 200, w: 200, h: 280 }
const stubInst = {
  id: 'v1',
  getMode: function () { return 'canvas' },
  isSelected: function () { return false },
  beginDrag: function (w) { beginDragCalls.push(w); return true },
  handleHitTest: function (wx, wy, camera) {
    const r = handleWorldRect(cardRect, camera)
    return wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.y + r.h
  }
}
sandbox.App.InternalViewer = {
  handleAt: function (wx, wy, camera) {
    handleAtCalls.push({ x: wx, y: wy })
    return stubInst.handleHitTest(wx, wy, camera) ? stubInst : null
  },
  topmostAt: function () { return null },
  rectHit: function () { return null },
  selectOnly: function (id) { selectOnlyCalls.push(id) },
  anySelected: function () { return false },
  deselectAll: function () {},
  selectedInstance: function () { return null },
  draggingInstance: function () { return null },
  syncHandles: function () {},
  showHandles: function () {},
  hideHandles: function () {},
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
// 屏幕坐标 → world（viewport top=56，camera (0,0,1)：世界 = 局部屏幕坐标）
function screen(wx, wy) { return { x: wx, y: wy + 56 } }

;(async function () {
  D.initGesture()
  await D.refresh()

  // 手柄世界矩形（相机 (0,0,1)）
  const cam = D.getCamera ? D.getCamera() : sandbox.App.DesktopCore.camera
  const hr = handleWorldRect(cardRect, cam)
  const handleCenter = { x: hr.x + hr.w / 2, y: hr.y + hr.h / 2 }

  // ── 场景：按下手柄中心 → 位移 7px（超 TAP_THRESHOLD=6）→ 直接拿起拖动 ──
  const p = screen(handleCenter.x, handleCenter.y)
  viewportEl.dispatch('touchstart', tev('touchstart', [touch(1, p.x, p.y)]))
  // 纵向移动 7px：旧实现移动后点已移出手柄矩形（高 6px）→ 拿不起；修复后以按下起点命中
  viewportEl.dispatch('touchmove', tev('touchmove', [touch(1, p.x, p.y + 7)]))
  check(beginDragCalls.length === 1, '按住手柄 + 位移 7px → beginDrag 一次（拿得起）')
  check(selectOnlyCalls.length === 1 && selectOnlyCalls[0] === 'v1', '按住手柄 → 自动选中该 Viewer（selectOnly v1）')

  // 命中基准 = 按下起点：handleAt 收到的每个点都应 ≈ 起点（down 命中 + drag-start 起点命中）
  const allAtStart = handleAtCalls.length >= 2 && handleAtCalls.every(function (pt) {
    return Math.abs(pt.x - handleCenter.x) < 0.5 && Math.abs(pt.y - handleCenter.y) < 0.5
  })
  check(allAtStart, 'handleAt 命中基准 = 按下起点（收到 ' + handleAtCalls.length + ' 次，' +
    '而非移动后点 ' + JSON.stringify({ x: handleCenter.x, y: handleCenter.y + 7 }) + '）')

  // 拖动继续 → moveBy 语义：桩 beginDrag 已拿起点，后续 drag 事件由 draggingInstance 接管
  viewportEl.dispatch('touchmove', tev('touchmove', [touch(1, p.x, p.y + 40)]))
  viewportEl.dispatch('touchend', tev('touchend', [], [touch(1, p.x, p.y + 40)]))
  check(true, '拖动 + 抬起完整走完（无异常）')

  if (failures > 0) {
    console.error('  [FAIL] test-handle-drag 手柄拖动回归 ' + failures + ' 项失败')
    process.exit(1)
  }
  console.log('  [ok] test-handle-drag 手柄拖动回归全部通过')
})().catch(function (e) {
  console.error('  [FAIL] test-handle-drag 异常: ' + e.message)
  console.error(e.stack)
  process.exit(1)
})
