// desktop.js refresh 竞态回归测试（真机 Bug A 复现）：
// 快速连续导航（进入 docs 后立即退根）时，旧路径 list 结果迟到，
// 不得覆盖新路径状态——否则旧 items 渲染在根视图（先切视图再变目录）
// + 用旧 items 做 valid 清空根级 positions（布局像初次启动）。
// 用法: node test-desktop-refresh-race.js [项目路径]   （由 run-tests.sh 调用）
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

// ── 最小 DOM stub（与 test-desktop-nav-dom.js 同构）──
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

// 文件树：根 2 项（docs + a.txt），docs 1 项（b.txt）
const fsTree = {
  '': [
    { name: 'docs', isDir: true, size: 0, mtime: 1 },
    { name: 'a.txt', isDir: false, size: 1, mtime: 2 }
  ],
  'docs': [
    { name: 'b.txt', isDir: false, size: 1, mtime: 3 }
  ]
}
let listCalls = []

// ── 可控 list：deferredList 非空时挂起，测试手动 resolve（模拟桥乱序返回）──
let deferredList = null
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
// 布局：a.txt 摆放在 (100,100)，docs 在 (200,200)——若 refresh 竞态清空则回退自动排布
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

// layout-store.js 加载后会覆盖桩（真实实现读 localStorage→null）——重新设桩，确保 positions 可注入
sandbox.App.LayoutStore = {
  load: function () {
    return { version: 1, icons: { 'a.txt': { x: 100, y: 100 }, 'docs': { x: 200, y: 200 } }, camera: { x: 0, y: 0, zoom: 1 } }
  },
  save: function () { return true }
}
sandbox.App.HomeStore = { load: function () { return null }, saveHome: function () { return true }, saveFallback: function () { return true } }
sandbox.App.ViewStore = { load: function () { return { viewStyle: 'grid', sortBy: 'name', sortDir: 1 } }, save: function () { return true } }

const D = sandbox.App.Desktop

;(async function () {
  // ── 初始：根目录渲染（a.txt @100,100 应保持）──
  D.initGesture()
  await D.refresh()
  let aIcon = createdIcons.filter(function (n) { return n.getAttribute('data-name') === 'a.txt' })[0]
  check(!!aIcon, '初始根目录渲染 a.txt')
  
  // ── 竞态场景：进入 docs（list 挂起）→ 立即退根（list 立即返回）→ 旧 list 迟到 ──
  let resolveDocs
  deferredList = { promise: new Promise(function (res) { resolveDocs = res }) }
  D.enterFolder('docs')              // refresh#A：seq=1，list('docs') 即将挂起
  await new Promise(function (r) { setTimeout(r, 0) })   // 微任务：rootInfo.then 执行 → list('docs') 挂起
  D.goBack()                          // refresh#B：seq=2，list('') 立即返回根内容

  await new Promise(function (r) { setTimeout(r, 20) })
  // 此刻根已渲染（refresh#B 完成），a.txt 位置应保持 100px
  aIcon = createdIcons.filter(function (n) { return n.getAttribute('data-name') === 'a.txt' })[0]
  check(!!aIcon, '竞态中退根后渲染 a.txt')
  check(aIcon && aIcon.style.left === '100px', 'refresh#B 完成后 a.txt 位置保持 100px（实际 ' + (aIcon && aIcon.style.left) + '）')
  check(createdIcons.length === 2, '退根后渲染 2 个图标（根内容），实际 ' + createdIcons.length)

  // 旧 list('docs') 迟到返回：b.txt（docs 内容）
  resolveDocs([{ name: 'b.txt', isDir: false, size: 1, mtime: 3 }])
  await new Promise(function (r) { setTimeout(r, 20) })


  // ── 断言：旧响应不得覆盖新状态 ──
  check(createdIcons.length === 2, '旧 list 迟到后仍渲染 2 个图标（不被 docs 内容覆盖），实际 ' + createdIcons.length)
  check(!createdIcons.some(function (n) { return n.getAttribute('data-name') === 'b.txt' }),
    '旧 list 迟到后 b.txt 不出现（不渲染旧目录内容）')
  aIcon = createdIcons.filter(function (n) { return n.getAttribute('data-name') === 'a.txt' })[0]
  check(!!aIcon && aIcon.style.left === '100px',
    '旧 list 迟到后 a.txt 位置仍保持 100px（positions 未被错误清理），实际 ' + (aIcon && aIcon.style.left))
  check(D.getCurPath() === '', '旧 list 迟到后 curPath 仍为根')

  if (failures > 0) {
    console.error('  [FAIL] refresh-race 测试 ' + failures + ' 项失败')
    process.exit(1)
  }
  console.log('  [ok] refresh-race 测试全部通过')
})().catch(function (e) {
  console.error('  [FAIL] refresh-race 测试异常: ' + (e && e.stack || e))
  process.exit(1)
})
