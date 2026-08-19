// Viewer 文件锁定生命周期集成测试（修复：锁定文件图标与 Viewer 预览窗口双向锚定）。
// 背景：锁定文件有双位置源（图标 positions vs Viewer rect），打开时对齐后各自
// 独立演化 → 拖动图标/拖动 Viewer/整理桌面/避让会让两者分家 → 重叠/占位混乱。
// 修复语义（Windows 占用式）：
//   1. 图标拖动 → Viewer 实时跟随（syncRectForPath，单向锚定——图标是网格真相锚点）
//   2. Viewer 拖动 → 图标不跟随（窗口自由浮动；desktop-viewer-link 不订阅 Viewer 位置变化）
//   3. 整理桌面跳过锁定文件，其余排布让开其占位格（occupied）
//   4. 其它文件拖动不能顶开锁定文件（resolvePlacement immovable 钉子户）
// 驱动方式：真实 Desktop + 真实手势层 + InternalViewer 桩（记录双向同步），
// touch 事件走完整链路。
// 用法: node test-viewer-lock-sync.js [项目路径]   （由 run-tests.sh 调用）
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
const eq = function (a, b) { return JSON.stringify(a) === JSON.stringify(b) }

// ── 最小 DOM stub（同 test-desktop-drop-selection）──
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

const fsTree = {
  '': [
    { name: 'a.txt', isDir: false, size: 1, mtime: 2 },
    { name: 'b.txt', isDir: false, size: 2, mtime: 3 }
  ]
}
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
sandbox.App.ViewerStore = { load: function () { return { viewers: [] } }, save: function () { return true } }

// ── InternalViewer 桩：一个 canvas 实例（a.txt）+ 双向同步记录 ──
const syncRectCalls = []    // syncRectForPath 调用记录 {path, x, y}
let persistListenerFn = null
let moveListenerFn = null
const viewerRect = { x: 16, y: 16, w: 200, h: 280 }
const stubInst = {
  id: 'v1',
  getMode: function () { return 'canvas' },
  getPath: function () { return 'a.txt' },
  getRect: function () { return { x: viewerRect.x, y: viewerRect.y, w: viewerRect.w, h: viewerRect.h } },
  isSelected: function () { return false },
  beginDrag: function () { return true },
  setRectFromIcon: function (x, y) {
    viewerRect.x = x
    viewerRect.y = y
    return true
  }
}
sandbox.App.InternalViewer = {
  setPersistListener: function (fn) { persistListenerFn = fn },
  setMoveListener: function (fn) { moveListenerFn = fn },
  syncRectForPath: function (path, x, y) {
    syncRectCalls.push({ path: path, x: x, y: y })
    if (path === 'a.txt') return stubInst.setRectFromIcon(x, y)
    return false
  },
  handleAt: function () { return null },
  topmostAt: function () { return null },
  rectHit: function () { return null },
  selectOnly: function () {},
  anySelected: function () { return false },
  deselectAll: function () {},
  selectedInstance: function () { return null },
  draggingInstance: function () { return null },
  syncHandles: function () {},
  showHandles: function () {},
  hideHandles: function () {},
  fullscreenInstance: function () { return null },
  suspendCanvas: function () {},
  resumeCanvas: function () {},
  list: function () { return [] },
  open: function () {},
  closeById: function () {},
  closeAll: function () {},
  count: function () { return 0 },
  isAnyOpen: function () { return false }
}

vm.createContext(sandbox)
for (const f of ['namespace.js', 'desktop-nav.js', 'double-tap.js', 'desktop-selection.js',
  'folder-sort.js', 'desktop-grid.js', 'folder-layout.js', 'layout-store.js', 'view-store.js',
  'home-store.js', 'desktop-camera.js', 'desktop-gesture.js', 'desktop-core.js', 'desktop-render.js',
  'desktop-browse-mode.js', 'desktop-navigation.js', 'desktop-persist.js', 'desktop-viewer-link.js',
  'desktop-gesture-handlers.js', 'desktop.js', 'actions.js']) {
  vm.runInContext(fs.readFileSync(path.join(SRC_DIR, f), 'utf8'), sandbox, { filename: f })
}

const D = sandbox.App.Desktop
const C = sandbox.App.DesktopCore
function touch(id, x, y) { return { identifier: id, clientX: x, clientY: y } }
function tev(type, pts, changed) {
  return { type: type, touches: pts, changedTouches: changed || pts, preventDefault: function () {} }
}
// 屏幕坐标 → world（viewport top=56，camera (0,0,1)）
function screen(wx, wy) { return { x: wx, y: wy + 56 } }

