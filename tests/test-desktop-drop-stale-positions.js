// desktop.js 拖动落盘回归测试：进子文件夹再返回根目录后拖动文件不得崩溃。
// 背景（Bug）：folder 视图 render 会把子文件夹 key（如 docs/b.txt）写入 positions，
// 返回根目录后这些 key 成为「幽灵条目」——根目录拖动落盘时 statics 会带上它们，
// bounds 里却没有对应项 → bounds[n].w 抛 TypeError，拖动清理（picked-up 回收 + 落盘）中断，
// 表现为「选中态消失但悬浮态残留 + 卡死 + 重启后位置丢失」。
// 用法: node test-desktop-drop-stale-positions.js [项目路径]   （由 run-tests.sh 调用）
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

// ── 最小 DOM stub（与 test-desktop-drop-selection.js 同构）──
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
function makeViewportEl(rect) {
  const handlers = {}
  return {
    clientWidth: rect.width, clientHeight: rect.height,
    style: {}, classList: makeClassList(),
    addEventListener: function (type, fn) { (handlers[type] = handlers[type] || []).push(fn) },
    dispatch: function (type, ev) { (handlers[type] || []).forEach(function (fn) { fn(ev) }) },
    getBoundingClientRect: function () {
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height,
        right: rect.left + rect.width, bottom: rect.top + rect.height }
    }
  }
}

const gridEl = makeGridEl()
const viewportEl = makeViewportEl({ left: 0, top: 56, width: 412, height: 700 })
const canvasEl = { style: {}, classList: makeClassList() }
const els = {
  'desktop-grid': gridEl,
  'desktop-viewport': viewportEl,
  'desktop-canvas': canvasEl,
  'desktop-marquee': { style: {} }
}

const fsTree = {
  '': [
    { name: 'docs', isDir: true, size: 0, mtime: 1 },
    { name: 'a.txt', isDir: false, size: 1, mtime: 2 }
  ],
  'docs': [
    { name: 'sub', isDir: true, size: 0, mtime: 5 },
    { name: 'b.txt', isDir: false, size: 1, mtime: 3 }
  ]
}

const layoutWrites = []
const fabSelection = []
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
  localStorage: {
    getItem: function () { return null },
    setItem: function (k, v) { layoutWrites.push({ k: k, v: v }) }
  },
  navigator: {}
}
sandbox.window = sandbox
sandbox.App.bridge = { vibrate: function () {} }
sandbox.App.toast = { show: function () {} }
sandbox.App.Dialog = { open: function () {}, close: function () {} }
sandbox.App.Loading = {
  showTag: function () {}, hideTag: function () {}, show: function () {}, hide: function () {}
}
sandbox.App.Actions = { moveIntoFolder: function () {} }
sandbox.App.FileAPI = {
  rootInfo: function () { return Promise.resolve({ rootName: 'Test', mode: 'private', displayPath: '内部存储/Test' }) },
  list: function (p) { return Promise.resolve((fsTree[p || ''] || []).slice()) }
}
sandbox.App.HomeStore = { load: function () { return null }, saveHome: function () { return true }, saveFallback: function () { return true } }
sandbox.App.ViewStore = { load: function () { return { viewStyle: 'grid', sortBy: 'name', sortDir: 1 } }, save: function () { return true } }
sandbox.App.ViewMenu = { setEnabled: function () {} }
sandbox.App.fabSpeedDial = { setSelection: function (has) { fabSelection.push(!!has) } }
sandbox.App.Drawer = { updatePath: function () {} }
sandbox.App.BottomBar = { updateNavButtons: function () {} }
sandbox.App.Clipboard = { isCut: function () { return false } }

vm.createContext(sandbox)
for (const f of ['namespace.js', 'desktop-nav.js', 'double-tap.js', 'desktop-selection.js',
  'folder-sort.js', 'desktop-grid.js', 'folder-layout.js', 'layout-store.js', 'view-store.js',
  'home-store.js', 'desktop-camera.js', 'desktop-gesture.js', 'desktop-core.js', 'desktop-render.js', 'desktop-browse-mode.js', 'desktop-navigation.js', 'desktop.js']) {
  vm.runInContext(fs.readFileSync(path.join(SRC_DIR, f), 'utf8'), sandbox, { filename: f })
}

const D = sandbox.App.Desktop
function touch(id, x, y) { return { identifier: id, clientX: x, clientY: y } }
function tev(type, pts, changed) {
  return { type: type, touches: pts, changedTouches: changed || pts, preventDefault: function () {} }
}
function screen(wx, wy) { return { x: wx, y: wy + 56 } }

;(async function () {
  D.initGesture()
  await D.refresh()
  check(createdIcons.length === 2, '根目录渲染 2 个图标（docs + a.txt）')

  // 进入 docs 子文件夹再返回根目录——制造 positions 里的「幽灵子文件夹 key」
  D.enterFolder('docs')
  await D.refresh()
  check(D.getCurPath() === 'docs', '已进入 docs（folder 视图）')
  check(createdIcons.length === 2, 'docs 渲染 2 个图标（sub + b.txt）')
  D.goUp()
  await D.refresh()
  check(D.getCurPath() === '', '已返回根目录')

  // 选中 a.txt 并拖动落盘（moved=true）——修复前这里会因幽灵 key 抛 TypeError
  const aIcon = createdIcons.filter(function (n) { return n.getAttribute('data-name') === 'a.txt' })[0]
  check(!!aIcon, '根目录存在 a.txt 图标')
  const aP = screen(parseInt(aIcon.style.left, 10) + 42, parseInt(aIcon.style.top, 10) + 38)
  viewportEl.dispatch('touchstart', tev('touchstart', [touch(1, aP.x, aP.y)]))
  viewportEl.dispatch('touchend', tev('touchend', [], [touch(1, aP.x, aP.y)]))
  await new Promise(function (r) { setTimeout(r, 350) })   // 越过双击窗口
  check(D.getSelectionNames().length === 1, '选中 a.txt')

  const writesBefore = layoutWrites.length
  viewportEl.dispatch('touchstart', tev('touchstart', [touch(1, aP.x, aP.y)]))
  viewportEl.dispatch('touchmove', tev('touchmove', [touch(1, aP.x + 20, aP.y + 20)]))
  viewportEl.dispatch('touchmove', tev('touchmove', [touch(1, aP.x + 150, aP.y + 150)]))
  viewportEl.dispatch('touchend', tev('touchend', [], [touch(1, aP.x + 150, aP.y + 150)]))

  check(D.getSelectionNames().length === 0, '拖动落盘后选中清空（无中断）')
  check(!aIcon.classList.contains('picked-up'), '拖动落盘后拿起态回收（无悬浮残留）')
  check(layoutWrites.length === writesBefore + 1, '拖动落盘成功保存一次布局')

  if (failures > 0) {
    console.error('  [FAIL] desktop-drop-stale-positions 测试 ' + failures + ' 项失败')
    process.exit(1)
  }
  console.log('  [ok] desktop-drop-stale-positions 测试全部通过')
})().catch(function (e) {
  console.error('ERROR:', e && e.stack || e)
  process.exit(1)
})
