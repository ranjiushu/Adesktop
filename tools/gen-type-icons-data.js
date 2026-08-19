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
// 对齐 MT 管理器(Apktool M) 15 类文件图标 + markdown/code 两个额外细分
// 合并: json→text, word→text, ppt→text; 新增: dex, jar, lib, file
// 颜色来自 MT 管理器实机截图提取（用户2026-08-19提供）
const SPEC = {
  text:       { glyph: 'file-document',     color: '#3860AF', label: '文本' },
  markdown:   { glyph: 'language-markdown', color: '#7B1FA2', label: 'Markdown' },
  html:       { glyph: 'language-html5',    color: '#2083BD', label: 'HTML' },
  code:       { glyph: 'code-tags',         color: '#3860AF', label: '代码' },
  image:      { glyph: 'image',             color: '#777777', label: '图片' },
  video:      { glyph: 'video',             color: '#FB8C00', label: '视频' },
  audio:      { glyph: 'music',             color: '#E53935', label: '音频' },
  archive:    { glyph: 'zip-box',           color: '#795548', label: '压缩包' },
  pdf:        { glyph: 'file-pdf-box',      color: '#D81E06', label: 'PDF' },
  excel:      { glyph: 'file-excel',        color: '#6D9B00', label: 'Excel' },
  font:       { glyph: 'format-font',       color: '#3F51B5', label: '字体' },
  executable: { glyph: 'android',           color: '#40AD3E', label: '可执行' },
  dex:        { glyph: 'file-cog',          color: '#5F9EA0', label: 'DEX' },
  jar:        { glyph: 'archive-cog',       color: '#795548', label: 'JAR' },
  lib:        { glyph: 'library',           color: '#607D8B', label: '共享库' },
  file:       { glyph: 'file',              color: '#795548', label: '通用文件' },
  folder:     { glyph: 'folder',            color: '#2B2B2B', label: '目录' }
}

function glyphPath(svgFile) {
  const p = path.join(SRC, svgFile + '.svg')
  if (!fs.existsSync(p)) { console.error('[gen] 缺失字形: ' + p); process.exit(1) }
  const s = fs.readFileSync(p, 'utf8')
  const m = s.match(/<path d="([^"]+)"/)
  if (!m) { console.error('[gen] 无法解析字形: ' + p); process.exit(1) }
  return m[1]
}

// 生成条目：瓷砖 = 彩色圆角方块 + 白色缩小字形；folder 例外（经典文件夹字形，无底）
// 字形缩放到 16x16 居中（4px 边距），匹配 MT 管理器留白比例
const GLYPH_SIZE = 16
const GLYPH_OFFSET = (24 - GLYPH_SIZE) / 2  // 4
const GLYPH_SCALE = (GLYPH_SIZE / 24).toFixed(4)  // 0.6667

function tile(kind, spec) {
  const d = glyphPath(spec.glyph)
  if (kind === 'folder') {
    return '<svg viewBox="0 0 24 24"><path fill="' + spec.color + '" d="' + d + '"/></svg>'
  }
  return '<svg viewBox="0 0 24 24"><rect width="24" height="24" rx="4.5" fill="' + spec.color + '"/>' +
    '<g transform="translate(' + GLYPH_OFFSET + ',' + GLYPH_OFFSET + ') scale(' + GLYPH_SCALE + ')">' +
    '<path fill="#fff" d="' + d + '"/></g></svg>'
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
