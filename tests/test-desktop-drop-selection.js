// desktop.js 选中态生命周期集成测试（Windows 原则：选中态脆弱，动作后即失效）：
// 1. 移动完成（drop moved=true）→ 选中清空 + FAB 操作栏收起 + 落盘
// 2. 原地拿起放下（moved=false）→ 选中保留、不落盘
// 3. 拖动中取消（1→2 指 / touchcancel → single-cancel）→ 图标还原起始位、
//    拿起态回收、选中保留、不落盘（取消 = 什么都没发生）
// 驱动方式：真实 Desktop + 真实手势层（vm 最小 DOM stub），touch 事件走完整链路。
// 用法: node test-desktop-drop-selection.js [项目路径]   （由 run-tests.sh 调用）
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

// ── 最小 DOM stub（render + 手势监听）──
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
// viewport stub：可派发 touch 事件（gesture 层 addEventListener 收集）
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

// FileAPI 假桥
const fsTree = {
  '': [
    { name: 'docs', isDir: true, size: 0, mtime: 1 },
    { name: 'a.txt', isDir: false, size: 1, mtime: 2 }
  ]
}
let listCalls = []

const fabSelection = []        // fabSpeedDial.setSelection 调用记录
const layoutWrites = []        // localStorage.setItem 记录（真实 LayoutStore 经 localStorage 落盘）
const loadingCalls = { tag: [], hideTag: 0 }
const moveCalls = []           // moveIntoFolder 调用记录
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
  showTag: function (text) { loadingCalls.tag.push(text) },
  hideTag: function () { loadingCalls.hideTag++ },
  show: function () {},
  hide: function () {}
}
sandbox.App.Actions = {
  moveIntoFolder: function (entries, dirPath) { moveCalls.push({ entries: entries, dirPath: dirPath }) }
}
sandbox.App.FileAPI = {
  rootInfo: function () { return Promise.resolve({ rootName: 'Test', mode: 'private', displayPath: '内部存储/Test' }) },
  list: function (p) { listCalls.push(p || ''); return Promise.resolve((fsTree[p || ''] || []).slice()) }
}
sandbox.App.HomeStore = { load: function () { return null }, saveHome: function () { return true }, saveFallback: function () { return true } }
sandbox.App.ViewStore = { load: function () { return { viewStyle: 'grid', sortBy: 'name', sortDir: 1 } }, save: function () { return true } }
sandbox.App.ViewMenu = { setEnabled: function () {} }
sandbox.App.fabSpeedDial = { setSelection: function (has) { fabSelection.push(!!has) } }
sandbox.App.Drawer = { updatePath: function () {} }
sandbox.App.BottomBar = { updateNavButtons: function () {} }
sandbox.App.Clipboard = { isCut: function () { return false } }

vm.createContext(sandbox)
// 按 JS_ORDER 加载真实模块（desktop.js 依赖链完整；LayoutStore 为真实模块，经 localStorage stub 落盘）
for (const f of ['namespace.js', 'desktop-nav.js', 'double-tap.js', 'desktop-selection.js',
  'folder-sort.js', 'desktop-grid.js', 'folder-layout.js', 'layout-store.js', 'view-store.js',
  'home-store.js', 'desktop-camera.js', 'desktop-gesture.js', 'desktop.js']) {
  vm.runInContext(fs.readFileSync(path.join(SRC_DIR, f), 'utf8'), sandbox, { filename: f })
}

const D = sandbox.App.Desktop
function touch(id, x, y) { return { identifier: id, clientX: x, clientY: y } }
function tev(type, pts, changed) {
  return { type: type, touches: pts, changedTouches: changed || pts, preventDefault: function () {} }
}
// 屏幕坐标 → world（viewport top=56，camera (0,0,1)）
function screen(wx, wy) { return { x: wx, y: wy + 56 } }

