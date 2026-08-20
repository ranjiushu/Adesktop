// 文件「打开」态（Viewer 即文件）集成测试（2026-08-20 重构，取代旧「锁定文件单向锚定」）。
// 旧语义的病：文件打开后网格图标 + 上层窗口两个实体并存，双位置源（positions vs
// Viewer rect）各自演化 → 分家/重叠，靠单向锚定/钉子户/锁定集合打补丁协调。
// 新语义：Viewer = 文件的打开状态，同一实体两种形态——
//   1. 打开：图标退出网格渲染（原格子释放为普通空格），位置真相 = Viewer 矩形
//   2. Viewer 拖动/移动不回写 positions（无第二套坐标，无需同步）
//   3. 整理桌面：打开态文件不是网格成员（不参与、不留占位格）
//   4. 关闭：Viewer 变回图标——窗口位置吸附落位（被占避让），图标重现
// 驱动方式：真实 Desktop + 真实手势层 + 真实 FileOpener + InternalViewer 桩
// （实例生命周期 + persist 通知模拟真实 viewer.js 行为），touch 事件走完整链路。
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

// ── InternalViewer 桩：实例生命周期模拟真实 viewer.js ──
// open → 创建 canvas 实例 + persist 通知；closeById → onClose(path, rect) + 移除 + persist 通知
let persistListenerFn = null
let moveListenerFn = null
let viewerInstances = []
let nextViewerId = 1
function canvasViewerList() {
  return viewerInstances.map(function (i) {
    return { path: i.getPath(), name: i.getPath(), kind: 'text', rect: i.getRect() }
  })
}
sandbox.App.InternalViewer = {
  setPersistListener: function (fn) { persistListenerFn = fn },
  setMoveListener: function (fn) { moveListenerFn = fn },
  open: function (opts) {
    const anchor = opts.anchor || { x: 0, y: 0 }
    const rect = opts.rect || { x: anchor.x, y: anchor.y, w: 200, h: 280 }
    const inst = {
      id: nextViewerId++,
      _path: opts.path,
      _rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
      _onClose: opts.onClose,
      isOpen: function () { return true },
      getMode: function () { return 'canvas' },
      getPath: function () { return this._path },
      getRect: function () { return { x: this._rect.x, y: this._rect.y, w: this._rect.w, h: this._rect.h } },
      isDesktopEntity: function () { return true },
      isSelected: function () { return false },
      setSelected: function () {}
    }
    viewerInstances.push(inst)
    if (persistListenerFn) persistListenerFn(canvasViewerList())
    return inst.id
  },
  closeById: function (id) {
    const inst = viewerInstances.find(function (i) { return i.id === id })
    if (!inst) return false
    viewerInstances = viewerInstances.filter(function (i) { return i.id !== id })
    if (typeof inst._onClose === 'function') inst._onClose(inst._path, inst.getRect())
    if (persistListenerFn) persistListenerFn(canvasViewerList())
    return true
  },
  list: function () { return viewerInstances.slice() },
  hasPath: function (p) { return viewerInstances.some(function (i) { return i.getPath() === p }) },
  isDesktopEntityPath: function (p) { return viewerInstances.some(function (i) { return i.getPath() === p }) },
  desktopEntityPaths: function () { return viewerInstances.map(function (i) { return i.getPath() }) },
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
  closeAll: function () { viewerInstances = [] },
  count: function () { return viewerInstances.length },
  isAnyOpen: function () { return viewerInstances.length > 0 }
}

vm.createContext(sandbox)
for (const f of ['namespace.js', 'desktop-nav.js', 'double-tap.js', 'desktop-selection.js',
  'folder-sort.js', 'desktop-grid.js', 'folder-layout.js', 'layout-store.js', 'view-store.js',
  'home-store.js', 'desktop-camera.js', 'desktop-gesture.js', 'desktop-core.js', 'desktop-render.js',
  'desktop-browse-mode.js', 'desktop-navigation.js', 'desktop-persist.js', 'desktop-viewer-link.js',
  'desktop-gesture-handlers.js', 'desktop.js', 'file-opener.js', 'desktop-organize.js', 'actions.js']) {
  vm.runInContext(fs.readFileSync(path.join(SRC_DIR, f), 'utf8'), sandbox, { filename: f })
}

const D = sandbox.App.Desktop
const C = sandbox.App.DesktopCore
const VL = sandbox.App.DesktopViewerLink
function touch(id, x, y) { return { identifier: id, clientX: x, clientY: y } }
function tev(type, pts, changed) {
  return { type: type, touches: pts, changedTouches: changed || pts, preventDefault: function () {} }
}
// 屏幕坐标 → world（viewport top=56，camera (0,0,1)）
function screen(wx, wy) { return { x: wx, y: wy + 56 } }
function iconRendered(name) {
  return createdIcons.some(function (n) { return n.getAttribute('data-name') === name })
}

