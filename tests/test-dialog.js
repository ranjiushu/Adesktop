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

// ── 返回键关闭栈（无「取消」按钮的关闭途径） ──
const ov2 = makeEl()
els['ov2'] = ov2
let closed2 = 0
check(DLG.handleBack() === false, '无弹窗时 handleBack → false（不消费返回键）')
// 业务 closeFn 约定：内部调用 App.Dialog.close 完成出栈 + 显隐（如 CreateDialog.close）
DLG.open('ov2', function () { closed2++; DLG.close('ov2') })
check(DLG.handleBack() === true, '有弹窗时 handleBack → true（消费返回键）')
check(closed2 === 1, 'handleBack 调用注册的 closeFn')
check(ov2._classes['dialog-overlay-visible'] !== true, 'closeFn 内 App.Dialog.close 生效（overlay 已隐藏）')

// closeFn 内部调用 App.Dialog.close 出栈后，handleBack 不再消费
DLG.open('ov2', function () { DLG.close('ov2') })
check(DLG.handleBack() === true, '再次打开后 handleBack 消费')
check(DLG.handleBack() === false, 'closeFn 已出栈 → handleBack 不消费')

// 多层栈：先开下层再开上层，handleBack 关闭顶层
const ov3 = makeEl()
els['ov3'] = ov3
let closed3 = 0
DLG.open('ov2', function () { DLG.close('ov2') })
DLG.open('ov3', function () { closed3++; DLG.close('ov3') })
check(DLG.handleBack() === true && closed3 === 1, '多层栈 handleBack 先关顶层')
check(DLG.isOpen('ov3') === false && DLG.isOpen('ov2') === true, '顶层关闭后下层仍在')
DLG.close('ov2')

// 重复 open 不重复入栈（同一 overlay 只注册一次 closeFn）
DLG.open('ov2', function () { DLG.close('ov2') })
DLG.open('ov2', function () { DLG.close('ov2') })
check(DLG.handleBack() === true, '重复 open 后 handleBack 仍消费一次')
check(DLG.handleBack() === false, '重复 open 未重复入栈 → 一次消费即清空')

// closeFn 抛异常时降级为仅关 overlay，且不抛给调用方
const ov4 = makeEl()
els['ov4'] = ov4
DLG.open('ov4', function () { throw new Error('boom') })
check(DLG.handleBack() === true, 'closeFn 抛异常 → handleBack 仍返回 true')
check(ov4._classes['dialog-overlay-visible'] !== true, 'closeFn 抛异常 → 降级关闭 overlay')


if (failures > 0) {
  console.error('  [FAIL] dialog 测试 ' + failures + ' 项失败')
  process.exit(1)
}
console.log('  [ok] dialog 测试全部通过')
