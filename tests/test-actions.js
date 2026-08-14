// actions.js 编排层单元测试：新建（重名序号）/ 重命名（重名预检）/ 复制剪切粘贴
// 链路，vm 加载真实 actions.js + clipboard.js，桩 FileAPI/Desktop/toast。
// 用法: node test-actions.js [项目路径]   （由 run-tests.sh 调用）
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
  list: [], mkdir: [], write: [], rename: [], copy: [], del: [],
  refresh: 0, clearSelection: 0, toasts: [], applyRename: 0,
  progress: [], hideProgress: 0
}
let listResult = []       // FileAPI.list 返回
let copyShouldReject = false

function resetCalls() {
  calls.list.length = 0; calls.mkdir.length = 0; calls.write.length = 0
  calls.rename.length = 0; calls.copy.length = 0; calls.del.length = 0
  calls.refresh = 0; calls.clearSelection = 0; calls.toasts.length = 0
  calls.applyRename = 0; calls.progress.length = 0; calls.hideProgress = 0
}

const sandbox = {
  App: {},
  console: console,
  setTimeout: setTimeout,
  Promise: Promise
}
vm.createContext(sandbox)

// 先加载真实 clipboard.js（纯函数），actions.js 依赖它
vm.runInContext(fs.readFileSync(path.join(SRC, 'clipboard.js'), 'utf8'), sandbox,
  { filename: 'clipboard.js' })

// 桩依赖
sandbox.App.FileAPI = {
  list: function (p) { calls.list.push(p || ''); return Promise.resolve(listResult) },
  mkdir: function (p) { calls.mkdir.push(p); return Promise.resolve(true) },
  write: function (p, c) { calls.write.push([p, c]); return Promise.resolve(true) },
  rename: function (o, n) { calls.rename.push([o, n]); return Promise.resolve(true) },
  copy: function (s, d) {
    calls.copy.push([s, d])
    return copyShouldReject ? Promise.reject(new Error('磁盘空间不足')) : Promise.resolve(true)
  },
  del: function (p) { calls.del.push(p); return Promise.resolve(true) }
}
sandbox.App.Desktop = {
  getCurPath: function () { return '' },
  refresh: function () { calls.refresh++ },
  clearSelection: function () { calls.clearSelection++ },
  applyRename: function (o, n) { calls.applyRename++; calls.rename.push([o, n]) }
}
sandbox.App.toast = {
  show: function (m) { calls.toasts.push(m) }
}
sandbox.App.Loading = {
  progress: function (label, done, total) { calls.progress.push([label, done, total]) },
  hideProgress: function () { calls.hideProgress++ }
}

vm.runInContext(fs.readFileSync(path.join(SRC, 'actions.js'), 'utf8'), sandbox,
  { filename: 'actions.js' })

const A = sandbox.App.Actions
const C = sandbox.App.Clipboard
const tick = function () { return new Promise(function (r) { setTimeout(r, 20) }) }

