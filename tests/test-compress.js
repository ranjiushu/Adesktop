// compressSelection 编排层单元测试：命名规划（归一/序号）/ 级别映射 / 单独压缩调度 /
// 取消停止调度 / 压缩后删除源（进回收站，只删成功项）/ 守卫（锁定·回收站·非法名），
// vm 加载真实 actions.js + clipboard.js，桩 FileAPI/Desktop/Loading/toast。
// 用法: node test-compress.js [项目路径]   （由 run-tests.sh 调用）
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

// ── 沙箱：App + 桩依赖（每用例前 resetCalls 重置记录）──
const calls = {
  list: [], compress: [], move: [], toasts: [], show: [], hide: 0,
  refresh: 0, clearSelection: 0, cancelTransfer: 0
}
let listResult = []            // FileAPI.list 返回（目标目录现有条目）
let compressFailIdx = -1       // 第 N 次 compress 调用失败（0 基，-1 = 全成功）
let cancelOnFirstProgress = false
let lockedPaths = []

function resetCalls() {
  calls.list.length = 0; calls.compress.length = 0; calls.move.length = 0
  calls.toasts.length = 0; calls.show.length = 0
  calls.hide = 0; calls.refresh = 0; calls.clearSelection = 0; calls.cancelTransfer = 0
  compressFailIdx = -1
  cancelOnFirstProgress = false
  lockedPaths = []
}

function makeElStub() {
  return {
    _children: [], className: '', textContent: '', style: {}, _attrs: {},
    innerHTML: '', appendChild: function () {}, setAttribute: function () {},
    classList: { add: function () {}, remove: function () {}, contains: function () { return false } }
  }
}
const failEls = {
  'transfer-fail-overlay': makeElStub(),
  'transfer-fail-list': makeElStub(),
  'transfer-fail-summary': makeElStub(),
  'transfer-fail-ok': makeElStub()
}
const documentStub = {
  getElementById: function (id) { return failEls[id] || null },
  createElement: function () { return makeElStub() }
}

const sandbox = {
  App: {},
  document: documentStub,
  console: console,
  setTimeout: setTimeout,
  Promise: Promise
}
vm.createContext(sandbox)

// 先加载真实 clipboard.js（uniqueName/planPaste 为纯函数），actions.js 依赖它
vm.runInContext(fs.readFileSync(path.join(SRC, 'clipboard.js'), 'utf8'), sandbox,
  { filename: 'clipboard.js' })

sandbox.App.FileAPI = {
  list: function (p) { calls.list.push(p || ''); return Promise.resolve(listResult) },
  compress: function (srcPaths, dstPath, level, onProgress) {
    const idx = calls.compress.length
    calls.compress.push({ srcPaths: srcPaths, dstPath: dstPath, level: level })
    if (typeof onProgress === 'function') {
      onProgress({ path: 'a.txt', done: 1, total: 2 })
      // 取消复现：第一次 onProgress 时同步点取消（Loading.onCancel 由编排层注册）；
      // 真实桥层取消 = 当前归档中止 + 清理半成品并报「操作已取消」，不会成功返回
      if (cancelOnFirstProgress && idx === 0) {
        const last = calls.show[calls.show.length - 1]
        if (last && typeof last.onCancel === 'function') last.onCancel()
        return Promise.reject(new Error('操作已取消'))
      }
    }
    return idx === compressFailIdx
      ? Promise.reject(new Error('模拟压缩失败')) : Promise.resolve(true)
  },
  cancelTransfer: function () { calls.cancelTransfer++; return Promise.resolve(true) },
  move: function (s, d, onProgress) {
    calls.move.push([s, d])
    return Promise.resolve(true)
  }
}
sandbox.App.Desktop = {
  getCurPath: function () { return '' },
  refresh: function () { calls.refresh++ },
  clearSelection: function () { calls.clearSelection++ },
  getTrashName: function () { return '.trash' },
  isTrashPath: function (p) { return p === '.trash' },
  getLockedPaths: function () { return lockedPaths }
}
sandbox.App.toast = {
  show: function (m) { calls.toasts.push(m) }
}
sandbox.App.Dialog = {
  open: function () {}, close: function () {}
}
sandbox.App.utils = {
  bindPress: function () {}
}
sandbox.App.Loading = {
  show: function (opts) { calls.show.push(opts) },
  hide: function () { calls.hide++ }
}

