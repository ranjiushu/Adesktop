// desktop.js 真实 applyRename 集成测试（P2b 修复：原 test-rename-key.js 测的是
// 等价纯函数副本，与实现脱节；本测试 vm 加载真实 desktop.js，验证：
//   1) positions/bounds 布局 key 迁移（重命名后不丢位置）
//   2) saveLayout 落盘（LayoutStore.save 收到迁移后的 icons）
//   3) refresh 后图标仍在原世界坐标（端到端效果）
// selection 迁移与 positions 同构（闭包私有，无注入点），规则由代码评审确认。
// 用法: node test-desktop-applyrename.js [项目路径]   （由 run-tests.sh 调用）
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

// ── 最小 DOM stub（参考 test-desktop-nav-dom.js）──
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
    set innerHTML(v) { el._html = v; el.children = [] },
    appendChild: function (node) { el.children.push(node) }
  }
  return el
}
const gridEl = makeGridEl()
const els = {
  'desktop-grid': gridEl,
  'desktop-viewport': { clientWidth: 412, clientHeight: 700 },
  'desktop-canvas': { style: {}, classList: makeClassList() },
  'desktop-marquee': { style: {} }
}
const documentStub = {
  getElementById: function (id) { return els[id] || null },
  createElement: function () {
    return {
      offsetWidth: 84, offsetHeight: 76,
      classList: makeClassList(),
      style: {}, appendChild: function () {},
      _attrs: {},
      setAttribute: function (k, v) { this._attrs[k] = v },
      getAttribute: function (k) { return this._attrs[k] }
    }
  }
}

// ── 沙箱 ──
let savedLayout = null       // LayoutStore.save 捕获
const fileItems = [
  { name: 'b.txt', isDir: false, size: 10, mtime: 1 },
  { name: 'c.txt', isDir: false, size: 20, mtime: 2 }
]

const sandbox = {
  App: {},
  document: documentStub,
  console: console,
  setTimeout: setTimeout,
  Promise: Promise,
  requestAnimationFrame: function () { return 1 },
  cancelAnimationFrame: function () {},
  performance: { now: function () { return Date.now() } },
  Date: Date
}
vm.createContext(sandbox)

// 真实 desktop-nav.js（fullPath 依赖 DesktopNav.join）
vm.runInContext(fs.readFileSync(path.join(SRC, 'desktop-nav.js'), 'utf8'), sandbox,
  { filename: 'desktop-nav.js' })

// 桩依赖
sandbox.App.LayoutStore = {
  load: function () {
    return { version: 1, icons: { 'a.txt': { x: 100, y: 100 }, 'c.txt': { x: 200, y: 200 } }, camera: { x: 0, y: 0, zoom: 1 } }
  },
  save: function (data) { savedLayout = data; return true }
}
sandbox.App.HomeStore = { load: function () { return null } }
sandbox.App.ViewStore = { load: function () { return { viewStyle: 'grid', sortBy: 'name', sortDir: 1 } } }
sandbox.App.DesktopCamera = { create: function () { return { x: 0, y: 0, zoom: 1 } } }
sandbox.App.DesktopGrid = {
  GRID_W: 84,
  cellToWorld: function (c, r) { return { x: c * 84, y: r * 76 } }
}
sandbox.App.Clipboard = { isCut: function () { return false } }
sandbox.App.FileAPI = {
  rootInfo: function () { return Promise.resolve({ rootName: 'root', mode: 'private', displayPath: '/data/root' }) },
  list: function () { return Promise.resolve(fileItems) }
}
sandbox.App.Drawer = { updatePath: function () {} }
sandbox.App.BottomBar = { updateNavButtons: function () {} }
sandbox.App.toast = { show: function () {} }
sandbox.App.bridge = { vibrate: function () {} }
sandbox.App.ViewMenu = { setEnabled: function () {} }
sandbox.App.DesktopGesture = { init: function () {}, setCamera: function () {} }

vm.runInContext(fs.readFileSync(path.join(SRC, 'desktop-core.js'), 'utf8'), sandbox,
  { filename: 'desktop-core.js' })
vm.runInContext(fs.readFileSync(path.join(SRC, 'desktop.js'), 'utf8'), sandbox,
  { filename: 'desktop.js' })

