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
  delete: function (p, cbId) { bridgeCalls.push(['delete', p]); sandbox.window.__fbResolve(cbId, { ok: false, error: '模拟失败' }) },
  copy: function (s, d, cbId) { bridgeCalls.push(['copy', s, d, cbId]); setTimeout(function () { sandbox.window.__fbResolve(cbId, { ok: true, data: true }) }, 30) },
  move: function (s, d, cbId) { bridgeCalls.push(['move', s, d]); sandbox.window.__fbResolve(cbId, { ok: true, data: true }) },
  cancelTransfer: function (cbId) { bridgeCalls.push(['cancelTransfer']); sandbox.window.__fbResolve(cbId, { ok: true, data: true }) }
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

  // 5. copy 桥调用（阶段 C 粘贴基础操作）
  const copyResult = await FileAPI.copy('a.txt', 'a 2.txt')
  check(copyResult === true, 'copy 返回 true')
  const copyCall = bridgeCalls.filter(function (c) { return c[0] === 'copy' })
  check(copyCall.length === 1 && copyCall[0][1] === 'a.txt' && copyCall[0][2] === 'a 2.txt',
    'copy 桥参数 (src, dst) 正确')

  // 6. move 桥调用（剪切粘贴/拖入文件夹/移入回收站共用；真移动在桥层，前端只透传）
  const moveResult = await FileAPI.move('a.txt', 'b.txt')
  check(moveResult === true, 'move 返回 true')
  const moveCall = bridgeCalls.filter(function (c) { return c[0] === 'move' })
  check(moveCall.length === 1 && moveCall[0][1] === 'a.txt' && moveCall[0][2] === 'b.txt',
    'move 桥参数 (src, dst) 正确')

  // 7. cancelTransfer 桥调用（取消当前传输）
  const cancelResult = await FileAPI.cancelTransfer()
  check(cancelResult === true, 'cancelTransfer 返回 true')
  const cancelCall = bridgeCalls.filter(function (c) { return c[0] === 'cancelTransfer' })
  check(cancelCall.length === 1, 'cancelTransfer 桥调用一次')

  // 8. 进度回调：桥层 __fbProgress → 透传 onProgress（不 resolve Promise）
  const progPayload = { path: 'a.txt', done: 123456, total: 500000 }
  const progressSeen = []
  let progressResolved = false
  const markBefore = bridgeCalls.length
  FileAPI.copy('a.txt', 'a 2.txt', function (p) { progressSeen.push(p) }).then(function () {
    progressResolved = true
  })
  // 桥桩延迟 30ms resolve → 此窗口内推送进度（pending 尚在）
  await new Promise(function (r) { setTimeout(r, 5) })
  const progressCall = bridgeCalls.slice(markBefore).filter(function (c) { return c[0] === 'copy' })
  check(progressCall.length === 1 && progressCall[0].length === 4,
    'copy 带 onProgress → 桥调用仍为 (src, dst, cbId) 三参 + 记录位（onProgress 不进桥签名）')
  sandbox.window.__fbProgress(progressCall[0][3], progPayload)
  check(progressSeen.length === 1 && progressSeen[0].path === 'a.txt' &&
    progressSeen[0].done === 123456 && progressSeen[0].total === 500000,
    '__fbProgress 透传到 onProgress（path/done/total）')
  check(progressResolved === false, '进度回调不 resolve Promise（仅刷新 UI）')
  await new Promise(function (r) { setTimeout(r, 50) })
  check(progressResolved === true, '随后桥 resolve 正常完成（进度推送不干扰结果）')

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
