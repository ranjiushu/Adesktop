// markdown.js 纯函数单元测试：基础 Markdown 渲染 + 转义安全
// 用法: node test-markdown.js [项目路径]   （由 run-tests.sh 调用）
'use strict'

const fs = require('fs')
const path = require('path')
const vm = require('vm')

const PROJECT = process.argv[2] || path.join(__dirname, '..')
const SRC = path.join(PROJECT, 'src', 'js', 'markdown.js')

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
const sandbox = { App: {}, console: console }
vm.createContext(sandbox)
vm.runInContext(source, sandbox, { filename: 'markdown.js' })

const M = sandbox.App.Markdown

// ── 标题 ──
check(M.render('# 标题') === '<h1>标题</h1>', '# 标题 → h1')
check(M.render('### 三级') === '<h3>三级</h3>', '### 三级 → h3')

// ── 列表 ──
check(M.render('- 甲\n- 乙') === '<ul><li>甲</li><li>乙</li></ul>', '无序列表聚合')
check(M.render('1. 一\n2. 二') === '<ol><li>一</li><li>二</li></ol>', '有序列表聚合')
// 多行列表项：缩进续行并入上一项（软换行 = 空格，与段落口径一致）
check(M.render('- 甲\n  续行甲') === '<ul><li>甲 续行甲</li></ul>', '无序列表缩进续行并入当前项')
check(M.render('1. 一\n  续行一\n2. 二') === '<ol><li>一 续行一</li><li>二</li></ol>', '有序列表缩进续行并入当前项')
check(M.render('- 甲\n\n- 乙') === '<ul><li>甲</li></ul>\n<ul><li>乙</li></ul>', '列表间空行分段')
check(M.render('- 甲\n  续行 `code` **粗**') === '<ul><li>甲 续行 <code>code</code> <strong>粗</strong></li></ul>', '续行内行内标记生效')

// ── 代码块 ──
check(M.render('```js\nconst a = 1\n```') === '<pre><code class="lang-js">const a = 1</code></pre>',
  '围栏代码块（带语言）')
check(M.render('```\n<b>原始</b>\n```') === '<pre><code>&lt;b&gt;原始&lt;/b&gt;</code></pre>',
  '代码块内 HTML 转义')

// ── 行内标记 ──
check(M.render('**粗**') === '<p><strong>粗</strong></p>', '粗体')
check(M.render('*斜*') === '<p><em>斜</em></p>', '斜体')
check(M.render('`code`') === '<p><code>code</code></p>', '行内代码')
check(M.render('[链接](https://example.com)') === '<p><a href="https://example.com">链接</a></p>', '链接')

// ── 引用 / 分割线 / 段落 ──
check(M.render('> 引用') === '<blockquote>引用</blockquote>', '引用')
check(M.render('---') === '<hr>', '分割线')
check(M.render('第一行\n第二行') === '<p>第一行 第二行</p>', '段落内单换行 → 空格')

// ── 安全：HTML/脚本注入 ──
check(M.render('<script>alert(1)</script>').indexOf('<script>') === -1, 'script 标签被转义')
check(M.render('<img src=x onerror=alert(1)>').indexOf('<img') === -1, 'img 标签被转义')
const jsLink = M.render('[x](javascript:alert(1))')
check(jsLink.indexOf('<a') === -1 && jsLink.indexOf('javascript:') === -1,
  'javascript: 链接协议拒绝（不产生链接且不泄漏协议）')
check(M.render('[x](https://ok.com)').indexOf('https://ok.com') >= 0, 'http(s) 链接放行')

// ── 未闭合围栏不吞内容 ──
check(M.render('```\n残片') === '<pre><code>残片</code></pre>', '未闭合围栏输出已收集内容')

if (failures > 0) {
  console.error('  [FAIL] markdown 测试 ' + failures + ' 项失败')
  process.exit(1)
}
console.log('  [ok] markdown 测试全部通过')
