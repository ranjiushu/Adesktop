// view-store.js 单元测试：视图偏好持久化（读写/损坏回退/字段校验）
// 用法: node test-view-store.js [项目路径]   （由 run-tests.sh 调用）
'use strict'

const fs = require('fs')
const path = require('path')
const vm = require('vm')

const PROJECT = process.argv[2] || path.join(__dirname, '..')
const SRC = path.join(PROJECT, 'src', 'js', 'view-store.js')

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
const sandbox = {
  App: {},
  console: console,
  localStorage: {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null },
    setItem: function (k, v) { store[k] = String(v) },
    removeItem: function (k) { delete store[k] }
  }
}
vm.createContext(sandbox)
vm.runInContext(fs.readFileSync(SRC, 'utf8'), sandbox, { filename: 'view-store.js' })

const V = sandbox.App.ViewStore

// ── 无数据 → 默认 ──
let p = V.load()
check(p.viewStyle === 'grid' && p.sortBy === 'name' && p.sortDir === 1, '无数据回退默认（grid/name/升序）')

// ── 正常保存/读取 ──
check(V.save({ viewStyle: 'list', sortBy: 'mtime', sortDir: -1 }) === true, 'save 成功返回 true')
p = V.load()
check(p.viewStyle === 'list' && p.sortBy === 'mtime' && sortDir(p) === -1, '读取保存的偏好（list/mtime/降序）')
function sortDir(p) { return p.sortDir }

// ── 损坏数据回退默认 ──
store[V.KEY] = 'not-json{{{'
p = V.load()
check(p.sortBy === 'name', '损坏 JSON 回退默认')
store[V.KEY] = JSON.stringify({ viewStyle: 'carousel', sortBy: 'name', sortDir: 1 })
p = V.load()
check(p.viewStyle === 'grid', '非法 viewStyle 回退默认')
store[V.KEY] = JSON.stringify({ viewStyle: 'grid', sortBy: 'magic', sortDir: 1 })
p = V.load()
check(p.sortBy === 'name', '非法 sortBy 回退默认')
store[V.KEY] = JSON.stringify({ viewStyle: 'grid', sortBy: 'name', sortDir: 99 })
p = V.load()
check(p.sortDir === 1, '非法 sortDir 回退默认')

// ── 空串 / null ──
store[V.KEY] = ''
p = V.load()
check(p.sortBy === 'name', '空串回退默认')
delete store[V.KEY]
p = V.load()
check(p.viewStyle === 'grid', '键不存在回退默认')

if (failures > 0) {
  console.error('  [FAIL] view-store 测试 ' + failures + ' 项失败')
  process.exit(1)
}
console.log('  [ok] view-store 测试全部通过')