;(async function () {
  D.initGesture()
  VL.init()   // main.js 里才调用的 ViewerLink.init：注入持久化 + 实体 diff 监听
  await D.refresh()
  check(createdIcons.length === 2, '根目录渲染 2 个图标（全部关闭态）')
  check(eq(C.positions['a.txt'], { x: 16, y: 16 }), 'a.txt 自动排布在 (16,16)')

  // ── 场景 1：双击打开 → 文件变成 Viewer（图标退出网格，原格子释放）──
  const aCenter = screen(16 + 42, 16 + 38)   // a.txt 图标中心（世界 (58,54)）
  viewportEl.dispatch('touchstart', tev('touchstart', [touch(1, aCenter.x, aCenter.y)]))
  viewportEl.dispatch('touchend', tev('touchend', [], [touch(1, aCenter.x, aCenter.y)]))
  viewportEl.dispatch('touchstart', tev('touchstart', [touch(1, aCenter.x, aCenter.y)]))
  viewportEl.dispatch('touchend', tev('touchend', [], [touch(1, aCenter.x, aCenter.y)]))
  check(viewerInstances.length === 1 && viewerInstances[0].getPath() === 'a.txt', '双击 → a.txt 打开为 Viewer 实例')
  check(VL.isLockedPath('a.txt') === true, '打开态 = 锁定（派生态，禁改禁移）')
  check(!iconRendered('a.txt') && iconRendered('b.txt'), '打开后 a.txt 图标退出网格（只剩 b.txt）')
  check(!C.bounds['a.txt'], '打开态文件无命中边界（点选/框选/拖动都碰不到）')

  // ── 场景 2：Viewer 拖动不回写 positions（无第二套坐标，桌面层不订阅 onMove）──
  check(moveListenerFn === null, 'Viewer 位置变化监听未注入（Viewer 矩形自身即位置真相）')
  const aPosStale = C.positions['a.txt']
  viewerInstances[0]._rect.x = 300
  viewerInstances[0]._rect.y = 260
  check(eq(C.positions['a.txt'], aPosStale), 'Viewer 窗口移动后 positions 不动（关闭时按窗口落位）')

  // ── 场景 3：整理桌面——打开态文件不是网格成员（不参与、不留占位格）──
  sandbox.App.Actions.organizeDesktop()
  await new Promise(function (res) { setTimeout(res, 30) })   // refresh 异步完成
  check(eq(C.positions['a.txt'], aPosStale), '整理桌面：打开态 a.txt 位置不动（不参与整理）')
  check(eq(C.positions['b.txt'], { x: 14, y: 16 }), '整理桌面：b.txt 排到首格 (14,16)（a 的原格无占位保护）')
  check(!iconRendered('a.txt'), '整理后 a.txt 仍无图标（仍处打开态）')

  // ── 场景 4：关闭 → Viewer 变回文件（窗口位置吸附落位，图标重现）──
  sandbox.App.InternalViewer.closeById(viewerInstances[0].id)
  check(VL.isLockedPath('a.txt') === false, '关闭后锁定自动解除（实例消失，派生态）')
  check(eq(C.positions['a.txt'], { x: 316, y: 248 }),
    '关闭落位：窗口左上 (300,260) 吸附网格 (316,248)，实际 ' + JSON.stringify(C.positions['a.txt']))
  check(iconRendered('a.txt'), '关闭后 a.txt 图标重现（实体集合 diff → 重渲染）')
  const aNode = C.iconEls['a.txt']
  check(aNode && aNode.style.left === '316px' && aNode.style.top === '248px',
    '重现图标落在吸附位置 (316,248)')

  // ── 场景 5：关闭落位避让——期望格被占 → 最近空格 ──
  // 再打开 a.txt，把 b.txt 挪到 a 的窗口吸附格上，关闭时 a 应避让到右邻
  viewportEl.dispatch('touchstart', tev('touchstart', [touch(1, 316 + 42, 248 + 38 + 56)]))
  viewportEl.dispatch('touchend', tev('touchend', [], [touch(1, 316 + 42, 248 + 38 + 56)]))
  viewportEl.dispatch('touchstart', tev('touchstart', [touch(1, 316 + 42, 248 + 38 + 56)]))
  viewportEl.dispatch('touchend', tev('touchend', [], [touch(1, 316 + 42, 248 + 38 + 56)]))
  check(viewerInstances.length === 1 && !iconRendered('a.txt'), '再次打开 a.txt（图标退出）')
  // b.txt 占据 a 的期望格（316,248)：直接摆位 + 重渲染建立 bounds
  C.positions['b.txt'] = { x: 316, y: 248 }
  sandbox.App.DesktopRender.render()
  viewerInstances[0]._rect.x = 300
  viewerInstances[0]._rect.y = 260
  sandbox.App.InternalViewer.closeById(viewerInstances[0].id)
  check(eq(C.positions['a.txt'], { x: 416, y: 248 }),
    '期望格被 b.txt 占用 → 避让到右邻空格 (416,248)，实际 ' + JSON.stringify(C.positions['a.txt']))
  check(eq(C.positions['b.txt'], { x: 316, y: 248 }), '静止图标 b.txt 不动')

  if (failures > 0) {
    console.error('  [FAIL] test-viewer-lock-sync ' + failures + ' 项失败')
    process.exit(1)
  }
  console.log('  [ok] test-viewer-lock-sync 文件「打开」态回归全部通过')
})().catch(function (e) {
  console.error('  [FAIL] test-viewer-lock-sync 异常: ' + e.message)
  console.error(e.stack)
  process.exit(1)
})
