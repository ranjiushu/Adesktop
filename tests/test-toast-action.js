// toast.js showAction 单元测试：带操作按钮的吐司队列与回调
// 用法: node test-toast-action.js [项目路径]   （由 run-tests.sh 调用）
'use strict'

const fs = require('fs')
const path = require('path')
const vm = require('vm')

const PROJECT = process.argv[2] || path.join(__dirname, '..')
const NS_SRC = path.join(PROJECT, 'src', 'js', 'namespace.js')
const TOAST_SRC = path.join(PROJECT, 'src', 'js', 'toast.js')

let failures = 0
function check(cond, msg) {
  if (cond) {
    console.log('  [ok] ' + msg)
  } else {
    console.error('  [fail] ' + msg)
    failures++
  }
}

function makeElement(tag) {
  return {
    tagName: tag.toUpperCase(),
    className: '',
    _text: '',
    get textContent() { return this._text },
    set textContent(v) { this._text = String(v == null ? '' : v) },
    classList: {
      _set: new Set(),
      add: function (c) { this._set.add(c) },
      remove: function (c) { this._set.delete(c) },
      contains: function (c) { return this._set.has(c) }
    },
    style: {},
    dataset: {},
    children: [],
    _listeners: {},
    addEventListener: function (type, fn) {
      this._listeners[type] = this._listeners[type] || []
      this._listeners[type].push(fn)
    },
    appendChild: function (child) { this.children.push(child) },
    get outerHTML() {
      const cls = this.className ? ' class="' + this.className + '"' : ''
      const text = this._text
      const kids = this.children.map(function (c) { return c.outerHTML }).join('')
      return '<' + this.tagName + cls + '>' + text + kids + '</' + this.tagName + '>'
    }
  }
}

let lastToast = null
const sandbox = {
  App: {},
  window: { App: {} },
  document: {
    body: {
      appendChild: function (el) { lastToast = el }
    },
    createElement: function (tag) { return makeElement(tag) }
  },
  console: console,
  setTimeout: function (fn, ms) { return 0 },
  clearTimeout: function () {}
}
vm.createContext(sandbox)
vm.runInContext(fs.readFileSync(NS_SRC, 'utf8'), sandbox, { filename: 'namespace.js' })
vm.runInContext(fs.readFileSync(TOAST_SRC, 'utf8'), sandbox, { filename: 'toast.js' })
const toast = sandbox.App.toast

check(typeof toast.showAction === 'function', 'showAction 方法存在')
let actionCalled = false
const actionFn = function () { actionCalled = true }
toast.showAction('已经是最后一页了', '回到第一页', actionFn)
check(lastToast !== null, 'showAction 创建吐司元素')
check(lastToast.classList.contains('toast-action'), 'showAction 容器含 toast-action 类')
check(lastToast.children.length === 2, 'showAction 容器有两个子元素（msg + btn）')
const msgSpan = lastToast.children[0]
const btn = lastToast.children[1]
check(msgSpan.tagName === 'SPAN' && msgSpan.textContent === '已经是最后一页了', '消息文本正确')
check(btn.tagName === 'BUTTON' && btn.textContent === '回到第一页', '按钮文本正确')

// 模拟点击按钮触发回调
if (btn._listeners.click && btn._listeners.click[0]) {
  btn._listeners.click[0]()
}
check(actionCalled === true, '点击操作按钮触发回调')

if (failures > 0) {
  console.error('  [FAIL] toast-action 测试 ' + failures + ' 项失败')
  process.exit(1)
}
console.log('  [ok] toast-action 测试全部通过')
