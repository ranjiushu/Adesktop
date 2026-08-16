// loading.js 单元测试：居中对话框（单/双进度条、不确定进度）+ 实时标签
// vm 加载真实 loading.js + dialog.js（App.Dialog 显隐），DOM 桩记录 class 状态。
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

const dialogEl = makeEl()
const titleEl = makeEl()
const phaseEl = makeEl()
const phaseLabelEl = makeEl()
const phaseBarEl = makeEl()
const phaseCountEl = makeEl()
const totalEl = makeEl()
const totalLabelEl = makeEl()
const totalBarEl = makeEl()
const totalCountEl = makeEl()
const tagEl = makeEl()
const currentEl = makeEl()
const currentLabelEl = makeEl()
const currentCountEl = makeEl()
const actionsEl = makeEl()
const cancelBtnEl = makeEl()
const els = {
  'loading-dialog': dialogEl,
  'loading-dialog-title': titleEl,
  'loading-phase': phaseEl,
  'loading-phase-label': phaseLabelEl,
  'loading-phase-bar': phaseBarEl,
  'loading-phase-count': phaseCountEl,
  'loading-total': totalEl,
  'loading-total-label': totalLabelEl,
  'loading-total-bar': totalBarEl,
  'loading-total-count': totalCountEl,
  'loading-current': currentEl,
  'loading-current-label': currentLabelEl,
  'loading-current-count': currentCountEl,
  'loading-actions': actionsEl,
  'loading-cancel': cancelBtnEl,
  'drop-tag': tagEl
}

const sandbox = {
  App: {
    utils: { bindPress: function () {} }
  },
  console: console,
  document: { getElementById: function (id) { return els[id] || null } }
}
vm.createContext(sandbox)
// 先加载真实 dialog.js（App.Dialog 显隐基础），再加载 loading.js
vm.runInContext(fs.readFileSync(path.join(SRC, 'dialog.js'), 'utf8'), sandbox,
  { filename: 'dialog.js' })
vm.runInContext(fs.readFileSync(path.join(SRC, 'loading.js'), 'utf8'), sandbox,
  { filename: 'loading.js' })

const L = sandbox.App.Loading

// ── 对话框：双进度条（移动 = 复制阶段 + 总进度）──
L.show({
  title: '正在移动',
  phaseLabel: '复制', phaseDone: 0, phaseTotal: 5,
  totalLabel: '总进度', totalDone: 0, totalTotal: 10
})
check(dialogEl._classes['dialog-overlay-visible'] === true, 'show 双进度 → 对话框可见')
check(titleEl.textContent === '正在移动', '对话框标题「正在移动」')
check(phaseEl._classes['loading-visible'] === true, '阶段进度条可见')
check(phaseBarEl.style.width === '0%', '阶段 0/5 → 宽度 0%')
check(phaseLabelEl.textContent === '复制 0/5', '阶段标签「复制 0/5」（实际: ' + phaseLabelEl.textContent + '）')
check(phaseCountEl.textContent === '0/5', '阶段计数 0/5')
check(totalEl._classes['loading-visible'] === true, '总进度条可见')
check(totalBarEl.style.width === '0%' && totalCountEl.textContent === '0/10', '总进度 0/10')

// 阶段推进（复制 3/5）
L.show({
  title: '正在移动',
  phaseLabel: '复制', phaseDone: 3, phaseTotal: 5,
  totalLabel: '总进度', totalDone: 3, totalTotal: 10
})
check(phaseBarEl.style.width === '60%', '阶段 3/5 → 宽度 60%')
check(phaseCountEl.textContent === '3/5', '阶段计数 3/5')
check(totalBarEl.style.width === '30%', '总进度 3/10 → 宽度 30%')
check(totalCountEl.textContent === '3/10', '总计数 3/10')

// 阶段切换（复制完成 → 删除源）
L.show({
  title: '正在移动',
  phaseLabel: '删除源', phaseDone: 2, phaseTotal: 5,
  totalLabel: '总进度', totalDone: 7, totalTotal: 10
})
check(phaseLabelEl.textContent === '删除源 2/5', '阶段切换「删除源 2/5」')
check(totalBarEl.style.width === '70%', '总进度 7/10 → 70%')

