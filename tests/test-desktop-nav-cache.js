// 目录导航秒开回归测试（refresh({nav:true}) 的清单缓存 / 根信息复用 / loading 延迟显示）：
//   1. 启动 refresh（非导航）：取 rootInfo，清单缓存落地
//   2. 导航（进/退）复用根信息（rootInfo 不再调用）——省一次桥往返
//   3. 退出已看过的目录：goUp 返回时**已同步渲染**父目录（秒开），且不弹「加载中」；
//      随后静默向桥层重取对齐（stale-while-revalidate），内容未变不重渲染
//   4. 后台对齐发现内容变化 → 重渲染（文件系统仍是真相）
//   5. 未缓存目录：180ms 内不弹「加载中」（避免闪一下），超过才弹
// 用法: node test-desktop-nav-cache.js [项目路径]   （由 run-tests.sh 调用）
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

// ── 文件树（可变：用于「后台对齐发现变化」场景）──
const ROOT_ITEMS = [
  { name: 'docs', isDir: true, size: 0, mtime: 1 },
  { name: 'a.txt', isDir: false, size: 1, mtime: 2 }
]
const fsTree = {
  '': ROOT_ITEMS.slice(),
  'docs': [{ name: 'b.txt', isDir: false, size: 1, mtime: 3 }]
}
let listCalls = []
let rootInfoCalls = 0
let loadingShows = 0
let loadingHides = 0
let deferredList = null   // 非空时本次 list 挂起，测试手动 resolve（模拟慢目录）

const sandbox = {
  App: {},
  console: console,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  Date: Date,
  Promise: Promise,
  document: {
    getElementById: function (id) { return els[id] || null },
    createElement: function () { return makeIconEl() }
  },
  localStorage: { getItem: function () { return null }, setItem: function () {} },
  navigator: {}
}
sandbox.window = sandbox
sandbox.App.bridge = { vibrate: function () {} }
sandbox.App.toast = { show: function () {} }
sandbox.App.Loading = {
  show: function () { loadingShows++ },
  hide: function () { loadingHides++ }
}
sandbox.App.FileAPI = {
  rootInfo: function () {
    rootInfoCalls++
    return Promise.resolve({ rootName: 'Test', mode: 'private', displayPath: '内部存储/Test' })
  },
  list: function (p) {
    listCalls.push(p || '')
    if (deferredList) {
      const d = deferredList
      deferredList = null
      return d.promise
    }
    return Promise.resolve((fsTree[p || ''] || []).slice())
  },
  read: function () { return Promise.resolve('') },
  write: function () { return Promise.resolve(true) },
  mkdir: function () { return Promise.resolve(true) },
  del: function () { return Promise.resolve(true) },
  rename: function () { return Promise.resolve(true) },
  copy: function () { return Promise.resolve(true) }
}
sandbox.App.LayoutStore = {
  load: function () {
    return { version: 1, icons: { 'a.txt': { x: 100, y: 100 }, 'docs': { x: 200, y: 200 } }, camera: { x: 0, y: 0, zoom: 1 } }
  },
  save: function () { return true }
}
sandbox.App.HomeStore = { load: function () { return null }, saveHome: function () { return true }, saveFallback: function () { return true } }
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
for (const f of ['namespace.js', 'desktop-nav.js', 'double-tap.js', 'desktop-selection.js', 'desktop-grid.js', 'layout-store.js', 'desktop-camera.js', 'desktop-gesture.js', 'desktop-core.js', 'desktop-render.js', 'desktop-browse-mode.js', 'desktop-navigation.js', 'desktop-persist.js', 'desktop-viewer-link.js', 'desktop-gesture-handlers.js', 'clipboard.js', 'desktop.js']) {
  vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), sandbox, { filename: f })
}

// layout-store.js 等真实模块会覆盖桩——加载后重新设桩（与 refresh-race 测试同构）
sandbox.App.LayoutStore = {
  load: function () {
    return { version: 1, icons: { 'a.txt': { x: 100, y: 100 }, 'docs': { x: 200, y: 200 } }, camera: { x: 0, y: 0, zoom: 1 } }
  },
  save: function () { return true }
}
sandbox.App.HomeStore = { load: function () { return null }, saveHome: function () { return true }, saveFallback: function () { return true } }
sandbox.App.ViewStore = { load: function () { return { viewStyle: 'grid', sortBy: 'name', sortDir: 1 } }, save: function () { return true } }

const D = sandbox.App.Desktop
function names() {
  return createdIcons.map(function (n) { return n.getAttribute('data-name') })
}
function flush() { return new Promise(function (r) { setTimeout(r, 20) }) }

