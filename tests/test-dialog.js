// dialog.js 单元测试：通用弹窗显隐模块（App.Dialog）
// open/close/isOpen + aria 状态 + DOM 缺失防御。
// 用法: node test-dialog.js [项目路径]   （由 run-tests.sh 调用）
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

// ── DOM 桩 ──
function makeEl() {
  const el = { _classes: {}, _attrs: {} }
  el.classList = {
    add: function (c) { el._classes[c] = true },
    remove: function (c) { delete el._classes[c] },
    contains: function (c) { return !!el._classes[c] }
  }
  el.setAttribute = function (k, v) { el._attrs[k] = v }
  el.getAttribute = function (k) { return el._attrs[k] }
  return el
}

const overlay = makeEl()
const els = { 'test-overlay': overlay }
const sandbox = {
  App: {},
  console: console,
  document: { getElementById: function (id) { return els[id] || null } }
}
vm.createContext(sandbox)
vm.runInContext(fs.readFileSync(path.join(SRC, 'dialog.js'), 'utf8'), sandbox,
  { filename: 'dialog.js' })

const DLG = sandbox.App.Dialog

// ── open ──
check(DLG.open('test-overlay') === true, 'open 返回 true')
check(overlay._classes['dialog-overlay-visible'] === true, 'open → 加 dialog-overlay-visible')
check(overlay._attrs['aria-hidden'] === 'false', 'open → aria-hidden=false')
check(DLG.isOpen('test-overlay') === true, 'isOpen → true')

// ── close ──
check(DLG.close('test-overlay') === true, 'close 返回 true')
check(overlay._classes['dialog-overlay-visible'] !== true, 'close → 移除 dialog-overlay-visible')
check(overlay._attrs['aria-hidden'] === 'true', 'close → aria-hidden=true')
check(DLG.isOpen('test-overlay') === false, 'isOpen → false')

// ── 再 open（重复开合）──
DLG.open('test-overlay')
check(DLG.isOpen('test-overlay') === true, '再次 open 后 isOpen=true')
DLG.close('test-overlay')

// ── 缺失 DOM 防御 ──
check(DLG.open('missing') === false, 'open 缺失元素 → false 不抛异常')
check(DLG.close('missing') === false, 'close 缺失元素 → false 不抛异常')
check(DLG.isOpen('missing') === false, 'isOpen 缺失元素 → false')

if (failures > 0) {
  console.error('  [FAIL] dialog 测试 ' + failures + ' 项失败')
  process.exit(1)
}
console.log('  [ok] dialog 测试全部通过')
