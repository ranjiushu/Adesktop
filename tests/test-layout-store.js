// layout-store.js 单元测试：localStorage 布局读写（文件即真相的临时方案）
// 用法: node test-layout-store.js [项目路径]   （由 run-tests.sh 调用）
'use strict'

const fs = require('fs')
const path = require('path')
const vm = require('vm')

const PROJECT = process.argv[2] || path.join(__dirname, '..')
const SRC = path.join(PROJECT, 'src', 'js', 'layout-store.js')

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
const store = {}
const localStorageStub = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null },
  setItem: function (k, v) { store[k] = String(v) },
  removeItem: function (k) { delete store[k] }
}

const sandbox = { App: {}, console: console, localStorage: localStorageStub }
vm.createContext(sandbox)
vm.runInContext(fs.readFileSync(SRC, 'utf8'), sandbox, { filename: 'layout-store.js' })

const S = sandbox.App.LayoutStore

// ── 空 store → load null ──
check(S.load() === null, '空 store load → null')

// ── save 后 load 往返 ──
const data = { version: 1, icons: { 'a.txt': { x: 116, y: 108 } }, camera: { x: 0, y: 0, zoom: 1 } }
check(S.save(data) === true, 'save 正常 → true')
const loaded = S.load()
check(loaded && loaded.icons['a.txt'].x === 116 && loaded.icons['a.txt'].y === 108, 'load 往返还原 icons 位置')
check(loaded && loaded.camera.zoom === 1, 'load 往返还原 camera')

// ── 脏数据 → load null ──
store[S.KEY] = 'not-json{{{'
check(S.load() === null, '脏 JSON load → null（回退默认）')

// ── 写入失败 → false ──
const throwingLs = {
  getItem: function () { return null },
  setItem: function () { throw new Error('quota') }
}
const sandbox2 = { App: {}, console: console, localStorage: throwingLs }
vm.createContext(sandbox2)
vm.runInContext(fs.readFileSync(SRC, 'utf8'), sandbox2, { filename: 'layout-store.js' })
check(sandbox2.App.LayoutStore.save(data) === false, 'setItem 抛异常 → save false（写入路径不吞错）')

if (failures > 0) {
  console.error('  [FAIL] layout-store 测试 ' + failures + ' 项失败')
  process.exit(1)
}
console.log('  [ok] layout-store 测试全部通过')
