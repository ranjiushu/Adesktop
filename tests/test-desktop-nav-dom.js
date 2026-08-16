// desktop.js 目录导航 DOM 接线集成测试：
// 双击窗口（DoubleTap）→ 打开文件夹 → nav 历史栈后退/前进 → refresh 驱动
// 用法: node test-desktop-nav-dom.js [项目路径]   （由 run-tests.sh 调用）
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

// ── 最小 DOM stub（render 需要 iconEls offsetWidth/offsetHeight）──
function makeIconEl() {
  return {
    offsetWidth: 84, offsetHeight: 76,
    classList: {
      _set: {},
      add: function (c) { this._set[c] = true },
      remove: function (c) { delete this._set[c] },
      contains: function (c) { return !!this._set[c] }
    },
    style: {}, appendChild: function () {},
    _attrs: {},
    setAttribute: function (k, v) { this._attrs[k] = v },
    getAttribute: function (k) { return this._attrs[k] }
  }
}

// 收集 render 创建的元素（innerHTML='' 等价真实 DOM 清空）
let createdIcons = []
function makeClassList() {
  return {
    _set: {},
    add: function (c) { this._set[c] = true },
    remove: function (c) { delete this._set[c] },
    contains: function (c) { return !!this._set[c] }
  }
}
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
const els = {
  'desktop-grid': gridEl,
  'desktop-viewport': { clientWidth: 412, clientHeight: 700, addEventListener: function () {}, getBoundingClientRect: function () { return { left: 0, top: 56, width: 412, height: 700 } } },
  'desktop-canvas': { style: {}, classList: makeClassList(), addEventListener: function () {}, getBoundingClientRect: function () { return { left: 0, top: 56, width: 412, height: 700 } } },
  'desktop-marquee': { style: {}, }
}

// FileAPI 假桥：list(path) 按目录返回
const fsTree = {
  '': [
    { name: 'docs', isDir: true, size: 0, mtime: 1 },
    { name: 'a.txt', isDir: false, size: 1, mtime: 2 }
  ],
  'docs': [
    { name: 'b.txt', isDir: false, size: 1, mtime: 3 }
  ],
  'docs/sub': [
    { name: 'c.txt', isDir: false, size: 1, mtime: 4 }
  ]
}
let listCalls = []

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
  rootInfo: function () { return Promise.resolve({ rootName: 'Test', mode: 'private', displayPath: '内部存储/Test' }) },
  list: function (p) { listCalls.push(p || ''); return Promise.resolve((fsTree[p || ''] || []).slice()) },
  read: function () { return Promise.resolve('') },
  write: function () { return Promise.resolve(true) },
  mkdir: function () { return Promise.resolve(true) },
  del: function () { return Promise.resolve(true) },
  rename: function () { return Promise.resolve(true) },
  copy: function () { return Promise.resolve(true) }
}
sandbox.App.LayoutStore = {
  load: function () { return null },
  save: function () { return true }
}
sandbox.App.HomeStore = {
  load: function () { return null },
  saveHome: function () { return true },
  saveFallback: function () { return true }
}
sandbox.App.ViewStore = {
  load: function () { return { viewStyle: 'grid', sortBy: 'name', sortDir: 1 } },
  save: function () { return true }
}
sandbox.App.FolderSort = {
  sort: function (items) { return items.slice() },
  defaultDir: function () { return 1 }
}
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
  canvasSize: function (count, vw) { return { w: vw, h: 200 } },
  iconWidth: function () { return 80 }
}
sandbox.App.ViewMenu = { setEnabled: function () {} }
sandbox.App.fabSpeedDial = { setSelection: function () {} }
sandbox.App.Drawer = { updatePath: function () {} }
sandbox.App.BottomBar = { updateNavButtons: function () {} }
sandbox.App.Clipboard = { isCut: function () { return false } }
sandbox.App.DesktopGrid = { GRID_W: 100, GRID_H: 92, cellToWorld: function (c, r) { return { x: 16 + c * 100, y: 16 + r * 92 } }, snapToGrid: function (x, y) { return { x: x, y: y } }, resolvePlacement: function (moving, statics) { const out = {}; moving.forEach(function (m) { out[m.name] = { x: m.x, y: m.y } }); statics.forEach(function (s) { out[s.name] = { x: s.x, y: s.y } }); return out } }
sandbox.App.DesktopCamera = {
  create: function () { return { x: 0, y: 0, zoom: 1 } },
  applyTo: function () {},
  screenToWorld: function (x, y) { return { x: x, y: y } },
  worldToScreen: function (x, y) { return { x: x, y: y } }
}
sandbox.App.DesktopSelection = {
  pointHitTest: function () { return null },
  marqueeHitTest: function () { return [] },
  rectFromPoints: function () { return {} },
  selectOnly: function (n) { return new Set([n]) },
  toggle: function (s, n) { const x = new Set(s); if (x.has(n)) x.delete(n); else x.add(n); return x },
  add: function (s, n) { const x = new Set(s); x.add(n); return x },
  remove: function (s, n) { const x = new Set(s); x.delete(n); return x },
  clear: function () { return new Set() },
  unionRect: function () { return null },
  pointInRect: function () { return false }
}
sandbox.App.DesktopGesture = { init: function () {}, setCamera: function () {} }

