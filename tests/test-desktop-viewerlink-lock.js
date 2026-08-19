// desktop-viewer-link.js 模块级边界测试：锁定生命周期 + 布局迁移。
// 验证 closeAllViewers 删除后，锁定 API 仍完整：
//   1. isLockedPath / getLockedPaths 初始状态
//   2. closeViewer 关闭选中 Viewer + 解除锁定
//   3. closeViewer 无选中 Viewer 时 no-op
//   4. applyRename 布局 key 迁移 + 落盘 + 刷新
//   5. applyMoves 批量迁移 + 落盘（不逐项刷新）
//   6. applyRename / applyMoves 无效输入防御
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

// ── 可控 Viewer 桩 ──
let viewerInstances = []
let closedIds = []
let selectedViewerId = null

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
sandbox.App.InternalViewer = {
  selectedInstance: function () {
    if (selectedViewerId === null) return null
    return viewerInstances.find(function (inst) { return inst.id === selectedViewerId }) || null
  },
  anySelected: function () { return selectedViewerId !== null },
  closeById: function (id) { closedIds.push(id); viewerInstances = viewerInstances.filter(function (i) { return i.id !== id }); if (selectedViewerId === id) selectedViewerId = null },
  list: function () { return viewerInstances.slice() },
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
// applyRename 调用 App.DesktopPersist.refresh()，需拦截该路径
let persistRefreshCalls = 0
const origPersistRefresh = sandbox.App.DesktopPersist.refresh
sandbox.App.DesktopPersist.refresh = function () {
  persistRefreshCalls++
  return origPersistRefresh()
}
const origSave = sandbox.App.LayoutStore.save
sandbox.App.LayoutStore.save = function (data) { savedLayout = data; return origSave(data) }

;(async function () {
  D.initGesture()

  // ── 1. 初始状态：无锁定 ──
  check(VL.isLockedPath('a.txt') === false, 'isLockedPath 初始为 false')
  check(VL.getLockedPaths().length === 0, 'getLockedPaths 初始为空')

  // ── 2. 手动添加锁定（模拟 Viewer 打开文件）──
  C._lockedPaths.add('a.txt')
  check(VL.isLockedPath('a.txt') === true, '手动锁定后 isLockedPath = true')
  check(VL.getLockedPaths().length === 1, '手动锁定后 getLockedPaths 长度 = 1')
  check(VL.getLockedPaths()[0] === 'a.txt', 'getLockedPaths 包含 a.txt')

  // ── 3. closeViewer 无选中 Viewer 时 no-op ──
  selectedViewerId = null
  closedIds.length = 0
  VL.closeViewer()
  check(closedIds.length === 0, 'closeViewer 无选中 Viewer 时不调用 closeById')
  check(VL.isLockedPath('a.txt') === true, 'closeViewer no-op 后 a.txt 仍锁定')

  // ── 4. closeViewer 关闭选中 Viewer + 解除锁定 ──
  viewerInstances = [{ id: 1, getPath: function () { return 'a.txt' } }]
  selectedViewerId = 1
  closedIds.length = 0
  VL.closeViewer()
  check(closedIds.length === 1 && closedIds[0] === 1, 'closeViewer 调用 closeById(1)')
  check(VL.isLockedPath('a.txt') === false, 'closeViewer 后 a.txt 解除锁定')
  check(selectedViewerId === null, 'closeViewer 后 selectedViewerId 清空')

  // ── 5. 多锁定：closeViewer 只解除对应文件 ──
  C._lockedPaths.add('a.txt')
  C._lockedPaths.add('b.txt')
  viewerInstances = [{ id: 2, getPath: function () { return 'a.txt' } }]
  selectedViewerId = 2
  VL.closeViewer()
  check(VL.isLockedPath('a.txt') === false, 'closeViewer 解除 a.txt 锁定')
  check(VL.isLockedPath('b.txt') === true, 'b.txt 仍锁定（不同 Viewer）')
  C._lockedPaths.delete('b.txt')

  // ── 6. applyRename 布局 key 迁移 ──
  // 重新注入布局（initGesture 已加载 LayoutStore 桩）
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

  // ── 7. applyRename no-op 防御 ──
  savedLayout = null
  persistRefreshCalls = 0
  VL.applyRename('', 'x.txt')
  check(savedLayout === null, 'applyRename 空 oldPath → no-op')
  VL.applyRename('b.txt', '')
  check(savedLayout === null, 'applyRename 空 newPath → no-op')
  VL.applyRename('b.txt', 'b.txt')
  check(savedLayout === null, 'applyRename 同名 → no-op')

  // ── 8. applyMoves 批量迁移 ──
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

  // ── 9. applyMoves 空/无效 → 不 saveLayout ──
  savedLayout = null
  VL.applyMoves([])
  check(savedLayout === null, 'applyMoves 空列表 → 不 saveLayout')
  VL.applyMoves(null)
  check(savedLayout === null, 'applyMoves null → 不 saveLayout')
  VL.applyMoves([{ src: 'x.txt', dst: 'x.txt' }])
  check(savedLayout === null, 'applyMoves src=dst → 不 saveLayout')

  // ── 10. closeAllViewers 不在 DesktopViewerLink 导出中 ──
  check(typeof VL.closeAllViewers === 'undefined', 'closeAllViewers 已从 DesktopViewerLink 删除')

  // ── 11. closeAllViewers 不在 App.Desktop facade 中 ──
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