vm.runInContext(fs.readFileSync(path.join(SRC, 'actions.js'), 'utf8'), sandbox,
  { filename: 'actions.js' })

const A = sandbox.App.Actions
const tick = function () { return new Promise(function (r) { setTimeout(r, 20) }) }

async function main() {
  // ── 整包：默认名归一（缺 .zip 补上）+ 级别映射（normal → 6）──
  resetCalls(); listResult = []
  A.compressSelection([{ path: 'docs/报告.txt', isDir: false }],
    { name: 'abc', level: 'normal', separate: false, deleteAfter: false })
  await tick()
  check(calls.compress.length === 1 &&
    calls.compress[0].dstPath === 'abc.zip' &&
    calls.compress[0].srcPaths.length === 1 &&
    calls.compress[0].srcPaths[0] === 'docs/报告.txt',
    '整包：abc → abc.zip（补 .zip），srcPaths 含完整相对路径')
  check(calls.compress[0].level === 6, '级别映射 normal → 6')
  check(calls.toasts.some(function (t) { return t.indexOf('已创建压缩文件') === 0 }), '整包成功 toast')

  // ── 名称归一：已有 .zip 不重复加；空名回退「压缩包」──
  resetCalls(); listResult = []
  A.compressSelection([{ path: 'a.txt', isDir: false }],
    { name: 'x.ZIP', level: 'fast', separate: false, deleteAfter: false })
  await tick()
  check(calls.compress.length === 1 && calls.compress[0].dstPath === 'x.ZIP' &&
    calls.compress[0].level === 1,
    '已有 .zip 后缀不重复追加（大小写不敏感）；级别映射 fast → 1')
  resetCalls(); listResult = []
  A.compressSelection([{ path: 'a.txt', isDir: false }],
    { name: '   ', level: 'best', separate: false, deleteAfter: false })
  await tick()
  check(calls.compress.length === 1 && calls.compress[0].dstPath === '压缩包.zip' &&
    calls.compress[0].level === 9,
    '空名回退 压缩包.zip；级别映射 best → 9')

  // ── 仅存储：store → -1 ──
  resetCalls(); listResult = []
  A.compressSelection([{ path: 'a.txt', isDir: false }],
    { name: 's.zip', level: 'store', separate: false, deleteAfter: false })
  await tick()
  check(calls.compress.length === 1 && calls.compress[0].level === -1, '级别映射 store → -1（仅存储）')

  // ── 重名自动加序号（与 create/paste 同一命名入口 uniqueName）──
  resetCalls(); listResult = [{ name: 'a.zip', isDir: false }, { name: 'a 2.zip', isDir: true }]
  A.compressSelection([{ path: 'a.txt', isDir: false }],
    { name: 'a.zip', level: 'normal', separate: false, deleteAfter: false })
  await tick()
  check(calls.compress.length === 1 && calls.compress[0].dstPath === 'a 3.zip',
    '重名自动加序号：a.zip → a 3.zip')

  // ── 非法名（含路径分隔符）拒绝，桥不调用 ──
  resetCalls(); listResult = []
  A.compressSelection([{ path: 'a.txt', isDir: false }],
    { name: 'sub/x.zip', level: 'normal', separate: false, deleteAfter: false })
  await tick()
  check(calls.compress.length === 0 &&
    calls.toasts.some(function (t) { return t.indexOf('路径分隔符') > 0 }),
    '文件名含 / → 拒绝，compress 不调用')

  // ── 单独压缩：每项各出一个 <主名>.zip，规划名互不相同 ──
  resetCalls(); listResult = []
  A.compressSelection([
    { path: 'a.txt', isDir: false },
    { path: 'a.md', isDir: false },
    { path: 'sub', isDir: true }
  ], { name: 'ignored.zip', level: 'normal', separate: true, deleteAfter: false })
  await tick()
  check(calls.compress.length === 3 &&
    calls.compress[0].dstPath === 'a.zip' && calls.compress[0].srcPaths.length === 1 &&
    calls.compress[1].dstPath === 'a 2.zip' && calls.compress[1].srcPaths.length === 1 &&
    calls.compress[2].dstPath === 'sub.zip',
    '单独压缩：a.txt/a.md/sub → a.zip / a 2.zip / sub.zip（同名拆主名加序号）')

  // ── 压缩后删除源：整包成功 → 全部源走删除管道进回收站（move 到 .trash/…）──
  resetCalls(); listResult = []
  A.compressSelection([
    { path: 'a.txt', isDir: false },
    { path: 'sub', isDir: true }
  ], { name: 'pack.zip', level: 'normal', separate: false, deleteAfter: true })
  await tick()
  check(calls.compress.length === 1 && calls.move.length === 2 &&
    calls.move.every(function (m) { return m[1].indexOf('.trash/') === 0 }),
    '压缩后删除源：整包成功 → 2 项均移入回收站（.trash/…）')
  check(calls.toasts.some(function (t) { return t.indexOf('已删除') === 0 }), '删除源走删除管道（toast 已删除）')

  // ── 压缩后删除源：未勾选不动源 ──
  resetCalls(); listResult = []
  A.compressSelection([{ path: 'a.txt', isDir: false }],
    { name: 'p.zip', level: 'normal', separate: false, deleteAfter: false })
  await tick()
  check(calls.move.length === 0, '未勾选删除源 → 不移动任何源')

  // ── 压缩后删除源：单独压缩一项失败 → 只删归档成功的源（失败项源保留可重试）──
  resetCalls(); listResult = []
  compressFailIdx = 1
  A.compressSelection([
    { path: 'a.txt', isDir: false },
    { path: 'b.txt', isDir: false }
  ], { name: 'ignored.zip', level: 'normal', separate: true, deleteAfter: true })
  await tick()
  check(calls.compress.length === 2 && calls.move.length === 1 &&
    calls.move[0][0] === 'a.txt',
    '部分失败：只删归档成功的源（b.txt 源保留）')
  check(calls.toasts.some(function (t) { return t.indexOf('失败 1 项') > 0 }), '失败汇总 toast')

  // ── 取消：第一次进度回调点取消 → 剩余归档不再启动，取消 ≠ 失败 ──
  resetCalls(); listResult = []
  cancelOnFirstProgress = true
  A.compressSelection([
    { path: 'a.txt', isDir: false },
    { path: 'b.txt', isDir: false },
    { path: 'c.txt', isDir: false }
  ], { name: 'ignored.zip', level: 'normal', separate: true, deleteAfter: true })
  await tick()
  check(calls.compress.length === 1 && calls.cancelTransfer === 1,
    '取消后剩余归档不再启动（3 项只启动 1 项）+ cancelTransfer 只发一次')
  check(calls.move.length === 0, '取消场景不删除任何源')
  check(calls.toasts.some(function (t) { return t.indexOf('已取消') > 0 }), '取消结束态 toast（取消 ≠ 失败）')

  // ── 守卫：锁定文件（正在预览）拒绝 ──
  resetCalls(); listResult = []
  lockedPaths = ['a.txt']
  A.compressSelection([{ path: 'a.txt', isDir: false }],
    { name: 'p.zip', level: 'normal', separate: false, deleteAfter: false })
  await tick()
  check(calls.compress.length === 0 &&
    calls.toasts.some(function (t) { return t.indexOf('锁定') > 0 }), '锁定文件拒绝压缩')

  // ── 守卫：回收站自身不可压缩 ──
  resetCalls(); listResult = []
  A.compressSelection([{ path: '.trash', isDir: true }],
    { name: 'p.zip', level: 'normal', separate: false, deleteAfter: false })
  await tick()
  check(calls.compress.length === 0 &&
    calls.toasts.some(function (t) { return t.indexOf('回收站') >= 0 }), '回收站自身不可压缩')

  // ── 压缩失败：toast 失败 + 不删除源 ──
  resetCalls(); listResult = []
  compressFailIdx = 0
  A.compressSelection([{ path: 'a.txt', isDir: false }],
    { name: 'p.zip', level: 'normal', separate: false, deleteAfter: true })
  await tick()
  check(calls.move.length === 0 &&
    calls.toasts.some(function (t) { return t.indexOf('失败 1 项') > 0 }),
    '整包失败：源保留（不删除）+ 失败汇总')

  if (failures > 0) {
    console.error('[fail] compressSelection 测试失败 ' + failures + ' 项')
    process.exit(1)
  }
  console.log('[ok] compressSelection 测试全部通过')
  process.exit(0)
}

main().catch(function (e) {
  console.error('[fail] 测试执行异常: ' + (e && e.message))
  process.exit(1)
})
