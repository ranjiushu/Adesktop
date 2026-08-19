// bridge.js 单元测试：vm 加载真实模块，验证原生桥调用走 window.FileBridge（防命名空间错位回归）
// 背景：曾误用 Android.*（MainActivity 只注册 FileBridge），导致切换根目录/震动在真机失效
// 用法: node test-bridge.js [项目路径]   （由 run-tests.sh 调用）
'use strict'

const fs = require('fs')
const path = require('path')
const vm = require('vm')

const PROJECT = process.argv[2] || path.join(__dirname, '..')
const SRC = path.join(PROJECT, 'src', 'js', 'bridge.js')

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

// ── 有桥环境：window.FileBridge 桩 ──
const sandbox = {
  App: {},
  window: { App: null, FileBridge: null },
  navigator: { vibrate: null },
  console: console
}
sandbox.App = sandbox.window.App = sandbox.App
sandbox.window.window = sandbox.window

const bridgeCalls = []
let navFallback = 0
sandbox.window.FileBridge = {
  vibrate: function (ms) { bridgeCalls.push(['vibrate', ms]) },
  requestRootAccess: function () { bridgeCalls.push(['requestRootAccess']) },
  requestDesktopDir: function () { bridgeCalls.push(['requestDesktopDir']) }
}
sandbox.navigator.vibrate = function () { navFallback++ }

vm.createContext(sandbox)
vm.runInContext(source, sandbox)

const bridge = sandbox.window.App.bridge

// 1. vibrate 走 FileBridge（而非 Android.*），且不落 navigator 兜底
bridge.vibrate(20)
check(bridgeCalls.length === 1 && bridgeCalls[0][0] === 'vibrate' && bridgeCalls[0][1] === 20,
  'vibrate 调用 window.FileBridge.vibrate')
check(navFallback === 0, 'vibrate 未落 navigator 兜底（桥存在时优先桥）')

// 2. requestRootAccess 走 FileBridge 且返回 true
const ok = bridge.requestRootAccess()
check(ok === true, 'requestRootAccess 返回 true')
check(bridgeCalls.length === 2 && bridgeCalls[1][0] === 'requestRootAccess',
  'requestRootAccess 调用 window.FileBridge.requestRootAccess')

// 3. requestDesktopDir 走 FileBridge 且返回 true
const dirOk = bridge.requestDesktopDir()
check(dirOk === true, 'requestDesktopDir 返回 true')
check(bridgeCalls.length === 3 && bridgeCalls[2][0] === 'requestDesktopDir',
  'requestDesktopDir 调用 window.FileBridge.requestDesktopDir')

// ── 无桥环境：浏览器预览降级 ──
const bare = {
  App: {},
  window: { App: null, FileBridge: null },
  navigator: { vibrate: function () {} },
  console: console
}
bare.App = bare.window.App = bare.App
bare.window.window = bare.window
vm.createContext(bare)
vm.runInContext(source, bare)

// 3. 无桥时 requestRootAccess 返回 false（App.Actions 据此提示环境不支持）
check(bare.window.App.bridge.requestRootAccess() === false, '无桥环境 requestRootAccess 返回 false')

// 4. 无桥时 requestDesktopDir 返回 false
check(bare.window.App.bridge.requestDesktopDir() === false, '无桥环境 requestDesktopDir 返回 false')

// 5. 无桥时 vibrate 降级 navigator.vibrate 不抛异常
let navCalled = false
bare.navigator.vibrate = function () { navCalled = true }
bare.window.App.bridge.vibrate(15)
check(navCalled === true, '无桥环境 vibrate 降级 navigator.vibrate')

if (failures > 0) {
  console.error('[fail] bridge 测试失败 ' + failures + ' 项')
  process.exit(1)
}
console.log('[ok] bridge 测试全部通过')
process.exit(0)
