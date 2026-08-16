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
  list: [], mkdir: [], write: [], rename: [], copy: [], del: [], move: [],
  refresh: 0, clearSelection: 0, toasts: [], applyRename: 0, applyMoves: 0,
  show: [], hide: 0, dialogOpens: []
}
let listResult = []       // FileAPI.list 返回
let copyShouldReject = false
let moveShouldReject = false
let cancelOnFirstProgress = false   // P0 复现：第一个 onProgress 时同步触发取消

function resetCalls() {
  calls.list.length = 0; calls.mkdir.length = 0; calls.write.length = 0
  calls.rename.length = 0; calls.copy.length = 0; calls.del.length = 0; calls.move.length = 0
  calls.refresh = 0; calls.clearSelection = 0; calls.toasts.length = 0
  calls.applyRename = 0; calls.applyMoves = 0; calls.show.length = 0; calls.hide = 0
  calls.dialogOpens.length = 0
  calls.cancelTransfer = 0
  cancelOnFirstProgress = false
}

// ── document 桩（失败汇总弹窗）：元素桩记录 innerHTML/子节点，Dialog.open 可断言 ──
function makeElStub() {
  const el = {
    _children: [], className: '', textContent: '', style: {}, _attrs: {},
    set innerHTML(v) { el._html = v },
    get innerHTML() { return el._html || '' },
    appendChild: function (n) { el._children.push(n) },
    setAttribute: function (k, v) { el._attrs[k] = v },
    classList: { add: function () {}, remove: function () {}, contains: function () { return false } }
  }
  return el
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

// 先加载真实 clipboard.js（纯函数），actions.js 依赖它
vm.runInContext(fs.readFileSync(path.join(SRC, 'clipboard.js'), 'utf8'), sandbox,
  { filename: 'clipboard.js' })

// 桩依赖
sandbox.App.FileAPI = {
  list: function (p) { calls.list.push(p || ''); return Promise.resolve(listResult) },
  mkdir: function (p) { calls.mkdir.push(p); return Promise.resolve(true) },
  write: function (p, c) { calls.write.push([p, c]); return Promise.resolve(true) },
  rename: function (o, n) { calls.rename.push([o, n]); return Promise.resolve(true) },
  copy: function (s, d, onProgress) {
    calls.copy.push([s, d])
    if (typeof onProgress === 'function') onProgress({ path: d, done: 100, total: 200 })
    return copyShouldReject ? Promise.reject(new Error('磁盘空间不足')) : Promise.resolve(true)
  },
  del: function (p) { calls.del.push(p); return Promise.resolve(true) },
  move: function (s, d, onProgress) {
    calls.move.push([s, d])
    if (typeof onProgress === 'function') {
      onProgress({ path: d, done: 50, total: 100 })
      // P0 复现：第一个 onProgress 时同步触发取消（模拟用户在传输中点取消）
      if (cancelOnFirstProgress && calls.move.length === 1) {
        const last = calls.show[calls.show.length - 1]
        if (last && typeof last.onCancel === 'function') last.onCancel()
      }
    }
    return moveShouldReject ? Promise.reject(new Error('模拟移动失败')) : Promise.resolve(true)
  },
  cancelTransfer: function () { calls.cancelTransfer = (calls.cancelTransfer || 0) + 1; return Promise.resolve(true) }
}
sandbox.App.Desktop = {
  getCurPath: function () { return '' },
  refresh: function () { calls.refresh++ },
  clearSelection: function () { calls.clearSelection++ },
  applyRename: function (o, n) { calls.applyRename++; calls.rename.push([o, n]) },
  applyMoves: function (moves) { calls.applyMoves++; calls.lastMoves = moves },
  getTrashName: function () { return '.trash' },
  isTrashPath: function (p) { return p === '.trash' },
  getLockedPaths: function () { return [] }
}
sandbox.App.toast = {
  show: function (m) { calls.toasts.push(m) }
}
sandbox.App.Dialog = {
  open: function (id) { calls.dialogOpens.push(id) },
  close: function () {}
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

  // ── [P1] 新建文件与同名文件夹冲突：name 单键（类型不豁免）──
  // 修复前 actions._uniqueName 用 name+isDir 双匹配 → 文件夹「报告.txt」不占文件「报告.txt」的号
  resetCalls(); listResult = [{ name: '报告.txt', isDir: true }]
  A.createFile('报告.txt')
  await tick()
  check(calls.write.length === 1 && calls.write[0][0] === '报告 2.txt',
    '同名文件夹占用 → createFile → 报告 2.txt（name 单键，真实 FS 一名字一 entry）')

  // ── [P1] 新建文件夹与同名文件冲突：name 单键 ──
  resetCalls(); listResult = [{ name: '新建文件夹', isDir: false }]
  A.createFolder('新建文件夹')
  await tick()
  check(calls.mkdir.length === 1 && calls.mkdir[0] === '新建文件夹 2',
    '同名文件占用 → createFolder → 新建文件夹 2（name 单键）')

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

  // ── 粘贴：cut 模式（真移动语义，桥 move 优先；清剪贴板）──
  resetCalls(); C.clear()
  C.set('cut', [{ path: 'a.txt', isDir: false }])
  listResult = []
  A.paste()
  await tick()
  check(calls.move.length === 1 && calls.move[0][0] === 'a.txt' && calls.move[0][1] === 'a.txt',
    'paste cut → 桥 move(a.txt → a.txt)（真移动优先）')
  check(calls.copy.length === 0 && calls.del.length === 0,
    'paste cut → 不再前端拆 copy+del（降级在桥层内部）')
  check(C.has() === false, 'paste cut 后清剪贴板')
  check(calls.toasts.some(function (t) { return t.indexOf('已移动 1 项') === 0 }),
    'paste cut toast 已移动 1 项')

  // ── 粘贴：copy 失败 → 不中断，逐项继续，最后汇总（成功 N + 失败 M + 弹窗）──
  resetCalls(); C.clear()
  C.set('copy', [{ path: 'a.txt', isDir: false }, { path: 'b.txt', isDir: false }])
  listResult = []
  copyShouldReject = true
  A.paste()
  await tick()
  copyShouldReject = false
  check(calls.toasts.some(function (t) {
    return t.indexOf('已粘贴 0 项，失败 2 项') === 0
  }), 'paste copy 失败 → 汇总 toast（成功 0 失败 2）')
  check(calls.dialogOpens.indexOf('transfer-fail-overlay') >= 0,
    'paste copy 失败 → 弹失败汇总列表')
  check(calls.clearSelection === 1 && calls.refresh === 1, 'paste 失败也清选中 + refresh')

  // ── 多文件进度：对话框双进度条推进 + 完成自动隐藏 ──
  resetCalls(); C.clear()
  C.set('copy', [{ path: 'a.txt', isDir: false }, { path: 'b.txt', isDir: false }])
  listResult = []
  A.paste()
  await tick()
  check(calls.show.length === 5, '多文件 paste → show 5 次（初始、进度1、完成1、进度2、完成2），实际 ' + calls.show.length)
  check(calls.show[0].phaseTotal === 2 && calls.show[0].totalTotal === 2,
    'copy 模式：单阶段双进度条（phase=total=2）')
  check(calls.show[4].phaseDone === 2 && calls.show[4].totalDone === 2,
    'copy 完成：phaseDone=2 totalDone=2')
  check(calls.hide === 1, '完成 → hide 一次')

  // ── 多文件移动（cut）：单阶段进度（移动 1/2 → 2/2）+ 批量布局迁移 ──
  resetCalls(); C.clear()
  C.set('cut', [{ path: 'a.txt', isDir: false }, { path: 'b.txt', isDir: false }])
  listResult = []
  A.paste()
  await tick()
  check(calls.show.length === 5, 'cut 单阶段 → show 5 次（初始、进度1、完成1、进度2、完成2），实际 ' + calls.show.length)
  const moveLabels = calls.show.map(function (o) { return o.phaseLabel })
  check(moveLabels[0] === '移动' && moveLabels[1] === '移动' && moveLabels[2] === '移动' &&
    moveLabels[3] === '移动' && moveLabels[4] === '移动',
    '移动单阶段标签：全程 phaseLabel=移动')
  check(calls.show[4].phaseDone === 2 && calls.show[4].totalDone === 2 && calls.show[4].totalTotal === 2,
    '移动完成：phaseDone=2 totalDone=2 totalTotal=2（不再 ×2 两阶段）')
  check(calls.move.length === 2, 'cut 单阶段 → 桥 move 2 次')
  check(calls.applyMoves === 1 && calls.lastMoves.length === 2 &&
    calls.lastMoves[0].src === 'a.txt' && calls.lastMoves[0].dst === 'a.txt' &&
    calls.lastMoves[1].src === 'b.txt' && calls.lastMoves[1].dst === 'b.txt',
    '移动后批量布局迁移 applyMoves(2 项)')
  check(calls.hide === 1, '移动完成 → hide 一次')

  // ── 进度回调：桥层 onProgress → Loading.show 带 current（字节级） + 取消按钮 ──
  // 桩 move 每次调用同步回调 onProgress({path: dst, done, total}) → show 携带 current
  check(calls.show.length === 5 && calls.show[1].current &&
    calls.show[1].current.name === 'a.txt' && calls.show[1].current.done === 50 && calls.show[1].current.total === 100,
    '进度回调 → show 带 current（正在移动 a.txt 50/100 B）')
  check(calls.show[1].cancellable === true && typeof calls.show[1].onCancel === 'function',
    '传输中显示取消按钮（cancellable + onCancel）')

  // ── 取消：点取消 → FileAPI.cancelTransfer 被调用（桥层中止 + 清理半成品）──
  resetCalls(); C.clear()
  C.set('cut', [{ path: 'a.txt', isDir: false }])
  listResult = []
  A.paste()
  await tick()
  check(typeof calls.show[0].onCancel === 'function', '移动中注册 onCancel')
  calls.show[0].onCancel()
  check(calls.cancelTransfer === 1, 'onCancel → cancelTransfer 桥调用（取消当前传输）')
  calls.show[0].onCancel()
  check(calls.cancelTransfer === 1, '重复点取消 → 只发一次（防抖）')

  // ── [P0] 批量取消：第 1 个传输中取消 → 剩余项不再调度（3 以后不再启动）──
  // 修复前：cancelSent 后 chain 仍继续调度剩余 job，桥层每次 move 开头重置取消标志 →
  // 剩余项全部照常执行。修复后：取消即停止调度，结束态报「已取消」而非失败汇总。
  resetCalls(); C.clear()
  C.set('cut', [
    { path: 'a.txt', isDir: false },
    { path: 'b.txt', isDir: false },
    { path: 'c.txt', isDir: false }
  ])
  listResult = []
  cancelOnFirstProgress = true
  A.paste()
  await tick()
  check(calls.move.length === 1,
    '[P0] 批量取消 → 第 1 个传输中取消后不再调度剩余项（实际调度 ' + calls.move.length + ' 项）')
  check(calls.cancelTransfer === 1, '[P0] 批量取消 → cancelTransfer 只调 1 次')
  check(calls.toasts.some(function (t) { return t.indexOf('已取消') >= 0 }),
    '[P0] 取消结束态 → toast 含「已取消」（而非失败汇总）')
  check(calls.dialogOpens.length === 0, '[P0] 取消 → 不弹失败列表弹窗')
  check(calls.clearSelection === 1 && calls.refresh === 1, '[P0] 取消后 clearSelection + refresh')

  // ── moveIntoFolder：移动语义（桥 move）+ 不清剪贴板 ──
  resetCalls(); C.clear()
  C.set('copy', [{ path: 'x.txt', isDir: false }])   // 预置无关剪贴板
  listResult = []                                     // 目标文件夹 docs 内无同名
  A.moveIntoFolder([{ path: 'a.txt', isDir: false }], 'docs')
  await tick()
  check(calls.list.length >= 1 && calls.list[0] === 'docs',
    'moveIntoFolder → list(docs) 检查目标目录')
  check(calls.move.length === 1 && calls.move[0][0] === 'a.txt' && calls.move[0][1] === 'docs/a.txt',
    'moveIntoFolder → 桥 move(a.txt → docs/a.txt)')
  check(calls.copy.length === 0 && calls.del.length === 0,
    'moveIntoFolder → 不拆 copy+del')
  check(C.has() === true, 'moveIntoFolder 不清剪贴板（keepClipboard）')
  check(calls.toasts.some(function (t) { return t.indexOf('已移动 1 项') === 0 }),
    'moveIntoFolder toast 已移动 1 项')
  check(calls.clearSelection === 1 && calls.refresh === 1, 'moveIntoFolder 后清选中 + refresh')

  // ── 删除 = 移入回收站（安全删除）：桥 move（真移动优先）到 .trash ──
  resetCalls(); C.clear()
  listResult = []   // 回收站 .trash 内无同名
  A.deleteSelection([{ path: 'a.txt', isDir: false }])
  await tick()
  check(calls.list.length >= 1 && calls.list[0] === '.trash',
    'deleteSelection → list(.trash) 检查回收站')
  check(calls.move.length === 1 && calls.move[0][0] === 'a.txt' && calls.move[0][1] === '.trash/a.txt',
    'deleteSelection → 桥 move(a.txt → .trash/a.txt)（真移动，O(1) 秒删大文件夹）')
  check(calls.copy.length === 0 && calls.del.length === 0,
    'deleteSelection → 不拆 copy+del（降级在桥层内部）')
  check(calls.toasts.some(function (t) { return t.indexOf('已删除 1 项') === 0 }),
    'deleteSelection toast 已删除 1 项')
  check(calls.clearSelection === 1 && calls.refresh === 1, 'deleteSelection 后清选中 + refresh')

  // ── 删除回收站自身 → 拒绝 ──
  resetCalls(); C.clear()
  A.deleteSelection([{ path: '.trash', isDir: true }])
  await tick()
  check(calls.move.length === 0 && calls.copy.length === 0 && calls.del.length === 0,
    'deleteSelection 回收站自身 → 不 move/copy/del')
  check(calls.toasts.some(function (t) { return t.indexOf('回收站不可删除') === 0 }),
    'deleteSelection 回收站自身 → toast 回收站不可删除')

  // ── 删除（无回收站名，如未授权）→ 拒绝 ──
  const savedTrashName = sandbox.App.Desktop.getTrashName
  sandbox.App.Desktop.getTrashName = function () { return '' }
  resetCalls(); C.clear()
  A.deleteSelection([{ path: 'a.txt', isDir: false }])
  await tick()
  check(calls.move.length === 0 && calls.copy.length === 0 && calls.del.length === 0,
    'deleteSelection 无回收站名 → 不 move/copy/del')
  check(calls.toasts.some(function (t) { return t.indexOf('回收站不可用') === 0 }),
    'deleteSelection 无回收站名 → toast 回收站不可用')
  sandbox.App.Desktop.getTrashName = savedTrashName

  // ── 删除混入回收站的集合 → 仅删非回收站项 ──
  resetCalls(); C.clear()
  listResult = []
  A.deleteSelection([{ path: 'a.txt', isDir: false }, { path: '.trash', isDir: true }])
  await tick()
  check(calls.move.length === 1 && calls.move[0][0] === 'a.txt',
    'deleteSelection 混入回收站 → 只 move 非回收站项')
  check(calls.copy.length === 0 && calls.del.length === 0,
    'deleteSelection 混入回收站 → 不 copy/del')

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
