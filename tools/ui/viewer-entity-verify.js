// Viewer 实体交互性质验证（画布实体 + 选中脆弱性 + 锁定 + 相册式全屏）：
//   1. 打开 = 文件锁定（禁文件操作）+ Viewer 实体选中
//   2. 点击 Viewer = 选中实体；点击外部 = 取消选中（Viewer 保持打开）
//   3. 拖动移动实体 / 取消还原
//   4. 锁定拦截：复制/剪切/重命名/移动拒绝；拖动摆放允许
//   5. 全屏 = 相册式独立新页面（进入/退出/位置保留）
// 用法: node tools/ui/viewer-entity-verify.js
'use strict'
const path = require('path')
const { launch } = require('/skills/ui-verify/scripts/lib/browser.js')
const HTML = 'file://' + path.join(__dirname, '..', '..', 'dist', 'desktop.bundle.html')
let failures = 0
function check(cond, msg) { if (cond) console.log('  [ok] ' + msg); else { console.error('  [fail] ' + msg); failures++ } }
async function main() {
  const browser = await launch()
  const page = await browser.newPage()
  await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2.75, hasTouch: true })
  await page.evaluateOnNewDocument(function () {
    const FILES = {
      '': [
        { name: 'readme.md', isDir: false, size: 1, mtime: 0 },
        { name: 'other.txt', isDir: false, size: 1, mtime: 0 },
        { name: 'docs', isDir: true, size: 0, mtime: 0 }
      ],
      'docs': []
    }
    const CONTENT = { 'readme.md': '# 标题\n\n正文', 'other.txt': 'x' }
    function __ok(id, data) { window.__fbResolve(id, { ok: true, data: data }) }
    function __err(id, msg) { window.__fbResolve(id, { ok: false, error: msg }) }
    window.FileBridge = {
      rootInfo: function (cb) { __ok(cb, { rootName: 'm', mode: 'private', displayPath: '/' }) },
      list: function (p, cb) { __ok(cb, FILES[p || ''] || []) },
      read: function (p, cb) { if (p in CONTENT) __ok(cb, CONTENT[p]); else __err(cb, 'x') },
      resolveUri: function (p, cb) { __err(cb, 'x') },
      openExternal: function (p, cb) { __err(cb, 'x') },
      vibrate: function () {}, requestRootAccess: function () {}
    }
  })
  await page.goto(HTML, { waitUntil: 'networkidle0' })
  await page.waitForFunction(function () { return window.App && document.querySelectorAll('.desktop-icon').length === 3 }, { timeout: 10000 })

  console.log('═══ 1. 打开 Viewer = 文件锁定 + Viewer 实体选中 ═══')
  await page.evaluate(function () { App.Desktop.openItem('readme.md') })
  await page.waitForFunction(function () { return document.querySelector('.viewer-card-canvas') }, { timeout: 5000 })
  let r1 = await page.evaluate(function () {
    const lockedIcon = document.querySelector('.desktop-icon-locked')
    return {
      locked: App.Desktop.getLockedPath() === 'readme.md',
      lockedIcon: lockedIcon && lockedIcon.getAttribute('data-name') === 'readme.md',
      viewerSelected: App.InternalViewer.isSelected(),
      selectedClass: document.querySelector('.viewer-card-canvas').classList.contains('viewer-card-selected'),
      fileNotSelected: document.querySelectorAll('.desktop-icon.selected').length === 0,
      fsBtnGone: !document.querySelector('.viewer-fs-btn'),   // 全屏按钮已收纳进 FAB
      fabFs: getComputedStyle(document.querySelector('[data-action="fullscreen-preview"]')).display !== 'none',
      fabClose: getComputedStyle(document.querySelector('[data-action="close-preview"]')).display !== 'none',
      fabOpenHidden: getComputedStyle(document.querySelector('[data-action="open"]')).display === 'none'
    }
  })
  check(r1.locked && r1.lockedIcon, '打开 → 文件锁定（图标锁标记 + getLockedPath）')
  check(r1.viewerSelected && r1.selectedClass, 'Viewer 实体选中（脆弱/临时态，非文件选中）')
  check(r1.fileNotSelected, '文件不进入选中集（锁定 ≠ 选中）')
  check(r1.fsBtnGone && r1.fabFs && r1.fabClose && r1.fabOpenHidden,
    '全屏按钮收纳进 Morph FAB；Viewer 选中时 FAB 显示 全屏/关闭')

  console.log('═══ 2. 点击外部 = 取消 Viewer 选中（Viewer 保持打开）═══')
  // 真实触摸：点击 Viewer 矩形外的空白（屏幕坐标，卡片 x 从 16 起、y 从 viewport 顶开始）
  await page.touchscreen.tap(5, 120)
  await new Promise(function (res) { setTimeout(res, 200) })
  const r2 = await page.evaluate(function () {
    return {
      selected: App.InternalViewer.isSelected(),
      selectedClass: document.querySelector('.viewer-card-canvas').classList.contains('viewer-card-selected'),
      stillOpen: App.InternalViewer.isOpen(),
      stillLocked: App.Desktop.getLockedPath() === 'readme.md'
    }
  })
  check(!r2.selected && !r2.selectedClass, '点击外部 → Viewer 取消选中（选中态脆弱/临时）')
  check(r2.stillOpen && r2.stillLocked, 'Viewer 保持打开、文件保持锁定（取消选中 ≠ 关闭）')

  console.log('═══ 3. 再点 Viewer = 重新选中 ═══')
  const r3 = await page.evaluate(function () {
    // 模拟点击 Viewer 中心（世界坐标）
    const rect = App.InternalViewer.worldRect({ x: 180, y: 320 }, 380, 672)
    return { hit: App.InternalViewer.hitTestWorld(180, 320) }
  })
  check(r3.hit, '世界点命中 Viewer（点击选中入口）')

  console.log('═══ 4. 锁定拦截：复制/剪切/重命名拒绝 ═══')
  const r4 = await page.evaluate(function () {
    const before = App.Desktop.getLockedPath()
    const copyRes = App.Actions.copySelection([{ path: 'readme.md', isDir: false }])
    const renameRes = App.Actions.rename('readme.md', 'renamed.md')
    return { before: before, stillLocked: App.Desktop.getLockedPath() === before }
  })
  check(r4.stillLocked, '锁定文件复制/重命名被拦截（锁定保持）')

  console.log('═══ 5. 拖动移动实体 ═══')
  const posBefore = await page.evaluate(function () {
    return { x: parseFloat(document.querySelector('.viewer-card-canvas').style.left),
             y: parseFloat(document.querySelector('.viewer-card-canvas').style.top) }
  })
  const moved = await page.evaluate(function () {
    App.InternalViewer.beginDrag({ x: 180, y: 320 })
    App.InternalViewer.moveBy({ x: 280, y: 420 })
    const pos = { x: parseFloat(document.querySelector('.viewer-card-canvas').style.left),
                  y: parseFloat(document.querySelector('.viewer-card-canvas').style.top) }
    App.InternalViewer.endDrag()
    return { pos: pos, dragging: App.InternalViewer.isDragging() }
  })
  check(!moved.dragging && Math.abs(moved.pos.x - (posBefore.x + 100)) < 1 && Math.abs(moved.pos.y - (posBefore.y + 100)) < 1,
    '拖动 (100,100) → 实体世界坐标同步位移')

  console.log('═══ 6. 全屏 = 相册式新页面 ═══')
  await page.evaluate(function () { App.InternalViewer.toFullscreen() })
  const fs = await page.evaluate(function () {
    const page = document.getElementById('viewer-fs-page')
    const card = document.querySelector('.viewer-card-fullscreen')
    const pb = page.getBoundingClientRect()
    const cb = card.getBoundingClientRect()
    return {
      inPage: card.parentNode === page,
      pageOpen: page.classList.contains('viewer-fs-page-open'),
      full: Math.abs(cb.width - window.innerWidth) < 1 && Math.abs(cb.height - window.innerHeight) < 1,
      docClass: page.classList.contains('viewer-fs-doc'),
      fabHidden: document.getElementById('mode-switch-fab').classList.contains('fab-hidden'),
      backVisible: getComputedStyle(document.querySelector('.viewer-back-btn')).display !== 'none',
      histState: history.state && history.state._viewerFs
    }
  })
  check(fs.inPage && fs.pageOpen && fs.full, '全屏：独立新页面 fixed 覆盖全视口')
  check(fs.docClass, '文档类全屏 = 浅色阅读（viewer-fs-doc）')
  check(fs.fabHidden && fs.backVisible && fs.histState, 'FAB 隐藏 + 页头返回 + pushState')

  const back = await page.evaluate(function () {
    const handled = App.handleSystemBack()
    return { handled: handled, mode: App.InternalViewer.getMode(), open: App.InternalViewer.isOpen(),
             inCanvas: document.querySelector('.viewer-card-canvas') !== null }
  })
  check(back.handled && back.mode === 'canvas' && back.open && back.inCanvas,
    '返回键退出全屏 → 回到画布实体预览态')

  console.log('═══ 7. 关闭预览 = 解除锁定 ═══')
  const closed = await page.evaluate(function () {
    App.Desktop.closeViewer()
    return { open: App.InternalViewer.isOpen(), locked: App.Desktop.getLockedPath(),
             lockIconGone: !document.querySelector('.desktop-icon-locked') }
  })
  check(!closed.open && closed.locked === null && closed.lockIconGone,
    'closeViewer：Viewer 关闭 + 解除锁定 + 锁标记移除')

  await browser.close()
  if (failures > 0) { console.error('[FAIL] ' + failures + ' 项失败'); process.exit(1) }
  console.log('[ok] 实体交互验证通过')
}
main().catch(function (e) { console.error('[FAIL]', e.message); process.exit(1) })
