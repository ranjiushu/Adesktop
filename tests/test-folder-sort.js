// folder-sort.js 单元测试：排序规则（文件夹优先 + name/mtime/type/size + 升降序）
// 用法: node test-folder-sort.js [项目路径]   （由 run-tests.sh 调用）
'use strict'

const fs = require('fs')
const path = require('path')
const vm = require('vm')

const PROJECT = process.argv[2] || path.join(__dirname, '..')
const SRC = path.join(PROJECT, 'src', 'js', 'folder-sort.js')

let failures = 0
function check(cond, msg) {
  if (cond) {
    console.log('  [ok] ' + msg)
  } else {
    console.error('  [fail] ' + msg)
    failures++
  }
}

const sandbox = { App: {}, console: console }
vm.createContext(sandbox)
vm.runInContext(fs.readFileSync(SRC, 'utf8'), sandbox, { filename: 'folder-sort.js' })

const S = sandbox.App.FolderSort

function names(list) { return list.map(function (i) { return i.name }).join(',') }

// ── 基础数据 ──
const items = [
  { name: 'zeta.txt', isDir: false, size: 300, mtime: 1000 },
  { name: 'alpha', isDir: true, mtime: 5000 },
  { name: 'beta.txt', isDir: false, size: 100, mtime: 3000 },
  { name: 'gamma', isDir: true, mtime: 2000 },
  { name: 'charlie.jpg', isDir: false, size: 200, mtime: 4000 },
  { name: 'delta.PNG', isDir: false, size: 50, mtime: 6000 }
]

// ── 文件夹优先（恒在文件前，与方向无关；文件夹组内也随方向排序）──
let r = S.sort(items, 'name', 1)
check(names(r) === 'alpha,gamma,beta.txt,charlie.jpg,delta.PNG,zeta.txt',
  '按名称升序：文件夹 alpha,gamma 在前，文件内 A→Z，实际: ' + names(r))
r = S.sort(items, 'name', -1)
check(names(r) === 'gamma,alpha,zeta.txt,delta.PNG,charlie.jpg,beta.txt',
  '按名称降序：文件夹组内 Z→A（gamma,alpha），文件内 Z→A，实际: ' + names(r))

// ── 按修改日期 ──
r = S.sort(items, 'mtime', -1)
check(names(r) === 'alpha,gamma,delta.PNG,charlie.jpg,beta.txt,zeta.txt',
  '按日期降序（新在前）：alpha 5000 先于 gamma 2000，文件 6000>4000>3000>1000，实际: ' + names(r))
r = S.sort(items, 'mtime', 1)
check(names(r) === 'gamma,alpha,zeta.txt,beta.txt,charlie.jpg,delta.PNG',
  '按日期升序（旧在前）：gamma 2000 先于 alpha 5000，文件 1000<3000<4000<6000，实际: ' + names(r))

// ── 按类型（扩展名，大小写不敏感，无扩展名排前）──
const types = [
  { name: 'readme', isDir: false },
  { name: 'a.jpg', isDir: false },
  { name: 'b.PNG', isDir: false },
  { name: 'c.txt', isDir: false },
  { name: 'd.txt', isDir: false },
  { name: 'folder', isDir: true }
]
r = S.sort(types, 'type', 1)
check(names(r) === 'folder,readme,a.jpg,b.PNG,c.txt,d.txt',
  '按类型升序：无扩展名 readme 在前，jpg/png 按扩展名（a<b），txt 按名称，实际: ' + names(r))

// ── 按大小 ──
r = S.sort(items, 'size', 1)
check(names(r) === 'alpha,gamma,delta.PNG,beta.txt,charlie.jpg,zeta.txt',
  '按大小升序：50 < 100 < 200 < 300，实际: ' + names(r))

// ── 边界 ──
check(names(S.sort([], 'name', 1)) === '', '空数组排序 → 空')
check(S.sort(null, 'name', 1).length === 0, 'null 输入 → 空数组')
check(S.typeKey('a.TXT') === 'txt', 'typeKey 大小写归一')
check(S.typeKey('readme') === '', 'typeKey 无扩展名 → 空串')
check(S.typeKey('a.b.txt') === 'txt', 'typeKey 多后缀取最后一段')
check(S.defaultDir('mtime') === -1, '日期默认降序（新在前）')
check(S.defaultDir('name') === 1, '名称默认升序')

// ── 不改原数组 ──
const orig = items.slice()
S.sort(items, 'name', 1)
check(items.length === orig.length, '排序不改原数组长度')

if (failures > 0) {
  console.error('  [FAIL] folder-sort 测试 ' + failures + ' 项失败')
  process.exit(1)
}
console.log('  [ok] folder-sort 测试全部通过')
