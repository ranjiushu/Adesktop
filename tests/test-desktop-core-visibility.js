// desktop-core.js 模块级边界测试：C 容器状态跨模块可见性。
// 验证「C 容器」模式的核心契约：
//   1. desktop-core.js 的 App.DesktopCore 是单例对象，所有子模块 const C 指向同一引用
//   2. 重赋值（C.selection = new Set()）对其他模块立即可见
//   3. 属性变更（C.state.curPath = 'xxx'）对其他模块立即可见
//   4. 工具函数（el/fmtSize/fullPath/isFolderView/viewport）行为正确
//   5. desktop-viewer-link.js 删除 closeAllViewers 后，锁定 API 仍完整
// 用法: node test-desktop-core-visibility.js [项目路径]   （由 run-tests.sh 调用）
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
    _attrs: {},
    setAttribute: function (k, v) { this._attrs[k] = v },
    getAttribute: function (k) { return this._attrs[k] }
  }
}
function makeGridEl() {
  const el = {
    _html: '', children: [], classList: makeClassList(), style: {},
    get innerHTML() { return el._html },
    set innerHTML(v) { el._html = v; el.children = [] },
    appendChild: function (node) { el.children.push(node) }
  }
  return el
}

const gridEl = makeGridEl()
const viewportEl = { clientWidth: 412, clientHeight: 700, addEventListener: function () {}, getBoundingClientRect: function () { return { left: 0, top: 56, width: 412, height: 700 } } }
const els = {
  'desktop-grid': gridEl,
  'desktop-viewport': viewportEl,
  'desktop-canvas': { style: {}, classList: makeClassList(), addEventListener: function () {} },
  'desktop-marquee': { style: {} }
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
  rootInfo: function () { return Promise.resolve({ rootName: 'Test', mode: 'private', displayPath: '/data/Test', trashName: '.trash' }) },
  list: function () { return Promise.resolve([]) }
}
sandbox.App.LayoutStore = {
  load: function () { return { version: 1, icons: {}, camera: { x: 0, y: 0, zoom: 1 } } },
  save: function () { return true }
}
sandbox.App.HomeStore = { load: function () { return null }, saveHome: function () { return true }, saveFallback: function () { return true } }
sandbox.App.ViewStore = { load: function () { return { viewStyle: 'grid', sortBy: 'name', sortDir: 1 } }, save: function () { return true } }
sandbox.App.ViewMenu = { setEnabled: function () {} }
sandbox.App.fabSpeedDial = { setSelection: function () {} }
sandbox.App.Drawer = { updatePath: function () {} }
sandbox.App.BottomBar = { updateNavButtons: function () {} }
sandbox.App.Clipboard = { isCut: function () { return false } }
sandbox.App.DesktopCamera = {
  create: function (x, y, z) { return { x: x || 0, y: y || 0, zoom: z || 1 } },
  screenToWorld: function (x, y) { return { x: x, y: y } },
  worldToScreen: function (x, y) { return { x: x, y: y } }
}
sandbox.App.DesktopGesture = { init: function () {}, setCamera: function () {} }
sandbox.App.InternalViewer = {
  selectedInstance: function () { return null },
  anySelected: function () { return false },
  list: function () { return [] },
  closeAll: function () {},
  closeById: function () {}
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
const D = sandbox.App.Desktop

;(function main() {
  // ── 1. App.DesktopCore 是对象（单例容器）──
  check(typeof C === 'object' && C !== null, 'App.DesktopCore 是对象')

  // ── 2. state 子对象存在且字段完整 ──
  check(typeof C.state === 'object' && C.state !== null, 'C.state 存在')
  check(C.state.curPath === '', 'C.state.curPath 初始为空字符串（根目录）')
  check(C.state.trashName === '', 'C.state.trashName 初始为空')
  check(C.state.viewStyle === 'grid', 'C.state.viewStyle 初始为 grid')
  check(C.state.sortBy === 'name', 'C.state.sortBy 初始为 name')
  check(C.state.sortDir === 1, 'C.state.sortDir 初始为 1（升序）')
  check(Array.isArray(C.state.items), 'C.state.items 初始为数组')

  // ── 3. 重赋值跨模块可见性：C.selection = new Set() ──
  // desktop-render.js 持有 const C = App.DesktopCore（同一引用）
  C.selection = new Set(['test.txt'])
  check(D.hasSelection() === true, 'C.selection 重赋值后 hasSelection() 可见')
  check(D.getSelectionNames().length === 1 && D.getSelectionNames()[0] === 'test.txt',
    'C.selection 重赋值后 getSelectionNames() 可见')
  C.selection = new Set()
  check(D.hasSelection() === false, 'C.selection 清空后 hasSelection() 可见')

  // ── 4. 属性变更跨模块可见性：C.state.curPath ──
  C.state.curPath = 'docs'
  check(C.isFolderView() === true, 'C.state.curPath 变更后 isFolderView() 可见')
  check(C.viewMode() === 'folder', 'C.state.curPath 变更后 viewMode() === folder')
  C.state.curPath = ''
  check(C.isFolderView() === false, 'C.state.curPath 清空后 isFolderView() 可见')
  check(C.viewMode() === 'desktop', 'C.state.curPath 清空后 viewMode() === desktop')

  // ── 5. C.state.trashName 变更后 isTrashPath/inTrash 可见 ──
  C.state.trashName = '.trash'
  check(C.isTrashPath('.trash') === true, 'isTrashPath(.trash) = true')
  check(C.isTrashPath('other') === false, 'isTrashPath(other) = false')
  check(C.inTrash() === false, 'inTrash() = false（curPath 非 .trash）')
  C.state.curPath = '.trash'
  check(C.inTrash() === true, 'inTrash() = true（curPath = .trash）')
  C.state.curPath = ''
  C.state.trashName = ''

  // ── 6. C.positions / C.bounds 变更跨模块可见 ──
  C.positions['a.txt'] = { x: 100, y: 200 }
  C.bounds['a.txt'] = { x: 100, y: 200, w: 84, h: 76 }
  check(C.positions['a.txt'].x === 100, 'C.positions 写入后可读')
  check(C.bounds['a.txt'].w === 84, 'C.bounds 写入后可读')
  delete C.positions['a.txt']
  delete C.bounds['a.txt']

  // ── 7. C.dragTargets / C.dragStartPositions 变更跨模块可见 ──
  C.dragTargets = ['a.txt', 'b.txt']
  check(C.dragTargets.length === 2, 'C.dragTargets 重赋值后可读')
  check(C.dragIncludesTrash() === false, 'dragIncludesTrash() = false（无 .trash）')
  C.state.trashName = '.trash'
  C.dragTargets = ['a.txt', '.trash']
  check(C.dragIncludesTrash() === true, 'dragIncludesTrash() = true（含 .trash）')
  C.dragTargets = []
  C.state.trashName = ''

  // ── 8. C._lockedPaths 变更跨模块可见（ViewerLink 锁定 API）──
  check(D.isLockedPath('a.txt') === false, 'isLockedPath 初始为 false')
  check(D.getLockedPaths().length === 0, 'getLockedPaths 初始为空')
  C._lockedPaths.add('a.txt')
  check(D.isLockedPath('a.txt') === true, 'isLockedPath 变更为 true')
  check(D.getLockedPaths().length === 1, 'getLockedPaths 长度为 1')
  C._lockedPaths.delete('a.txt')
  check(D.isLockedPath('a.txt') === false, 'isLockedPath 恢复为 false')

  // ── 9. 工具函数：el() ──
  const node = C.el('div', 'test-class', 'hello')
  check(node.className === 'test-class', 'el() 设置 className')
  check(node.textContent === 'hello', 'el() 设置 textContent')
  const node2 = C.el('span')
  check(!node2.className && node2.textContent === undefined, 'el() 无参数时 className/textContent 不设')

  // ── 10. 工具函数：fmtSize() ──
  check(C.fmtSize(0) === '0 B', 'fmtSize(0) = "0 B"')
  check(C.fmtSize(512) === '512 B', 'fmtSize(512) = "512 B"')
  check(C.fmtSize(1536) === '1.5 KB', 'fmtSize(1536) = "1.5 KB"')
  check(C.fmtSize(1048576) === '1.0 MB', 'fmtSize(1048576) = "1.0 MB"')
  check(C.fmtSize(-1) === '', 'fmtSize(-1) = ""')
  check(C.fmtSize('bad') === '', 'fmtSize("bad") = ""')

  // ── 11. 工具函数：fullPath() ──
  C.state.curPath = ''
  check(C.fullPath('a.txt') === 'a.txt', 'fullPath("a.txt") 根目录 = "a.txt"')
  C.state.curPath = 'docs'
  check(C.fullPath('a.txt') === 'docs/a.txt', 'fullPath("a.txt") curPath=docs = "docs/a.txt"')
  C.state.curPath = ''

  // ── 12. RAF 工具函数存在 ──
  check(typeof C._raf === 'function', 'C._raf 是函数')
  check(typeof C._caf === 'function', 'C._caf 是函数')
  check(typeof C._now === 'function', 'C._now 是函数')
  const t = C._now()
  check(typeof t === 'number' && t > 0, 'C._now() 返回正数')

  // ── 13. _animRaf / _refreshSeq 初始值 ──
  check(C._animRaf === null, 'C._animRaf 初始为 null')
  check(C._refreshSeq === 0, 'C._refreshSeq 初始为 0')

  // ── 14. desktop-viewer-link.js 不导出 closeAllViewers ──
  const VL = sandbox.App.DesktopViewerLink
  check(typeof VL === 'object' && VL !== null, 'App.DesktopViewerLink 存在')
  check(typeof VL.closeViewer === 'function', 'DesktopViewerLink.closeViewer 存在')
  check(typeof VL.closeAllViewers === 'undefined', 'closeAllViewers 已删除（不导出）')
  check(typeof VL.isLockedPath === 'function', 'DesktopViewerLink.isLockedPath 存在')
  check(typeof VL.getLockedPaths === 'function', 'DesktopViewerLink.getLockedPaths 存在')
  check(typeof VL.applyRename === 'function', 'DesktopViewerLink.applyRename 存在')
  check(typeof VL.applyMoves === 'function', 'DesktopViewerLink.applyMoves 存在')

  // ── 15. App.Desktop facade 不导出 closeAllViewers ──
  check(typeof D.closeAllViewers === 'undefined', 'App.Desktop 不导出 closeAllViewers')

  // ── 16. App.Desktop facade 完整性：34 个导出全在 ──
  const expected = [
    'refresh', 'render', 'initGesture',
    'clearSelection', 'hasSelection', 'getSelectionNames', 'getSelectionEntries',
    'applyRename', 'applyMoves',
    'openItem', 'enterFolder', 'goBack', 'goForward', 'goUp',
    'canGoBack', 'canGoForward', 'canGoUp', 'getCurPath',
    'getLockedPaths', 'isLockedPath', 'closeViewer',
    'isTrashPath', 'inTrash', 'getTrashName',
    'viewMode', 'isFolderView',
    'applyViewPrefs', 'getViewPrefs',
    'captureHome', 'captureDefaultView', 'goHome',
    'setAdvancedBrowse', 'isAdvancedBrowse', 'exitTempMode'
  ]
  const missing = expected.filter(function (k) { return typeof D[k] !== 'function' })
  check(missing.length === 0, 'App.Desktop facade 34 个导出全在（缺失: ' + (missing.join(',') || '无') + ')')

  // ── 17. _tapState / _pendingDeselect / _deselectTimer 双击状态字段 ──
  check(C._tapState === null, 'C._tapState 初始为 null')
  check(C._pendingDeselect === null, 'C._pendingDeselect 初始为 null')
  check(C._deselectTimer === null, 'C._deselectTimer 初始为 null')

  // ── 18. 高级浏览模式字段 ──
  check(C._advancedBrowse === false, 'C._advancedBrowse 初始为 false')
  check(C._tempNormalMode === false, 'C._tempNormalMode 初始为 false')
  check(C._emptyTapTime === 0, 'C._emptyTapTime 初始为 0')

  if (failures > 0) {
    console.error('  [FAIL] desktop-core-visibility 测试 ' + failures + ' 项失败')
    process.exit(1)
  }
  console.log('  [ok] desktop-core-visibility 测试全部通过')
})()
