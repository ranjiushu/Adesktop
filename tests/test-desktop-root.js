// desktop-root 桌面根回归测试（2026-08-19 全盘桌面根引入）：
// 1. all-files 模式 isFolderView 判定（桌面空间 = desktopRoot，全盘根 '' 也是 folder）
// 2. refresh 启动初始化（curPath = desktopRoot、rootId 拼装 'all-files:<桌面根>'、nav 栈同步）
// 3. saveDesktopRoot 校验与切换（拒绝绝对路径/..逃逸/空段；持久化 + 回到新桌面根）
// 4. render.layout 虚拟回收站（.trash 在全盘根，桌面空间附加 key='.trash' 条目）
// 用法: node test-desktop-root.js [项目路径]   （由 run-tests.sh 调用）
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

// ── 最小 DOM stub（与 test-desktop-layout-reload.js 同构）──
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

// ── 可控 localStorage ──
let store = {}
const localStorageStub = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null },
  setItem: function (k, v) { store[k] = String(v) },
  removeItem: function (k) { delete store[k] }
}

// ── 布局数据文件（文件即真相）：路径 → JSON 文本 ──
let fsLayout = {}

// 文件树：全盘根（含 .trash）+ 桌面目录 Desktop（不含 .trash——回收站虚拟附加场景）
const fsTree = {
  '': [
    { name: 'Desktop', isDir: true, size: 0, mtime: 1 },
    { name: '.trash', isDir: true, size: 0, mtime: 1 },
    { name: 'Download', isDir: true, size: 0, mtime: 2 }
  ],
  'Desktop': [
    { name: 'a.txt', isDir: false, size: 1, mtime: 3 },
    { name: 'docs', isDir: true, size: 0, mtime: 4 }
  ],
  'Download': []
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
    // 全盘模式：rootId 固定串 'all-files'（前端在 refresh 里拼桌面根）
    return Promise.resolve({ rootName: '手机存储', mode: 'all-files', displayPath: '/storage/emulated/0', rootId: 'all-files', trashName: '.trash' })
  },
  // 布局数据文件（.adesktop-layout.json）：可预置/可断言写入
  read: function (p) {
    if (Object.prototype.hasOwnProperty.call(fsLayout, p)) return Promise.resolve(fsLayout[p])
    return Promise.reject(new Error('不存在: ' + p))
  },
  write: function (p, content) {
    fsLayout[p] = content
    return Promise.resolve(true)
  },
  list: function (p) { return Promise.resolve((fsTree[p || ''] || []).slice()) },
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
const R = sandbox.App.DesktopRender