;(async function () {
  D.initGesture()
  await D.refresh()
  check(createdIcons.length === 2, '根目录渲染 2 个图标')
  const docsIcon = createdIcons[0]   // docs 在 cell(0,0) = (16,16)

  // ── 单击选中 docs ──
  const p = screen(16 + 42, 16 + 38)   // docs 图标中心（世界坐标）
  viewportEl.dispatch('touchstart', tev('touchstart', [touch(1, p.x, p.y)]))
  viewportEl.dispatch('touchend', tev('touchend', [], [touch(1, p.x, p.y)]))
  check(D.getSelectionNames().length === 1 && D.getSelectionNames()[0] === 'docs', '单击选中 docs')
  check(fabSelection[fabSelection.length - 1] === true, '选中后 FAB 操作栏展开（setSelection(true)）')

  // ── 场景 1：拿起移动后放下（drop moved=true）→ 选中清空 + FAB 收起 + 落盘 ──
  const startLeft = docsIcon.style.left
  const startTop = docsIcon.style.top
  const writesBefore = layoutWrites.length
  viewportEl.dispatch('touchstart', tev('touchstart', [touch(1, p.x, p.y)]))
  viewportEl.dispatch('touchmove', tev('touchmove', [touch(1, p.x + 20, p.y + 20)]))   // 位移 > 6px → 直接拿起
  check(docsIcon.classList.contains('picked-up'), '拖动中图标进入拿起态（picked-up）')
  viewportEl.dispatch('touchmove', tev('touchmove', [touch(1, p.x + 120, p.y + 120)])) // 拖远（> 半格，确保吸附后换位）
  viewportEl.dispatch('touchend', tev('touchend', [], [touch(1, p.x + 120, p.y + 120)]))
  check(D.getSelectionNames().length === 0, '移动完成后选中清空（Windows 原则：选中态脆弱）')
  check(fabSelection[fabSelection.length - 1] === false, '移动完成后 FAB 操作栏收起（setSelection(false)）')
  check(!docsIcon.classList.contains('picked-up'), '放下后拿起态回收（无悬浮阴影）')
  check(layoutWrites.length === writesBefore + 1, '移动完成落盘一次（saveLayout → localStorage）')
  check(docsIcon.style.left !== startLeft || docsIcon.style.top !== startTop, '图标已移动到新位置')

  // ── 场景 2：原地拿起放下（drop moved=false）→ 选中保留、不落盘 ──
  await new Promise(function (r) { setTimeout(r, 350) })   // 越过双击窗口，避免误判双击打开
  const curP = screen(parseInt(docsIcon.style.left, 10) + 42, parseInt(docsIcon.style.top, 10) + 38)
  viewportEl.dispatch('touchstart', tev('touchstart', [touch(1, curP.x, curP.y)]))
  viewportEl.dispatch('touchend', tev('touchend', [], [touch(1, curP.x, curP.y)]))   // 先选中（若已被清）
  check(D.getSelectionNames().length === 1, '再次选中 docs')
  const writesBefore2 = layoutWrites.length
  viewportEl.dispatch('touchstart', tev('touchstart', [touch(1, curP.x, curP.y)]))
  await new Promise(function (r) { setTimeout(r, 550) })   // 长按拿起（pickedup，无位移）
  viewportEl.dispatch('touchend', tev('touchend', [], [touch(1, curP.x, curP.y)]))   // 原地放下
  check(D.getSelectionNames().length === 1, '原地放下（moved=false）选中保留')
  check(layoutWrites.length === writesBefore2, '原地放下不落盘')
  check(!docsIcon.classList.contains('picked-up'), '原地放下拿起态回收')

  // ── 场景 3：拖动中 touchcancel → single-cancel → 还原 + 选中保留 + 不落盘 ──
  const start2 = { left: docsIcon.style.left, top: docsIcon.style.top }
  const writesBefore3 = layoutWrites.length
  viewportEl.dispatch('touchstart', tev('touchstart', [touch(1, curP.x, curP.y)]))
  viewportEl.dispatch('touchmove', tev('touchmove', [touch(1, curP.x + 30, curP.y + 30)]))  // 拿起拖动
  check(docsIcon.classList.contains('picked-up'), '取消前处于拿起态')
  viewportEl.dispatch('touchcancel', tev('touchcancel', [touch(1, curP.x + 30, curP.y + 30)]))
  check(!docsIcon.classList.contains('picked-up'), '取消后拿起态回收（无悬浮阴影）')
  check(docsIcon.style.left === start2.left && docsIcon.style.top === start2.top, '取消后图标还原起始位')
  check(D.getSelectionNames().length === 1, '取消不清选中（取消 = 什么都没发生）')
  check(layoutWrites.length === writesBefore3, '取消不落盘')

  // ── 场景 4：拖入文件夹——拖动中命中文件夹 → 实时标签；松手 → moveIntoFolder ──
  // 场景 1 已把 docs 拖走，这里动态读取 docs 当前世界坐标（避免固定坐标失效）
  const docsIconNow = createdIcons.filter(function (n) { return n.getAttribute('data-name') === 'docs' })[0]
  const aIcon = createdIcons.filter(function (n) { return n.getAttribute('data-name') === 'a.txt' })[0]
  const aP = screen(parseInt(aIcon.style.left, 10) + 42, parseInt(aIcon.style.top, 10) + 38)
  // 选中 a.txt
  viewportEl.dispatch('touchstart', tev('touchstart', [touch(1, aP.x, aP.y)]))
  viewportEl.dispatch('touchend', tev('touchend', [], [touch(1, aP.x, aP.y)]))
  await new Promise(function (r) { setTimeout(r, 350) })
  check(D.getSelectionNames().length === 1 && D.getSelectionNames()[0] === 'a.txt', '场景4 选中 a.txt')
  // 拖到 docs 图标中心（动态坐标）
  const docsC = screen(parseInt(docsIconNow.style.left, 10) + 42, parseInt(docsIconNow.style.top, 10) + 38)
  loadingCalls.tag.length = 0; loadingCalls.hideTag = 0
  viewportEl.dispatch('touchstart', tev('touchstart', [touch(1, aP.x, aP.y)]))
  viewportEl.dispatch('touchmove', tev('touchmove', [touch(1, aP.x + 15, aP.y + 15)]))      // 位移 >6px → 拿起（drag-start）
  viewportEl.dispatch('touchmove', tev('touchmove', [touch(1, docsC.x, docsC.y)]))          // drag → 实时标签
  check(loadingCalls.tag.length > 0 && loadingCalls.tag[loadingCalls.tag.length - 1].indexOf('docs') >= 0,
    '拖动命中文件夹 → 实时标签「文件将移入 docs 文件夹」')
  // 松手 → moveIntoFolder 被调用
  moveCalls.length = 0
  viewportEl.dispatch('touchend', tev('touchend', [], [touch(1, docsC.x, docsC.y)]))
  check(moveCalls.length === 1, '松手命中文件夹 → 触发 moveIntoFolder')
  check(moveCalls[0] && moveCalls[0].dirPath === 'docs', 'moveIntoFolder 目标 = docs')
  check(moveCalls[0] && moveCalls[0].entries.length === 1 && moveCalls[0].entries[0].path === 'a.txt',
    'moveIntoFolder 携带 a.txt 完整路径')
  check(loadingCalls.hideTag > 0, '松手后隐藏实时标签')
  check(!docsIcon.classList.contains('picked-up'), '松手后拿起态回收')
  check(D.getSelectionNames().length === 0, '移动完成选中清空（Windows 原则）')

  // ── 场景 5：拖动未命中文件夹 → 不触发 moveIntoFolder（吸附排布）──
  await new Promise(function (r) { setTimeout(r, 350) })
  const aP2 = screen(parseInt(aIcon.style.left, 10) + 42, parseInt(aIcon.style.top, 10) + 38)
  viewportEl.dispatch('touchstart', tev('touchstart', [touch(1, aP2.x, aP2.y)]))
  viewportEl.dispatch('touchend', tev('touchend', [], [touch(1, aP2.x, aP2.y)]))
  await new Promise(function (r) { setTimeout(r, 350) })
  moveCalls.length = 0
  viewportEl.dispatch('touchstart', tev('touchstart', [touch(1, aP2.x, aP2.y)]))
  viewportEl.dispatch('touchmove', tev('touchmove', [touch(1, aP2.x + 150, aP2.y + 150)]))
  viewportEl.dispatch('touchend', tev('touchend', [], [touch(1, aP2.x + 150, aP2.y + 150)]))
  check(moveCalls.length === 0, '拖到空白 → 不触发 moveIntoFolder（吸附移动）')
  check(layoutWrites.length > 0, '拖到空白 → 落盘（位置移动）')

  // ── 场景 6：拖动中标签显示 → touchcancel 取消 → 标签必须回收（偶发残留修复点）──
  await new Promise(function (r) { setTimeout(r, 350) })
  // 场景 5 避让后 docs/a.txt 位置都变了——重新读取当前位置，不用过期的 docsC
  const docsIconNow6 = createdIcons.filter(function (n) { return n.getAttribute('data-name') === 'docs' })[0]
  const aIcon6 = createdIcons.filter(function (n) { return n.getAttribute('data-name') === 'a.txt' })[0]
  const aP3 = screen(parseInt(aIcon6.style.left, 10) + 42, parseInt(aIcon6.style.top, 10) + 38)
  const docsC6 = screen(parseInt(docsIconNow6.style.left, 10) + 42, parseInt(docsIconNow6.style.top, 10) + 38)
  // 预选中 a.txt（否则 touchmove 走框选而非拿起）
  viewportEl.dispatch('touchstart', tev('touchstart', [touch(1, aP3.x, aP3.y)]))
  viewportEl.dispatch('touchend', tev('touchend', [], [touch(1, aP3.x, aP3.y)]))
  await new Promise(function (r) { setTimeout(r, 350) })
  check(D.getSelectionNames().length === 1, '场景6 预选中 a.txt')
  loadingCalls.tag.length = 0; loadingCalls.hideTag = 0
  viewportEl.dispatch('touchstart', tev('touchstart', [touch(1, aP3.x, aP3.y)]))
  viewportEl.dispatch('touchmove', tev('touchmove', [touch(1, aP3.x + 15, aP3.y + 15)]))
  viewportEl.dispatch('touchmove', tev('touchmove', [touch(1, docsC6.x, docsC6.y)]))   // 命中文件夹 → 标签显示
  check(loadingCalls.tag.length > 0, '场景6 拖动命中文件夹 → 标签已显示')
  viewportEl.dispatch('touchcancel', tev('touchcancel', [touch(1, docsC6.x, docsC6.y)]))
  check(loadingCalls.hideTag > 0, 'touchcancel 取消 → 标签回收（不残留）')

  // ── 场景 7：folder 视图（子文件夹内）移入文件夹——长按拿起 + 拖到文件夹图标 → moveIntoFolder ──
  // 进入 docs（folder 视图，grid 4 列）：docs 内 b.txt（第 1 格）+ 子文件夹 sub（第 2 格）
  // 用 fsTree 扩展：docs 下含文件夹 sub 和文件 b.txt
  // 先改 fsTree 注入 sub 文件夹
  fsTree['docs'] = [
    { name: 'sub', isDir: true, size: 0, mtime: 5 },
    { name: 'b.txt', isDir: false, size: 1, mtime: 3 }
  ]
  D.enterFolder('docs')
  await D.refresh()
  check(D.getCurPath() === 'docs', '场景7 进入 docs（folder 视图）')
  const subIcon = createdIcons.filter(function (n) { return n.getAttribute('data-name') === 'sub' })[0]
  const bIcon = createdIcons.filter(function (n) { return n.getAttribute('data-name') === 'b.txt' })[0]
  check(!!subIcon && !!bIcon, '场景7 docs 渲染 sub 文件夹 + b.txt')
  // b.txt 长按拿起（500ms）→ 拖到 sub 上 → 松手 moveIntoFolder
  const bP = screen(parseInt(bIcon.style.left, 10) + 42, parseInt(bIcon.style.top, 10) + 38)
  const subC = screen(parseInt(subIcon.style.left, 10) + 42, parseInt(subIcon.style.top, 10) + 38)
  viewportEl.dispatch('touchstart', tev('touchstart', [touch(1, bP.x, bP.y)]))
  await new Promise(function (r) { setTimeout(r, 550) })   // 长按 500ms → pickedup
  check(bIcon.classList.contains('picked-up'), '场景7 长按拿起 b.txt（folder 视图）')
  moveCalls.length = 0
  viewportEl.dispatch('touchmove', tev('touchmove', [touch(1, subC.x, subC.y)]))
  viewportEl.dispatch('touchend', tev('touchend', [], [touch(1, subC.x, subC.y)]))
  check(moveCalls.length === 1, '场景7 松手命中文件夹 → moveIntoFolder')
  check(moveCalls[0] && moveCalls[0].dirPath === 'docs/sub', '场景7 moveIntoFolder 目标 = docs/sub')
  check(moveCalls[0] && moveCalls[0].entries.length === 1 && moveCalls[0].entries[0].path === 'docs/b.txt',
    '场景7 moveIntoFolder 携带 docs/b.txt')

  if (failures > 0) {
    console.error('  [FAIL] desktop-drop-selection 选中态生命周期测试 ' + failures + ' 项失败')
    process.exit(1)
  }
  console.log('  [ok] desktop-drop-selection 选中态生命周期测试全部通过')
})().catch(function (e) {
  console.error('ERROR:', e && e.stack || e)
  process.exit(1)
})
