// desktop-viewer-link.js 模块级边界测试：文件「打开」态（Viewer 即文件）+ 布局 key 迁移。
// 语义（2026-08-20 重构）：Viewer = 文件的打开状态——打开即图标退出网格（位置真相
// 移交 Viewer 矩形），关闭即按窗口位置吸附落位回网格。验证：
//   1. 锁定是派生态：isLockedPath / getLockedPaths 由 InternalViewer 实例推导（无集合）
//   2. isDesktopEntityPath：canvas 实体 true；folder 全屏预览 false（不退出网格）
//   3. closeViewer 关闭选中 Viewer（落位经 onClose 链，无需手动解锁）
//   4. handleViewerClosed 落位：空格吸附 / 被占避让 / folder 跳过 / 无矩形跳过
//   5. 实体集合 diff：persist 监听驱动网格重渲染（图标退场/重现）
//   6. applyRename 布局 key 迁移 + 落盘 + 刷新
//   7. applyMoves 批量迁移 + 落盘（不逐项刷新）
//   8. applyRename / applyMoves 无效输入防御
// 用法: node test-desktop-viewerlink-lock.js [项目路径]   （由 run-tests.sh 调用）
'use strict'

const fs = require('fs')
const path = require('path')
const vm = require('vm')

const PROJECT = process.argv[2] || path.join(__dirname, '..')
const SRC = path.join(PROJECT, 'src', 'js')

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

// ── 最小 DOM stub ──
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
    innerHTML: '',
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

const gridEl = makeGridEl()
const viewportEl = { clientWidth: 412, clientHeight: 700, addEventListener: function () {} }
const els = {
  'desktop-grid': gridEl,
  'desktop-viewport': viewportEl,
  'desktop-canvas': { style: {}, classList: makeClassList(), addEventListener: function () {} },
  'desktop-marquee': { style: {} }
}

// ── 可控 Viewer 桩（实例驱动：isOpen/getPath/isDesktopEntity 派生一切状态）──
let viewerInstances = []
let closedIds = []
let selectedViewerId = null
let persistListenerFn = null

function makeInst(id, p, desktopEntity) {
  return {
    id: id,
    _path: p,
    _open: true,
    _entity: !!desktopEntity,
    isOpen: function () { return this._open },
    getPath: function () { return this._path },
    isDesktopEntity: function () { return this._open && this._entity },
    getMode: function () { return 'canvas' }
  }
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
sandbox.App.FileAPI = {
  rootInfo: function () { return Promise.resolve({ rootName: 'Test', mode: 'private', displayPath: '/data/Test' }) },
  list: function () { return Promise.resolve([]) }
}
sandbox.App.LayoutStore = {
  load: function () { return { version: 1, icons: { 'a.txt': { x: 100, y: 100 }, 'b.txt': { x: 200, y: 200 }, 'c.txt': { x: 300, y: 300 } }, camera: { x: 0, y: 0, zoom: 1 } } },
  save: function () { return true }
}
sandbox.App.HomeStore = { load: function () { return null }, saveHome: function () { return true }, saveFallback: function () { return true } }
sandbox.App.ViewStore = { load: function () { return { viewStyle: 'grid', sortBy: 'name', sortDir: 1 } }, save: function () { return true } }
sandbox.App.ViewMenu = { setEnabled: function () {} }
sandbox.App.fabSpeedDial = { setSelection: function () {} }
sandbox.App.Drawer = { updatePath: function () {} }
sandbox.App.BottomBar = { updateNavButtons: function () {} }
sandbox.App.Clipboard = { isCut: function () { return false } }
sandbox.App.TypeIcons = { kindFor: function () { return 'text' }, svgFor: function () { return '' }, iconFor: function () { return '' }, kindSvg: function () { return '' } }
sandbox.App.Thumbnail = { canThumbnail: function () { return false }, request: function () {} }
sandbox.App.Shortcut = { isShortcutName: function () { return false } }
sandbox.App.DesktopCamera = { create: function () { return { x: 0, y: 0, zoom: 1 } } }
sandbox.App.DesktopGesture = { init: function () {}, setCamera: function () {} }
sandbox.App.ViewerStore = { load: function () { return { version: 1, viewers: [] } }, save: function () { return true } }
sandbox.App.InternalViewer = {
  setPersistListener: function (fn) { persistListenerFn = fn },
  selectedInstance: function () {
    if (selectedViewerId === null) return null
    return viewerInstances.find(function (inst) { return inst.id === selectedViewerId }) || null
  },
  anySelected: function () { return selectedViewerId !== null },
  closeById: function (id) {
    closedIds.push(id)
    viewerInstances = viewerInstances.filter(function (i) { return i.id !== id })
    if (selectedViewerId === id) selectedViewerId = null
  },
  list: function () { return viewerInstances.slice() },
  hasPath: function (p) {
    return viewerInstances.some(function (i) { return i.isOpen() && i.getPath() === p })
  },
  isDesktopEntityPath: function (p) {
    return viewerInstances.some(function (i) { return i.isDesktopEntity() && i.getPath() === p })
  },
  desktopEntityPaths: function () {
    return viewerInstances.filter(function (i) { return i.isDesktopEntity() }).map(function (i) { return i.getPath() })
  },
  closeAll: function () { viewerInstances.forEach(function (i) { closedIds.push(i.id) }); viewerInstances = []; selectedViewerId = null }
}

vm.createContext(sandbox)
for (const f of ['namespace.js', 'desktop-nav.js', 'double-tap.js', 'desktop-selection.js',
  'desktop-grid.js', 'folder-sort.js', 'folder-layout.js', 'layout-store.js', 'view-store.js',
  'home-store.js', 'desktop-camera.js', 'desktop-gesture.js',
  'desktop-core.js', 'desktop-render.js', 'desktop-browse-mode.js',
  'desktop-navigation.js', 'desktop-persist.js', 'desktop-viewer-link.js',
  'desktop-gesture-handlers.js', 'desktop.js']) {
  vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), sandbox, { filename: f })
}

