// 桥契约锁测试：锁定 FileAPI 方法面与 FileBridge 桥方法的映射关系，
// 以及回调信封 {ok,data}/{ok,error} 与数据形状（FsEntry/RootInfo/AppEntry）。
// 人读版契约: docs/bridge-and-data-contract.md；本测试 = 其机器可读版，两处必须同步。
// 改桥签名未同步更新本测试 → 本测试变红，由 verify.sh 拦截提交。
// 用法: node test-bridge-contract.js [项目路径]   （由 run-tests.sh 调用）
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

// ── 契约表（人读版在 docs/bridge-and-data-contract.md，两处必须同步）──
// bridge = 桥方法名（FileBridge.java 的 @JavascriptInterface 方法）；args = 除 cbId 外的参数名
const CONTRACT = {
  rootInfo: { bridge: 'rootInfo', args: [] },
  list: { bridge: 'list', args: ['path'] },
  read: { bridge: 'read', args: ['path'] },
  write: { bridge: 'write', args: ['path', 'content'] },
  mkdir: { bridge: 'mkdir', args: ['path'] },
  del: { bridge: 'delete', args: ['path'] },
  rename: { bridge: 'rename', args: ['oldPath', 'newPath'] },
  copy: { bridge: 'copy', args: ['srcPath', 'dstPath'] },
  resolveUri: { bridge: 'resolveUri', args: ['path'] },
  thumb: { bridge: 'thumb', args: ['path'] },
  openExternal: { bridge: 'openExternal', args: ['path'] },
  openUrl: { bridge: 'openUrl', args: ['url'] },
  listApps: { bridge: 'listApps', args: [] },
  launchApp: { bridge: 'launchApp', args: ['pkg'] },
  appIcon: { bridge: 'appIcon', args: ['pkg'] }
}

// 各桥方法的成功返回样本（数据形状契约，用于验证前端透传不丢字段）
const FIXTURE = {
  rootInfo: { rootName: '存储', mode: 'saf', displayPath: '/saf/root', trashName: '.trash' },
  list: [{ name: 'a.txt', isDir: false, size: 12, mtime: 1700000000000 }],
  read: 'hello',
  write: true,
  mkdir: true,
  delete: true,
  rename: true,
  copy: true,
  resolveUri: 'file:///a.txt',
  thumb: 'file:///thumb.jpg',
  openExternal: true,
  openUrl: true,
  listApps: [{ package: 'com.x', label: 'X', isSystem: false }],
  launchApp: true,
  appIcon: 'data:image/png;base64,AAAA'
}

const source = fs.readFileSync(SRC, 'utf8')

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

const calls = []      // { bridge, args }（args 不含 cbId）
const responses = {}  // bridge → 信封（默认 {ok:true,data:FIXTURE[...]}，可被测试覆盖）

Object.keys(CONTRACT).forEach(function (frontKey) {
  const bridgeName = CONTRACT[frontKey].bridge
  sandbox.window.FileBridge = sandbox.window.FileBridge || {}
  sandbox.window.FileBridge[bridgeName] = function () {
    const args = Array.prototype.slice.call(arguments)
    const cbId = args.pop()
    calls.push({ bridge: bridgeName, args: args })
    const env = responses[bridgeName] || { ok: true, data: FIXTURE[bridgeName] }
    sandbox.window.__fbResolve(cbId, env)
  }
})

vm.createContext(sandbox)
vm.runInContext(source, sandbox, { filename: 'file-api.js' })

const FileAPI = sandbox.window.App.FileAPI

// 1. 方法面一致性：前端暴露的方法（除本地判断 hasBridge）与契约表一一对应
const exposed = Object.keys(FileAPI).filter(function (k) { return k !== 'hasBridge' }).sort()
const contractKeys = Object.keys(CONTRACT).sort()
check(JSON.stringify(exposed) === JSON.stringify(contractKeys),
  'FileAPI 方法面与契约表一致（' + exposed.join(',') + '）')

;(async function () {
  // 2. 桥方法名映射 + 参数个数（尤其 del → delete）
  for (const frontKey of Object.keys(CONTRACT)) {
    const c = CONTRACT[frontKey]
    const dummyArgs = c.args.map(function (_, i) { return 'arg' + i })
    await FileAPI[frontKey].apply(FileAPI, dummyArgs)
    const last = calls[calls.length - 1]
    check(last && last.bridge === c.bridge,
      frontKey + ' 调桥方法 ' + c.bridge)
    check(last && last.args.length === c.args.length,
      frontKey + ' 传参个数 ' + c.args.length + '（' + c.args.join(',') + '）')
  }

  // 3. 回调信封：error 字段透传为 reject 的 message
  responses['delete'] = { ok: false, error: '契约测试错误' }
  let rejected = false
  let rejectedMsg = ''
  try {
    await FileAPI.del('x.txt')
  } catch (e) {
    rejected = true
    rejectedMsg = e.message
  }
  check(rejected, 'error 信封触发 reject')
  check(rejectedMsg === '契约测试错误', 'error 字段透传（收到: ' + rejectedMsg + '）')
  delete responses['delete']

  // 4. 数据形状透传：FsEntry / RootInfo / AppEntry 字段完整
  const items = await FileAPI.list('')
  check(items.length === 1 && items[0].name === 'a.txt' && items[0].isDir === false &&
    items[0].size === 12 && typeof items[0].mtime === 'number',
    'FsEntry 四字段透传（name/isDir/size/mtime）')

  const root = await FileAPI.rootInfo()
  check(root.rootName === '存储' && root.mode === 'saf' &&
    typeof root.displayPath === 'string' && root.trashName === '.trash',
    'RootInfo 字段透传（rootName/mode/displayPath/trashName）')

  const apps = await FileAPI.listApps()
  check(apps.length === 1 && apps[0].package === 'com.x' && apps[0].label === 'X' &&
    apps[0].isSystem === false,
    'AppEntry 字段透传（package/label/isSystem）')

  if (failures > 0) {
    console.error('[fail] 桥契约锁测试失败 ' + failures + ' 项')
    process.exit(1)
  }
  console.log('[ok] 桥契约锁测试全部通过')
  process.exit(0)
})().catch(function (e) {
  console.error('[fail] 测试执行异常: ' + (e && e.message))
  process.exit(1)
})
