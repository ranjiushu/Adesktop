// Viewer 实体交互性质验证（画布实体 + 选中脆弱性 + 锁定 + 相册式全屏 + 多实例）：
//   1. 打开 = 文件锁定 + Viewer 未选中（打开不选中）
//   2. 点击 Viewer = 选中；点击外部 = 取消选中（Viewer 保持打开）
//   3. 拖动移动实体（选中后）
//   4. 锁定拦截：复制/重命名拒绝
//   5. 全屏 = 相册式独立新页面
//   6. 关闭预览 = 解除锁定
//   7. 多实例：打开第二个 Viewer 不关闭第一个，级联错位
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

  console.log('═══ 1. 打开 = 文件锁定 + Viewer 未选中（打开不选中） ═══')
  await page.evaluate(function () { App.Desktop.openItem('readme.md') })
  await page.waitForFunction(function () { return document.querySelector('.viewer-card-canvas') }, { timeout: 5000 })
  let r1 = await page.evaluate(function () {
    const lockedIcon = document.querySelector('.desktop-icon-locked')
    return {
      locked: App.Desktop.isLockedPath('readme.md'),
      lockedIcon: lockedIcon && lockedIcon.getAttribute('data-name') === 'readme.md',
      viewerSelected: App.InternalViewer.anySelected(),
      selectedClass: document.querySelector('.viewer-card-canvas').classList.contains('viewer-card-selected'),
      fileNotSelected: document.querySelectorAll('.desktop-icon.selected').length === 0,
      fsBtnGone: !document.querySelector('.viewer-fs-btn'),
      fabCollapsed: !document.querySelector('.fab-speed-dial-expanded'),
      count: App.InternalViewer.count()
    }
  })
  check(r1.locked && r1.lockedIcon, '打开 → 文件锁定（图标锁标记）')
  check(!r1.viewerSelected && !r1.selectedClass, '打开 → Viewer 未选中（打开动作不触发选中）')
  check(r1.fileNotSelected, '文件不进入选中集（锁定 ≠ 选中）')
  check(r1.fsBtnGone && r1.fabCollapsed, '打开未选中 → FAB 收起')
  check(r1.count === 1, '打开后实例数 = 1')

  console.log('═══ 2. 点击 Viewer = 选中 ═══')
  const center = await page.evaluate(function () {
    const b = document.querySelector('.viewer-card-canvas').getBoundingClientRect()
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
  })
  await page.touchscreen.tap(center.x, center.y)
  await new Promise(function (res) { setTimeout(res, 200) })
  const r2 = await page.evaluate(function () {
    return {
      selected: App.InternalViewer.anySelected(),
      selectedClass: document.querySelector('.viewer-card-canvas').classList.contains('viewer-card-selected'),
      stillOpen: App.InternalViewer.isAnyOpen(),
      stillLocked: App.Desktop.isLockedPath('readme.md')
    }
  })
  check(r2.selected && r2.selectedClass, '点击 Viewer → 选中（脆弱/临时态）')
  check(r2.stillOpen && r2.stillLocked, 'Viewer 保持打开、文件保持锁定')

  console.log('═══ 3. 点击外部 = 取消选中（Viewer 保持打开） ═══')
  await page.touchscreen.tap(5, 120)
  await new Promise(function (res) { setTimeout(res, 200) })
  const r3 = await page.evaluate(function () {
    return {
      selected: App.InternalViewer.anySelected(),
      stillOpen: App.InternalViewer.isAnyOpen(),
      stillLocked: App.Desktop.isLockedPath('readme.md')
    }
  })
  check(!r3.selected, '点击外部 → Viewer 取消选中（选中态脆弱/临时）')
  check(r3.stillOpen && r3.stillLocked, 'Viewer 保持打开、文件保持锁定（取消选中 ≠ 关闭）')

  console.log('═══ 4. 锁定拦截：复制/重命名拒绝 ═══')
  const r5 = await page.evaluate(function () {
    App.Actions.copySelection([{ path: 'readme.md', isDir: false }])
    App.Actions.rename('readme.md', 'renamed.md')
    return { stillLocked: App.Desktop.isLockedPath('readme.md') }
  })
  check(r5.stillLocked, '锁定文件复制/重命名被拦截（锁定保持）')

  console.log('═══ 5. 拖动移动实体（选中后） ═══')
  const posBefore = await page.evaluate(function () {
    const c = document.querySelector('.viewer-card-canvas')
    return { x: parseFloat(c.style.left), y: parseFloat(c.style.top) }
  })
  const moved = await page.evaluate(function () {
    // 选中实例后拖动
    const hit = App.InternalViewer.topmostAt(180, 320)
    if (!hit) return { ok: false }
    App.InternalViewer.selectOnly(hit.id)
    hit.beginDrag({ x: 180, y: 320 })
    hit.moveBy({ x: 280, y: 420 })
    const pos = { x: parseFloat(document.querySelector('.viewer-card-canvas').style.left),
                  y: parseFloat(document.querySelector('.viewer-card-canvas').style.top) }
    hit.endDrag()
    return { ok: true, pos: pos, dragging: App.InternalViewer.draggingInstance() !== null }
  })
  check(moved.ok && !moved.dragging && Math.abs(moved.pos.x - (posBefore.x + 100)) < 1 && Math.abs(moved.pos.y - (posBefore.y + 100)) < 1,
    '拖动 (100,100) → 实体世界坐标同步位移')

  console.log('═══ 6. 全屏 = 相册式新页面 ═══')
  await page.evaluate(function () {
    const hit = App.InternalViewer.topmostAt(200, 400)
    if (hit) { App.InternalViewer.selectOnly(hit.id); hit.toFullscreen() }
  })
  const fs = await page.evaluate(function () {
    const page = document.getElementById('viewer-fs-page')
    const card = document.querySelector('.viewer-card-fullscreen')
    return {
      inPage: card.parentNode === page,
      pageOpen: page.classList.contains('viewer-fs-page-open'),
      docClass: page.classList.contains('viewer-fs-doc'),
      fabHidden: document.getElementById('mode-switch-fab').classList.contains('fab-hidden'),
      histState: history.state && history.state._viewerFs
    }
  })
  check(fs.inPage && fs.pageOpen, '全屏：独立新页面')
  check(fs.docClass, '文档类全屏 = 浅色阅读（viewer-fs-doc）')
  check(fs.fabHidden && fs.histState, 'FAB 隐藏 + pushState')

  const back = await page.evaluate(function () {
    const handled = App.handleSystemBack()
    return { handled: handled, hasFs: App.InternalViewer.hasFullscreen(), inCanvas: document.querySelector('.viewer-card-canvas') !== null }
  })
  check(back.handled && !back.hasFs && back.inCanvas, '返回键退出全屏 → 回到画布实体预览态')

  console.log('═══ 7. 关闭预览 = 解除锁定 ═══')
  await page.evaluate(function () {
    const hit = App.InternalViewer.topmostAt(200, 400)
    if (hit) App.InternalViewer.selectOnly(hit.id)
  })
  const closed = await page.evaluate(function () {
    App.Desktop.closeViewer()
    return { open: App.InternalViewer.isAnyOpen(), locked: App.Desktop.isLockedPath('readme.md'),
             lockIconGone: !document.querySelector('.desktop-icon-locked') }
  })
  check(!closed.open && !closed.locked && closed.lockIconGone,
    'closeViewer：Viewer 关闭 + 解除锁定 + 锁标记移除')

  console.log('═══ 8. 多实例：打开第二个不关闭第一个 + 级联错位 ═══')
  await page.evaluate(function () { App.Desktop.openItem('readme.md') })
  await page.evaluate(function () { App.Desktop.openItem('other.txt') })
  await page.waitForFunction(function () { return document.querySelectorAll('.viewer-card-canvas').length === 2 }, { timeout: 5000 })
  const multi = await page.evaluate(function () {
    const cards = document.querySelectorAll('.viewer-card-canvas')
    const locked = App.Desktop.getLockedPaths()
    return {
      count: App.InternalViewer.count(),
      cards: cards.length,
      bothLocked: locked.indexOf('readme.md') >= 0 && locked.indexOf('other.txt') >= 0,
      // 级联错位：两个文本 Viewer（视觉中心锚点）应错开
      first: { x: parseFloat(cards[0].style.left), y: parseFloat(cards[0].style.top) },
      second: { x: parseFloat(cards[1].style.left), y: parseFloat(cards[1].style.top) }
    }
  })
  check(multi.count === 2 && multi.cards === 2, '打开第二个 Viewer → 实例数 = 2，两个卡片并存')
  check(multi.bothLocked, '两个文件同时锁定（多锁定集合）')
  check(multi.first.x !== multi.second.x || multi.first.y !== multi.second.y, '级联错位：两个 Viewer 位置错开')

  await browser.close()
  if (failures > 0) { console.error('[FAIL] ' + failures + ' 项失败'); process.exit(1) }
  console.log('[ok] 实体交互验证通过')
}
main().catch(function (e) { console.error('[FAIL]', e.message); process.exit(1) })
