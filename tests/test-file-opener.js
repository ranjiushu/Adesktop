// file-opener.js 纯函数单元测试：扩展名 → 查看器类型判定
// 用法: node test-file-opener.js [项目路径]   （由 run-tests.sh 调用）
'use strict'

const fs = require('fs')
const path = require('path')
const vm = require('vm')

const PROJECT = process.argv[2] || path.join(__dirname, '..')
const SRC = path.join(PROJECT, 'src', 'js', 'file-opener.js')

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
vm.runInContext(source, sandbox, { filename: 'file-opener.js' })

const F = sandbox.App.FileOpener

// ── 文本类 ──
check(F.kindFor('readme.txt') === 'text', 'readme.txt → text')
check(F.kindFor('a.log') === 'text', 'a.log → text')
check(F.kindFor('config.ini') === 'text', 'config.ini → text')

// ── Markdown ──
check(F.kindFor('readme.md') === 'markdown', 'readme.md → markdown')
check(F.kindFor('README.MARKDOWN') === 'markdown', '大写扩展名归一化')

// ── JSON / HTML / SVG ──
check(F.kindFor('data.json') === 'json', 'data.json → json')
check(F.kindFor('index.html') === 'html', 'index.html → html')
check(F.kindFor('page.htm') === 'html', 'page.htm → html')
check(F.kindFor('icon.svg') === 'svg', 'icon.svg → svg')

// ── 图片 / 视频 / 音频 ──
check(F.kindFor('a.jpg') === 'image' && F.kindFor('a.jpeg') === 'image', 'jpg/jpeg → image')
check(F.kindFor('a.png') === 'image' && F.kindFor('a.webp') === 'image', 'png/webp → image')
check(F.kindFor('a.gif') === 'image', 'gif → image')
check(F.kindFor('a.mp4') === 'video' && F.kindFor('a.webm') === 'video', 'mp4/webm → video')
check(F.kindFor('a.mp3') === 'audio' && F.kindFor('a.m4a') === 'audio', 'mp3/m4a → audio')
check(F.kindFor('a.wav') === 'audio', 'wav → audio')

// ── 快捷方式 (.desktop) ──
check(F.kindFor('微信.desktop') === 'shortcut', '微信.desktop → shortcut')
check(F.kindFor('a.DESKTOP') === 'shortcut', '大写 .DESKTOP → shortcut')

// ── 外部 ──
check(F.kindFor('a.pdf') === 'external', 'pdf → external（Intent）')
check(F.kindFor('a.docx') === 'external', 'docx → external')
check(F.kindFor('a.zip') === 'external', 'zip → external')
check(F.kindFor('noext') === 'external', '无扩展名 → external')
check(F.kindFor('.hidden') === 'external', '点开头隐藏文件 → external')

// ── extOf 边界 ──
check(F.extOf('a.txt') === 'txt', 'extOf 小写化')
check(F.extOf('a.TXT') === 'txt', 'extOf 大写归一化')
check(F.extOf('a') === '', 'extOf 无扩展名 → 空')
check(F.extOf('') === '', 'extOf 空串 → 空')

if (failures > 0) {
  console.error('  [FAIL] file-opener 测试 ' + failures + ' 项失败')
  process.exit(1)
}
console.log('  [ok] file-opener 测试全部通过')