;(async function () {
  D.initGesture()
  // main.js 里才调用的 ViewerLink.init：注入持久化 + 移动监听（双向锚定接线）
  sandbox.App.DesktopViewerLink.init()
  await D.refresh()
  check(createdIcons.length === 2, '根目录渲染 2 个图标')

  // ── 场景 1：拖动锁定文件图标 → Viewer 实时跟随（含 drop 网格吸附同步）──
  C._lockedPaths.add('a.txt')
  const aCenter = screen(16 + 42, 16 + 38)   // a.txt 图标中心（世界 (58,54)）
  // tap 选中 a.txt
  viewportEl.dispatch('touchstart', tev('touchstart', [touch(1, aCenter.x, aCenter.y)]))
  viewportEl.dispatch('touchend', tev('touchend', [], [touch(1, aCenter.x, aCenter.y)]))
  check(D.getSelectionNames().length === 1 && D.getSelectionNames()[0] === 'a.txt', 'tap 选中 a.txt')
  // 拖：mv1 微移触发 drag-start（起点=此处），mv2 产生 60px 世界增量 → 吸附到新格
  const mv1 = { x: aCenter.x + 8, y: aCenter.y }
  const mv2 = { x: aCenter.x + 68, y: aCenter.y + 68 }
  viewportEl.dispatch('touchstart', tev('touchstart', [touch(1, aCenter.x, aCenter.y)]))
  viewportEl.dispatch('touchmove', tev('touchmove', [touch(1, mv1.x, mv1.y)]))
  viewportEl.dispatch('touchmove', tev('touchmove', [touch(1, mv2.x, mv2.y)]))
  check(syncRectCalls.length >= 1, '图标拖动 → syncRectForPath 被调用')
  check(eq(viewerRect, { x: 76, y: 84, w: 200, h: 280 }),
    '拖动中 Viewer 实时跟随（未吸附 76,84），实际 (' + viewerRect.x + ',' + viewerRect.y + ')')
  viewportEl.dispatch('touchend', tev('touchend', [], [touch(1, mv2.x, mv2.y)]))
  check(eq(viewerRect, { x: 116, y: 132, w: 200, h: 280 }),
    'drop 网格吸附后 Viewer 同步到 (116,132)，实际 (' + viewerRect.x + ',' + viewerRect.y + ')')
  check(eq(C.positions['a.txt'], { x: 116, y: 132 }), '图标拖动 → positions 落位 (116,132)')

  // ── 场景 2：Viewer 拖动 → 图标不跟随（单向锚定：图标是网格真相锚点，窗口自由浮动）──
  const vBefore = C.positions['a.txt']
  check(moveListenerFn === null, 'Viewer 位置变化监听未注入（desktop-viewer-link 不订阅 onMove）')
  // 模拟 Viewer 窗口被拖到新位置（组件 onMove 只通知世界矩形，Desktop 层不响应）
  viewerRect.x = 150
  viewerRect.y = 260
  check(eq(C.positions['a.txt'], vBefore),
    'Viewer 窗口移动后图标 positions 不变（' + JSON.stringify(vBefore) + '）')
  const aNode = C.iconEls['a.txt']
  check(aNode && aNode.style.left === '116px' && aNode.style.top === '132px',
    'Viewer 窗口移动后图标 DOM 不变（left/top 116/132，场景 1 drop 落位）')

  // ── 场景 3：整理桌面跳过锁定文件（图标与 Viewer 不再分家）──
  const aPosBefore = C.positions['a.txt']
  sandbox.App.Actions.organizeDesktop()
  await new Promise(function (res) { setTimeout(res, 30) })   // refresh 异步完成
  check(eq(C.positions['a.txt'], aPosBefore), '整理桌面：锁定文件 a.txt 保持原位 (' + aPosBefore.x + ',' + aPosBefore.y + ')')
  // 锁定文件占位格不被其它条目占用（a 的位置不是网格格点 → 无占用断言改为：b 不与 a 重叠）
  const bPos = C.positions['b.txt']
  const overlap = bPos && aPosBefore &&
    !(bPos.x + 84 <= aPosBefore.x || aPosBefore.x + 84 <= bPos.x ||
      bPos.y + 76 <= aPosBefore.y || aPosBefore.y + 76 <= bPos.y)
  check(!overlap, '整理桌面：b.txt 不与锁定文件 a.txt 重叠')

  // ── 场景 4：钉子户避让——拖动 b.txt 到锁定文件位置，a 不让位 ──
  const bCenter = screen(bPos.x + 42, bPos.y + 38)
  const nearStart = { x: bCenter.x + 8, y: bCenter.y }   // 微移触发 drag-start（起点=此处）
  const dragTo = screen(116 + 42, 132 + 38)              // 目标：a 图标中心（世界 (158,170)）
  // 选中 b
  viewportEl.dispatch('touchstart', tev('touchstart', [touch(1, bCenter.x, bCenter.y)]))
  viewportEl.dispatch('touchend', tev('touchend', [], [touch(1, bCenter.x, bCenter.y)]))
  // 拖 b：位移 = dragTo - nearStart（drag-start 已含 8px 微移）
  viewportEl.dispatch('touchstart', tev('touchstart', [touch(1, bCenter.x, bCenter.y)]))
  viewportEl.dispatch('touchmove', tev('touchmove', [touch(1, nearStart.x, nearStart.y)]))
  viewportEl.dispatch('touchmove', tev('touchmove', [touch(1, dragTo.x, dragTo.y)]))
  viewportEl.dispatch('touchend', tev('touchend', [], [touch(1, dragTo.x, dragTo.y)]))
  check(eq(C.positions['a.txt'], { x: 116, y: 132 }), '钉子户：拖动 b 后锁定文件 a 保持原位 (116,132)')
  const bAfter = C.positions['b.txt']
  check(bAfter && !(bAfter.x === 150 && bAfter.y === 260), '钉子户：b 与锁定文件冲突时让位（不占 a 的格）')

  if (failures > 0) {
    console.error('  [FAIL] test-viewer-lock-sync ' + failures + ' 项失败')
    process.exit(1)
  }
  console.log('  [ok] test-viewer-lock-sync 锁定文件单向锚定回归全部通过')
})().catch(function (e) {
  console.error('  [FAIL] test-viewer-lock-sync 异常: ' + e.message)
  console.error(e.stack)
  process.exit(1)
})
