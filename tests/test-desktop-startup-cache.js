// desktop-persist 启动缓存先行渲染回归测试（方向 B）：
// 进入桌面加载优化的「首屏缓存先出」行为契约：
//   1) 启动快照存在 → renderFromCache 立即用缓存 items 渲染图标（秒出）+ 不弹 loading 转圈；
//   2) 随后 refresh 后台对齐真实 list（跳过首屏 loading）+ 与缓存不一致时以真实为准；
//   3) refresh 完成后写回最新启动快照（下次启动用新快照）；
//   4) 无启动快照 → renderFromCache 不渲染 + refresh 正常弹 loading（不破坏首次加载）。
// 用法: node test-desktop-startup-cache.js [项目路径]   （由 run-tests.sh 调用）
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

// ── 可控 localStorage（真实 store / 启动快照读它）──
let store = {}
const localStorageStub = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null },
  setItem: function (k, v) { store[k] = String(v) },
  removeItem: function (k) { delete store[k] }
}

// 真实文件系统返回（可被测试改写，模拟「与缓存不一致」）
const realItems = {
  '': [
    { name: 'docs', isDir: true, size: 0, mtime: 1 },
    { name: 'a.txt', isDir: false, size: 1, mtime: 2 },
    { name: 'c.txt', isDir: false, size: 3, mtime: 3 }   // 真实新增，缓存里没有
  ]
}
let loadingShown = 0
let loadingHidden = 0

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
sandbox.App.Loading = {
  show: function () { loadingShown++ },
  hide: function () { loadingHidden++ }
}
sandbox.App.FileAPI = {
  rootInfo: function () {
    return Promise.resolve({ rootName: 'Test', mode: 'private', displayPath: '内部存储/Test', rootId: 'rootX' })
  },
  list: function (p) { return Promise.resolve((realItems[p || ''] || []).slice()) },
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
for (const f of ['namespace.js', 'desktop-nav.js', 'double-tap.js', 'desktop-selection.js', 'desktop-grid.js',
  'layout-store.js', 'home-store.js', 'desktop-camera.js', 'desktop-gesture.js', 'desktop-core.js',
  'desktop-render.js', 'desktop-browse-mode.js', 'desktop-navigation.js', 'desktop-persist.js',
  'desktop-viewer-link.js', 'desktop-gesture-handlers.js', 'clipboard.js', 'desktop.js']) {
  vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), sandbox, { filename: f })
}

// layout-store.js 加载后会覆盖桩（真实实现读 localStorage→null）——重新设桩，确保 positions 可注入
sandbox.App.LayoutStore = {
  load: function () {
    return { version: 1, icons: { 'a.txt': { x: 100, y: 100 }, 'docs': { x: 200, y: 200 } }, camera: { x: 0, y: 0, zoom: 1 } }
  },
  save: function () { return true }
}
sandbox.App.HomeStore = { load: function () { return null }, saveHome: function () { return true }, saveFallback: function () { return true } }
sandbox.App.ViewStore = { load: function () { return { viewStyle: 'grid', sortBy: 'name', sortDir: 1 } }, save: function () { return true } }

const CACHE_KEY = 'desktop.startup-cache.v1'
function setCache(items) {
  store[CACHE_KEY] = JSON.stringify({
    version: 1,
    mode: 'private',
    curPath: '',
    desktopRoot: 'Desktop',
    trashName: '.trash',
    rootId: 'rootX',
    rootName: 'Test',
    displayPath: '内部存储/Test',
    items: items
  })
}

const D = sandbox.App.Desktop
const C = sandbox.App.DesktopCore
const P = sandbox.App.DesktopPersist

;(async function () {
  // ── 场景 1：有启动快照 → renderFromCache 秒出缓存内容，不弹 loading ──
  setCache([{ name: 'docs', isDir: true, size: 0, mtime: 1 }, { name: 'a.txt', isDir: false, size: 1, mtime: 2 }])
  loadingShown = 0
  D.initGesture()
  P.renderFromCache()

  check(loadingShown === 0, '首屏缓存渲染不弹 loading 转圈（实际 ' + loadingShown + '）')
  check(createdIcons.length === 2, '首屏用缓存 items 渲染出图标（实际 ' + createdIcons.length + '）')
  let aIcon = createdIcons.filter(function (n) { return n.getAttribute('data-name') === 'a.txt' })[0]
  check(!!aIcon, '首屏渲染出 a.txt')
  check(aIcon && aIcon.style.left === '100px', 'a.txt 用持久化位置渲染（实际 ' + (aIcon && aIcon.style.left) + '）')

  // ── 场景 2：refresh 后台对齐（跳过首屏 loading），且与缓存不一致时以真实为准 ──
  loadingShown = 0
  await D.refresh()
  check(loadingShown === 0, '首屏后台对齐 refresh 不再弹 loading（实际 ' + loadingShown + '）')
  check(createdIcons.length === 3, 'refresh 后以真实 list 对齐（新增 c.txt，实际 ' + createdIcons.length + '）')
  check(createdIcons.some(function (n) { return n.getAttribute('data-name') === 'c.txt' }), '对齐后渲染出真实新增的 c.txt')

  // ── 场景 3：refresh 完成后写回最新快照（缓存 items 含 c.txt）──
  const savedCache = JSON.parse(store[CACHE_KEY])
  check(savedCache && savedCache.items && savedCache.items.length === 3,
    'refresh 后写回最新启动快照（3 项，实际 ' + (savedCache && savedCache.items && savedCache.items.length) + '）')
  check(savedCache && savedCache.items.some(function (it) { return it.name === 'c.txt' }),
    '写回快照含真实新增 c.txt')

  // ── 场景 4：无启动快照 → renderFromCache 不渲染 + refresh 正常弹 loading ──
  delete store[CACHE_KEY]
  // 重置内存状态模拟全新启动
  C.state.rootId = ''
  Object.keys(C.positions).forEach(function (k) { delete C.positions[k] })
  C.state.items = []
  C._bootstrapShown = false
  createdIcons = []
  loadingShown = 0
  P.renderFromCache()
  check(createdIcons.length === 0, '无快照时 renderFromCache 不渲染（走正常加载）')
  await D.refresh()
  check(loadingShown >= 1, '无快照时 refresh 正常弹 loading 转圈（实际 ' + loadingShown + '）')
  check(createdIcons.length === 3, '无快照时 refresh 正常渲染真实列表（实际 ' + createdIcons.length + '）')

  if (failures > 0) {
    console.error('  [FAIL] startup-cache 测试 ' + failures + ' 项失败')
    process.exit(1)
  }
  console.log('  [ok] startup-cache 测试全部通过')
})().catch(function (e) {
  console.error('  [FAIL] startup-cache 测试异常: ' + (e && e.stack || e))
  process.exit(1)
})
