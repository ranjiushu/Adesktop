// FileAPI 单元测试：vm 加载真实 file-api.js + 桩桥，验证 Promise 封装与回调协议
// 用法: node test-fileapi.js [项目路径]   （由 run-tests.sh 调用）
'use strict'

const fs = require('fs')
const path = require('path')
const vm = require('vm')

const PROJECT = process.argv[2] || path.join(__dirname, '..')
const SRC = path.join(PROJECT, 'src', 'js', 'file-api.js')

let failures = 0
function check(cond, msg) {
  if (cond) {
    console.log('  [ok] ' + msg)
  } else {
    console.error('  [fail] ' + msg)
    failures++
  }
}

const source = fs.readFileSync(SRC, 'utf8')

// ── 沙盒：window.__fbResolve 由 file-api.js 运行时注册，桥经 sandbox.window 间接调用 ──
const sandbox = {
  App: {},
  window: { App: null, FileBridge: null, __fbResolve: null },
  Promise: Promise,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  Error: Error,
  console: console
}
sandbox.App = sandbox.window.App = sandbox.App
sandbox.window.window = sandbox.window

const bridgeCalls = []
sandbox.window.FileBridge = {
  list: function (p, cbId) { bridgeCalls.push(['list', p]); sandbox.window.__fbResolve(cbId, { ok: true, data: [{ name: 'a.txt', isDir: false }] }) },
  read: function (p, cbId) { bridgeCalls.push(['read', p]); sandbox.window.__fbResolve(cbId, { ok: true, data: 'hello' }) },
  write: function (p, c, cbId) { bridgeCalls.push(['write', p]); sandbox.window.__fbResolve(cbId, { ok: true, data: true }) },
  delete: function (p, cbId) { bridgeCalls.push(['delete', p]); sandbox.window.__fbResolve(cbId, { ok: false, error: '模拟失败' }) }
}

vm.createContext(sandbox)
vm.runInContext(source, sandbox)

const FileAPI = sandbox.window.App.FileAPI

;(async function () {
  // 1. list 成功路径
  const items = await FileAPI.list('')
  check(items.length === 1 && items[0].name === 'a.txt', 'list 返回数据')
  check(bridgeCalls[0][0] === 'list' && bridgeCalls[0][1] === '', 'list 桥调用参数正确')

  // 2. read 成功路径
  const content = await FileAPI.read('a.txt')
  check(content === 'hello', 'read 返回内容')

  // 3. 错误路径 reject
  let rejected = false
  try {
    await FileAPI.del('x.txt')
  } catch (e) {
    rejected = true
    check(e.message === '模拟失败', '错误透传: ' + e.message)
  }
  check(rejected, '错误路径 reject')

  // 4. 无桥环境 reject
  const bare = { App: {}, window: { App: null }, Promise: Promise, setTimeout: setTimeout, Error: Error }
  bare.App = bare.window.App = bare.App
  bare.window.window = bare.window
  vm.createContext(bare)
  vm.createContext(bare)
  vm.runInContext(source, bare)
  let bridgeRejected = false
  try {
    await bare.window.App.FileAPI.list('')
  } catch (e) {
    bridgeRejected = true
    check(/FileBridge 不可用/.test(e.message), '无桥环境明确报错')
  }
  check(bridgeRejected, '无桥环境 reject')

  if (failures > 0) {
    console.error('[fail] FileAPI 测试失败 ' + failures + ' 项')
    process.exit(1)
  }
  console.log('[ok] FileAPI 测试全部通过')
  process.exit(0)
})().catch(function (e) {
  console.error('[fail] 测试执行异常: ' + (e && e.message))
  process.exit(1)
})
