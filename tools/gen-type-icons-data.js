#!/usr/bin/env node
// 生成 src/js/type-icons-data.js：将优化后的 Vivid 风格 SVG 图标打包为 JS 数据模块。
// 用法: node tools/gen-type-icons-data.js <svg-dir> [输出路径]
//   <svg-dir>  含扩展名命名的 .svg（如 pdf.svg、docx.svg）+ folder.svg（目录图标）
//   输出默认 src/js/type-icons-data.js（须登记进 tools/build-web.sh 的 JS_ORDER）
// 图标来源: https://github.com/dmhendricks/file-icon-vectors 的 Vivid 套（MIT）
//   —— 由 opt 脚本去除 xmlns/id/style/class、内联 fill 后作为输入。
'use strict'
const fs = require('fs')
const path = require('path')

const SRC = process.argv[2]
const OUT = process.argv[3] || path.join(__dirname, '..', 'src', 'js', 'type-icons-data.js')
if (!SRC) { console.error('用法: node gen-type-icons-data.js <svg-dir> [输出路径]'); process.exit(1) }

const files = fs.readdirSync(SRC).filter(f => f.endsWith('.svg')).sort()
if (!files.length) { console.error('目录无 SVG: ' + SRC); process.exit(1) }

const entries = files.map(f => {
  const key = f.slice(0, -4) // 去 .svg：扩展名 / folder
  const svg = fs.readFileSync(path.join(SRC, f), 'utf8').trim()
  return "  '" + key + "': '" + svg.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"
})

const header = [
  '/* 类型图标数据：Vivid 风格全彩 SVG（file-icon-vectors，MIT）压缩版。',
  ' * 键 = 扩展名（folder 为目录图标）；值 = 内联 SVG（无 xmlns/style/class，fill 已内联）。',
  ' * 来源: https://github.com/dmhendricks/file-icon-vectors（Vivid 套，MIT License）',
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
console.log('[gen] ' + files.length + ' 个图标 → ' + OUT + '（' + (header.length / 1024).toFixed(1) + 'KB）')
