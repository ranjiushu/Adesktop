// app-list.js 纯函数单元测试：filterApps 搜索过滤（大小写不敏感 / label + package 命中）
// vm 加载真实 app-list.js；filterApps 不触 DOM，无需桩 document。
// 用法: node test-app-list.js [项目路径]   （由 run-tests.sh 调用）
'use strict'

const fs = require('fs')
const path = require('path')
const vm = require('vm')

const PROJECT = process.argv[2] || path.join(__dirname, '..')
const SRC = path.join(PROJECT, 'src', 'js', 'app-list.js')

let failures = 0
function check(cond, msg) {
  if (cond) console.log('  [ok] ' + msg)
  else { console.error('  [fail] ' + msg); failures++ }
}

const source = fs.readFileSync(SRC, 'utf8')
const sandbox = { App: {}, console: console }
vm.createContext(sandbox)
vm.runInContext(source, sandbox, { filename: 'app-list.js' })

const L = sandbox.App.AppList

const apps = [
  { package: 'com.tencent.mm', label: '微信', isSystem: false },
  { package: 'com.android.settings', label: 'Settings', isSystem: true },
  { package: 'com.eg.android', label: '支付宝', isSystem: false }
]

check(L.filterApps(apps, '').length === 3, '空查询返回全部')
check(L.filterApps(apps, '微').length === 1, '按 label 中文过滤')
check(L.filterApps(apps, 'com.tencent').length === 1, '按 package 过滤')
check(L.filterApps(apps, 'settings').length === 1, '大小写不敏感命中 label')
check(L.filterApps(apps, 'COM.ANDROID').length === 1, '大小写不敏感命中 package')
check(L.filterApps(apps, 'zzz').length === 0, '无匹配返回空')
check(L.filterApps(null, '').length === 0, 'null 列表安全返回空')

if (failures > 0) { console.error('  [FAIL] app-list 测试 ' + failures + ' 项失败'); process.exit(1) }
console.log('  [ok] app-list 测试全部通过')
process.exit(0)
