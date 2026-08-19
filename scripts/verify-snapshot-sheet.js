// 快照面板 E2E 门禁：CDP 无头 Chromium 实地验证
// ═══════════════════════════════════════════════════════════════
//  场景（evaluateOnNewDocument 预注入 FileBridge 内存桩）：
//    1. 面板打开后高度 = 视口 50%（固定高度，参考 MT 管理器）
//    2. 遮罩覆盖全屏且可见；面板贴底；底部有关闭按钮 + footer 条
//    3. 分组标签栏在列表顶部：默认分组(3) / 项目A(1)，默认选中 Home 分组 tab
//    4. 列表只显示当前分组快照（不混排）
//    5. 点击 tab 切换分组；列表内左右滑动切换分组
//    6. Home 位快照有高亮类；全程零 pageerror
//
//  用法: DESKTOP_BUNDLE=dist/adesktop.bundle.min.html node scripts/verify-snapshot-sheet.js
//  退出码: 0 通过 / 1 失败
// ═══════════════════════════════════════════════════════════════
'use strict'
const { launch } = require('./lib/browser')
const path = require('path')

const BUNDLE = process.env.DESKTOP_BUNDLE || path.join(__dirname, '..', 'dist', 'adesktop.bundle.html')
const SHOT = process.env.SHOT_PATH || '/tmp/snapshot-sheet.png'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const TAP_GAP = 300

let PASS = 0, FAIL = 0
function pass(label) { console.log('  [PASS] ' + label); PASS++ }
function fail(label, detail) {
  console.log('  [FAIL] ' + label + (detail ? ' — ' + detail : ''))
  FAIL++
}

async function tap(client, x, y, holdMs = 60) {
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
  await sleep(holdMs)
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await sleep(TAP_GAP)
}

// 单指水平滑动（列表内切换分组）
async function swipeH(client, x, y, dx, steps = 8, gap = 14) {
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
  for (let i = 1; i <= steps; i++) {
    await sleep(gap)
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * i / steps, y }] })
  }
  await sleep(gap)
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await sleep(TAP_GAP)
}

