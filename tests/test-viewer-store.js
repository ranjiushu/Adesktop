// viewer-store.js 单元测试：保存/加载往返、无效记录过滤、localStorage 缓存、
// 隐藏文件写入（文件即真相）、rootId 隔离
// 用法: node test-viewer-store.js [项目路径]   （由 run-tests.sh 调用）
'use strict'

const fs = require('fs')
const path = require('path')
const vm = require('vm')

const PROJECT = process.argv[2] || path.join(__dirname, '..')
const NS_SRC = path.join(PROJECT, 'src', 'js', 'namespace.js')
const VS_SRC = path.join(PROJECT, 'src', 'js', 'viewer-store.js')

let failures = 0
function check(cond, msg) {
  if (cond) {
    console.log('  [ok] ' + msg)
  } else {
    console.error('  [fail] ' + msg)
    failures++
  }
}

// localStorage stub
let store = {}
const ls = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null },
  setItem: function (k, v) { store[k] = String(v) },
  removeItem: function (k) { delete store[k] }
}

// 文件写入记录（FileAPI.write stub）
let writes = []

const sandbox = {
  App: {},
  console: console,
  localStorage: ls,
  window: { App: {} }
}
vm.createContext(sandbox)
vm.runInContext(fs.readFileSync(NS_SRC, 'utf8'), sandbox, { filename: 'namespace.js' })
sandbox.App.DesktopCore = { state: { curPath: '' } }
sandbox.App.FileAPI = {
  write: function (filePath, content) {
    writes.push({ filePath: filePath, content: content })
    return Promise.resolve(true)
  }
}
vm.runInContext(fs.readFileSync(VS_SRC, 'utf8'), sandbox, { filename: 'viewer-store.js' })
const VS = sandbox.App.ViewerStore

const rec1 = { path: '/a.txt', name: 'a.txt', kind: 'text', rect: { x: 100, y: 200, w: 240, h: 320 } }
const rec2 = { path: '/b.png', name: 'b.png', kind: 'image', rect: { x: 400, y: 100, w: 300, h: 200 } }

// ── 空 store → 空 viewers ──
store = {}
let d = VS.load('rootV')
check(d && d.version === 1 && Array.isArray(d.viewers) && d.viewers.length === 0, '空 store load → version 1 + 空 viewers')

// ── 保存 → load 往返 ──
store = {}
writes = []
VS.save([rec1, rec2], 'rootV')
d = VS.load('rootV')
check(d.viewers.length === 2, '保存 2 条 → load 2 条')
check(d.viewers[0].path === '/a.txt' && d.viewers[0].rect.x === 100 && d.viewers[0].rect.w === 240, '记录字段完整（path/kind/rect）')
check(d.viewers[1].kind === 'image', '第二条 kind 保留')
check(store['desktop.viewers.rootV.v1'] !== undefined, 'localStorage 缓存写入（desktop.viewers.rootV.v1）')
check(writes.length === 1 && writes[0].filePath === '.adesktop-viewers.json', '隐藏文件写入（文件即真相，curPath 空 → 根级）')
check(JSON.parse(writes[0].content).viewers.length === 2, '文件内容为完整 viewers 列表')

// ── curPath 非空 → 文件写入路径带目录前缀 ──
store = {}
writes = []
sandbox.App.DesktopCore.state.curPath = 'Desktop'
VS.save([rec1], 'rootV2')
check(writes.length === 1 && writes[0].filePath === 'Desktop/.adesktop-viewers.json', 'curPath 前缀写入（Desktop/.adesktop-viewers.json）')

// ── rootId 隔离 ──
store = {}
VS.save([rec1], 'rootA')
VS.save([rec2], 'rootB')
check(VS.load('rootA').viewers.length === 1 && VS.load('rootA').viewers[0].path === '/a.txt', 'rootA 只含自己的记录')
check(VS.load('rootB').viewers.length === 1 && VS.load('rootB').viewers[0].path === '/b.png', 'rootB 只含自己的记录')

// ── 无效记录过滤 ──
store = {}
store['desktop.viewers.badRoot.v1'] = JSON.stringify({
  version: 1,
  viewers: [
    rec1,
    { path: '', name: 'x', kind: 'text', rect: { x: 1, y: 2, w: 3, h: 4 } },            // 空 path
    { path: '/y.txt', name: 'y', kind: 'text', rect: null },                            // 缺 rect
    { path: '/z.txt', name: 'z', kind: 'text', rect: { x: 0, y: 0, w: 0, h: 0 } },      // 零尺寸
    { path: '/m.txt', name: 'm', kind: 'text', rect: { x: 'a', y: 1, w: 2, h: 3 } },    // 非数字
    { path: '/n.txt', name: 'n', kind: 'text', rect: { x: 1, y: 2, w: 3, h: 4 }, extra: 'ignored' }
  ]
})
d = VS.load('badRoot')
check(d.viewers.length === 2 && d.viewers[0].path === '/a.txt' && d.viewers[1].path === '/n.txt', '无效记录过滤（空 path/缺 rect/零尺寸/非数字），合法 2 条保留')
check(d.viewers[1].extra === undefined, '多余字段剥离（只留 path/name/kind/rect）')

// ── 非对象/损坏数据 → 空 ──
store = {}
store['desktop.viewers.corrupt.v1'] = '{oops'
d = VS.load('corrupt')
check(d.viewers.length === 0, '损坏 JSON → 空 viewers（不抛）')
store = {}
store['desktop.viewers.str.v1'] = JSON.stringify('just a string')
d = VS.load('str')
check(d.viewers.length === 0, '非对象数据 → 空 viewers')

// ── keyFor ──
check(VS.keyFor('') === 'desktop.viewers.legacy.v1', '空 rootId → legacy key')
check(VS.keyFor('rk') === 'desktop.viewers.rk.v1', 'rootId key 格式 desktop.viewers.<rootId>.v1')

if (failures > 0) {
  console.error('  [FAIL] viewer-store 测试 ' + failures + ' 项失败')
  process.exit(1)
}
console.log('  [ok] viewer-store 测试全部通过')
