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
vm.runInContext(fs.readFileSync(path.join(SRC, 'type-icons-data.js'), 'utf8'), sandbox, { filename: 'type-icons-data.js' })
vm.runInContext(fs.readFileSync(path.join(SRC, 'type-icons.js'), 'utf8'), sandbox, { filename: 'type-icons.js' })

const T = sandbox.App.TypeIcons

// ── 目录 → folder ──
check(T.kindFor('docs', true) === 'folder', '目录 → folder')

// ── 文本类 ──
check(T.kindFor('a.txt', false) === 'text', 'txt → text')
check(T.kindFor('b.LOG', false) === 'text', 'LOG（大写）→ text')
check(T.kindFor('notes.md', false) === 'markdown', 'md → markdown')
check(T.kindFor('data.json', false) === 'text', 'json → text（合入 MT text 类型）')
check(T.kindFor('report.docx', false) === 'text', 'docx → text（合入 MT text 类型）')
check(T.kindFor('slides.pptx', false) === 'text', 'pptx → text（合入 MT text 类型）')

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
check(T.kindFor('sheet.xlsx', false) === 'excel', 'xlsx → excel')

// ── 字体/可执行 ──
check(T.kindFor('font.ttf', false) === 'font', 'ttf → font')
check(T.kindFor('app.apk', false) === 'executable', 'apk → executable')

// ── MT 管理器新增类型 ──
check(T.kindFor('classes.dex', false) === 'dex', 'dex → dex')
check(T.kindFor('lib.jar', false) === 'jar', 'jar → jar')
check(T.kindFor('libfoo.so', false) === 'lib', 'so → lib')
check(T.kindFor('lib.dll', false) === 'lib', 'dll → lib')

// ── 快捷方式 ──
check(T.kindFor('微信.desktop', false) === 'shortcut', 'desktop → shortcut')

// ── 未知/无扩展名 ──
check(T.kindFor('noext', false) === 'unknown', '无扩展名 → unknown')
check(T.kindFor('file.xyzzy', false) === 'unknown', '未知扩展名 → unknown')
check(T.kindFor('', false) === 'unknown', '空名 → unknown')

// ── SVG 生成 ──
const svgText = T.svgFor('text')
check(svgText.indexOf('<svg') === 0, 'svgFor 返回 <svg>')
check(svgText.indexOf('type-icon type-text') >= 0, 'svgFor 含 type-text class')
check(T.svgFor('unknown').indexOf('type-unknown') >= 0, 'svgFor unknown 回退 class')
check(T.svgFor('no-such-kind').indexOf('type-no-such-kind') >= 0, 'svgFor 未登记 kind 保留原 class（形态回退 file）')
check(T.svgFor('no-such-kind').indexOf('M13 2H6') >= 0, 'svgFor 未知 kind 形态回退 file')

// ── 全彩瓷砖（iconFor 三级解析）──
const dataKeys = Object.keys(sandbox.App.TypeIconsData || {})
check(dataKeys.length >= 17, 'type-icons-data 内置瓷砖 ≥ 17（实际 ' + dataKeys.length + '）')

const pdfIcon = T.iconFor('a.pdf', false)
check(pdfIcon.indexOf('<svg') === 0, 'iconFor pdf 返回 <svg>')
check(pdfIcon.indexOf('type-icon type-pdf') >= 0, 'iconFor pdf 含 type-pdf class')
check(pdfIcon.indexOf('viewBox="0 0 24 24"') >= 0, 'iconFor pdf 为 24x24 瓷砖')
check(pdfIcon.indexOf('stroke="currentColor"') < 0, 'iconFor pdf 非线条版')
check(pdfIcon.indexOf('#D81E06') >= 0, 'iconFor pdf 含红色瓷砖底色')

// 扩展名归并：png/jpg 都走 image 瓷砖（同一种）
check(T.iconFor('a.png', false) === T.iconFor('a.jpg', false), 'png/jpg 归并为同一 image 瓷砖')

// kind 兜底：rs 不在数据表 → 走 code 瓷砖
const rsIcon = T.iconFor('a.rs', false)
check(rsIcon.indexOf('type-code') >= 0, 'iconFor rs 兜底 type-code')

// 新增 MT 类型瓷砖
check(T.iconFor('classes.dex', false).indexOf('type-dex') >= 0, 'iconFor dex → type-dex 瓷砖')
check(T.iconFor('lib.jar', false).indexOf('type-jar') >= 0, 'iconFor jar → type-jar 瓷砖')
check(T.iconFor('libfoo.so', false).indexOf('type-lib') >= 0, 'iconFor so → type-lib 瓷砖')

// 未知扩展名 → 线条占位
const unkIcon = T.iconFor('a.xyzzy', false)
check(unkIcon.indexOf('type-unknown') >= 0, 'iconFor 未知扩展名 → type-unknown')
check(unkIcon.indexOf('stroke="currentColor"') >= 0, 'iconFor 未知扩展名 → 线条占位')

// 目录 → 经典黄色文件夹
const dirIcon = T.iconFor('我的文档', true)
check(dirIcon.indexOf('type-folder') >= 0, 'iconFor 目录 → type-folder')
check(dirIcon.indexOf('M10,4H4C') >= 0, 'iconFor 目录 → Material folder 字形')
check(dirIcon.indexOf('stroke="currentColor"') < 0, 'iconFor 目录 → 全彩文件夹')

// 快捷方式/回收站 → 线条版（保持原样）
check(T.iconFor('微信.desktop', false).indexOf('type-shortcut') >= 0, 'iconFor .desktop → type-shortcut 线条版')
check(T.kindSvg('pdf').indexOf('type-pdf') >= 0 && T.kindSvg('pdf').indexOf('stroke="currentColor"') < 0, 'kindSvg pdf 瓷砖')
check(T.kindSvg('trash').indexOf('stroke="currentColor"') >= 0, 'kindSvg trash 线条版')

if (failures > 0) { console.error('  [FAIL] type-icons 测试 ' + failures + ' 项失败'); process.exit(1) }
console.log('  [ok] type-icons 测试全部通过')
