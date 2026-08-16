// icons.js 图标系统测试：生成器纯函数（get/命名访问/kebab 转换/class/style 转义）+
// sprite 一致性（index.html 的 symbol id 与 icons.js _NAMES 一一对应）。
// vm 加载真实 icons.js + namespace.js，零依赖运行。
// 用法: node test-icons.js [项目路径]   （由 run-tests.sh 调用）
'use strict'

const fs = require('fs')
const path = require('path')
const vm = require('vm')

const PROJECT = process.argv[2] || path.join(__dirname, '..')
const SRC = path.join(PROJECT, 'src', 'js')
const HTML = path.join(PROJECT, 'src', 'index.html')

let failures = 0
function check(cond, msg) {
  if (cond) console.log('  [ok] ' + msg)
  else { console.error('  [fail] ' + msg); failures++ }
}

const sandbox = { App: {}, console: console, window: { App: {} } }
vm.createContext(sandbox)
vm.runInContext(fs.readFileSync(path.join(SRC, 'namespace.js'), 'utf8'), sandbox, { filename: 'namespace.js' })
vm.runInContext(fs.readFileSync(path.join(SRC, 'icons.js'), 'utf8'), sandbox, { filename: 'icons.js' })

const icons = sandbox.App.icons

// ── 生成器纯函数 ──
check(typeof icons.get === 'function', 'icons.get 存在')
const svg = icons.get('chevronLeft', { width: 16, height: 16 })
check(svg.indexOf('<svg') === 0, 'get 返回 <svg> 开头')
check(svg.indexOf('width="16"') >= 0 && svg.indexOf('height="16"') >= 0, 'get 应用 width/height')
check(svg.indexOf('href="#icon-chevron-left"') >= 0, 'get 引用 kebab 化 symbol id')
check(svg.indexOf('viewBox="0 0 24 24"') >= 0, 'svg 含 viewBox 0 0 24 24')

// camelCase → kebab-case
check(icons.get('moreVertical').indexOf('#icon-more-vertical') >= 0, 'camelCase → kebab 转换（moreVertical）')
check(icons.get('refreshCw').indexOf('#icon-refresh-cw') >= 0, 'camelCase → kebab 转换（refreshCw）')
check(icons.get('externalLink').indexOf('#icon-external-link') >= 0, 'camelCase → kebab 转换（externalLink）')

// className / style / 转义
check(icons.get('plus', { className: 'my-cls' }).indexOf('class="my-cls"') >= 0, 'className 注入')
check(icons.get('plus', { class: 'a"b' }).indexOf('class="a&quot;b"') >= 0, 'class 引号转义')
check(icons.get('plus', { style: 'color:red' }).indexOf('style="color:red"') >= 0, 'style 注入')

// 命名访问（默认 20×20）
check(typeof icons.chevronLeft === 'string' && icons.chevronLeft.indexOf('#icon-chevron-left') >= 0, '命名访问 icons.chevronLeft')
check(typeof icons.folder === 'string' && icons.folder.indexOf('width="20"') >= 0, '命名访问默认 20×20')

// ── sprite 一致性：index.html symbol id 与 _NAMES 双向一致 ──
const html = fs.readFileSync(HTML, 'utf8')
const spriteIds = [...html.matchAll(/id="icon-([a-z-]+)"/g)].map(m => m[1])
const kebab = s => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
const nameIds = icons._NAMES.map(kebab)
const sorted = a => [...new Set(a)].sort()
const spriteSet = sorted(spriteIds)
const nameSet = sorted(nameIds)
check(JSON.stringify(spriteSet) === JSON.stringify(nameSet),
  'sprite symbol 与 _NAMES 一一对应（' + spriteSet.length + ' 个）')
check(icons._NAMES.length === new Set(icons._NAMES).size, '_NAMES 无重复项')
check(spriteSet.length === new Set(spriteIds).size, 'sprite 无重复 symbol id')

// ── 关键业务图标存在性（Desktop 25 处引用 + viewer 2 处） ──
const critical = ['menu', 'moreVertical', 'arrowLeft', 'arrowRight', 'arrowUp', 'plus', 'home',
  'close', 'chevronLeft', 'folder', 'folderPlus', 'file', 'refreshCw', 'copy', 'maximize',
  'scissors', 'edit', 'trash', 'music']
for (const n of critical) {
  check(typeof icons[n] === 'string' && icons[n].indexOf('#icon-' + kebab(n)) >= 0, '关键图标可访问: ' + n)
}

if (failures > 0) { console.error('  [FAIL] icons 测试 ' + failures + ' 项失败'); process.exit(1) }
console.log('  [ok] icons 测试全部通过')