const D = sandbox.App.Desktop
const tick = function () { return new Promise(function (r) { setTimeout(r, 20) }) }

async function main() {
  // 注入布局：initGesture 内部 initLayout 从 LayoutStore.load 读入
  // positions = { 'a.txt': {100,100}, 'c.txt': {200,200} }
  D.initGesture()

  // 重命名 a.txt → b.txt
  D.applyRename('a.txt', 'b.txt')

  // 1) 落盘：saveLayout 同步执行，icons 已迁移
  check(!!savedLayout, 'applyRename → saveLayout 被调用')
  check(savedLayout && savedLayout.icons['b.txt'] &&
    savedLayout.icons['b.txt'].x === 100 && savedLayout.icons['b.txt'].y === 100,
    '布局 key 迁移：b.txt 继承 a.txt 位置 {100,100}')
  check(savedLayout && !savedLayout.icons['a.txt'], '布局 key 迁移：a.txt 已移除')
  check(savedLayout && savedLayout.icons['c.txt'] &&
    savedLayout.icons['c.txt'].x === 200,
    '未重命名条目不受影响：c.txt 保持 {200,200}')

  // 2) 端到端：refresh（applyRename 内部触发）后图标仍在原世界坐标
  await tick()
  const bIcon = gridEl.children.find(function (n) { return n._attrs['data-path'] === 'b.txt' })
  const cIcon = gridEl.children.find(function (n) { return n._attrs['data-path'] === 'c.txt' })
  check(!!bIcon && bIcon.style.left === '100px' && bIcon.style.top === '100px',
    'refresh 后 b.txt 渲染在 {100,100}（不丢位置，未回退自动排布）')
  check(!!cIcon && cIcon.style.left === '200px' && cIcon.style.top === '200px',
    'refresh 后 c.txt 仍在 {200,200}')
  check(gridEl.children.length === 2, 'render 恰好 2 个图标')

  // 3) 相同位置重命名（no-op 防御）
  D.applyRename('b.txt', 'b.txt')
  check(savedLayout && savedLayout.icons['b.txt'], '同名重命名 no-op，布局不被破坏')

  // 4) 批量布局迁移 applyMoves（移动后）：src 布局 key → dst，不 refresh，可多文件
  savedLayout = null
  // 移动 b.txt → sub/b.txt（含子目录）；c.txt 不动
  D.applyMoves([{ src: 'b.txt', dst: 'sub/b.txt' }, { src: 'not-exist.txt', dst: 'x.txt' }])
  check(!!savedLayout, 'applyMoves → saveLayout 被调用（有迁移时）')
  check(savedLayout && savedLayout.icons['sub/b.txt'] &&
    savedLayout.icons['sub/b.txt'].x === 100 && savedLayout.icons['sub/b.txt'].y === 100,
    'applyMoves 迁移：sub/b.txt 继承 b.txt 位置 {100,100}')
  check(savedLayout && !savedLayout.icons['b.txt'], 'applyMoves 迁移：b.txt 旧 key 已移除')
  check(savedLayout && savedLayout.icons['c.txt'] &&
    savedLayout.icons['c.txt'].x === 200,
    'applyMoves 不动条目：c.txt 保持 {200,200}')
  check(savedLayout && !savedLayout.icons['x.txt'],
    'applyMoves 无布局条目：not-exist.txt 迁移不产生新 key')

  // 5) applyMoves 空/无效列表 → 不 saveLayout（无变更）
  savedLayout = null
  D.applyMoves([])
  check(savedLayout === null, 'applyMoves 空列表 → 不 saveLayout')
  D.applyMoves([{ src: 'c.txt', dst: 'c.txt' }])
  check(savedLayout === null, 'applyMoves src=dst → 不 saveLayout（no-op）')

  if (failures > 0) {
    console.error('  [FAIL] desktop-applyrename 测试 ' + failures + ' 项失败')
    process.exit(1)
  }
  console.log('  [ok] desktop-applyrename 测试全部通过')
}

main().catch(function (e) {
  console.error('  [FAIL] desktop-applyrename 测试异常: ' + (e && e.stack || e))
  process.exit(1)
})