async function main() {
  // ── 新建文件夹：默认名 + 重名序号 ──
  resetCalls(); listResult = []
  A.createFolder('')
  await tick()
  check(calls.mkdir.length === 1 && calls.mkdir[0] === '新建文件夹',
    'createFolder 空名 → mkdir(新建文件夹)')
  check(calls.refresh === 1, 'createFolder 后 refresh')
  check(calls.toasts.some(function (t) { return t.indexOf('已创建文件夹') === 0 }),
    'createFolder toast 成功')

  // ── 新建文件夹：重名自动加序号 ──
  resetCalls(); listResult = [{ name: '新建文件夹', isDir: true }]
  A.createFolder('')
  await tick()
  check(calls.mkdir.length === 1 && calls.mkdir[0] === '新建文件夹 2',
    'createFolder 重名 → 新建文件夹 2')

  // ── 新建文件：默认名 ──
  resetCalls(); listResult = []
  A.createFile('')
  await tick()
  check(calls.write.length === 1 && calls.write[0][0] === '新建文件' && calls.write[0][1] === '',
    'createFile 空名 → write(新建文件, "")')
  check(calls.toasts.some(function (t) { return t.indexOf('已创建文件') === 0 }),
    'createFile toast 成功')

  // ── 新建文件：重名序号拆主名/扩展名 ──
  resetCalls(); listResult = [{ name: '报告.txt', isDir: false }]
  A.createFile('报告.txt')
  await tick()
  check(calls.write.length === 1 && calls.write[0][0] === '报告 2.txt',
    'createFile 重名 → 报告 2.txt（扩展名保留）')

  // ── 重命名：正常路径（预检通过 → 桥 rename + applyRename）──
  resetCalls(); listResult = []
  A.rename('a.txt', 'b.txt')
  await tick()
  check(calls.rename.some(function (c) { return c[0] === 'a.txt' && c[1] === 'b.txt' }),
    'rename 无冲突 → FileAPI.rename(a.txt, b.txt)')
  check(calls.applyRename === 1, 'rename 后调用 Desktop.applyRename')
  check(calls.toasts.some(function (t) { return t.indexOf('已重命名') === 0 }),
    'rename toast 成功')

  // ── 重命名：目标重名 → 拒绝，桥不调用（P1 修复点）──
  resetCalls(); listResult = [{ name: 'b.txt', isDir: false }]
  A.rename('a.txt', 'b.txt')
  await tick()
  check(!calls.rename.some(function (c) { return c[0] === 'a.txt' }),
    'rename 重名 → 桥 rename 不被调用（先查后改）')
  check(calls.applyRename === 0, 'rename 重名 → applyRename 不被调用')
  check(calls.toasts.some(function (t) { return t.indexOf('重命名失败') === 0 }),
    'rename 重名 → toast 失败（含原因）')

  // ── 子目录内重命名：预检查目标目录（oldPath 父目录），非当前目录 ──
  resetCalls(); listResult = []   // docs 下无同名 → 通过
  A.rename('docs/a.txt', 'docs/b.txt')
  await tick()
  check(calls.list.length === 1 && calls.list[0] === 'docs',
    'rename 子目录 → 预检 list(docs)（目标目录）')
  check(calls.rename.some(function (c) { return c[0] === 'docs/a.txt' && c[1] === 'docs/b.txt' }),
    'rename 子目录无冲突 → 桥调用完整路径')

  // ── 复制：只写剪贴板，文件不动 ──
  resetCalls(); C.clear()
  A.copySelection([{ path: 'a.txt', isDir: false }])
  const cbCopy = C.get()
  check(cbCopy && cbCopy.mode === 'copy' && cbCopy.entries.length === 1,
    'copySelection → 剪贴板 mode=copy')
  check(calls.copy.length === 0, 'copySelection 不触发桥 copy（Windows 模型）')
  check(calls.toasts.some(function (t) { return t.indexOf('已复制 1 项') === 0 }),
    'copySelection toast')

  // ── 剪切：写剪贴板 + refresh 渲染半透明标记 ──
  resetCalls(); C.clear()
  A.cutSelection([{ path: 'a.txt', isDir: false }])
  const cbCut = C.get()
  check(cbCut && cbCut.mode === 'cut', 'cutSelection → 剪贴板 mode=cut')
  check(calls.refresh === 1, 'cutSelection 后 refresh（渲染源标记）')
  check(C.isCut('a.txt') === true, 'cutSelection 源路径 isCut 标记')

  // ── 粘贴：剪贴板为空 → 拒绝 ──
  resetCalls(); C.clear()
  A.paste()
  await tick()
  check(calls.copy.length === 0, 'paste 空剪贴板 → 不 copy')
  check(calls.toasts.some(function (t) { return t.indexOf('剪贴板为空') === 0 }),
    'paste 空剪贴板 toast')

  // ── 粘贴：copy 模式（目标重名加序号 + 保留剪贴板）──
  resetCalls(); C.clear()
  C.set('copy', [{ path: 'docs/a.txt', isDir: false }, { path: 'docs/sub', isDir: true }])
  listResult = [{ name: 'a.txt', isDir: false }]   // 当前目录已有 a.txt → a 2.txt
  A.paste()
  await tick()
  check(calls.copy.length === 2, 'paste copy 模式 → 2 个 copy 作业')
  check(calls.copy[0][0] === 'docs/a.txt' && calls.copy[0][1] === 'a 2.txt',
    'paste copy 重名 → a.txt → a 2.txt')
  check(calls.copy[1][0] === 'docs/sub' && calls.copy[1][1] === 'sub',
    'paste copy 目录条目 → docs/sub → sub')
  check(calls.del.length === 0, 'paste copy 模式不删源')
  check(C.has() === true, 'paste copy 模式保留剪贴板（可多次粘贴）')
  check(calls.toasts.some(function (t) { return t.indexOf('已粘贴 2 项') === 0 }),
    'paste copy toast 已粘贴 2 项')
  check(calls.clearSelection === 1 && calls.refresh === 1, 'paste 后清选中 + refresh')

  // ── 粘贴：cut 模式（copy+delete 源 = 移动；清剪贴板）──
  resetCalls(); C.clear()
  C.set('cut', [{ path: 'a.txt', isDir: false }])
  listResult = []
  A.paste()
  await tick()
  check(calls.copy.length === 1 && calls.copy[0][1] === 'a.txt', 'paste cut → copy 到目标')
  check(calls.del.length === 1 && calls.del[0] === 'a.txt', 'paste cut → del 源（移动语义）')
  check(C.has() === false, 'paste cut 后清剪贴板')
  check(calls.toasts.some(function (t) { return t.indexOf('已移动 1 项') === 0 }),
    'paste cut toast 已移动 1 项')

  // ── 粘贴：copy 失败 → 告警 + 已成功计数 ──
  resetCalls(); C.clear()
  C.set('copy', [{ path: 'a.txt', isDir: false }, { path: 'b.txt', isDir: false }])
  listResult = []
  copyShouldReject = true
  A.paste()
  await tick()
  copyShouldReject = false
  check(calls.toasts.some(function (t) {
    return t.indexOf('粘贴失败: 磁盘空间不足') === 0
  }), 'paste copy 失败 → toast 含错误原因')
  check(calls.clearSelection === 1 && calls.refresh === 1, 'paste 失败也清选中 + refresh')

  // ── 多文件进度：progress 推进 + 完成自动隐藏 ──
  resetCalls(); C.clear()
  C.set('copy', [{ path: 'a.txt', isDir: false }, { path: 'b.txt', isDir: false }])
  listResult = []
  A.paste()
  await tick()
  check(calls.progress.length === 3, '多文件 paste → progress 3 次（0/2、1/2、2/2），实际 ' + calls.progress.length)
  check(calls.progress[0][0] === '正在粘贴' && calls.progress[0][2] === 2,
    'progress 起始 label=正在粘贴 total=2')
  check(calls.progress[2][1] === 2, 'progress 末次 done=2（完成）')
  check(calls.hideProgress === 1, '完成 → hideProgress 一次')

  // ── moveIntoFolder：移动语义（copy+del 源）+ 不清剪贴板 ──
  resetCalls(); C.clear()
  C.set('copy', [{ path: 'x.txt', isDir: false }])   // 预置无关剪贴板
  listResult = []                                     // 目标文件夹 docs 内无同名
  A.moveIntoFolder([{ path: 'a.txt', isDir: false }], 'docs')
  await tick()
  check(calls.list.length >= 1 && calls.list[0] === 'docs',
    'moveIntoFolder → list(docs) 检查目标目录')
  check(calls.copy.length === 1 && calls.copy[0][0] === 'a.txt' && calls.copy[0][1] === 'docs/a.txt',
    'moveIntoFolder → copy(a.txt, docs/a.txt)')
  check(calls.del.length === 1 && calls.del[0] === 'a.txt', 'moveIntoFolder → del 源（移动语义）')
  check(C.has() === true, 'moveIntoFolder 不清剪贴板（keepClipboard）')
  check(calls.toasts.some(function (t) { return t.indexOf('已移动 1 项') === 0 }),
    'moveIntoFolder toast 已移动 1 项')
  check(calls.clearSelection === 1 && calls.refresh === 1, 'moveIntoFolder 后清选中 + refresh')

  if (failures > 0) {
    console.error('  [FAIL] actions 测试 ' + failures + ' 项失败')
    process.exit(1)
  }
  console.log('  [ok] actions 测试全部通过')
}

main().catch(function (e) {
  console.error('  [FAIL] actions 测试异常: ' + (e && e.stack || e))
  process.exit(1)
})
