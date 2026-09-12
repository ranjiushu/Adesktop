// 缩略图按需加载（视口优先）回归测试：
//   1. 大目录渲染只为**视口内**（含半屏外扩）条目派发缩略图请求——离屏条目不生成
//   2. 滚动/平移到新区域 → scheduleVisibleThumbs 节流补齐新进入视口的条目
//   3. 同一路径不重复派发；重新渲染后可见条目会重新派发（DOM 元素已换新，
//      Thumbnail 侧 pending 合并 waiter——防「等待中缩略图落地到已卸载元素 → 类型图标卡住」）
// 用法: node test-desktop-thumb-viewport.js [项目路径]   （由 run-tests.sh 调用）
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
  const el = {
    offsetWidth: 84, offsetHeight: 76,
    classList: makeClassList(),
    style: {}, appendChild: function () {},
    _attrs: {}, _html: '',
    setAttribute: function (k, v) { this._attrs[k] = v },
    getAttribute: function (k) { return this._attrs[k] },
    // 渲染层经 card.querySelector('.desktop-icon-glyph') 取缩略图容器
    querySelector: function (sel) { return el._glyph || null }
  }
  return el
}
function makeGridEl() {
  const el = {
    _html: '', children: [], classList: makeClassList(), style: {},
    get innerHTML() { return el._html },
    set innerHTML(v) { el._html = v; el.children = []; createdIcons = [] },
    appendChild: function (node) {
      createdIcons.push(node)
      el.children.push(node)
      // 卡片第一个子元素 = glyph 容器（appendChild 顺序：icon → name）
      if (!node._isName) node._glyph = node
    }
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

// ── 文件树：根 1 个目录；目录内 200 个 jpg（4 列 → 50 行，远超一屏）──
const BIG_COUNT = 200
const bigItems = []
for (let i = 0; i < BIG_COUNT; i++) {
  bigItems.push({ name: 'p' + i + '.jpg', isDir: false, size: 100, mtime: i })
}
const fsTree = {
  '': [{ name: 'big', isDir: true, size: 0, mtime: 0 }],
  'big': bigItems
}
const listCalls = []
const thumbRequests = []      // 派发顺序（含重复，用于查重）
const thumbRequestedSet = {}

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
sandbox.App.Loading = { show: function () {}, hide: function () {} }
sandbox.App.FileAPI = {
  rootInfo: function () { return Promise.resolve({ rootName: 'T', mode: 'private', displayPath: '/T', trashName: '.trash', rootId: 'mock' }) },
  list: function (p) { listCalls.push(p || ''); return Promise.resolve((fsTree[p || ''] || []).slice()) },
  read: function () { return Promise.resolve('') },
  write: function () { return Promise.resolve(true) },
  mkdir: function () { return Promise.resolve(true) },
  del: function () { return Promise.resolve(true) },
  rename: function () { return Promise.resolve(true) },
  copy: function () { return Promise.resolve(true) }
}
// 缩略图桩：只记录派发（不回调——保持 pending，模拟真实异步生成）
sandbox.App.Thumbnail = {
  canThumbnail: function (kind) { return kind === 'image' || kind === 'video' },
  request: function (p, name, kind, onReady, onFallback) {
    thumbRequests.push(p)
    thumbRequestedSet[p] = true
  },
  requestShortcutIcon: function () {}
}
sandbox.App.TypeIcons = {
  kindFor: function (name, isDir) { return isDir ? 'dir' : 'image' },
  iconFor: function () { return '<svg data-type-icon="image"></svg>' },
  svgFor: function () { return '<svg></svg>' },
  kindSvg: function () { return '<svg></svg>' }
}
sandbox.App.LayoutStore = { load: function () { return null }, save: function () { return true } }
sandbox.App.HomeStore = { load: function () { return null }, saveHome: function () { return true }, saveFallback: function () { return true } }
sandbox.App.ViewStore = { load: function () { return { viewStyle: 'grid', sortBy: 'name', sortDir: 1 } }, save: function () { return true } }
sandbox.App.FolderSort = { sort: function (items) { return items.slice() }, defaultDir: function () { return 1 } }
// 4 列网格：y = 16 + floor(i/4) * 92（200 项 → 50 行，约 4600px 高）
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
  canvasSize: function (count, vw) { return { w: vw, h: 16 + Math.ceil(count / 4) * 92 } },
  iconWidth: function () { return 100 }
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
// 真实 desktop-camera.js 参与加载：worldToScreen 语义即生产实现（rotation=0 时 (w-c)*zoom）
for (const f of ['namespace.js', 'desktop-nav.js', 'double-tap.js', 'desktop-selection.js', 'desktop-grid.js', 'layout-store.js', 'desktop-camera.js', 'desktop-gesture.js', 'desktop-core.js', 'desktop-render.js', 'desktop-browse-mode.js', 'desktop-navigation.js', 'desktop-persist.js', 'desktop-viewer-link.js', 'desktop-gesture-handlers.js', 'clipboard.js', 'desktop.js']) {
  vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), sandbox, { filename: f })
}
// 真实模块可能覆盖桩：重新设桩（本测试断言不受 store 实现影响）
sandbox.App.Loading = { show: function () {}, hide: function () {} }
sandbox.App.Thumbnail = sandbox.App.Thumbnail   // 未被真实模块覆盖（无 thumbnail.js 加载）
sandbox.App.TypeIcons = sandbox.App.TypeIcons

