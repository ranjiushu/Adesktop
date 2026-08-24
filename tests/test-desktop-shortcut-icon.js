// desktop-render 快捷方式图标稳定性回归测试：
// 复现「首次进桌面能显示真图标，一旦重渲染就回落类型图标」的 bug。
//
// 根因：render() 在把 card appendChild 进 grid **之前**就调用 requestShortcutIcon；
// 其同模块对缓存 ready 的条目会**同步**触发 onReady。此时 icon.parentNode 还是 null，
// setThumbImg 的 if(icon.parentNode) 守卫把它跳过 → 图标保持 svgFor('shortcut') 类型占位。
// 首次渲染因「cache miss → 异步读文件」，读完后 DOM 已挂载所以能显示；重渲染命中 ready
// 缓存 → 同步 onReady → 跳过 → 回落类型图标（正是"显示不稳定"）。
//
// 本测试用 parentNode 感知的 DOM 桩 + 可控 Thumbnail 桩（首次异步 miss / 后续同步 ready）：
//   1) 首次 render（miss→异步）→ 图标应为真图标 img
//   2) 二次 render（ready→同步）→ 图标仍应为真图标 img（不回落类型占位）
// 用法: node test-desktop-shortcut-icon.js [项目路径]   （由 run-tests.sh 调用）
'use strict'

const fs = require('fs')
const path = require('path')
const vm = require('vm')

const PROJECT = process.argv[2] || path.join(__dirname, '..')
const SRC = path.join(PROJECT, 'src', 'js')

let failures = 0
function check(cond, msg) {
  if (cond) console.log('  [ok] ' + msg)
  else { console.error('  [fail] ' + msg); failures++ }
}

function makeClassList() {
  return {
    _set: {},
    add: function (c) { this._set[c] = true },
    remove: function (c) { delete this._set[c] },
    contains: function (c) { return !!this._set[c] }
  }
}
// 最小 DOM 元素：appendChild 记录 parentNode（这是本测试的关键——setThumbImg 依赖 parentNode）
function makeEl(tag) {
  const el = {
    tagName: (tag || 'div').toUpperCase(),
    className: '', textContent: '', style: {}, _html: '', _attrs: {},
    children: [], parentNode: null, classList: makeClassList(),
    offsetWidth: 84, offsetHeight: 76,
    setAttribute: function (k, v) { this._attrs[k] = v },
    getAttribute: function (k) { return this._attrs[k] },
    appendChild: function (node) { node.parentNode = this; this.children.push(node); return node },
    get innerHTML() { return this._html },
    set innerHTML(v) { this._html = v; this.children = [] }
  }
  return el
}

// 桌面 grid：appendChild 跟踪建出的图标卡片
const gridEl = makeEl('div')
gridEl.appendChild = function (node) { node.parentNode = gridEl; gridEl.children.push(node); createdIcons.push(node); return node }
let createdIcons = []
const els = {
  'desktop-grid': gridEl,
  'desktop-viewport': { clientWidth: 412, clientHeight: 700 },
  'desktop-canvas': { style: {}, classList: makeClassList() },
  'desktop-marquee': { style: {} }
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
    createElement: function (tag) { return makeEl(tag) }
  },
  localStorage: { getItem: function () { return null }, setItem: function () {} },
  navigator: {}
}
sandbox.window = sandbox
sandbox.App.bridge = { vibrate: function () {} }
sandbox.App.toast = { show: function () {} }
sandbox.App.TypeIcons = {
  kindFor: function (name, isDir) { return /\.desktop$/i.test(name) ? 'shortcut' : (isDir ? 'folder' : 'text') },
  svgFor: function (kind) { return '<svg>' + kind + '</svg>' },
  iconFor: function () { return '<svg></svg>' },
  kindSvg: function (kind) { return '<svg>' + kind + '</svg>' }
}
sandbox.App.Shortcut = { isShortcutName: function (name) { return /\.desktop$/i.test(name) } }
sandbox.App.Clipboard = { isCut: function () { return false } }
sandbox.App.DesktopViewerLink = {
  isDesktopEntityPath: function () { return false }
}
sandbox.App.DesktopGrid = {
  GRID_W: 100, GRID_H: 92,
  cellToWorld: function (c, r) { return { x: 16 + c * 100, y: 16 + r * 92 } }
}
sandbox.App.fabSpeedDial = { setSelection: function () {} }
sandbox.App.DesktopNavigation = { applyCameraForPath: function () {} }

