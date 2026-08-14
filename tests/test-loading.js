// loading.js 单元测试：进度条（progress/hideProgress）+ 实时标签（showTag/hideTag）
// vm 加载真实 loading.js，DOM 桩记录 class/style/textContent 状态。
// 用法: node test-loading.js [项目路径]   （由 run-tests.sh 调用）
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

// ── DOM 桩：classList 记录 + style/textContent 可断言 ──
function makeEl() {
  return {
    _classes: {},
    style: {},
    textContent: '',
    _attrs: {},
    classList: {
      add: function (c) { this._p._classes[c] = true },
      remove: function (c) { delete this._p._classes[c] },
      contains: function (c) { return !!this._p._classes[c] }
    },
    setAttribute: function (k, v) { this._attrs[k] = v },
    getAttribute: function (k) { return this._attrs[k] }
  }
}
// classList 需要引用宿主（闭包改 this 指向），用工厂绑定
function makeEl() {
  const el = { _classes: {}, style: {}, textContent: '', _attrs: {} }
  el.classList = {
    add: function (c) { el._classes[c] = true },
    remove: function (c) { delete el._classes[c] },
    contains: function (c) { return !!el._classes[c] }
  }
  el.setAttribute = function (k, v) { el._attrs[k] = v }
  el.getAttribute = function (k) { return el._attrs[k] }
  return el
}

const progressEl = makeEl()
const barEl = makeEl()
const labelEl = makeEl()
const tagEl = makeEl()
const els = {
  'loading-progress': progressEl,
  'loading-progress-bar': barEl,
  'loading-progress-label': labelEl,
  'drop-tag': tagEl
}

const sandbox = {
  App: {},
  console: console,
  document: { getElementById: function (id) { return els[id] || null } }
}
vm.createContext(sandbox)
vm.runInContext(fs.readFileSync(path.join(SRC, 'loading.js'), 'utf8'), sandbox,
  { filename: 'loading.js' })

const L = sandbox.App.Loading

// ── 进度条：显示 + 文案 + 宽度 ──
L.progress('正在移动', 0, 5)
check(progressEl._classes['loading-visible'] === true, 'progress(0/5) → 显示进度条')
check(labelEl.textContent === '正在移动 0/5', 'progress 文案「正在移动 0/5」（实际: ' + labelEl.textContent + '）')
check(barEl.style.width === '0%', 'progress 0/5 → 宽度 0%')

L.progress('正在移动', 2, 5)
check(barEl.style.width === '40%', 'progress 2/5 → 宽度 40%')
check(labelEl.textContent === '正在移动 2/5', 'progress 文案更新 2/5')

// ── 进度条：完成自动隐藏 ──
L.progress('正在移动', 5, 5)
check(progressEl._classes['loading-visible'] !== true, 'progress(5/5) → 完成自动隐藏')
check(barEl.style.width === '0%', '隐藏后宽度复位 0%')
check(labelEl.textContent === '', '隐藏后文案清空')

// ── hideProgress：显式隐藏（失败路径收尾）──
L.progress('正在粘贴', 1, 5)
L.hideProgress()
check(progressEl._classes['loading-visible'] !== true, 'hideProgress → 隐藏')
check(barEl.style.width === '0%' && labelEl.textContent === '', 'hideProgress 复位宽度与文案')

// ── 实时标签：显示 ──
L.showTag('文件将移入 报告 文件夹')
check(tagEl._classes['loading-visible'] === true, 'showTag → 标签可见')
check(tagEl.textContent === '文件将移入 报告 文件夹', 'showTag 文案（实际: ' + tagEl.textContent + '）')

// ── 实时标签：更新（拖动中切换目标文件夹）──
L.showTag('文件将移入 照片 文件夹')
check(tagEl.textContent === '文件将移入 照片 文件夹', 'showTag 更新文案')

// ── 实时标签：隐藏 ──
L.hideTag()
check(tagEl._classes['loading-visible'] !== true, 'hideTag → 隐藏')
check(tagEl.textContent === '', 'hideTag 清空文案')

// ── 空文本 showTag 等效 hide ──
L.showTag('')
check(tagEl._classes['loading-visible'] !== true, 'showTag("") → 等效隐藏')

// ── DOM 缺失防御（不抛异常）──
const savedGet = sandbox.document.getElementById
sandbox.document.getElementById = function () { return null }
L.progress('x', 1, 5)
L.hideProgress()
L.showTag('x')
L.hideTag()
sandbox.document.getElementById = savedGet
check(true, 'DOM 缺失时不抛异常')

if (failures > 0) {
  console.error('  [FAIL] loading 测试 ' + failures + ' 项失败')
  process.exit(1)
}
console.log('  [ok] loading 测试全部通过')