const D = sandbox.App.Desktop
const C = sandbox.App.DesktopCore
const R = sandbox.App.DesktopRender
function flush() { return new Promise(function (r) { setTimeout(r, 30) }) }

// 世界矩形（4 列网格）→ 世界 y；用于断言「只请求视口内的条目」
function worldY(path) {
  const i = parseInt(String(path).split('/')[1].replace('p', '').replace('.jpg', ''), 10)
  return 16 + Math.floor(i / 4) * 92
}

;(async function () {
  D.initGesture()
  await D.refresh()
  check(listCalls[listCalls.length - 1] === '', '启动 list 根目录')

  // ── 1. 进大目录：只派发视口内（含半屏外扩）的缩略图 ──
  D.enterFolder('big')
  await flush()
  check(createdIcons.length === BIG_COUNT, '文件夹渲染 ' + BIG_COUNT + ' 个图标')
  const first = thumbRequests.slice()
  check(first.length > 0, '视口内条目派发缩略图（实际 ' + first.length + ' 个）')
  check(first.length < BIG_COUNT, '离屏条目**不**派发缩略图（' + first.length + ' < ' + BIG_COUNT + '）')
  check(first.indexOf('big/p0.jpg') >= 0, '首屏第一条（big/p0.jpg）已派发')
  check(first.indexOf('big/p199.jpg') < 0, '末尾离屏条目（big/p199.jpg）未派发')
  const overscan = first.filter(function (p) { return worldY(p) > 700 + 700 * 0.5 + 120 })
  check(overscan.length === 0, '派发范围不超过视口 + 半屏外扩（越界 ' + overscan.length + ' 个）')
  const dup = Object.keys(first.reduce(function (m, p) { m[p] = (m[p] || 0) + 1; return m }, {})).filter(function (p) {
    return first.filter(function (q) { return q === p }).length > 1
  })
  check(dup.length === 0, '同一路径不重复派发（重复 ' + dup.length + ' 个）')

  // ── 2. 滚动到第二屏：节流补齐新进入视口的条目 ──
  const beforeScroll = thumbRequests.length
  C.camera = { x: 0, y: 3000, zoom: 1 }
  R.scheduleVisibleThumbs()
  await new Promise(function (r) { setTimeout(r, 200) })   // 等节流窗口（THUMB_REFILL_MS=120）
  const added = thumbRequests.slice(beforeScroll)
  check(added.length > 0, '滚动后补齐新进入视口的缩略图（+' + added.length + ' 个）')
  const nearCam = added.filter(function (p) { return worldY(p) >= 3000 - 350 - 120 && worldY(p) <= 3000 + 700 + 350 })
  check(nearCam.length === added.length, '补齐的条目全部落在新视口带内（' + nearCam.length + '/' + added.length + '）')
  check(thumbRequests.indexOf('big/p199.jpg') < 0,
    '仍未滚动到的条目（big/p199.jpg，y=' + worldY('big/p199.jpg') + '）保持未派发')
  check(thumbRequests.length < BIG_COUNT, '总派发数仍远小于目录条目数（' + thumbRequests.length + '）')

  // ── 3. 重新渲染后可见条目重新派发（DOM 元素换新 → 防类型图标卡住）──
  const beforeRerender = thumbRequests.length
  R.render()
  await flush()
  check(thumbRequests.length > beforeRerender,
    '重新渲染后可见条目重新派发（Thumbnail 侧 pending/ready 合并，防元素换新后图标卡住）')

  if (failures > 0) {
    console.error('  [FAIL] thumb-viewport 测试 ' + failures + ' 项失败')
    process.exit(1)
  }
  console.log('[ok] thumb-viewport 测试全部通过')
  process.exit(0)
})().catch(function (e) {
  console.error('  [fail] 测试执行异常: ' + (e && e.stack || e))
  process.exit(1)
})