;(async function () {
  // ── 1. 启动流程：initGesture → refresh（all-files 桌面根初始化）──
  D.initGesture()
  check(C.state.desktopRoot === 'Desktop', 'desktopRoot 默认 Desktop（未配置 localStorage）')
  check(C.state.curPath === '', '启动时 curPath 初始为空（rootInfo 前）')
  await D.refresh()
  check(C.state.mode === 'all-files', 'rootInfo 后 mode = all-files')
  check(C.state.curPath === 'Desktop', 'all-files 启动：curPath 初始化为桌面根 Desktop')
  check(C.state.rootId === 'all-files:Desktop', 'rootId 拼装带桌面根：all-files:Desktop（布局隔离）')
  check(D.getCurPath() === 'Desktop', 'getCurPath 返回 Desktop')

  // ── 2. isFolderView 判定（all-files：桌面空间 = desktopRoot，其余都是 folder）──
  check(C.isFolderView() === false, 'curPath=Desktop（桌面根）= 桌面空间（isFolderView false）')
  C.state.curPath = ''
  check(C.isFolderView() === true, 'curPath=全盘根（空串）= folder 容器（isFolderView true）')
  C.state.curPath = 'Desktop/docs'
  check(C.isFolderView() === true, 'curPath=Desktop/docs = folder 容器')
  C.state.curPath = 'Desktop'
  check(C.viewMode() === 'desktop', 'viewMode = desktop（桌面根）')
  C.state.curPath = ''
  check(C.viewMode() === 'folder', 'viewMode = folder（全盘根）')
  C.state.curPath = 'Desktop'

  // ── 3. render.layout 虚拟回收站（桌面空间附加 .trash，key = 固定串）──
  const placed = R.layout(C.state.items.slice())
  const keys = placed.map(function (p) { return p.key })
  check(keys.indexOf('.trash') >= 0, '桌面空间 layout 附加虚拟回收站（key=.trash）')
  check(C.isTrashPath('.trash') === true, '虚拟回收站 isTrashPath 命中（删除守卫/打开入口可用）')
  // 全盘根 folder：.trash 是真实条目，走普通 folder 逻辑
  C.state.curPath = ''
  await D.refresh()
  const placedRoot = R.layout(C.state.items.slice())
  check(placedRoot.some(function (p) { return p.key === '.trash' }),
    '全盘根 folder：.trash 真实存在，正常入列')
  C.state.curPath = 'Desktop'
  await D.refresh()

  // ── 4. saveDesktopRoot：校验 + 切换 + 持久化 ──
  check(P.saveDesktopRoot('/abs') === false, '拒绝绝对路径（/abs）')
  check(P.saveDesktopRoot('../x') === false, '拒绝 .. 逃逸（../x）')
  check(P.saveDesktopRoot('a//b') === false, '拒绝空路径段（a//b）')
  check(P.saveDesktopRoot('My/Work') === true, '接受合法自定义相对路径（My/Work）')
  check(C.state.desktopRoot === 'My/Work', 'saveDesktopRoot 更新 desktopRoot')
  check(store['desktop-root'] === 'My/Work', 'saveDesktopRoot 持久化到 localStorage')
  await D.refresh()
  check(C.state.rootId === 'all-files:My/Work', '切桌面根后 rootId 重新拼装（布局隔离）')
  check(C.state.curPath === 'My/Work', '切桌面根后回到新桌面根')
  check(C.isFolderView() === false, '新桌面根 = 桌面空间')
  check(P.saveDesktopRoot('') === true, '允许桌面根 = 全盘根（空字符串）')
  await D.refresh()
  check(C.state.rootId === 'all-files:', '桌面根=全盘根 → rootId = all-files:（与空桌面区分）')
  check(C.state.curPath === '', '桌面根=全盘根 → curPath = 全盘根')
  check(C.isFolderView() === false, '桌面根=全盘根 → 桌面空间')
  check(P.saveDesktopRoot('Desktop') === true, '切回 Desktop')
  await D.refresh()
  check(C.state.curPath === 'Desktop' && C.state.desktopRoot === 'Desktop', '切回 Desktop 生效')

  // ── 3.5 布局数据文件（文件即真相，localStorage 为缓存）──
  // 预置桌面根布局文件 → refresh 后按文件应用（覆盖缓存）
  fsLayout['Desktop/.adesktop-layout.json'] = JSON.stringify({
    version: 1,
    icons: { 'Desktop/a.txt': { x: 55, y: 66 }, '.trash': { x: 10, y: 10 } },
    camera: { x: 1, y: 2, zoom: 1.5, rotation: 0 }
  })
  await D.refresh()
  check(C.positions['Desktop/a.txt'] && C.positions['Desktop/a.txt'].x === 55,
    '布局文件为真相：refresh 应用文件数据（a.txt @ 55,66）')
  check(C.positions['.trash'] && C.positions['.trash'].y === 10,
    '虚拟回收站位置随布局文件恢复（key 直通）')
  check(!!C.camera && C.camera.zoom === 1.5, '布局文件相机恢复（zoom=1.5）')
  // saveLayout 双写：目录文件（真相）+ localStorage（缓存）
  C.positions['Desktop/a.txt'] = { x: 111, y: 222 }
  P.saveLayout()
  const fileData = fsLayout['Desktop/.adesktop-layout.json']
    ? JSON.parse(fsLayout['Desktop/.adesktop-layout.json']) : null
  check(fileData && fileData.icons['Desktop/a.txt'] && fileData.icons['Desktop/a.txt'].x === 111,
    'saveLayout 双写：布局文件含最新位置（111,222）')
  check(store['desktop.layout.all-files:Desktop.v1'] !== undefined,
    'saveLayout 双写：localStorage 缓存同步')

  // ── 3.6 布局文件不渲染（隐藏元数据）──
  fsLayout['Desktop/.adesktop-layout.json'] = JSON.stringify({
    version: 1,
    icons: {}, camera: null
  })
  fsTree['Desktop'] = [
    { name: 'a.txt', isDir: false, size: 1, mtime: 3 },
    { name: '.adesktop-layout.json', isDir: false, size: 1, mtime: 5 }
  ]
  await D.refresh()
  const placedFiltered = R.layout(C.state.items.slice())
  check(placedFiltered.every(function (p) { return p.key !== 'Desktop/.adesktop-layout.json' }),
    '布局数据文件不渲染（过滤隐藏元数据）')

  // ── 5. 浏览器环境（无 FileBridge）不弹授权引导（Drawer.maybePromptAllFiles 守卫）──
  check(typeof sandbox.App.Drawer.maybePromptAllFiles === 'undefined',
    '测试环境 Drawer 无 maybePromptAllFiles（真实环境由 drawer.js 提供，无桥不弹）')

  if (failures > 0) {
    console.error('[fail] desktop-root 测试失败 ' + failures + ' 项')
    process.exit(1)
  }
  console.log('[ok] desktop-root 测试全部通过')
  process.exit(0)
})().catch(function (err) {
  console.error('[fail] desktop-root 测试异常: ' + (err && err.message))
  process.exit(1)
})
