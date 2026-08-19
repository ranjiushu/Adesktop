#!/usr/bin/env node
// 生成 src/js/type-icons-data.js：Material Design Icons 字形 + 彩色圆角瓷砖（MT 管理器风格）。
// 用法: node tools/gen-type-icons-data.js <mdi-svg-dir> [输出路径]
//   <mdi-svg-dir>  含 MDI 官方字形 SVG（24x24 单 path，从
//                   https://github.com/Templarian/MaterialDesign/tree/master/svg 下载）
//   输出默认 src/js/type-icons-data.js（须登记进 tools/build-web.sh 的 JS_ORDER）
// 图标来源: Material Design Icons（https://pictogrammers.com/library/mdi/），
//   Apache-2.0（© Austin Andrews / Pictogrammers），字形下载自官方仓库 master/svg。
// 本文件将每个 kind 的 MDI 字形套上彩色圆角方块（rx=4.5/24），白色字形 = MT 管理器风格瓷砖。
'use strict'
const fs = require('fs')
const path = require('path')

const SRC = process.argv[2]
const OUT = process.argv[3] || path.join(__dirname, '..', 'src', 'js', 'type-icons-data.js')
if (!SRC) { console.error('用法: node gen-type-icons-data.js <mdi-svg-dir> [输出路径]'); process.exit(1) }

// kind → { glyph: MDI 图标文件名, color: 瓷砖底色, label: 说明 }
const SPEC = {
  text:       { glyph: 'file-document',     color: '#607d8b', label: '文本' },
  markdown:   { glyph: 'language-markdown', color: '#7b1fa2', label: 'Markdown' },
  json:       { glyph: 'code-json',         color: '#f9a825', label: 'JSON' },
  html:       { glyph: 'language-html5',    color: '#f4511e', label: 'HTML' },
  code:       { glyph: 'code-tags',         color: '#0288d1', label: '代码' },
  image:      { glyph: 'image',             color: '#26a69a', label: '图片' },
  video:      { glyph: 'video',             color: '#c2185b', label: '视频' },
  audio:      { glyph: 'music',             color: '#ec407a', label: '音频' },
  archive:    { glyph: 'zip-box',           color: '#fbc02d', label: '压缩包' },
  pdf:        { glyph: 'file-pdf-box',      color: '#e53935', label: 'PDF' },
  word:       { glyph: 'file-word',         color: '#1e88e5', label: 'Word' },
  excel:      { glyph: 'file-excel',        color: '#43a047', label: 'Excel' },
  ppt:        { glyph: 'file-powerpoint',   color: '#fb8c00', label: 'PPT' },
  font:       { glyph: 'format-font',       color: '#546e7a', label: '字体' },
  executable: { glyph: 'android',           color: '#00897b', label: '可执行' },
  folder:     { glyph: 'folder',            color: '#ffb300', label: '目录（无瓷砖，经典黄色文件夹）' }
}

function glyphPath(svgFile) {
  const p = path.join(SRC, svgFile + '.svg')
  if (!fs.existsSync(p)) { console.error('[gen] 缺失字形: ' + p); process.exit(1) }
  const s = fs.readFileSync(p, 'utf8')
  const m = s.match(/<path d="([^"]+)"/)
  if (!m) { console.error('[gen] 无法解析字形: ' + p); process.exit(1) }
  return m[1]
}

// 生成条目：瓷砖 = 彩色圆角方块 + 白色字形；folder 例外（经典文件夹字形，无底）
function tile(kind, spec) {
  const d = glyphPath(spec.glyph)
  if (kind === 'folder') {
    return '<svg viewBox="0 0 24 24"><path fill="' + spec.color + '" d="' + d + '"/></svg>'
  }
  return '<svg viewBox="0 0 24 24"><rect width="24" height="24" rx="4.5" fill="' + spec.color + '"/><path fill="#fff" d="' + d + '"/></svg>'
}

const entries = Object.keys(SPEC).map(kind => {
  const svg = tile(kind, SPEC[kind])
  return "  '" + kind + "': '" + svg.replace(/'/g, "\\'") + "'"
})

const header = [
  '/* 类型图标数据：Material Design Icons 字形 + 彩色圆角瓷砖（MT 管理器风格）。',
  ' * 键 = kind（text/markdown/.../folder）；值 = 内联 SVG（24x24）。',
  ' * 来源: Material Design Icons（https://pictogrammers.com/library/mdi/），Apache-2.0，',
  ' *   © Austin Andrews / Pictogrammers；字形下载自官方仓库 Templarian/MaterialDesign master/svg。',
  ' * 本文件由 tools/gen-type-icons-data.js 自动生成，勿手改；重新生成见该脚本头部说明。 */',
  '// @ts-check',
  "'use strict'",
  '',
  '/** @type {Record<string, string>} */',
  'App.TypeIconsData = {',
  entries.join(',\n'),
  '}',
  ''
].join('\n')

fs.writeFileSync(OUT, header)
console.log('[gen] ' + entries.length + ' 个瓷砖 → ' + OUT + '（' + (header.length / 1024).toFixed(1) + 'KB）')
