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
const HTML = 'file://' + path.join(__dirname, '..', '..', 'dist', 'adesktop.bundle.html')
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
  // 桩环境首启弹「授权手机存储」对话框（drawer.js）——overlay 会吃掉所有触摸且
  // 占用返回键优先级，先关掉再验证（真实设备已授权不出现）
  await page.evaluate(function () {
    if (App.Dialog && typeof App.Dialog.close === 'function') App.Dialog.close('all-files-dialog-overlay')
  })

  console.log('═══ 1. 打开 = 文件锁定 + Viewer 未选中（打开不选中） ═══')
  await page.evaluate(function () { App.Desktop.openItem('readme.md') })
  await page.waitForFunction(function () { return document.querySelector('.viewer-card-canvas') }, { timeout: 5000 })
  let r1 = await page.evaluate(function () {
    const header = document.querySelector('.viewer-card-canvas .viewer-header')
    const body = document.querySelector('.viewer-card-canvas .viewer-body')
    const bodyCs = body ? getComputedStyle(body) : null
    return {
      locked: App.Desktop.isLockedPath('readme.md'),
      iconExited: !document.querySelector('.desktop-icon[data-name="readme.md"]'),
      viewerSelected: App.DesktopCore.selection.size > 0,
      selectedClass: document.querySelector('.viewer-card-canvas').classList.contains('viewer-card-selected'),
      fileNotSelected: document.querySelectorAll('.desktop-icon.selected').length === 0,
      fsBtnGone: !document.querySelector('.viewer-fs-btn'),
      fabCollapsed: !document.querySelector('.fab-speed-dial-expanded'),
      count: App.InternalViewer.count(),
      headerHidden: header && getComputedStyle(header).display === 'none',
      handleGone: !document.querySelector('.viewer-drag-handle'),
      staticClass: document.querySelector('.viewer-card-canvas').classList.contains('viewer-card-static'),
      bodyNoTouch: bodyCs && bodyCs.pointerEvents === 'none',
      bodyNoScroll: bodyCs && bodyCs.overflow === 'hidden'
    }
  })
  check(r1.locked && r1.iconExited, '打开 → 文件锁定（派生态）+ 图标退出网格渲染')
  check(!r1.viewerSelected && !r1.selectedClass, '打开 → Viewer 未选中（打开动作不触发选中）')
  check(r1.fileNotSelected, '文件不进入选中集（锁定 ≠ 选中）')
  check(r1.fsBtnGone && r1.fabCollapsed, '打开未选中 → FAB 收起')
  check(r1.count === 1, '打开后实例数 = 1')
  check(r1.headerHidden, '打开未选中 → 文件名栏隐藏')
  check(r1.handleGone, '拖动手柄已删除（DOM 无 .viewer-drag-handle）')
  check(r1.staticClass && r1.bodyNoTouch && r1.bodyNoScroll,
    'canvas 态文本卡片 = 静态预览（viewer-card-static：pointer-events none + overflow hidden）')

  console.log('═══ 2. 点击 Viewer = 选中 ═══')
  const center = await page.evaluate(function () {
    const b = document.querySelector('.viewer-card-canvas').getBoundingClientRect()
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
  })
  await page.touchscreen.tap(center.x, center.y)
  await new Promise(function (res) { setTimeout(res, 200) })
  const r2 = await page.evaluate(function () {
    const header = document.querySelector('.viewer-card-canvas .viewer-header')
    const body = document.querySelector('.viewer-card-canvas .viewer-body')
    const h = header.getBoundingClientRect()
    const b = body.getBoundingClientRect()
    return {
      selected: App.DesktopCore.selection.size > 0,
      selectedClass: document.querySelector('.viewer-card-canvas').classList.contains('viewer-card-selected'),
      stillOpen: App.InternalViewer.isAnyOpen(),
      stillLocked: App.Desktop.isLockedPath('readme.md'),
      headerVisible: getComputedStyle(header).display !== 'none',
      headerBelowBody: h.top >= b.bottom - 1,
      headerTopAligned: Math.abs(h.top - b.bottom) < 2
    }
  })
  check(r2.selected && r2.selectedClass, '点击 Viewer → 选中（脆弱/临时态）')
  check(r2.stillOpen && r2.stillLocked, 'Viewer 保持打开、文件保持锁定')
  check(r2.headerVisible, '选中 → 文件名栏显示')
  check(r2.headerBelowBody && r2.headerTopAligned, '文件名栏在内容区下方（底栏）')

  console.log('═══ 3. 点击外部 = 取消选中（Viewer 保持打开） ═══')
  await page.touchscreen.tap(5, 120)
  await new Promise(function (res) { setTimeout(res, 200) })
  const r3 = await page.evaluate(function () {
    const header = document.querySelector('.viewer-card-canvas .viewer-header')
    return {
      selected: App.DesktopCore.selection.size > 0,
      stillOpen: App.InternalViewer.isAnyOpen(),
      stillLocked: App.Desktop.isLockedPath('readme.md'),
      headerHidden: header && getComputedStyle(header).display === 'none'
    }
  })
  check(!r3.selected, '点击外部 → Viewer 取消选中（选中态脆弱/临时）')
  check(r3.stillOpen && r3.stillLocked, 'Viewer 保持打开、文件保持锁定（取消选中 ≠ 关闭）')
  check(r3.headerHidden, '取消选中 → 文件名栏重新隐藏')

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
    App.DesktopCore.selection = App.DesktopSelection.selectOnly(hit.getPath()); App.DesktopRender.applySelection()
    hit.beginDrag({ x: 180, y: 320 })
    hit.moveBy({ x: 280, y: 420 })
    const pos = { x: parseFloat(document.querySelector('.viewer-card-canvas').style.left),
                  y: parseFloat(document.querySelector('.viewer-card-canvas').style.top) }
    hit.endDrag()
    return { ok: true, pos: pos, dragging: App.InternalViewer.list().some(function(i){return i.isDragging()}) }
  })
  check(moved.ok && !moved.dragging && Math.abs(moved.pos.x - (posBefore.x + 100)) < 1 && Math.abs(moved.pos.y - (posBefore.y + 100)) < 1,
    '拖动 (100,100) → 实体世界坐标同步位移')

  console.log('═══ 5b. 无手柄新模型：选中即可直接拖动（viewer-selected 命中 → beginDrag） ═══')
  // 拖动手柄已删除（刀 1）：拿起语义与文件图标统一——已选中直接拖、未选中长按拿起。
  // 未选中拖动 = 框选、长按选中+拿起的全链路回归见 tests/test-viewer-drag.js。
  await page.evaluate(function () { App.DesktopRender.clearSelection() })
  const directDrag = await page.evaluate(function () {
    const card = document.querySelector('.viewer-card-canvas')
    const before = { x: parseFloat(card.style.left), y: parseFloat(card.style.top) }
    const inst = App.InternalViewer.topmostAt(before.x + 10, before.y + 10)
    if (!inst) return { ok: false }
    App.DesktopCore.selection = App.DesktopSelection.selectOnly(inst.getPath()); App.DesktopRender.applySelection()   // 已选中
    const dragOk = inst.beginDrag({ x: before.x + 10, y: before.y + 10 })
    inst.moveBy({ x: before.x + 10 + 60, y: before.y + 10 + 40 })
    const pos = { x: parseFloat(card.style.left), y: parseFloat(card.style.top) }
    inst.endDrag()
    return { ok: true, selAfter: inst.isSelected(), dragOk: dragOk, before: before, pos: pos }
  })
  check(directDrag.ok && directDrag.dragOk, '已选中 Viewer → beginDrag 直接拿起（无手柄辅助入口）')
  check(directDrag.selAfter === true, '拖动结束 → 选中保持')
  check(directDrag.pos && Math.abs(directDrag.pos.x - (directDrag.before.x + 60)) < 1 && Math.abs(directDrag.pos.y - (directDrag.before.y + 40)) < 1,
    '选中拖动 → 实体世界坐标位移 (60,40)')

  console.log('═══ 6. 全屏 = 相册式新页面 ═══')
  await page.evaluate(function () {
    const hit = App.InternalViewer.topmostAt(200, 400)
    if (hit) { App.DesktopCore.selection = App.DesktopSelection.selectOnly(hit.getPath()); App.DesktopRender.applySelection(); hit.toFullscreen() }
  })
  const fs = await page.evaluate(function () {
    const page = document.getElementById('viewer-fs-page')
    const card = document.querySelector('.viewer-card-fullscreen')
    const body = card.querySelector('.viewer-body')
    const bodyCs = getComputedStyle(body)
    return {
      inPage: card.parentNode === page,
      pageOpen: page.classList.contains('viewer-fs-page-open'),
      docClass: page.classList.contains('viewer-fs-doc'),
      fabHidden: document.getElementById('mode-switch-fab').classList.contains('fab-hidden'),
      histState: history.state && history.state._viewerFs,
      noStatic: !card.classList.contains('viewer-card-static'),
      bodyInteractive: bodyCs.pointerEvents !== 'none' && bodyCs.overflow === 'auto'
    }
  })
  check(fs.inPage && fs.pageOpen, '全屏：独立新页面')
  check(fs.docClass, '文档类全屏 = 浅色阅读（viewer-fs-doc）')
  check(fs.fabHidden && fs.histState, 'FAB 隐藏 + pushState')
  check(fs.noStatic && fs.bodyInteractive, '全屏态内容恢复可交互（static 标记解除，可滚动阅读）')

  const back = await page.evaluate(function () {
    const handled = App.handleSystemBack()
    return { handled: handled, hasFs: App.InternalViewer.hasFullscreen(), inCanvas: document.querySelector('.viewer-card-canvas') !== null }
  })
  check(back.handled && !back.hasFs && back.inCanvas, '返回键退出全屏 → 回到画布实体预览态')

  console.log('═══ 7. 关闭预览 = 解除锁定 ═══')
  await page.evaluate(function () {
    const hit = App.InternalViewer.topmostAt(200, 400)
    if (hit) App.DesktopCore.selection = App.DesktopSelection.selectOnly(hit.getPath()); App.DesktopRender.applySelection()
  })
  const closed = await page.evaluate(function () {
    App.Desktop.closeViewer()
    return { open: App.InternalViewer.isAnyOpen(), locked: App.Desktop.isLockedPath('readme.md'),
             iconBack: !!document.querySelector('.desktop-icon[data-name="readme.md"]') }
  })
  check(!closed.open && !closed.locked && closed.iconBack,
    'closeViewer：Viewer 关闭 + 解除锁定 + 图标落位重现')

  console.log('═══ 8. 多实例：打开第二个不关闭第一个 + 原地展开锚定各自图标 ═══')
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
      // 原地展开：卡片左上锚定各自图标位置（readme.md 与 other.txt 不同格位 → 错开）
      first: { x: parseFloat(cards[0].style.left), y: parseFloat(cards[0].style.top) },
      second: { x: parseFloat(cards[1].style.left), y: parseFloat(cards[1].style.top) }
    }
  })
  check(multi.count === 2 && multi.cards === 2, '打开第二个 Viewer → 实例数 = 2，两个卡片并存')
  check(multi.bothLocked, '两个文件同时锁定（多锁定派生态）')
  check(multi.first.x !== multi.second.x || multi.first.y !== multi.second.y, '原地展开：两个 Viewer 锚定各自图标位置（错开）')

  await browser.close()
  if (failures > 0) { console.error('[FAIL] ' + failures + ' 项失败'); process.exit(1) }
  console.log('[ok] 实体交互验证通过')
}
main().catch(function (e) { console.error('[FAIL]', e.message); process.exit(1) })
