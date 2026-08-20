// Viewer 持久化 E2E 门禁：CDP 无头 Chromium 实地验证
// ═══════════════════════════════════════════════════════════════
//  场景（FileBridge 内存桩 + 页面加载后 seed + reload）：
//    0. seed 策略：桥桩经 evaluateOnNewDocument 注入（导航前）；localStorage
//       种子（ViewerStore/快照）在首载后用 page.evaluate 写入再 reload——
//       file:// 下 evaluateOnNewDocument 早期读 localStorage 偶发为空，
//       幂等 seed 会重复注入（历史踩坑，勿改回）
//    1. 画布态 Viewer 打开状态 + 世界坐标位置持久化：seed 后 reload → 自动恢复
//       （卡片 world 矩形 = 持久化矩形，文件处「打开」态 → 图标退出网格）
//    2. 拖动结束 → 位置变化落盘（ViewerStore 更新）
//    3. 手动关闭 → 状态清空；reload 后不再恢复（Viewer 只能通过手动关闭）
//    4. 文件已删除的陈旧记录 → 跳过恢复（不出现幽灵 Viewer）
//    5. 矩形设计语言：快照列表/顶栏菜单/Viewer 卡片 computed border-radius = 0px
//  用法: DESKTOP_BUNDLE=dist/adesktop.bundle.min.html node scripts/verify-viewer.js
//  退出码: 0 通过 / 1 失败
// ═══════════════════════════════════════════════════════════════
'use strict'
const { launch } = require('./lib/browser')
const path = require('path')

const BUNDLE = process.env.DESKTOP_BUNDLE || path.join(__dirname, '..', 'dist', 'adesktop.bundle.html')
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

let PASS = 0, FAIL = 0
function pass(label) { console.log('  [PASS] ' + label); PASS++ }
function fail(label, detail) {
  console.log('  [FAIL] ' + label + (detail ? ' — ' + detail : ''))
  FAIL++
}

// 桥桩（每次导航注入；不碰 localStorage——种子统一在页面加载后 evaluate 写入）
function bridgeScript() {
  return () => {
    window.FileBridge = {
      vibrate: function () {},
      rootInfo: function (cb) {
        window.__fbResolve(cb, { ok: true, data: { rootId: 'mock-root', rootName: 'mock', displayPath: '/mock', mode: 'mock' } })
      },
      list: function (p, cb) {
        const items = p ? [] : [
          { name: 'a.txt', isDir: false, size: 10, mtime: 0 },
          { name: 'b.png', isDir: false, size: 20, mtime: 0 }
        ]
        window.__fbResolve(cb, { ok: true, data: items })
      },
      read: function (p, cb) {
        if (p === 'a.txt') window.__fbResolve(cb, { ok: true, data: 'hello viewer' })
        else if (p === 'b.png') window.__fbResolve(cb, { ok: false, error: 'noop' })
        else window.__fbResolve(cb, { ok: false, error: 'noop' })
      },
      write: function (p, c, cb) { window.__fbResolve(cb, { ok: true, data: true }) },
      openExternal: function (p, cb) { window.__fbResolve(cb, { ok: true }) }
    }
  }
}

// 页面上下文种子写入（首载后调用，随后 reload 让应用吃到）
async function seedStore(page, viewers, snapshots) {
  await page.evaluate((v, s) => {
    localStorage.setItem('desktop.viewers.mock-root.v1', JSON.stringify({ version: 1, viewers: v }))
    const gid = 'g_v1'
    localStorage.setItem('desktop.snapshots.mock-root.v3', JSON.stringify({
      version: 3,
      groups: [{ id: gid, name: '默认分组' }],
      portrait: { version: 3, groups: [{ id: gid, snapshots: s }] },
      landscape: { version: 3, groups: [{ id: gid, snapshots: [] }] }
    }))
  }, viewers, snapshots)
}

const REC_A = { path: 'a.txt', name: 'a.txt', kind: 'text', rect: { x: 100, y: 200, w: 240, h: 320 } }
const SNAP_ONE = [{ id: 's1', name: '08-19 10:00', camera: { x: 0, y: 0, zoom: 1, rotation: 0 }, createdAt: 1 }]

