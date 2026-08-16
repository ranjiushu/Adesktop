// web-upload.js 单元测试：待上传文件状态管理（setPending / hasPending / getPending / clearPending）
// 用法: node test-web-upload.js [项目路径]   （由 run-tests.sh 调用）
'use strict'

const fs = require('fs')
const path = require('path')
const vm = require('vm')

const PROJECT = process.argv[2] || path.join(__dirname, '..')
const SRC = path.join(PROJECT, 'src', 'js', 'web-upload.js')

let failures = 0
function check(cond, msg) {
  if (cond) console.log('  [ok] ' + msg)
  else { console.error('  [fail] ' + msg); failures++ }
}

const source = fs.readFileSync(SRC, 'utf8')
const sandbox = { App: {}, console: console }
vm.createContext(sandbox)
vm.runInContext(source, sandbox, { filename: 'web-upload.js' })

const W = sandbox.App.WebUpload

// ── 待上传状态生命周期 ──
check(W.hasPending() === false, '初始无待上传')
W.setPending(['a.txt', 'b.txt'])
check(W.hasPending() === true, 'setPending 后有待上传')
const p = W.getPending()
check(p.length === 2 && p[0] === 'a.txt' && p[1] === 'b.txt', 'getPending 返回路径列表')
W.clearPending()
check(W.hasPending() === false, 'clearPending 后无待上传')

// ── 边界 ──
W.setPending([])
check(W.hasPending() === false, 'setPending 空数组 → 无待上传')
W.setPending(null)
check(W.hasPending() === false, 'setPending null → 无待上传')
W.setPending(['x'])
check(W.getPending()[0] === 'x', 'setPending 覆盖旧值')

// ── 数组拷贝（防外部修改污染内部状态）──
const arr = ['y']
W.setPending(arr)
arr.push('z')
check(W.getPending().length === 1, 'setPending 拷贝数组（外部修改不污染）')

if (failures > 0) {
  console.error('  [FAIL] web-upload 测试 ' + failures + ' 项失败')
  process.exit(1)
}
console.log('  [ok] web-upload 测试全部通过')
process.exit(0)
