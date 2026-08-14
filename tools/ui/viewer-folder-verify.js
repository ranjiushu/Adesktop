// folder 容器沉浸式验证
'use strict'
const path = require('path')
const { launch } = require('/skills/ui-verify/scripts/lib/browser.js')
const HTML = 'file://' + path.join('/workspace/Desktop', 'dist', 'desktop.bundle.html')
let failures = 0
function check(cond, msg) { if (cond) console.log('  [ok] ' + msg); else { console.error('  [fail] ' + msg); failures++ } }
async function main() {
  const browser = await launch()
  const page = await browser.newPage()
  await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2.75 })
  await page.evaluateOnNewDocument(function () {
    const FILES = {
      '': [{ name: 'docs', isDir: true, size: 0, mtime: 0 }],
      'docs': [{ name: 'guide.md', isDir: false, size: 80, mtime: 0 }, { name: 'pic.png', isDir: false, size: 500, mtime: 0 }]
    }
    const CONTENT = { 'docs/guide.md': '# 子目录文档\n\n正文内容' }
    const URIS = { 'docs/pic.png': 'file:///mock/pic.png' }
    function __ok(id, data) { window.__fbResolve(id, { ok: true, data: data }) }
    function __err(id, msg) { window.__fbResolve(id, { ok: false, error: msg }) }
    window.FileBridge = {
      rootInfo: function (cb) { __ok(cb, { rootName: 'mock', mode: 'private', displayPath: '/mock' }) },
      list: function (p, cb) { __ok(cb, FILES[p || ''] || []) },
      read: function (p, cb) { if (p in CONTENT) __ok(cb, CONTENT[p]); else __err(cb, '不存在: ' + p) },
      resolveUri: function (p, cb) { if (p in URIS) __ok(cb, URIS[p]); else __err(cb, '无 URI: ' + p) },
      openExternal: function (p, cb) { __err(cb, '浏览器无外部应用') },
      vibrate: function () {}, requestRootAccess: function () {}
    }
  })
  await page.goto(HTML, { waitUntil: 'networkidle0' })
  await page.waitForFunction(function () { return window.App && document.querySelector('.desktop-icon') }, { timeout: 10000 })
  // 进入 docs 子目录
  await page.evaluate(function () { App.Desktop.openItem('docs') })
  await page.waitForFunction(function () { return document.querySelectorAll('.desktop-icon').length === 2 }, { timeout: 5000 })
  console.log('═══ folder 沉浸式查看 ═══')
  await page.evaluate(function () { App.FileOpener.open({ name: 'guide.md', path: 'docs/guide.md' }, null) })
  await page.waitForFunction(function () { return document.querySelector('.viewer-md h1') }, { timeout: 5000 })
  const r = await page.evaluate(function () {
    const layer = document.getElementById('viewer-layer')
    const lb = layer.getBoundingClientRect()
    const c = document.querySelector('.viewer-card').getBoundingClientRect()
    return { x: c.x - lb.x, y: c.y - lb.y, w: c.width, h: c.height, lbW: lb.width, lbH: lb.height, open: App.InternalViewer.isOpen() }
  })
  check(r.open && r.x === 0 && r.y === 0 && Math.abs(r.w - r.lbW) < 1 && Math.abs(r.h - r.lbH) < 1,
    '沉浸式占满内容区（' + r.w.toFixed(0) + '×' + r.h.toFixed(0) + '）')
  // 返回键关闭 viewer 而非退出目录
  const back = await page.evaluate(function () { return App.handleSystemBack() })
  const after = await page.evaluate(function () { return App.InternalViewer.isOpen() })
  check(back === true && after === false, '返回键关闭 viewer（不退出目录）')
  const cur = await page.evaluate(function () { return App.Desktop.getCurPath() })
  check(cur === 'docs', '目录上下文保持 docs')
  await browser.close()
  if (failures > 0) { console.error('[FAIL] ' + failures + ' 项失败'); process.exit(1) }
  console.log('[ok] folder 沉浸式验证通过')
}
main().catch(function (e) { console.error('[FAIL]', e.message); process.exit(1) })
