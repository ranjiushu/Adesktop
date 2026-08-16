// desktop-persist 布局重载回归测试（rootId 隔离时序 Bug 复现）：
// initLayout 在 rootInfo 就绪前同步执行（rootId='' → 读旧 key desktop.layout.v1），
// 而 refresh 拿到 rootId 后 migrateLegacy 会删除旧 key——第二次启动起 initLayout
// 永远读不到旧 key → 布局丢失，回自动排布（3*n 网格）。
// 修复：rootId 首次就绪时必须用 rootId key 重载布局/相机（切根场景同样受益）。
// 用法: node test-desktop-layout-reload.js [项目路径]   （由 run-tests.sh 调用）
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

// ── 最小 DOM stub（与 test-desktop-refresh-race.js 同构）──
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
    set innerHTML(v) { el._html = v; el.children = []; createdIcons = [] },
    appendChild: function (node) { createdIcons.push(node); el.children.push(node) }
  }
  return el
}
let createdIcons = []
const gridEl = makeGridEl()
const els = {
  'desktop-grid': gridEl,
  'desktop-viewport': { clientWidth: 412, clientHeight: 700, addEventListener: function () {}, getBoundingClientRect: function () { return { left: 0, top: 56, width: 412, height: 700 } } },
  'desktop-canvas': { style: {}, classList: makeClassList(), addEventListener: function () {}, getBoundingClientRect: function () { return { left: 0, top: 56, width: 412, height: 700 } } },
  'desktop-marquee': { style: {} }
}

// ── 可控 localStorage（真实 layout-store / home-store 实现读它）──
let store = {}
const localStorageStub = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null },
  setItem: function (k, v) { store[k] = String(v) },
  removeItem: function (k) { delete store[k] }
}

// 文件树：根 2 项
const fsTree = {
  '': [
    { name: 'docs', isDir: true, size: 0, mtime: 1 },
    { name: 'a.txt', isDir: false, size: 1, mtime: 2 }
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
  localStorage: localStorageStub,
  navigator: {}
}
sandbox.window = sandbox
sandbox.App.bridge = { vibrate: function () {} }
sandbox.App.toast = { show: function () {} }
sandbox.App.FileAPI = {
  rootInfo: function () {
    return Promise.resolve({ rootName: 'Test', mode: 'private', displayPath: '内部存储/Test', rootId: 'rootX' })
  },
  list: function (p) { return Promise.resolve((fsTree[p || ''] || []).slice()) },
  read: function () { return Promise.resolve('') },
  write: function () { return Promise.resolve(true) },
  mkdir: function () { return Promise.resolve(true) },
  del: function () { return Promise.resolve(true) },
  rename: function () { return Promise.resolve(true) },
  copy: function () { return Promise.resolve(true) }
}
sandbox.App.ViewStore = { load: function () { return { viewStyle: 'grid', sortBy: 'name', sortDir: 1 } }, save: function () { return true } }
sandbox.App.FolderSort = { sort: function (items) { return items.slice() }, defaultDir: function () { return 1 } }
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
sandbox.App.DesktopGrid = {
  GRID_W: 100, GRID_H: 92,
  cellToWorld: function (c, r) { return { x: 16 + c * 100, y: 16 + r * 92 } },
  snapToGrid: function (x, y) { return { x: x, y: y } },
  resolvePlacement: function (moving, statics) { const out = {}; moving.forEach(function (m) { out[m.name] = { x: m.x, y: m.y } }); statics.forEach(function (s) { out[s.name] = { x: s.x, y: s.y } }); return out }
}
sandbox.App.DesktopCamera = {
  create: function (x, y, zoom) { return { x: x || 0, y: y || 0, zoom: zoom || 1 } },
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
for (const f of ['namespace.js', 'desktop-nav.js', 'double-tap.js', 'desktop-selection.js', 'desktop-grid.js',
  'layout-store.js', 'home-store.js', 'desktop-camera.js', 'desktop-gesture.js', 'desktop-core.js',
  'desktop-render.js', 'desktop-browse-mode.js', 'desktop-navigation.js', 'desktop-persist.js',
  'desktop-viewer-link.js', 'desktop-gesture-handlers.js', 'clipboard.js', 'desktop.js']) {
  vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), sandbox, { filename: f })
}

const D = sandbox.App.Desktop
const C = sandbox.App.DesktopCore
const P = sandbox.App.DesktopPersist

;(async function () {
  // ── 预置：升级前旧 key 数据（用户自由摆放 + 相机）──
  store['desktop.layout.v1'] = JSON.stringify({
    version: 1,
    icons: { 'a.txt': { x: 100, y: 100 }, 'docs': { x: 200, y: 200 } },
    camera: { x: 5, y: 6, zoom: 1.5 }
  })

  // ── 第一次启动：initGesture（initLayout 同步，rootId 未就绪）→ refresh（rootId 就绪 + 迁移）──
  D.initGesture()
  await D.refresh()
  check(C.state.rootId === 'rootX', 'rootInfo 就绪后 rootId 缓存为 rootX')
  check(C.positions['a.txt'] && C.positions['a.txt'].x === 100, '第一次启动布局恢复（旧 key 迁移前读到）')
  check(!store['desktop.layout.v1'] && !!store['desktop.layout.rootX.v1'],
    '旧 key 已迁移到 desktop.layout.rootX.v1 并删除旧 key')

  // ── 第二次启动复现：内存重置（rootId 未就绪、positions 空、相机默认）──
  C.state.rootId = ''
  Object.keys(C.positions).forEach(function (k) { delete C.positions[k] })
  C.camera = sandbox.App.DesktopCamera.create()
  // initLayout（rootId=''）→ 读旧 key（已被迁移删除）→ null → 布局空（= 用户看到的 3*n 网格）
  P.initLayout()
  check(!C.positions['a.txt'], '复现：rootId 就绪前 initLayout 读不到布局（旧 key 已删）')

  // ── 修复点：refresh 拿到 rootId 后必须用 rootId key 重载布局/相机 ──
  await D.refresh()
  check(C.positions['a.txt'] && C.positions['a.txt'].x === 100,
    '修复：rootId 就绪后从 rootId key 重载布局（第二次启动不丢摆放）')
  check(C.positions['docs'] && C.positions['docs'].x === 200, '重载后多图标位置完整')
  check(C.camera && C.camera.x === 5 && C.camera.zoom === 1.5, '重载后相机从 rootId key 恢复')

  if (failures > 0) {
    console.error('  [FAIL] layout-reload 测试 ' + failures + ' 项失败')
    process.exit(1)
  }
  console.log('  [ok] layout-reload 测试全部通过')
})().catch(function (e) {
  console.error('  [FAIL] layout-reload 测试异常: ' + (e && e.stack || e))
  process.exit(1)
})
