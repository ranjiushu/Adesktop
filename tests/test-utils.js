// utils.js 单元测试：vm 加载真实模块，验证 escapeHtml（纯函数）
// 用法: node test-utils.js [项目路径]   （由 run-tests.sh 调用）
'use strict'

const fs = require('fs')
const path = require('path')
const vm = require('vm')

const PROJECT = process.argv[2] || path.join(__dirname, '..')
const SRC = path.join(PROJECT, 'src', 'js', 'utils.js')

let failures = 0
function check(cond, msg) {
  if (cond) {
    console.log('  [ok] ' + msg)
  } else {
    console.error('  [fail] ' + msg)
    failures++
  }
}

const source = fs.readFileSync(SRC, 'utf8')
const sandbox = { App: {}, window: { App: null }, console: console }
sandbox.App = sandbox.window.App = sandbox.App
sandbox.window.window = sandbox.window
vm.createContext(sandbox)
vm.runInContext(source, sandbox)

const utils = sandbox.App.utils

// 1. escapeHtml 五字符转义
check(utils.escapeHtml('<script>"\'&') === '&lt;script&gt;&quot;&#39;&amp;', 'escapeHtml 五字符转义')

// 2. 非字符串输入安全
check(utils.escapeHtml(null) === 'null', 'escapeHtml(null) 安全')
check(utils.escapeHtml(123) === '123', 'escapeHtml(数字) 安全')

// 3. 正常文本不受影响
check(utils.escapeHtml('你好 Desktop') === '你好 Desktop', 'escapeHtml 中文原样')

// 4. bindPress 存在（DOM 依赖，仅验证接口）
check(typeof utils.bindPress === 'function', 'bindPress 接口存在')

// 5. bindPressSplit 存在（长短按分流，DOM 依赖，仅验证接口）
check(typeof utils.bindPressSplit === 'function', 'bindPressSplit 接口存在')

// 5. bindPressSplit 存在（长短按分流，DOM 依赖，仅验证接口）
check(typeof utils.bindPressSplit === 'function', 'bindPressSplit 接口存在')

if (failures > 0) {
  console.error('[fail] utils 测试失败 ' + failures + ' 项')
  process.exit(1)
}
console.log('[ok] utils 测试全部通过')
process.exit(0)
