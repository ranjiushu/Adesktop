// Viewer folder 容器验证：进入子目录 → 打开文件（无锚点 → 全屏沉浸式）
//   - 全屏占满内容区 + layer 拦截触摸
//   - FAB「关闭预览」关闭；取消选择 = 关闭预览
//   - 目录上下文保持
'use strict'
const path = require('path')
const { launch } = require('/skills/ui-verify/scripts/lib/browser.js')
const HTML = 'file://' + path.join(__dirname, '..', '..', 'dist', 'desktop.bundle.html')
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

  console.log('═══ folder 全屏沉浸式 ═══')
  await page.evaluate(function () { App.Desktop.openItem('docs/guide.md') })
  await page.waitForFunction(function () { return document.querySelector('.viewer-card-fullscreen') }, { timeout: 5000 })
  const r = await page.evaluate(function () {
    const layer = document.getElementById('viewer-layer')
    const lb = layer.getBoundingClientRect()
    const c = document.querySelector('.viewer-card-fullscreen').getBoundingClientRect()
    return {
      full: Math.abs(c.width - lb.width) < 1 && Math.abs(c.height - lb.height) < 1,
      inLayer: document.querySelector('.viewer-card-fullscreen').parentNode === layer,
      layerOpen: layer.classList.contains('viewer-layer-open'),
      mode: App.InternalViewer.getMode(),
      selected: document.querySelectorAll('.desktop-icon.selected').length
    }
  })
  check(r.full && r.inLayer && r.layerOpen, 'folder 打开文件 → 全屏占满内容区 + 拦截触摸')
  check(r.mode === 'fullscreen', 'folder 模式 = 全屏形态')
  check(r.selected === 1, '文件保持选中态（FAB 关闭入口可用）')

  console.log('═══ FAB 关闭预览（folder）═══')
  const closed = await page.evaluate(function () {
    document.querySelector('[data-action="close-preview"]').click()
    return {
      open: App.InternalViewer.isOpen(),
      layerOpen: document.getElementById('viewer-layer').classList.contains('viewer-layer-open'),
      cur: App.Desktop.getCurPath()
    }
  })
  check(!closed.open && !closed.layerOpen && closed.cur === 'docs', '关闭预览后：Viewer 关、目录保持 docs')

  console.log('═══ 返回键关闭 + 目录保持 ═══')
  await page.evaluate(function () { App.Desktop.openItem('docs/guide.md') })
  await page.waitForFunction(function () { return App.InternalViewer.isOpen() }, { timeout: 5000 })
  const back = await page.evaluate(function () {
    const handled = App.handleSystemBack()
    return { handled: handled, open: App.InternalViewer.isOpen(), cur: App.Desktop.getCurPath() }
  })
  check(back.handled && !back.open && back.cur === 'docs', '返回键关闭 Viewer，目录保持 docs')

  await browser.close()
  if (failures > 0) { console.error('[FAIL] ' + failures + ' 项失败'); process.exit(1) }
  console.log('[ok] folder 验证通过')
}
main().catch(function (e) { console.error('[FAIL]', e.message); process.exit(1) })
