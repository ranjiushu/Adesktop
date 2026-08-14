// Viewer folder 容器验证：进入子目录 → 打开文件 = 全屏新页面 → 退出 = 关闭 + 目录保持
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
      '': [{ name: 'docs', isDir: true, size: 0, mtime: 0 }],
      'docs': [{ name: 'guide.md', isDir: false, size: 80, mtime: 0 }]
    }
    const CONTENT = { 'docs/guide.md': '# 子目录文档\n\n正文内容' }
    function __ok(id, data) { window.__fbResolve(id, { ok: true, data: data }) }
    function __err(id, msg) { window.__fbResolve(id, { ok: false, error: msg }) }
    window.FileBridge = {
      rootInfo: function (cb) { __ok(cb, { rootName: 'mock', mode: 'private', displayPath: '/mock' }) },
      list: function (p, cb) { __ok(cb, FILES[p || ''] || []) },
      read: function (p, cb) { if (p in CONTENT) __ok(cb, CONTENT[p]); else __err(cb, '不存在: ' + p) },
      resolveUri: function (p, cb) { __err(cb, '无 URI') },
      openExternal: function (p, cb) { __err(cb, '浏览器无外部应用') },
      vibrate: function () {}, requestRootAccess: function () {}
    }
  })
  await page.goto(HTML, { waitUntil: 'networkidle0' })
  await page.waitForFunction(function () { return window.App && document.querySelector('.desktop-icon') }, { timeout: 10000 })
  await page.evaluate(function () { App.Desktop.openItem('docs') })
  await page.waitForFunction(function () { return document.querySelectorAll('.desktop-icon').length === 1 }, { timeout: 5000 })

  console.log('═══ folder 打开文件 = 全屏新页面 ═══')
  await page.evaluate(function () { App.Desktop.openItem('docs/guide.md') })
  await page.waitForFunction(function () {
    return document.getElementById('viewer-fs-page').classList.contains('viewer-fs-page-open')
  }, { timeout: 5000 })
  const r = await page.evaluate(function () {
    const page = document.getElementById('viewer-fs-page')
    const card = document.querySelector('.viewer-card-fullscreen')
    const pb = page.getBoundingClientRect()
    const cb = card.getBoundingClientRect()
    return {
      full: Math.abs(cb.width - window.innerWidth) < 1 && Math.abs(cb.height - window.innerHeight) < 1,
      inPage: card.parentNode === page,
      mode: App.InternalViewer.getMode(),
      selected: document.querySelectorAll('.desktop-icon.selected').length,
      md: !!document.querySelector('.viewer-md h1'),
      fabHidden: document.getElementById('mode-switch-fab').classList.contains('fab-hidden')
    }
  })
  check(r.full && r.inPage, 'folder 打开 → 全屏新页面（fixed 覆盖全视口）')
  check(r.mode === 'fullscreen' && r.fabHidden, 'folder 全屏模式 + FAB 隐藏（简洁新页面）')
  check(r.selected === 1 && r.md, '文件保持选中 + 内容渲染')

  console.log('═══ 退出全屏 = 关闭 + 目录保持 ═══')
  const back = await page.evaluate(function () {
    const handled = App.handleSystemBack()
    return { handled: handled, open: App.InternalViewer.isOpen(),
             pageOpen: document.getElementById('viewer-fs-page').classList.contains('viewer-fs-page-open'),
             cur: App.Desktop.getCurPath() }
  })
  check(back.handled && !back.open && !back.pageOpen && back.cur === 'docs',
    '返回键退出全屏 → Viewer 关闭、目录保持 docs')

  await browser.close()
  if (failures > 0) { console.error('[FAIL] ' + failures + ' 项失败'); process.exit(1) }
  console.log('[ok] folder 全屏验证通过')
}
main().catch(function (e) { console.error('[FAIL]', e.message); process.exit(1) })