// ── 对话框：单进度条（纯粘贴 copy，无删除源阶段）──
L.show({
  title: '正在粘贴',
  phaseLabel: '复制', phaseDone: 1, phaseTotal: 3
})
check(dialogEl._classes['dialog-overlay-visible'] === true, 'show 单进度 → 对话框可见')
check(phaseEl._classes['loading-visible'] === true, '单进度 → 阶段条可见')
check(totalEl._classes['loading-visible'] !== true, '单进度 → 总进度条隐藏')
check(phaseBarEl.style.width === '33%', '单进度 1/3 → 33%')

// ── 对话框：不确定进度（目录切换/刷新，无总量）──
L.show({ title: '加载中' })
check(dialogEl._classes['dialog-overlay-visible'] === true, '不确定进度 → 对话框可见')
check(phaseBarEl._classes['loading-indeterminate'] === true, '不确定进度 → 条纹动画 class')
check(phaseBarEl.style.width === '100%', '不确定进度 → 宽度 100%（动画）')
check(phaseLabelEl.textContent === '加载中', '不确定进度 → 阶段标签=标题')
check(totalEl._classes['loading-visible'] !== true, '不确定进度 → 总进度条隐藏')

// ── hide：复位 ──
L.hide()
check(dialogEl._classes['dialog-overlay-visible'] !== true, 'hide → 对话框隐藏')
check(phaseBarEl._classes['loading-indeterminate'] !== true, 'hide → 清除条纹动画')
check(phaseBarEl.style.width === '0%', 'hide → 阶段条宽度复位 0%')
check(totalBarEl.style.width === '0%', 'hide → 总进度条宽度复位 0%')
check(phaseCountEl.textContent === '' && totalCountEl.textContent === '', 'hide → 计数清空')

// ── 当前文件行（字节级进度）：current + 取消按钮 ──
let cancelFired = 0
L.show({
  title: '正在移动',
  phaseLabel: '移动', phaseDone: 1, phaseTotal: 2,
  totalLabel: '总进度', totalDone: 1, totalTotal: 2,
  current: { name: 'docs/report.txt', done: 1234567, total: 5000000 },
  cancellable: true,
  onCancel: function () { cancelFired++ }
})
check(currentEl._classes['loading-visible'] === true, 'current 行可见')
check(currentLabelEl.textContent === 'docs/report.txt', 'current 文件名（实际: ' + currentLabelEl.textContent + '）')
check(currentCountEl.textContent === '1.2 MB / 4.8 MB', 'current 字节人性化 1.2/4.8 MB（实际: ' + currentCountEl.textContent + '）')
check(actionsEl._classes['loading-visible'] === true, '取消按钮区可见')

// 无 current / 不取消 → 隐藏
L.show({ title: 'x', phaseLabel: '移动', phaseDone: 1, phaseTotal: 2, totalLabel: 't', totalDone: 1, totalTotal: 2 })
check(currentEl._classes['loading-visible'] !== true, '无 current → 当前行隐藏')
check(actionsEl._classes['loading-visible'] !== true, '无 cancellable → 取消按钮区隐藏')

// 取消回调：Loading 模块内按钮绑定（无 DOM 桩交互则跳过；此处验证 onCancel 注册可被 hide 清理）
L.hide()
check(cancelFired === 0, 'hide 不触发取消（仅清理状态）')

// ── 实时标签（拖入文件夹提示，不进对话框）──
L.showTag('文件将移入 报告 文件夹')
check(tagEl._classes['loading-visible'] === true, 'showTag → 标签可见')
check(tagEl.textContent === '文件将移入 报告 文件夹', 'showTag 文案（实际: ' + tagEl.textContent + '）')
L.showTag('文件将移入 照片 文件夹')
check(tagEl.textContent === '文件将移入 照片 文件夹', 'showTag 更新文案')
L.hideTag()
check(tagEl._classes['loading-visible'] !== true, 'hideTag → 隐藏')
check(tagEl.textContent === '', 'hideTag 清空文案')
L.showTag('')
check(tagEl._classes['loading-visible'] !== true, 'showTag("") → 等效隐藏')

// ── DOM 缺失防御（不抛异常）──
const savedGet = sandbox.document.getElementById
sandbox.document.getElementById = function () { return null }
L.show({ title: 'x', phaseDone: 1, phaseTotal: 2 })
L.hide()
L.showTag('x')
L.hideTag()
sandbox.document.getElementById = savedGet
check(true, 'DOM 缺失时不抛异常')

if (failures > 0) {
  console.error('  [FAIL] loading 测试 ' + failures + ' 项失败')
  process.exit(1)
}
console.log('  [ok] loading 测试全部通过')
