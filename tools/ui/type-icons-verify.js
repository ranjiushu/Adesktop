// 类型图标系统验证：SVG 类型图标替代 emoji + 位图图片缩略图 + 失败回退类型图标。
// 三条缩略图路径：成功（data:image）/ resolveUri 失败（reject → 回退）/ img 加载失败（onerror → 回退）
'use strict'
const path = require('path')
const { launch } = require('/skills/ui-verify/scripts/lib/browser.js')
const HTML = 'file://' + path.join('/workspace/Desktop', 'dist', 'desktop.bundle.html')
let failures = 0
function check(cond, msg) {
  if (cond) console.log('  [ok] ' + msg)
  else { console.error('  [fail] ' + msg); failures++ }
}

async function main() {
  const browser = await launch()
  const page = await browser.newPage()
  await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2.75 })
  await page.evaluateOnNewDocument(function () {
    const FILES = {
      '': [
        { name: '.trash', isDir: true, size: 0, mtime: 1 },
        { name: 'docs', isDir: true, size: 0, mtime: 2 },
        { name: 'note.txt', isDir: false, size: 10, mtime: 3 },
        { name: 'app.js', isDir: false, size: 20, mtime: 4 },
        { name: 'photo.jpg', isDir: false, size: 30, mtime: 5 },
        { name: 'reject.png', isDir: false, size: 40, mtime: 6 },
        { name: 'broken.webp', isDir: false, size: 50, mtime: 7 },
        { name: 'backup.zip', isDir: false, size: 60, mtime: 8 },
        { name: 'report.pdf', isDir: false, size: 70, mtime: 9 },
        { name: 'movie.mp4', isDir: false, size: 80, mtime: 10 }
      ]
    }
    function __ok(id, data) { window.__fbResolve(id, { ok: true, data: data }) }
    function __err(id, msg) { window.__fbResolve(id, { ok: false, error: msg }) }
    window.FileBridge = {
      rootInfo: function (cb) { __ok(cb, { rootName: 'mock', mode: 'private', displayPath: '/mock', trashName: '.trash' }) },
      list: function (p, cb) { __ok(cb, (FILES[p || ''] || []).slice()) },
      read: function (p, cb) { __err(cb, '无内容') },
      thumb: function (p, cb) {
        if (p === 'photo.jpg' || p === 'movie.mp4') __ok(cb, "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
        else if (p === 'broken.webp') __ok(cb, 'file:///nonexistent/broken.webp')
        else __err(cb, '无法生成缩略图: ' + p)
      },
      resolveUri: function (p, cb) { __err(cb, '无 URI') },
      openExternal: function (p, cb) { __err(cb, '浏览器无外部应用') },
      vibrate: function () {}, requestRootAccess: function () {}
    }
  })
  await page.goto(HTML, { waitUntil: 'networkidle0' })
  await page.waitForFunction(function () {
    return window.App && document.querySelectorAll('.desktop-icon').length >= 10
  }, { timeout: 10000 })

  console.log('═══ 类型图标（SVG 替代 emoji） ═══')
  const glyphs = await page.evaluate(function () {
    const out = {}
    document.querySelectorAll('.desktop-icon').forEach(function (el) {
      const name = el.getAttribute('data-name')
      const glyph = el.querySelector('.desktop-icon-glyph')
      const svg = glyph ? glyph.querySelector('svg.type-icon') : null
      const thumb = glyph ? glyph.querySelector('img.desktop-icon-thumb') : null
      out[name] = {
        svgClass: svg ? svg.getAttribute('class') : null,
        hasThumb: !!thumb,
        glyphHTML: glyph ? glyph.innerHTML.slice(0, 40) : ''
      }
    })
    return out
  })
  check(glyphs['note.txt'] && glyphs['note.txt'].svgClass === 'type-icon type-text', 'note.txt → SVG type-text')
  check(glyphs['app.js'] && glyphs['app.js'].svgClass === 'type-icon type-code', 'app.js → SVG type-code')
  check(glyphs['docs'] && glyphs['docs'].svgClass === 'type-icon type-folder', 'docs → SVG type-folder')
  check(glyphs['.trash'] && glyphs['.trash'].svgClass === 'type-icon type-trash', '.trash → SVG type-trash（回收站）')
  check(glyphs['backup.zip'] && glyphs['backup.zip'].svgClass === 'type-icon type-archive', 'backup.zip → SVG type-archive')
  check(glyphs['report.pdf'] && glyphs['report.pdf'].svgClass === 'type-icon type-pdf', 'report.pdf → SVG type-pdf')

  console.log('═══ 缩略图三条路径 ═══')
  // 成功路径：photo.jpg → img 缩略图（自然尺寸 > 0）
  await page.waitForFunction(function () {
    const el = document.querySelector('.desktop-icon[data-name="photo.jpg"] .desktop-icon-thumb')
    return el && el.complete && el.naturalWidth > 0
  }, { timeout: 5000 })
  const photoOk = await page.evaluate(function () {
    const el = document.querySelector('.desktop-icon[data-name="photo.jpg"] .desktop-icon-thumb')
    return !!el
  })
  check(photoOk, 'photo.jpg → img 缩略图（成功路径）')

  // 视频帧缩略图：movie.mp4 → img 缩略图（桥层 thumb 帧提取）
  await page.waitForFunction(function () {
    const el = document.querySelector('.desktop-icon[data-name="movie.mp4"] .desktop-icon-thumb')
    return el && el.complete && el.naturalWidth > 0
  }, { timeout: 5000 })
  const movieOk = await page.evaluate(function () {
    const el = document.querySelector('.desktop-icon[data-name="movie.mp4"] .desktop-icon-thumb')
    return !!el
  })
  check(movieOk, 'movie.mp4 → img 缩略图（视频帧提取）')

  // 失败路径 1：reject.png → thumb reject → 回退类型图标（type-image）
  await page.waitForFunction(function () {
    const g = document.querySelector('.desktop-icon[data-name="reject.png"] .desktop-icon-glyph')
    return g && g.querySelector('svg.type-icon.type-image')
  }, { timeout: 5000 })
  check(true, 'reject.png → thumb 失败 → 回退 type-image SVG')

  // 失败路径 2：broken.webp → img 加载失败 onerror → 回退类型图标（type-image）
  await page.waitForFunction(function () {
    const g = document.querySelector('.desktop-icon[data-name="broken.webp"] .desktop-icon-glyph')
    return g && g.querySelector('svg.type-icon.type-image')
  }, { timeout: 5000 })
  check(true, 'broken.webp → img onerror → 回退 type-image SVG')

  await browser.close()
  if (failures > 0) { console.error('[FAIL] ' + failures + ' 项失败'); process.exit(1) }
  console.log('[ok] 类型图标系统验证通过')
}
main().catch(function (e) { console.error('[FAIL]', e.message); process.exit(1) })
