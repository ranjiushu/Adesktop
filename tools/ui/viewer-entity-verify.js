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

  console.log('═══ 1. 打开 = 文件锁定 + Viewer 未选中（打开不选中） ═══')
  await page.evaluate(function () { App.Desktop.openItem('readme.md') })
  await page.waitForFunction(function () { return document.querySelector('.viewer-card-canvas') }, { timeout: 5000 })
  let r1 = await page.evaluate(function () {
    const lockedIcon = document.querySelector('.desktop-icon-locked')
    const header = document.querySelector('.viewer-card-canvas .viewer-header')
    const handle = document.querySelector('.viewer-drag-handle')
    const hr = handle ? handle.getBoundingClientRect() : null
    const cr = document.querySelector('.viewer-card-canvas').getBoundingClientRect()
    return {
      locked: App.Desktop.isLockedPath('readme.md'),
      lockedIcon: lockedIcon && lockedIcon.getAttribute('data-name') === 'readme.md',
      viewerSelected: App.InternalViewer.anySelected(),
      selectedClass: document.querySelector('.viewer-card-canvas').classList.contains('viewer-card-selected'),
      fileNotSelected: document.querySelectorAll('.desktop-icon.selected').length === 0,
      fsBtnGone: !document.querySelector('.viewer-fs-btn'),
      fabCollapsed: !document.querySelector('.fab-speed-dial-expanded'),
      count: App.InternalViewer.count(),
      headerHidden: header && getComputedStyle(header).display === 'none',
      handleExists: !!handle,
      handleSize: hr ? { w: hr.width, h: hr.height } : null,
      handleBelowCard: hr ? hr.top >= cr.bottom - 1 && Math.abs(hr.left + hr.width / 2 - (cr.left + cr.width / 2)) < 2 : false
    }
  })
  check(r1.locked && r1.lockedIcon, '打开 → 文件锁定（图标锁标记）')
  check(!r1.viewerSelected && !r1.selectedClass, '打开 → Viewer 未选中（打开动作不触发选中）')
  check(r1.fileNotSelected, '文件不进入选中集（锁定 ≠ 选中）')
  check(r1.fsBtnGone && r1.fabCollapsed, '打开未选中 → FAB 收起')
  check(r1.count === 1, '打开后实例数 = 1')
  check(r1.headerHidden, '打开未选中 → 文件名栏隐藏')
  check(r1.handleExists && r1.handleSize && Math.abs(r1.handleSize.w - 36) < 1 && Math.abs(r1.handleSize.h - 6) < 1,
    '拖动手柄存在且固定屏幕尺寸 36×6')
  check(r1.handleBelowCard, '手柄位于卡片底部中心下方（悬浮间距适中）')

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
      selected: App.InternalViewer.anySelected(),
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
      selected: App.InternalViewer.anySelected(),
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

  console.log('═══ 5b. 拖动手柄：未选中直接拖动（按住即选中+移动，辅助入口） ═══')
  // 取消选中 → 手柄命中断言：未选中时按住手柄（handleAt 命中）→ 自动选中 + beginDrag
  await page.evaluate(function () { App.InternalViewer.deselectAll() })
  const handleDrag = await page.evaluate(function () {
    // 用当前相机反算手柄世界中心（文档类卡片底部中心 + 14px）
    const card = document.querySelector('.viewer-card-canvas')
    const rect = { x: parseFloat(card.style.left), y: parseFloat(card.style.top),
                   w: parseFloat(card.style.width), h: parseFloat(card.style.height) }
    const cam = { x: 0, y: 0, zoom: 1 }   // 初始相机 (0,0,1)，视觉中心锚点已含偏移
    const c = document.querySelector('.viewer-card-canvas').getBoundingClientRect()
    const hw = App.InternalViewer.handleWorldRect(rect, cam)
    const hitBefore = App.InternalViewer.anySelected()
    const inst = App.InternalViewer.handleAt(hw.x + hw.w / 2, hw.y + hw.h / 2, cam)
    if (!inst) return { ok: false, hitBefore: hitBefore }
    const selBefore = inst.isSelected()
    App.InternalViewer.selectOnly(inst.id)   // 模拟手势层「按住手柄 = 自动选中」
    const dragOk = inst.beginDrag({ x: hw.x + hw.w / 2, y: hw.y + hw.h / 2 })
    inst.moveBy({ x: hw.x + hw.w / 2 + 60, y: hw.y + hw.h / 2 + 40 })
    const pos = { x: parseFloat(card.style.left), y: parseFloat(card.style.top) }
    inst.endDrag()
    return { ok: true, hitBefore: hitBefore, selBefore: selBefore, selAfter: inst.isSelected(), dragOk: dragOk, pos: pos }
  })
  check(handleDrag.ok, 'handleAt 命中未选中 Viewer 的手柄')
  check(!handleDrag.hitBefore && handleDrag.dragOk, '未选中时按住手柄 → 可直接拖动（无需先点击选中）')
  check(handleDrag.selBefore === false && handleDrag.selAfter === true, '按住手柄拖动 → 自动选中该实例')
  check(handleDrag.pos && Math.abs(handleDrag.pos.x - (posBefore.x + 160)) < 1 && Math.abs(handleDrag.pos.y - (posBefore.y + 140)) < 1,
    '手柄拖动 → 实体世界坐标位移 (60,40)')

  // 手柄点击（tap）= 仅选中（保持现有语义：辅助拖动区不改变点击行为）
  await page.evaluate(function () { App.InternalViewer.deselectAll() })
  const handleTap = await page.evaluate(function () {
    const card = document.querySelector('.viewer-card-canvas')
    const rect = { x: parseFloat(card.style.left), y: parseFloat(card.style.top),
                   w: parseFloat(card.style.width), h: parseFloat(card.style.height) }
    const cam = { x: 0, y: 0, zoom: 1 }
    const hw = App.InternalViewer.handleWorldRect(rect, cam)
    App.InternalViewer.deselectAll()
    const inst = App.InternalViewer.handleAt(hw.x + hw.w / 2, hw.y + hw.h / 2, cam)
    if (inst) App.InternalViewer.selectOnly(inst.id)   // tap 语义 = 点击卡片本体（仅选中）
    return { selected: App.InternalViewer.anySelected() }
  })
  check(handleTap.selected, '手柄轻点 = 仅选中（与点击卡片一致，不触发拖动）')

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
