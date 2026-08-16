// desktop-render.js 模块级边界测试：渲染域独立行为。
// 验证 App.DesktopRender 的核心契约：
//   1. render() 正确创建 DOM 图标（位置/类名/属性）
//   2. render() 清空旧 iconEls/bounds 后重建（防幽灵命中）
//   3. applySelection() 同步选中态到 DOM + FAB
//   4. clearSelection() 清空选中集 + DOM + FAB
//   5. hasSelection() / getSelectionNames() / getSelectionEntries() 正确反映选中态
//   6. syncFab() 联动 fabSpeedDial（选中态 或 Viewer 选中）
//   7. updateLockedVisual() 同步锁定 class
//   8. layout() desktop 空间 vs folder 容器排布逻辑
// 用法: node test-desktop-render-boundary.js [项目路径]   （由 run-tests.sh 调用）
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
const viewportEl = { clientWidth: 412, clientHeight: 700 }
const canvasEl = { style: {}, classList: makeClassList() }
const els = {
  'desktop-grid': gridEl,
  'desktop-viewport': viewportEl,
  'desktop-canvas': canvasEl,
  'desktop-marquee': { style: {} }
}

let fabSetSelectionCalls = []
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
sandbox.App.TypeIcons = {
  kindFor: function (name, isDir) { return isDir ? 'folder' : 'text' },
  svgFor: function (kind) { return '<svg>' + kind + '</svg>' }
}
sandbox.App.Thumbnail = {
  canThumbnail: function () { return false },
  request: function () {},
  requestShortcutIcon: function () {}
}
sandbox.App.Shortcut = { isShortcutName: function () { return false } }
sandbox.App.Clipboard = { isCut: function () { return false } }
sandbox.App.fabSpeedDial = {
  setSelection: function (has) { fabSetSelectionCalls.push(!!has) }
}
sandbox.App.InternalViewer = {
  anySelected: function () { return false },
  selectedInstance: function () { return null }
}
sandbox.App.DesktopCamera = { create: function () { return { x: 0, y: 0, zoom: 1 } } }
sandbox.App.DesktopGesture = { init: function () {}, setCamera: function () {} }
sandbox.App.bridge = { vibrate: function () {} }
sandbox.App.toast = { show: function () {} }
sandbox.App.FileAPI = {
  rootInfo: function () { return Promise.resolve({ rootName: 'Test', mode: 'private', displayPath: '/data/Test' }) },
  list: function () { return Promise.resolve([]) }
}
sandbox.App.LayoutStore = { load: function () { return null }, save: function () { return true } }
sandbox.App.HomeStore = { load: function () { return null }, saveHome: function () { return true }, saveFallback: function () { return true } }
sandbox.App.ViewStore = { load: function () { return { viewStyle: 'grid', sortBy: 'name', sortDir: 1 } }, save: function () { return true } }
sandbox.App.ViewMenu = { setEnabled: function () {} }
sandbox.App.Drawer = { updatePath: function () {} }
sandbox.App.BottomBar = { updateNavButtons: function () {} }
sandbox.App.FolderSort = { sort: function (items) { return items.slice() } }
sandbox.App.FolderLayout = {
  gridPositions: function (count) {
    const a = []
    for (let i = 0; i < count; i++) a.push({ x: 16 + (i % 4) * 100, y: 16 + Math.floor(i / 4) * 92 })
    return a
  },
  listPositions: function (count) {
    const a = []
    for (let i = 0; i < count; i++) a.push({ x: 0, y: i * 56 })
    return a
  },
  canvasSize: function (count, vw) { return { w: vw, h: count * 92 + 32 } },
  iconWidth: function (vw) { return Math.floor((vw - 24) / 4) }
}
sandbox.App.DesktopGrid = {
  GRID_W: 100,
  cellToWorld: function (c, r) { return { x: 16 + c * 100, y: 16 + r * 92 } }
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
const R = sandbox.App.DesktopRender
const D = sandbox.App.Desktop

;(function main() {
  // ── 1. render() 基本：desktop 空间（根目录）──
  C.state.curPath = ''
  C.state.items = [
    { name: 'a.txt', isDir: false, size: 100, mtime: 1 },
    { name: 'docs', isDir: true, size: 0, mtime: 2 }
  ]
  C.positions = {}
  C.bounds = {}
  C.iconEls = {}
  C.selection = new Set()
  R.render()
  check(createdIcons.length === 2, 'render() 创建 2 个图标')
  check(createdIcons[0].getAttribute('data-name') === 'a.txt', '第 1 个图标 data-name = a.txt')
  check(createdIcons[1].getAttribute('data-name') === 'docs', '第 2 个图标 data-name = docs')
  check(createdIcons[1].className.indexOf('is-dir') >= 0, 'docs 图标有 is-dir class')
  check(createdIcons[0].style.left === '16px', 'a.txt 位置 x = 16px（cell 0,0）')
  check(createdIcons[0].style.top === '16px', 'a.txt 位置 y = 16px（cell 0,0）')

  // ── 2. render() 清空旧 iconEls/bounds 后重建 ──
  check(Object.keys(C.iconEls).length === 2, 'iconEls 有 2 个条目')
  check(Object.keys(C.bounds).length === 2, 'bounds 有 2 个条目')
  check(!!C.bounds['a.txt'], 'bounds 包含 a.txt')
  check(!!C.bounds['docs'], 'bounds 包含 docs')

  // ── 3. render() 第二次调用清空旧数据 ──
  C.state.items = [{ name: 'x.txt', isDir: false, size: 1, mtime: 3 }]
  R.render()
  check(createdIcons.length === 1, '第二次 render 只创建 1 个图标')
  check(Object.keys(C.iconEls).length === 1, 'iconEls 清空后重建只有 1 个')
  check(!!C.iconEls['x.txt'], 'iconEls 包含 x.txt')
  check(!C.iconEls['a.txt'], '旧 a.txt 已从 iconEls 移除')
  check(Object.keys(C.bounds).length === 1, 'bounds 清空后重建只有 1 个')

  // ── 4. applySelection() 同步选中态到 DOM ──
  C.state.items = [
    { name: 'a.txt', isDir: false, size: 10, mtime: 1 },
    { name: 'b.txt', isDir: false, size: 20, mtime: 2 }
  ]
  R.render()
  C.selection = new Set(['a.txt'])
  R.applySelection()
  const aIcon = createdIcons.find(function (n) { return n.getAttribute('data-name') === 'a.txt' })
  const bIcon = createdIcons.find(function (n) { return n.getAttribute('data-name') === 'b.txt' })
  check(aIcon.classList.contains('selected'), 'applySelection: a.txt 有 selected class')
  check(!bIcon.classList.contains('selected'), 'applySelection: b.txt 无 selected class')

  // ── 5. applySelection() 变更后正确切换 ──
  C.selection = new Set(['b.txt'])
  R.applySelection()
  check(!aIcon.classList.contains('selected'), '切换后 a.txt 无 selected class')
  check(bIcon.classList.contains('selected'), '切换后 b.txt 有 selected class')

  // ── 6. clearSelection() 清空选中集 + DOM ──
  R.clearSelection()
  check(!aIcon.classList.contains('selected'), 'clearSelection: a.txt 无 selected')
  check(!bIcon.classList.contains('selected'), 'clearSelection: b.txt 无 selected')
  check(R.hasSelection() === false, 'clearSelection: hasSelection = false')
  check(R.getSelectionNames().length === 0, 'clearSelection: getSelectionNames 为空')

  // ── 7. hasSelection() / getSelectionNames() ──
  C.selection = new Set(['a.txt', 'b.txt'])
  check(R.hasSelection() === true, 'hasSelection = true（2 个选中）')
  const names = R.getSelectionNames()
  check(names.length === 2, 'getSelectionNames 长度 = 2')
  check(names.indexOf('a.txt') >= 0 && names.indexOf('b.txt') >= 0, 'getSelectionNames 包含 a.txt 和 b.txt')

  // ── 8. getSelectionEntries() 返回 [{path, isDir}] ──
  const entries = R.getSelectionEntries()
  check(entries.length === 2, 'getSelectionEntries 长度 = 2')
  const aEntry = entries.find(function (e) { return e.path === 'a.txt' })
  const dEntry = entries.find(function (e) { return e.path === 'b.txt' })
  check(aEntry && aEntry.isDir === false, 'a.txt isDir = false')
  check(dEntry && dEntry.isDir === false, 'b.txt isDir = false')

  // ── 9. syncFab() 联动 fabSpeedDial ──
  fabSetSelectionCalls.length = 0
  C.selection = new Set(['a.txt'])
  R.syncFab()
  check(fabSetSelectionCalls.length === 1 && fabSetSelectionCalls[0] === true,
    'syncFab: 选中态 → setSelection(true)')
  C.selection = new Set()
  R.syncFab()
  check(fabSetSelectionCalls.length === 2 && fabSetSelectionCalls[1] === false,
    'syncFab: 无选中 → setSelection(false)')

  // ── 10. updateLockedVisual() 同步锁定 class ──
  C.selection = new Set()
  R.render()
  const a2 = createdIcons.find(function (n) { return n.getAttribute('data-name') === 'a.txt' })
  C._lockedPaths.add('a.txt')
  R.updateLockedVisual()
  check(a2.classList.contains('desktop-icon-locked'), 'updateLockedVisual: a.txt 有 locked class')
  C._lockedPaths.delete('a.txt')
  R.updateLockedVisual()
  check(!a2.classList.contains('desktop-icon-locked'), 'updateLockedVisual: 解锁后无 locked class')

  // ── 11. layout() desktop 空间：已有位置优先 ──
  C.state.curPath = ''
  C.positions = { 'a.txt': { x: 500, y: 300 } }
  const laid = R.layout([
    { name: 'a.txt', isDir: false, size: 10, mtime: 1 },
    { name: 'b.txt', isDir: false, size: 20, mtime: 2 }
  ])
  check(laid.length === 2, 'layout() 返回 2 个条目')
  const laidA = laid.find(function (p) { return p.item.name === 'a.txt' })
  const laidB = laid.find(function (p) { return p.item.name === 'b.txt' })
  check(laidA.x === 500 && laidA.y === 300, 'layout: a.txt 使用已有位置 {500,300}')
  check(laidB.x === 116 && laidB.y === 16, 'layout: b.txt 自动排布 cell(1,0) = {116,16}')

  // ── 12. layout() folder 容器：排序后固定排布 ──
  C.state.curPath = 'docs'
  const laidFolder = R.layout([
    { name: 'z.txt', isDir: false, size: 10, mtime: 1 },
    { name: 'a.txt', isDir: false, size: 20, mtime: 2 }
  ])
  check(laidFolder.length === 2, 'layout() folder 返回 2 个条目')
  // FolderSort.sort 桩不排序（原样返回），所以 z.txt 在前
  check(laidFolder[0].x === 16 && laidFolder[0].y === 16,
    'layout folder: 第 1 个在 grid 位置 {16,16}')
  C.state.curPath = ''

  // ── 13. render() folder 容器设置画布尺寸 ──
  C.state.curPath = 'docs'
  C.state.items = [
    { name: 'a.txt', isDir: false, size: 10, mtime: 1 },
    { name: 'b.txt', isDir: false, size: 20, mtime: 2 }
  ]
  C.state.viewStyle = 'grid'
  R.render()
  check(gridEl.style.width === '412px', 'folder 画布宽度 = viewport 宽')
  const canvasH = parseInt(gridEl.style.height, 10)
  check(canvasH > 0, 'folder 画布高度 = ' + canvasH + 'px（canvasSize 计算值）')
  check(canvasEl.classList.contains('folder-canvas'), 'canvas 有 folder-canvas class')
  C.state.curPath = ''
  C.state.viewStyle = 'grid'

  // ── 14. render() desktop 空间清空画布尺寸 ──
  C.state.items = [{ name: 'a.txt', isDir: false, size: 10, mtime: 1 }]
  R.render()
  check(gridEl.style.width === '', 'desktop 画布宽度清空')
  check(gridEl.style.height === '', 'desktop 画布高度清空')
  check(!canvasEl.classList.contains('folder-canvas'), 'canvas 无 folder-canvas class')

  // ── 15. render() 回收站特判 ──
  C.state.trashName = '.trash'
  C.state.items = [
    { name: '.trash', isDir: true, size: 0, mtime: 1 },
    { name: 'a.txt', isDir: false, size: 10, mtime: 2 }
  ]
  R.render()
  const trashIcon = createdIcons.find(function (n) { return n.getAttribute('data-name') === '.trash' })
  check(trashIcon.className.indexOf('is-trash') >= 0, '回收站图标有 is-trash class')
  C.state.trashName = ''

  // ── 16. render() list 视图样式 ──
  C.state.curPath = 'docs'
  C.state.viewStyle = 'list'
  C.state.items = [{ name: 'a.txt', isDir: false, size: 1024, mtime: 1 }]
  R.render()
  const listIcon = createdIcons[0]
  check(listIcon.classList.contains('desktop-list-row'), 'list 视图图标有 desktop-list-row class')
  C.state.curPath = ''
  C.state.viewStyle = 'grid'

  // ── 17. render() 选中态恢复到新图标 ──
  C.state.items = [
    { name: 'a.txt', isDir: false, size: 10, mtime: 1 },
    { name: 'b.txt', isDir: false, size: 20, mtime: 2 }
  ]
  C.selection = new Set(['b.txt'])
  R.render()
  const bNew = createdIcons.find(function (n) { return n.getAttribute('data-name') === 'b.txt' })
  check(bNew.classList.contains('selected'), 'render 后选中态恢复到新图标 b.txt')

  if (failures > 0) {
    console.error('  [FAIL] desktop-render-boundary 测试 ' + failures + ' 项失败')
    process.exit(1)
  }
  console.log('  [ok] desktop-render-boundary 测试全部通过')
})()
