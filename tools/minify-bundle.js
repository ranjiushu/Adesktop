#!/usr/bin/env node
// 构建产物压缩：terser(JS) + clean-css(CSS)，产出 dist/desktop.bundle.min.html
// =============================================================================
// 用法: node tools/minify-bundle.js   （需先运行 bash tools/build-web.sh）
// 安全边界:
//   - 主 script 块 terser mangle + compress（passes:2），drop_console:false
//   - CSS clean-css level 2：剥注释 + 空白/合并优化，类名语义不变
//   - 顶层标识符不 rename（toplevel:false），App 等跨模块全局引用安全
//   - 构建注入变量（BUILD_COUNT/BUILD_TIMESTAMP）为顶层 var，不受影响
// 退出码: 0 成功 / 1 失败
// =============================================================================
'use strict'

const fs = require('fs')
const path = require('path')
const terser = require('terser')
const CleanCSS = require('clean-css')

const SRC = path.join(__dirname, '..', 'dist', 'desktop.bundle.html')
const OUT = path.join(__dirname, '..', 'dist', 'desktop.bundle.min.html')

function fail(msg) {
  console.error('[minify] ' + msg)
  process.exit(1)
}

if (!fs.existsSync(SRC)) fail('未找到 ' + SRC + '（先运行 bash tools/build-web.sh）')

const s = fs.readFileSync(SRC, 'utf8')

// ── 提取块：保留 <script>/<style> 完整标签结构 ──
const re = /(<script[^>]*>)([\s\S]*?)(<\/script>)|(<style[^>]*>)([\s\S]*?)(<\/style>)/g
const blocks = []
const shell = s.replace(re, (m, sOpen, sInner, sClose, cOpen, cInner, cClose) => {
  const isScript = !!sOpen
  const open = isScript ? sOpen : cOpen
  const inner = isScript ? sInner : cInner
  const close = isScript ? sClose : cClose
  const idx = blocks.length
  blocks.push({ isScript, inner })
  return open + '###B' + idx + '###' + close
})

;(async () => {
  const results = []
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]
    if (b.isScript) {
      const r = await terser.minify(b.inner, {
        compress: { passes: 2 },
        mangle: true,
        toplevel: false,
        format: { comments: false }
      })
      if (r.error) fail('JS 压缩失败 (block ' + i + '): ' + r.error.message)
      results.push(r.code)
    } else {
      const r = new CleanCSS({ level: 2 }).minify(b.inner)
      if (r.errors && r.errors.length) fail('CSS 压缩失败 (block ' + i + '): ' + r.errors.join('; '))
      results.push(r.styles)
    }
  }

  let out = shell
  for (let i = 0; i < blocks.length; i++) {
    out = out.replace('###B' + i + '###', () => results[i])
  }

  fs.writeFileSync(OUT, out)
  const orig = fs.statSync(SRC).size
  const min = Buffer.byteLength(out)
  const pct = Math.round((1 - min / orig) * 100)
  console.log('[minify] ' + orig + ' -> ' + min + ' bytes (-' + pct + '%) -> ' + OUT)
})().catch((e) => {
  fail(e && e.message ? e.message : String(e))
})