async function main() {
  const browser = await launch()
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2.75 })

    // 预注入 FileBridge 桩（导航前）
    await page.evaluateOnNewDocument(() => {
      window.FileBridge = {
        vibrate: function () {},
        rootInfo: function (cb) {
          window.__fbResolve(cb, { ok: true, data: { rootId: 'mock-root', rootName: 'mock', displayPath: '/mock', mode: 'mock' } })
        },
        list: function (p, cb) {
          const items = p ? [] : [
            { name: 'docs', isDir: true, size: 0, mtime: 0 },
            { name: 'a.txt', isDir: false, size: 10, mtime: 0 },
            { name: 'b.txt', isDir: false, size: 20, mtime: 0 }
          ]
          window.__fbResolve(cb, { ok: true, data: items })
        },
        read: function (p, cb) { window.__fbResolve(cb, { ok: false, error: 'noop' }) },
        write: function (p, c, cb) { window.__fbResolve(cb, { ok: true, data: true }) }
      }
    })

    await page.goto('file://' + BUNDLE, { waitUntil: 'networkidle0', timeout: 30000 })
    await sleep(1200)

    const errors = []
    page.on('pageerror', e => errors.push('pageerror: ' + e.message))
    page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()) })

    // 注入快照/分组数据（用真实 rootId）+ 打开面板
    await page.evaluate(() => {
      const core = App.DesktopCore
      const rootId = core.state.rootId
      try {
        const key = 'desktop.snapshots.' + rootId + '.v3'
        if (!localStorage.getItem(key)) {
          const gid1 = 'g_seed_a', gid2 = 'g_seed_b'
          const snap = (id, name, x, y, zoom) => ({ id, name, camera: { x, y, zoom, rotation: 0 }, createdAt: Date.now() })
          const bundle = {
            version: 3,
            groups: [{ id: gid1, name: '默认分组' }, { id: gid2, name: '项目A' }],
            portrait: {
              version: 3,
              groups: [
                { id: gid1, snapshots: [snap('s1', '08-19 10:00', 0, 0, 1), snap('s2', '08-19 10:05', 100, 50, 1.5), snap('s3', '08-19 10:10', 200, 100, 2)] },
                { id: gid2, snapshots: [snap('s4', '08-19 11:00', 50, 80, 1.2)] }
              ]
            },
            landscape: { version: 3, groups: [{ id: gid1, snapshots: [] }, { id: gid2, snapshots: [] }] }
          }
          localStorage.setItem(key, JSON.stringify(bundle))
        }
      } catch (e) { /* ignore */ }
      App.SnapshotSheet.open()
    })
    await sleep(700)

    const client = await page.createCDPSession()

    // ── 1. 面板布局：50vh / 遮罩 / 关闭按钮 / footer ──
    const lay = await page.evaluate(() => {
      const rect = sel => {
        const el = document.querySelector(sel)
        if (!el) return null
        const b = el.getBoundingClientRect()
        return { top: b.top, bottom: b.bottom, width: b.width, height: b.height }
      }
      const tabs = Array.from(document.querySelectorAll('.snapshot-tab')).map(t => ({
        name: t.querySelector('.snapshot-tab-name').textContent,
        count: t.querySelector('.snapshot-tab-count').textContent,
        active: t.classList.contains('snapshot-tab-active')
      }))
      return {
        vh: window.innerHeight,
        panel: rect('#snapshot-sheet-panel'),
        overlay: rect('#snapshot-sheet-overlay'),
        overlayVisible: document.querySelector('#snapshot-sheet-overlay').classList.contains('snapshot-sheet-overlay-visible'),
        list: rect('#snapshot-list'),
        closeBtn: rect('#snapshot-close-btn'),
        footer: rect('.snapshot-sheet-footer'),
        tabsRect: rect('#snapshot-tabs'),
        tabs: tabs,
        addBtn: !!document.querySelector('.snapshot-tab-add'),
        items: document.querySelectorAll('#snapshot-list .snapshot-item').length,
        homeItems: document.querySelectorAll('#snapshot-list .snapshot-item.snapshot-home').length,
        groupSections: document.querySelectorAll('#snapshot-list .snapshot-group').length
      }
    })
    const half = lay.vh / 2
    if (lay.panel && Math.abs(lay.panel.height - half) <= 2) pass('面板高度 = 50vh（' + lay.panel.height.toFixed(1) + ' / ' + lay.vh + '）')
    else fail('面板高度 50vh', JSON.stringify(lay.panel))
    if (lay.panel && Math.abs(lay.panel.bottom - lay.vh) <= 1) pass('面板贴底')
    else fail('面板贴底', JSON.stringify(lay.panel))
    if (lay.overlay && lay.overlay.top === 0 && lay.overlayVisible) pass('遮罩覆盖全屏且可见')
    else fail('遮罩', JSON.stringify(lay.overlay) + ' visible=' + lay.overlayVisible)
    if (lay.closeBtn && lay.closeBtn.height > 0) pass('关闭按钮存在')
    else fail('关闭按钮缺失')
    if (lay.footer && lay.footer.height > 0) pass('footer 关闭条存在')
    else fail('footer 缺失')
    if (lay.list && lay.list.height > 60) pass('列表可滚动（高 ' + lay.list.height.toFixed(1) + '）')
    else fail('列表高度', JSON.stringify(lay.list))

    // ── 2. 标签栏 ──
    if (lay.tabsRect && lay.tabsRect.height > 0) pass('分组标签栏在列表上方')
    else fail('标签栏缺失')
    if (lay.tabs.length === 2 && lay.tabs[0].name === '默认分组' && lay.tabs[1].name === '项目A') pass('两个分组标签：' + lay.tabs.map(t => t.name).join(' / '))
    else fail('标签内容', JSON.stringify(lay.tabs))
    if (lay.tabs[0].active && lay.tabs[0].count === '3') pass('默认选中 Home 分组 tab（默认分组，3 项）')
    else fail('默认 tab 态', JSON.stringify(lay.tabs[0]))
    if (lay.addBtn) pass('标签栏末尾新建分组按钮存在')
    else fail('新建分组按钮缺失')
    if (lay.groupSections === 0 && lay.items === 3) pass('列表只渲染当前分组（3 项，无混排分组段）')
    else fail('列表渲染', 'sections=' + lay.groupSections + ' items=' + lay.items)
    if (lay.homeItems === 1) pass('Home 位快照高亮 1 项')
    else fail('Home 高亮', 'homeItems=' + lay.homeItems)

    // ── 3. 点击第二个 tab 切换分组 ──
    const tab2 = await page.evaluate(() => {
      const t = document.querySelectorAll('.snapshot-tab')[1]
      const b = t.getBoundingClientRect()
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
    })
    await tap(client, tab2.x, tab2.y)
    const afterTap = await page.evaluate(() => ({
      active: Array.from(document.querySelectorAll('.snapshot-tab')).findIndex(t => t.classList.contains('snapshot-tab-active')),
      items: document.querySelectorAll('#snapshot-list .snapshot-item').length,
      firstName: (document.querySelector('#snapshot-list .snapshot-name') || {}).textContent || ''
    }))
    if (afterTap.active === 1 && afterTap.items === 1 && afterTap.firstName === '08-19 11:00') pass('点击 tab → 切换到项目A（1 项）')
    else fail('点击切换', JSON.stringify(afterTap))

    // ── 4. 列表内右滑 → 切回默认分组 ──
    const listRect = await page.evaluate(() => {
      const b = document.querySelector('#snapshot-list').getBoundingClientRect()
      return { x: b.left + b.width / 2, y: b.top + 80 }
    })
    await swipeH(client, listRect.x, listRect.y, 100)
    const afterSwipe = await page.evaluate(() => ({
      active: Array.from(document.querySelectorAll('.snapshot-tab')).findIndex(t => t.classList.contains('snapshot-tab-active')),
      items: document.querySelectorAll('#snapshot-list .snapshot-item').length
    }))
    if (afterSwipe.active === 0 && afterSwipe.items === 3) pass('列表内右滑 → 切回默认分组（3 项）')
    else fail('滑动切换', JSON.stringify(afterSwipe))

    // ── 5. 左滑 → 切到项目A；到边界不再切换 ──
    await swipeH(client, listRect.x, listRect.y, -100)
    const afterSwipe2 = await page.evaluate(() => ({
      active: Array.from(document.querySelectorAll('.snapshot-tab')).findIndex(t => t.classList.contains('snapshot-tab-active'))
    }))
    if (afterSwipe2.active === 1) pass('列表内左滑 → 切到项目A')
    else fail('左滑切换', JSON.stringify(afterSwipe2))
    await swipeH(client, listRect.x, listRect.y, -100)
    const afterSwipe3 = await page.evaluate(() => ({
      active: Array.from(document.querySelectorAll('.snapshot-tab')).findIndex(t => t.classList.contains('snapshot-tab-active'))
    }))
    if (afterSwipe3.active === 1) pass('最后一个分组再左滑 → 停留（边界保护）')
    else fail('边界保护', JSON.stringify(afterSwipe3))

    await page.screenshot({ path: SHOT })
    console.log('SHOT: ' + SHOT)

    if (errors.length > 0) fail('pageerror', errors.join(' | '))
    else pass('全程零 pageerror')

    await browser.close()
    if (FAIL > 0) {
      console.log('\n  SnapshotSheet E2E: ' + PASS + ' 通过 / ' + FAIL + ' 失败')
      process.exit(1)
    }
    console.log('\n  SnapshotSheet E2E 全部通过（' + PASS + ' 项）')
    process.exit(0)
  } finally {
    await browser.close()
  }
}

main().catch(function (e) {
  console.error('  [ERROR] ' + (e && e.message))
  process.exit(1)
})