;(async function () {
  // ── 1. 启动（非导航 refresh）：取根信息 + 立即弹 loading ──
  D.initGesture()
  await D.refresh()
  check(names().length === 2, '启动渲染根目录 2 项（' + names().join(',') + '）')
  check(rootInfoCalls === 1, '启动取 rootInfo 1 次')
  check(loadingShows === 1, '启动（无首屏缓存）立即弹「加载中」')
  check(listCalls.filter(function (p) { return p === '' }).length === 1, '启动 list 根目录 1 次')

  // ── 2. 进入未缓存目录：导航复用根信息 + 快目录不闪 loading ──
  const showsBeforeEnter = loadingShows
  D.enterFolder('docs')
  await flush()
  check(rootInfoCalls === 1, '导航复用根信息（rootInfo 仍为 1 次，未新增桥往返）')
  check(listCalls[listCalls.length - 1] === 'docs', '导航 list(docs)')
  check(names().length === 1 && names()[0] === 'b.txt', 'folder 渲染 docs 内容（b.txt）')
  check(loadingShows === showsBeforeEnter, '快目录（清单即时返回）不闪「加载中」')

  // ── 3. 退出文件夹（回到已看过的根目录）：同步渲染 + 不弹 loading + 后台对齐 ──
  const listsBeforeUp = listCalls.length
  D.goUp()
  check(names().length === 2 && names().indexOf('a.txt') >= 0,
    '退出文件夹：goUp 返回时已同步渲染父目录 2 项（秒开，无需等桥）')
  check(sandbox.App.DesktopCore.getCurPath === undefined || D.getCurPath() === '', '退出后 curPath 回根')
  check(loadingShows === showsBeforeEnter, '退出文件夹：未弹「加载中」')
  const aIcon = createdIcons.filter(function (n) { return n.getAttribute('data-name') === 'a.txt' })[0]
  check(!!aIcon && aIcon.style.left === '100px', '退出后 a.txt 位置保持布局值 100px（positions 未被误清）')
  await flush()
  check(listCalls.length === listsBeforeUp + 1 && listCalls[listCalls.length - 1] === '',
    '退出后静默向桥层重取根清单（stale-while-revalidate）')
  check(names().length === 2, '内容未变 → 不重复重渲染（仍是 2 项）')

  // ── 4. 后台对齐发现内容变化 → 重渲染（文件系统是真相）──
  fsTree[''] = ROOT_ITEMS.concat([{ name: 'c.txt', isDir: false, size: 1, mtime: 4 }])
  D.enterFolder('docs')
  await flush()
  check(names().length === 1, '再进 docs（缓存命中）同步渲染 1 项')
  D.goUp()
  check(names().length === 2, '退回根：先按缓存渲染 2 项（尚未对齐）')
  await flush()
  check(names().length === 3 && names().indexOf('c.txt') >= 0,
    '后台对齐发现新增 c.txt → 重渲染为 3 项（缓存不遮蔽真相）')

  // ── 5. 未缓存目录：loading 延迟显示（180ms 内不闪，超时才弹） ──
  let resolveSlow
  deferredList = { promise: new Promise(function (res) { resolveSlow = res }) }
  const showsBeforeSlow = loadingShows
  const hidesBeforeSlow = loadingHides
  D.enterFolder('slow')
  check(loadingShows === showsBeforeSlow, '未缓存目录：180ms 内不弹「加载中」（避免闪一下）')
  await new Promise(function (r) { setTimeout(r, 240) })
  check(loadingShows === showsBeforeSlow + 1, '超过 180ms 仍在加载 → 弹出「加载中」')
  resolveSlow([{ name: 's.txt', isDir: false, size: 1, mtime: 5 }])
  await flush()
  check(names().length === 1 && names()[0] === 's.txt', '慢目录返回后渲染内容（s.txt）')
  check(loadingHides > hidesBeforeSlow, '加载完成 → 关闭「加载中」')

  // ── 6. 视图偏好切换：只重渲染（不白跑一次 list、不闪一次「加载中」）──
  const listsBeforeView = listCalls.length
  const showsBeforeView = loadingShows
  D.applyViewPrefs({ viewStyle: 'list', sortBy: 'name', sortDir: 1 })
  check(listCalls.length === listsBeforeView, '切换视图偏好：不向桥层重取清单（清单内容与偏好无关）')
  check(loadingShows === showsBeforeView, '切换视图偏好：不弹「加载中」')
  check(names().length === 1 && names()[0] === 's.txt', '切换视图偏好：按新偏好重渲染（仍 1 项）')

  if (failures > 0) {
    console.error('  [FAIL] nav-cache 测试 ' + failures + ' 项失败')
    process.exit(1)
  }
  console.log('[ok] nav-cache 测试全部通过')
  process.exit(0)
})().catch(function (e) {
  console.error('  [fail] 测试执行异常: ' + (e && e.stack || e))
  process.exit(1)
})
