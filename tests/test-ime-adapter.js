// ime-adapter.js DOM 接线测试：desktop:ime 事件 → .dialog-overlay 切换 .ime-open
// 用法: node test-ime-adapter.js [项目路径]   （由 run-tests.sh 调用）
'use strict'

const fs = require('fs')
const path = require('path')
const vm = require('vm')

const PROJECT = process.argv[2] || path.join(__dirname, '..')
const SRC_DIR = path.join(PROJECT, 'src', 'js')

let failures = 0
function check(cond, msg) {
  if (cond) {
    console.log('  [ok] ' + msg)
  } else {
    console.error('  [fail] ' + msg)
    failures++
  }
}

// ── 最小 DOM stub：两个 .dialog-overlay，classList 记录 ime-open 状态 ──
function makeOverlay() {
  const classes = new Set()
  return {
    classList: {
      contains: (c) => classes.has(c),
      toggle: (c, force) => {
        if (force === undefined) {
          if (classes.has(c)) { classes.delete(c); return false }
          classes.add(c); return true
        }
        if (force) classes.add(c); else classes.delete(c)
        return force
      }
    }
  }
}

const overlays = [makeOverlay(), makeOverlay()]
const winHandlers = {}
const sandbox = {
  App: {},
  console: console,
  window: {
    addEventListener: function (type, fn) { winHandlers[type] = fn }
  },
  document: {
    querySelectorAll: function (sel) {
      return sel === '.dialog-overlay' ? overlays : []
    }
  }
}
vm.createContext(sandbox)
vm.runInContext(fs.readFileSync(path.join(SRC_DIR, 'ime-adapter.js'), 'utf8'), sandbox, { filename: 'ime-adapter.js' })

const Ime = sandbox.App.ImeAdapter
check(Ime && typeof Ime.init === 'function', 'App.ImeAdapter 暴露 init()')

Ime.init()
check(typeof winHandlers['desktop:ime'] === 'function', 'init() 注册 desktop:ime 监听')

// ── 键盘弹出：所有 overlay 加 .ime-open ──
winHandlers['desktop:ime']({ detail: { open: true } })
check(overlays[0].classList.contains('ime-open'), 'open=true → overlay[0] 加 .ime-open')
check(overlays[1].classList.contains('ime-open'), 'open=true → overlay[1] 加 .ime-open')

// ── 键盘收起：移除 .ime-open ──
winHandlers['desktop:ime']({ detail: { open: false } })
check(!overlays[0].classList.contains('ime-open'), 'open=false → overlay[0] 移除 .ime-open')
check(!overlays[1].classList.contains('ime-open'), 'open=false → overlay[1] 移除 .ime-open')

// ── 无 detail 的事件按关闭处理（防御） ──
winHandlers['desktop:ime']({})
check(!overlays[0].classList.contains('ime-open'), '无 detail → 视为关闭')

// ── 重复事件幂等 ──
winHandlers['desktop:ime']({ detail: { open: true } })
winHandlers['desktop:ime']({ detail: { open: true } })
check(overlays[0].classList.contains('ime-open'), '重复 open=true 幂等（保持开启）')
winHandlers['desktop:ime']({ detail: { open: false } })
winHandlers['desktop:ime']({ detail: { open: false } })
check(!overlays[0].classList.contains('ime-open'), '重复 open=false 幂等（保持关闭）')

if (failures > 0) {
  console.error('  [FAIL] ime-adapter 测试 ' + failures + ' 项失败')
  process.exit(1)
}
console.log('  [ok] ime-adapter 测试全部通过')