const C = sandbox.App.DesktopCore
const VL = sandbox.App.DesktopViewerLink
const D = sandbox.App.Desktop

let savedLayout = null

// 拦截 saveLayout / refresh（DesktopPersist.refresh 是内部函数，经 App.Desktop.refresh 暴露）
let persistRefreshCalls = 0
const origPersistRefresh = sandbox.App.DesktopPersist.refresh
sandbox.App.DesktopPersist.refresh = function () {
  persistRefreshCalls++
  return origPersistRefresh()
}
const origSave = sandbox.App.LayoutStore.save
sandbox.App.LayoutStore.save = function (data) { savedLayout = data; return origSave(data) }

// render 调用计数（实体集合 diff → 重渲染验证）
let renderCalls = 0
const origRender = sandbox.App.DesktopRender.render
sandbox.App.DesktopRender.render = function () { renderCalls++; return origRender() }

;(async function () {
  D.initGesture()
  VL.init()   // main.js 里才调用的 ViewerLink.init：注入持久化/实体 diff 监听

  // ── 1. 锁定是派生态：无独立集合，由 Viewer 实例推导 ──
  check(C._lockedPaths === undefined, 'C._lockedPaths 集合已删除')
  check(VL.isLockedPath('a.txt') === false, 'isLockedPath 初始为 false（无打开实例）')
  check(VL.getLockedPaths().length === 0, 'getLockedPaths 初始为空')

  viewerInstances = [makeInst(1, 'a.txt', true)]
  check(VL.isLockedPath('a.txt') === true, 'Viewer 打开 a.txt → isLockedPath = true（派生）')
  check(VL.getLockedPaths().length === 1 && VL.getLockedPaths()[0] === 'a.txt', 'getLockedPaths 含 a.txt')
  viewerInstances[0]._open = false
  check(VL.isLockedPath('a.txt') === false, '实例关闭 → 锁定自动解除（无手动解锁路径）')
  viewerInstances = []

  // ── 2. isDesktopEntityPath：canvas 实体退出网格；folder 全屏预览不退出 ──
  viewerInstances = [makeInst(2, 'a.txt', true), makeInst(3, 'b.txt', false)]
  check(VL.isDesktopEntityPath('a.txt') === true, 'canvas 实体 → isDesktopEntityPath = true')
  check(VL.isDesktopEntityPath('b.txt') === false, 'folder 全屏预览 → isDesktopEntityPath = false（图标不退出）')
  check(VL.isLockedPath('b.txt') === true, 'folder 全屏预览仍锁定（禁改禁移派生）')
  check(VL.isDesktopEntityPath('c.txt') === false, '未打开 → isDesktopEntityPath = false')
  viewerInstances = []

  // ── 3. closeViewer 无选中 Viewer 时 no-op ──
  selectedViewerId = null
  closedIds.length = 0
  VL.closeViewer()
  check(closedIds.length === 0, 'closeViewer 无选中 Viewer 时不调用 closeById')

  // ── 4. closeViewer 关闭选中 Viewer（落位/重渲染经 onClose + persist diff 链）──
  viewerInstances = [makeInst(4, 'a.txt', true)]
  selectedViewerId = 4
  closedIds.length = 0
  VL.closeViewer()
  check(closedIds.length === 1 && closedIds[0] === 4, 'closeViewer 调用 closeById(4)')
  check(selectedViewerId === null, 'closeViewer 后 selectedViewerId 清空')
  check(VL.isLockedPath('a.txt') === false, '关闭后锁定自动解除（实例消失）')
  viewerInstances = []

  // ── 5. handleViewerClosed 落位：空格吸附到最近网格格 ──
  C.state.curPath = ''
  C.positions = {}
  C.bounds = {}
  savedLayout = null
  VL.handleViewerClosed('a.txt', { x: 20, y: 30, w: 240, h: 320 })
  check(eq(C.positions['a.txt'], { x: 16, y: 16 }), '关闭落位：窗口左上 (20,30) 吸附到网格 (16,16)')
  check(savedLayout !== null, '关闭落位后 saveLayout 落盘')

  // ── 6. handleViewerClosed 落位避让：期望格被占 → 最近空格（右邻）──
  C.positions = { 'b.txt': { x: 16, y: 16 } }
  C.bounds = { 'b.txt': { x: 16, y: 16, w: 84, h: 76 } }
  savedLayout = null
  VL.handleViewerClosed('a.txt', { x: 20, y: 30, w: 240, h: 320 })
  check(eq(C.positions['a.txt'], { x: 116, y: 16 }), '期望格被 b.txt 占用 → 避让到右邻空格 (116,16)')
  check(eq(C.positions['b.txt'], { x: 16, y: 16 }), '静止图标 b.txt 不动')

  // ── 7. handleViewerClosed 防御：folder 容器 / 无矩形 → 跳过 ──
  C.state.curPath = 'sub'
  delete C.positions['a.txt']
  savedLayout = null
  VL.handleViewerClosed('a.txt', { x: 20, y: 30, w: 240, h: 320 })
  check(!C.positions['a.txt'] && savedLayout === null, 'folder 容器（无持久布局）→ 跳过落位')
  C.state.curPath = ''
  VL.handleViewerClosed('a.txt', null)
  check(!C.positions['a.txt'], '无矩形（异常路径）→ 跳过落位')

  // ── 8. 实体集合 diff：persist 监听驱动网格重渲染（图标退场/重现）──
  check(typeof persistListenerFn === 'function', 'init() 注入了 persist 监听')
  C.state.items = [{ name: 'a.txt', isDir: false, size: 1, mtime: 1 }, { name: 'b.txt', isDir: false, size: 2, mtime: 2 }]
  renderCalls = 0
  persistListenerFn([])   // 集合不变（空 → 空）
  check(renderCalls === 0, '实体集合不变 → 不重渲染（拖动/自适应只改矩形）')
  viewerInstances = [makeInst(5, 'a.txt', true)]
  persistListenerFn([{ path: 'a.txt', name: 'a.txt', kind: 'text', rect: { x: 0, y: 0, w: 200, h: 280 } }])
  check(renderCalls === 1, '实体集合变化（打开）→ 重渲染一次')
  check(createdIcons.length === 1 && createdIcons[0].getAttribute('data-name') === 'b.txt',
    '打开后 a.txt 图标退出网格（只剩 b.txt）')
  viewerInstances = []
  persistListenerFn([])
  check(renderCalls === 2, '实体集合变化（关闭）→ 重渲染一次')
  check(createdIcons.length === 2, '关闭后 a.txt 图标回到网格')

  // ── 9. applyRename 布局 key 迁移 ──
  C.positions = { 'a.txt': { x: 100, y: 100 }, 'b.txt': { x: 200, y: 200 }, 'c.txt': { x: 300, y: 300 } }
  C.bounds = { 'a.txt': { x: 100, y: 100, w: 84, h: 76 }, 'b.txt': { x: 200, y: 200, w: 84, h: 76 }, 'c.txt': { x: 300, y: 300, w: 84, h: 76 } }
  C.selection = new Set(['a.txt'])
  savedLayout = null
  persistRefreshCalls = 0
  VL.applyRename('a.txt', 'd.txt')
  check(C.positions['d.txt'] && C.positions['d.txt'].x === 100, 'applyRename: d.txt 继承 a.txt 位置')
  check(!C.positions['a.txt'], 'applyRename: a.txt 旧 key 已删除')
  check(C.bounds['d.txt'] && C.bounds['d.txt'].w === 84, 'applyRename: d.txt 继承 a.txt bounds')
  check(!C.bounds['a.txt'], 'applyRename: a.txt 旧 bounds 已删除')
  check(C.selection.has('d.txt') && !C.selection.has('a.txt'), 'applyRename: selection 迁移到 d.txt')
  check(savedLayout !== null, 'applyRename: saveLayout 被调用')
  check(persistRefreshCalls > 0, 'applyRename: refresh 被调用')

  // ── 10. applyRename no-op 防御 ──
  savedLayout = null
  persistRefreshCalls = 0
  VL.applyRename('', 'x.txt')
  check(savedLayout === null, 'applyRename 空 oldPath → no-op')
  VL.applyRename('b.txt', '')
  check(savedLayout === null, 'applyRename 空 newPath → no-op')
  VL.applyRename('b.txt', 'b.txt')
  check(savedLayout === null, 'applyRename 同名 → no-op')

  // ── 11. applyMoves 批量迁移 ──
  C.positions = { 'b.txt': { x: 200, y: 200 }, 'c.txt': { x: 300, y: 300 } }
  C.bounds = { 'b.txt': { x: 200, y: 200, w: 84, h: 76 }, 'c.txt': { x: 300, y: 300, w: 84, h: 76 } }
  C.selection = new Set(['b.txt'])
  savedLayout = null
  VL.applyMoves([
    { src: 'b.txt', dst: 'sub/b.txt' },
    { src: 'c.txt', dst: 'sub/c.txt' }
  ])
  check(C.positions['sub/b.txt'] && C.positions['sub/b.txt'].x === 200, 'applyMoves: sub/b.txt 继承 b.txt 位置')
  check(!C.positions['b.txt'], 'applyMoves: b.txt 旧 key 已删除')
  check(C.bounds['sub/c.txt'] && C.bounds['sub/c.txt'].x === 300, 'applyMoves: sub/c.txt 继承 c.txt bounds')
  check(!C.bounds['c.txt'], 'applyMoves: c.txt 旧 bounds 已删除')
  check(C.selection.has('sub/b.txt') && !C.selection.has('b.txt'), 'applyMoves: selection 迁移到 sub/b.txt')
  check(savedLayout !== null, 'applyMoves: saveLayout 被调用（有变更时）')

  // ── 12. applyMoves 空/无效 → 不 saveLayout ──
  savedLayout = null
  VL.applyMoves([])
  check(savedLayout === null, 'applyMoves 空列表 → 不 saveLayout')
  VL.applyMoves(null)
  check(savedLayout === null, 'applyMoves null → 不 saveLayout')
  VL.applyMoves([{ src: 'x.txt', dst: 'x.txt' }])
  check(savedLayout === null, 'applyMoves src=dst → 不 saveLayout')

  // ── 13. closeAllViewers 不在 DesktopViewerLink / App.Desktop facade 导出中 ──
  check(typeof VL.closeAllViewers === 'undefined', 'closeAllViewers 已从 DesktopViewerLink 删除')
  check(typeof D.closeAllViewers === 'undefined', 'closeAllViewers 不在 App.Desktop facade 中')

  if (failures > 0) {
    console.error('  [FAIL] desktop-viewerlink-lock 测试 ' + failures + ' 项失败')
    process.exit(1)
  }
  console.log('  [ok] desktop-viewerlink-lock 测试全部通过')
})().catch(function (e) {
  console.error('  [FAIL] desktop-viewerlink-lock 测试异常: ' + (e && e.stack || e))
  process.exit(1)
})
