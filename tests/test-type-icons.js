// type-icons.js 纯函数单元测试：类型判定（kindFor）/ 缩略图判定（canThumbnail）/
// SVG 生成（svgFor）。vm 加载真实 type-icons.js + namespace.js。
// 用法: node test-type-icons.js [项目路径]   （由 run-tests.sh 调用）
'use strict'

const fs = require('fs')
const path = require('path')
const vm = require('vm')

const PROJECT = process.argv[2] || path.join(__dirname, '..')
const SRC = path.join(PROJECT, 'src', 'js')

let failures = 0
function check(cond, msg) {
  if (cond) console.log('  [ok] ' + msg)
  else { console.error('  [fail] ' + msg); failures++ }
}

const sandbox = { App: {}, console: console, window: { App: {} } }
vm.createContext(sandbox)
vm.runInContext(fs.readFileSync(path.join(SRC, 'namespace.js'), 'utf8'), sandbox, { filename: 'namespace.js' })
vm.runInContext(fs.readFileSync(path.join(SRC, 'type-icons.js'), 'utf8'), sandbox, { filename: 'type-icons.js' })

const T = sandbox.App.TypeIcons

// ── 目录 → folder ──
check(T.kindFor('docs', true) === 'folder', '目录 → folder')

// ── 文本类 ──
check(T.kindFor('a.txt', false) === 'text', 'txt → text')
check(T.kindFor('b.LOG', false) === 'text', 'LOG（大写）→ text')
check(T.kindFor('notes.md', false) === 'markdown', 'md → markdown')
check(T.kindFor('data.json', false) === 'json', 'json → json')

// ── 标记/代码 ──
check(T.kindFor('page.html', false) === 'html', 'html → html')
check(T.kindFor('app.js', false) === 'code', 'js → code')
check(T.kindFor('main.py', false) === 'code', 'py → code')
check(T.kindFor('style.css', false) === 'code', 'css → code')

// ── 媒体 ──
check(T.kindFor('photo.jpg', false) === 'image', 'jpg → image')
check(T.kindFor('icon.svg', false) === 'image', 'svg → image')
check(T.kindFor('clip.mp4', false) === 'video', 'mp4 → video')
check(T.kindFor('song.mp3', false) === 'audio', 'mp3 → audio')

// ── 压缩/办公 ──
check(T.kindFor('backup.zip', false) === 'archive', 'zip → archive')
check(T.kindFor('doc.pdf', false) === 'pdf', 'pdf → pdf')
check(T.kindFor('report.docx', false) === 'word', 'docx → word')
check(T.kindFor('sheet.xlsx', false) === 'excel', 'xlsx → excel')
check(T.kindFor('slides.pptx', false) === 'ppt', 'pptx → ppt')

// ── 字体/可执行 ──
check(T.kindFor('font.ttf', false) === 'font', 'ttf → font')
check(T.kindFor('app.apk', false) === 'executable', 'apk → executable')

// ── 未知/无扩展名 ──
check(T.kindFor('noext', false) === 'unknown', '无扩展名 → unknown')
check(T.kindFor('file.xyzzy', false) === 'unknown', '未知扩展名 → unknown')
check(T.kindFor('', false) === 'unknown', '空名 → unknown')

// ── 缩略图判定（位图 true / 矢量与其余 false）──
check(T.canThumbnail('photo.jpg') === true, 'jpg 可缩略图')
check(T.canThumbnail('photo.png') === true, 'png 可缩略图')
check(T.canThumbnail('photo.webp') === true, 'webp 可缩略图')
check(T.canThumbnail('icon.svg') === false, 'svg 不可缩略图（用类型图标）')
check(T.canThumbnail('a.txt') === false, 'txt 不可缩略图')
check(T.canThumbnail('clip.mp4') === false, 'mp4 不可缩略图')

// ── SVG 生成 ──
const svgText = T.svgFor('text')
check(svgText.indexOf('<svg') === 0, 'svgFor 返回 <svg>')
check(svgText.indexOf('type-icon type-text') >= 0, 'svgFor 含 type-text class')
check(T.svgFor('unknown').indexOf('type-unknown') >= 0, 'svgFor unknown 回退 class')
check(T.svgFor('no-such-kind').indexOf('type-no-such-kind') >= 0, 'svgFor 未登记 kind 保留原 class（形态回退 file）')
check(T.svgFor('no-such-kind').indexOf('M13 2H6') >= 0, 'svgFor 未知 kind 形态回退 file')

if (failures > 0) { console.error('  [FAIL] type-icons 测试 ' + failures + ' 项失败'); process.exit(1) }
console.log('  [ok] type-icons 测试全部通过')