async function main() {
  const browser = await launch()
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2.75 })
    await page.evaluateOnNewDocument(bridgeScript())

    const errors = []
    page.on('pageerror', e => errors.push('pageerror: ' + e.message))
    page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()) })

    // 首载（无种子）→ 写入种子 → reload（应用吃到数据并恢复）
    await page.goto('file://' + BUNDLE, { waitUntil: 'networkidle0', timeout: 30000 })
    await sleep(1000)
    await seedStore(page, [REC_A], SNAP_ONE)
    await page.reload({ waitUntil: 'networkidle0' })
    await sleep(1500)

    // ── 1. reload 自动恢复：画布态 Viewer 回到持久化位置 ──
    const restored = await page.evaluate(() => {
      const card = document.querySelector('.viewer-card-canvas')
      if (!card) return null
      return {
        left: card.style.left, top: card.style.top, w: card.style.width, h: card.style.height,
        title: (card.querySelector('.viewer-title') || {}).textContent,
        locked: App.DesktopViewerLink.isLockedPath('a.txt'),
        iconGone: !document.querySelector('.desktop-icon[data-path="a.txt"]'),
        otherIcon: !!document.querySelector('.desktop-icon[data-path="b.png"]'),
        count: App.InternalViewer.count(),
        storeCount: App.ViewerStore.load('mock-root').viewers.length
      }
    })
    if (restored && restored.left === '100px' && restored.top === '200px' &&
        restored.w === '240px' && restored.h === '320px')
      pass('启动恢复：a.txt Viewer 回到持久化世界坐标 (100,200) 240×320')
    else fail('启动恢复位置', JSON.stringify(restored))
    if (restored && restored.title === 'a.txt' && restored.count === 1) pass('恢复单实例 + 标题正确')
    else fail('恢复实例', JSON.stringify(restored))
    if (restored && restored.locked && restored.iconGone && restored.otherIcon) pass('恢复后文件处于打开态（a.txt 图标退出网格，b.png 不受影响）')
    else fail('恢复打开态', JSON.stringify(restored))
    if (restored && restored.storeCount === 1) pass('恢复过程不重复落盘（store 仍 1 条）')
    else fail('恢复幂等', JSON.stringify(restored))

    // ── 2. 拖动结束 → 位置变化落盘 ──
    await page.evaluate(() => {
      const inst = App.InternalViewer.list()[0]
      inst.beginDrag({ x: 0, y: 0 })
      inst.moveBy({ x: 50, y: 30 })
      inst.endDrag()
    })
    await sleep(300)
    const afterDrag = await page.evaluate(() => {
      const rec = App.ViewerStore.load('mock-root').viewers[0]
      const card = document.querySelector('.viewer-card-canvas')
      return { rect: rec && rec.rect, left: card && card.style.left, top: card && card.style.top }
    })
    if (afterDrag.rect && afterDrag.rect.x === 150 && afterDrag.rect.y === 230 &&
        afterDrag.left === '150px' && afterDrag.top === '230px')
      pass('拖动结束 → 位置落盘（(100,200) → (150,230)），卡片同步')
    else fail('拖动落盘', JSON.stringify(afterDrag))

    // ── 3. 手动关闭 → store 清空；reload 后不再恢复（Viewer 只能通过手动关闭）──
    await page.evaluate(() => { App.InternalViewer.closeById(App.InternalViewer.list()[0].id) })
    await sleep(300)
    const afterClose = await page.evaluate(() => ({
      count: App.InternalViewer.count(),
      storeCount: App.ViewerStore.load('mock-root').viewers.length,
      cards: document.querySelectorAll('.viewer-card-canvas').length
    }))
    if (afterClose.count === 0 && afterClose.storeCount === 0 && afterClose.cards === 0) pass('手动关闭 → Viewer 消失 + store 清空')
    else fail('手动关闭', JSON.stringify(afterClose))

    await page.reload({ waitUntil: 'networkidle0' })
    await sleep(1500)
    const afterReload = await page.evaluate(() => ({
      count: App.InternalViewer.count(),
      cards: document.querySelectorAll('.viewer-card-canvas').length
    }))
    if (afterReload.count === 0 && afterReload.cards === 0) pass('reload 后不恢复（已手动关闭，状态清空）')
    else fail('关闭后 reload', JSON.stringify(afterReload))

    // ── 4. 文件已删除的陈旧记录 → 跳过恢复 ──
    await seedStore(page, [
      REC_A,
      { path: 'deleted.txt', name: 'deleted.txt', kind: 'text', rect: { x: 300, y: 300, w: 200, h: 260 } }
    ], SNAP_ONE)
    await page.reload({ waitUntil: 'networkidle0' })
    await sleep(1500)
    const stale = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.viewer-card-canvas'))
      return {
        count: App.InternalViewer.count(),
        titles: cards.map(c => (c.querySelector('.viewer-title') || {}).textContent)
      }
    })
    if (stale.count === 1 && stale.titles.length === 1 && stale.titles[0] === 'a.txt')
      pass('文件已删除的记录跳过恢复（只恢复 a.txt，无 deleted.txt 幽灵）')
    else fail('陈旧记录过滤', JSON.stringify(stale))

    // ── 5. 矩形设计语言：computed border-radius = 0px ──
    const radii = await page.evaluate(() => {
      const r = sel => {
        const el = document.querySelector(sel)
        return el ? getComputedStyle(el).borderRadius : null
      }
      return {
        viewerCard: r('.viewer-card-canvas'),
        viewMenu: r('.view-menu'),
        bottomBarBtn: r('.bottom-bar-btn')
      }
    })
    const square = v => v === '0px' || v === '0px 0px 0px 0px'
    if (square(radii.viewerCard) && square(radii.viewMenu) && square(radii.bottomBarBtn))
      pass('矩形设计语言：Viewer/顶栏菜单/底栏按钮 border-radius = 0px')
    else fail('矩形设计语言', JSON.stringify(radii))
    // 快照列表项 + 字母徽标 + 标签（面板打开态）
    await page.evaluate(() => App.SnapshotSheet.open())
    await sleep(600)
    const radii2 = await page.evaluate(() => {
      const r = sel => {
        const el = document.querySelector(sel)
        return el ? getComputedStyle(el).borderRadius : null
      }
      return { item: r('.snapshot-item'), code: r('.snapshot-code'), menuBtn: r('.snapshot-sheet-menu-btn'), tab: r('.snapshot-tab') }
    })
    if (square(radii2.item) && square(radii2.code) && square(radii2.menuBtn) && square(radii2.tab))
      pass('矩形设计语言：快照列表项/字母徽标/菜单按钮/标签 border-radius = 0px')
    else fail('快照列表直角', JSON.stringify(radii2))

    if (errors.length > 0) fail('pageerror', errors.join(' | '))
    else pass('全程零 pageerror')

    await browser.close()
    if (FAIL > 0) {
      console.log('\n  Viewer E2E: ' + PASS + ' 通过 / ' + FAIL + ' 失败')
      process.exit(1)
    }
    console.log('\n  Viewer E2E 全部通过（' + PASS + ' 项）')
    process.exit(0)
  } finally {
    await browser.close()
  }
}

main().catch(function (e) {
  console.error('  [ERROR] ' + (e && e.message))
  process.exit(1)
})
