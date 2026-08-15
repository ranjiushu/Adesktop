// main.js handleSystemBack 单元测试（P2c 修复点）：系统返回键消费顺序
// Drawer → ViewMenu → BuildInfo → 文件导航后退（子目录内）→ 否则交还壳退出。
// 用法: node test-main-back.js [项目路径]   （由 run-tests.sh 调用）
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

// ── 沙箱：main.js 顶层只定义函数，boot 因 readyState='loading' 不触发 ──
const calls = {
  drawerClose: 0, viewClose: 0, buildClose: 0, goBack: 0,
  drawerOpen: false, viewOpen: false, buildOpen: false, canGoBackResult: false
}

const sandbox = {
  App: {},
  document: { readyState: 'loading', addEventListener: function () {} },
  history: { state: null, back: function () {} },
  console: console,
  setTimeout: setTimeout,
  Promise: Promise
}
vm.createContext(sandbox)

sandbox.App.Drawer = {
  isOpen: function () { return calls.drawerOpen },
  close: function () { calls.drawerClose++ }
}
sandbox.App.ViewMenu = {
  isOpen: function () { return calls.viewOpen },
  close: function () { calls.viewClose++ }
}
sandbox.App.BuildInfo = {
  isOpen: function () { return calls.buildOpen },
  close: function () { calls.buildClose++ }
}
sandbox.App.Desktop = {
  canGoBack: function () { return calls.canGoBackResult },
  goBack: function () { calls.goBack++ }
}

vm.runInContext(fs.readFileSync(path.join(SRC, 'main.js'), 'utf8'), sandbox,
  { filename: 'main.js' })

const hsb = sandbox.App.handleSystemBack

// ── 1. Drawer 打开 → 关 Drawer，消费返回键 ──
calls.drawerOpen = true
check(hsb() === true, 'Drawer 打开 → 返回键消费')
check(calls.drawerClose === 1, 'Drawer.close 被调用')
check(calls.goBack === 0, 'Drawer 场景不触发文件后退')
calls.drawerOpen = false

// ── 2. ViewMenu 打开 → 关 ViewMenu ──
calls.viewOpen = true
check(hsb() === true, 'ViewMenu 打开 → 返回键消费')
check(calls.viewClose === 1, 'ViewMenu.close 被调用')
calls.viewOpen = false

// ── 3. BuildInfo 打开 → 关 BuildInfo ──
calls.buildOpen = true
check(hsb() === true, 'BuildInfo 打开 → 返回键消费')
check(calls.buildClose === 1, 'BuildInfo.close 被调用')
calls.buildOpen = false

// ── 4. 全部关闭 + 子目录内（可后退）→ 文件导航后退一级（P2c 修复点）──
calls.canGoBackResult = true
check(hsb() === true, '子目录内无 overlay → 返回键消费')
check(calls.goBack === 1, 'Desktop.goBack 被调用（逐级退出）')

// ── 5. 全部关闭 + 根目录（不可后退）→ 交还壳退出 ──
calls.canGoBackResult = false
check(hsb() === false, '根目录无 overlay → 返回 false（壳退出）')
check(calls.goBack === 1, '根目录不触发 goBack（计数不变）')

// ── 6. overlay 优先级：Drawer 优先于文件后退 ──
calls.drawerOpen = true; calls.canGoBackResult = true
hsb()
check(calls.goBack === 1, 'Drawer 优先于文件后退（goBack 不被调用）')
calls.drawerOpen = false

// ── 7. Desktop 未初始化（防御）──
const savedDesktop = sandbox.App.Desktop
sandbox.App.Desktop = null
check(hsb() === false, 'Desktop 缺失 → 不抛异常，返回 false')
sandbox.App.Desktop = savedDesktop

if (failures > 0) {
  console.error('  [FAIL] main-back 测试 ' + failures + ' 项失败')
  process.exit(1)
}
console.log('  [ok] main-back 测试全部通过')