// 可控 Thumbnail 桩：首次 requestShortcutIcon 异步（cache miss → 读文件）；之后同步（cache ready）。
// 用 onReady 的调用是否同步来模拟真实 Thumbnail 的「ready 立即回调」路径。
const ICON_URI = 'data:image/svg+xml;utf8,' + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='48' height='48'><rect width='48' height='48' fill='#e11d48'/></svg>")
let shortcutRequestCount = 0
sandbox.App.Thumbnail = {
  canThumbnail: function () { return false },
  request: function () {},
  requestShortcutIcon: function (path, onReady, onFallback) {
    shortcutRequestCount++
    if (shortcutRequestCount === 1) {
      // 首次：cache miss → 异步读文件（模拟真实读盘延迟）
      setTimeout(function () { onReady(ICON_URI) }, 0)
    } else {
      // 之后：cache ready → **同步**回调（这是 bug 的关键触发条件）
      onReady(ICON_URI)
    }
  }
}

vm.createContext(sandbox)
for (const f of ['namespace.js', 'desktop-nav.js', 'desktop-core.js', 'desktop-render.js']) {
  vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), sandbox, { filename: f })
}

const C = sandbox.App.DesktopCore
const R = sandbox.App.DesktopRender

function glyphIconState() {
  // 找当前挂载的快捷方式图标（.desktop-entry），读其 glyph 内的 img
  const card = createdIcons.length ? createdIcons[createdIcons.length - 1] : null
  // 在真实 DOM 里，icon 是 card 的子节点；这里 card.children[0] 即 icon glyph
  const glyph = card && card.children[0]
  if (!glyph) return { hasImg: false, hasSvg: false }
  return {
    hasImg: !!(glyph.children && glyph.children.find(function (n) { return n.tagName === 'IMG' && n.className === 'desktop-icon-thumb' })),
    hasSvg: /<svg>shortcut<\/svg>/.test(glyph.innerHTML)
  }
}

;(async function main() {
  // 桌面空间（根目录 ''，非 folder 视图）
  C.state.mode = 'private'
  C.state.curPath = ''
  C.state.desktopRoot = ''
  C.state.rootName = 'Test'
  C.state.trashName = ''
  C.state.items = [{ name: 'xy.desktop', isDir: false, size: 10, mtime: 1 }]
  C.positions = {}
  C.bounds = {}
  C.iconEls = {}
  C.selection = new Set()

  // ── 首次 render：miss → 异步读 → 真图标 img ──
  R.render()
  await new Promise(function (r) { setTimeout(r, 30) })  // 等异步 onReady + 图标应用
  const s1 = glyphIconState()
  check(s1.hasImg, '首次渲染：快捷方式显示真图标 img（异步读后应用）')
  check(!s1.hasSvg, '首次渲染：未回落类型占位')

  // ── 二次 render：cache ready → **同步** onReady ──
  R.render()
  await new Promise(function (r) { setTimeout(r, 30) })  // 等修复的延迟应用（setTimeout 0）
  const s2 = glyphIconState()
  check(s2.hasImg, '二次渲染：仍显示真图标 img（不回落）')
  check(!s2.hasSvg, '二次渲染：未回落类型占位（修复生效）')

  if (failures > 0) {
    console.error('  [FAIL] desktop-shortcut-icon 测试 ' + failures + ' 项失败')
    process.exit(1)
  }
  console.log('  [ok] desktop-shortcut-icon 测试全部通过')
})().catch(function (e) {
  console.error('  [FAIL] desktop-shortcut-icon 测试异常: ' + (e && e.stack || e))
  process.exit(1)
})