vm.createContext(sandbox)
for (const f of ['namespace.js', 'desktop-nav.js', 'double-tap.js', 'desktop-selection.js', 'desktop-grid.js', 'layout-store.js', 'desktop-camera.js', 'desktop-gesture.js', 'desktop-core.js', 'desktop-render.js', 'desktop-browse-mode.js', 'desktop-navigation.js', 'desktop-persist.js', 'desktop-viewer-link.js', 'desktop-gesture-handlers.js', 'clipboard.js', 'desktop.js']) {
  vm.runInContext(fs.readFileSync(path.join(SRC_DIR, f), 'utf8'), sandbox, { filename: f })
}

const D = sandbox.App.Desktop

;(async function () {
  // ── 初始：根目录渲染 ──
  D.initGesture()
  await D.refresh()
  check(listCalls[listCalls.length - 1] === '', '初始 list 根目录（curPath=空）')
  check(D.getCurPath() === '', '初始 curPath = 根')
  check(D.canGoBack() === false, '根目录不可后退')
  check(D.canGoForward() === false, '根目录不可前进')
  check(createdIcons.length === 2, '根目录渲染 2 个图标，实际: ' + createdIcons.length)

  // ── 进入文件夹 docs ──
  D.enterFolder('docs')
  await D.refresh()
  check(D.getCurPath() === 'docs', '进入 docs 后 curPath = docs')
  check(listCalls[listCalls.length - 1] === 'docs', 'refresh 用 list(docs)')
  check(D.canGoBack() === true, '进入后可以后退')
  check(D.canGoForward() === false, '进入后不可前进（栈尾）')
  check(createdIcons.length === 1, 'docs 目录渲染 1 个图标，实际: ' + createdIcons.length)

  // ── 后退 → 根目录 ──
  const backOk = D.goBack()
  await D.refresh()
  check(backOk === true, '后退返回 true')
  check(D.getCurPath() === '', '后退后 curPath = 根')
  check(D.canGoBack() === false, '回根后不可后退')
  check(D.canGoForward() === true, '回根后可前进')

  // ── 前进 → docs ──
  const fwdOk = D.goForward()
  await D.refresh()
  check(fwdOk === true && D.getCurPath() === 'docs', '前进回到 docs')

  // ── 越界防御 ──
  D.goForward()
  check(D.getCurPath() === 'docs', '栈尾越界前进保持当前（防御）')

  // ── 上级目录（goUp）：docs → 根 ──
  const upOk = D.goUp()
  await D.refresh()
  check(upOk === true && D.getCurPath() === '', 'goUp 从 docs 退回根')
  check(D.canGoBack() === true, 'goUp 压栈导航：后退可回 docs')
  check(D.canGoUp() === false, '根目录不可上（canGoUp=false）')

  // ── goUp 到父文件夹（docs/sub → docs → 根）──
  D.enterFolder('docs')
  await D.refresh()
  D.enterFolder('docs/sub')
  await D.refresh()
  check(D.getCurPath() === 'docs/sub', '进入 docs/sub')
  const upOk2 = D.goUp()
  await D.refresh()
  check(upOk2 === true && D.getCurPath() === 'docs', 'goUp docs/sub → docs（父文件夹）')
  check(D.canGoUp() === true, 'docs 仍可上（非根）')
  D.goUp()
  await D.refresh()
  check(D.getCurPath() === '', 'goUp docs → 根')

  // ── 双击窗口接线：DoubleTap 在 handleTap 中被调用（命中测试桩验证流程） ──
  // 由于 handleTap 是内部函数，这里验证 App.DoubleTap 与 desktop 的依赖关系已建立
  check(typeof sandbox.App.DoubleTap.hit === 'function', 'App.DoubleTap 已加载')
  check(typeof D.openItem === 'function' && typeof D.enterFolder === 'function', 'openItem/enterFolder 已导出')
  check(typeof D.goBack === 'function' && typeof D.goForward === 'function', 'goBack/goForward 已导出')

  // ── 回归：Home 快照存在时，图标位置仍从 LayoutStore 恢复（曾把 icons 恢复误放进 if(!cam)） ──
  sandbox.App.HomeStore.load = function () { return { home: { x: 5, y: 6, zoom: 2 } } }
  sandbox.App.LayoutStore.load = function () {
    return { version: 1, icons: { 'a.txt': { x: 500, y: 300 } }, camera: { x: 0, y: 0, zoom: 1 } }
  }
  createdIcons = []
  D.initGesture()
  await D.refresh()
  const aIcon = createdIcons.filter(function (n) { return n.getAttribute('data-name') === 'a.txt' })[0]
  check(!!aIcon, '有 Home 快照时根目录仍渲染 a.txt')
  check(aIcon && aIcon.style.left === '500px' && aIcon.style.top === '300px',
    '有 Home 快照时图标位置仍恢复（a.txt @ 500,300，实际 ' + (aIcon && aIcon.style.left) + ',' + (aIcon && aIcon.style.top) + '）')

  if (failures > 0) {
    console.error('  [FAIL] desktop-nav-dom 测试 ' + failures + ' 项失败')
    process.exit(1)
  }
  console.log('  [ok] desktop-nav-dom 测试全部通过')
  process.exit(0)
})().catch(function (e) {
  console.error('  [fail] 测试执行异常: ' + (e && e.stack || e))
  process.exit(1)
})
