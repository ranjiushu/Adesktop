// 快照面板 E2E 门禁：CDP 无头 Chromium 实地验证
// ═══════════════════════════════════════════════════════════════
//  场景（evaluateOnNewDocument 预注入 FileBridge 内存桩）：
//    1. 面板打开后高度 = 视口 70%（固定高度）；遮罩/关闭按钮/footer 就位
//    2. 分组标签栏在列表顶部：默认分组(3) / 项目A(1)，默认选中 Home 分组 tab；
//       列表只渲染当前分组；点击 tab / 左右滑动切换分组
//    3. 操作模式（参考 LexiCull）：长按快照行进入——FAB morph 展开（✕ 删除/移动），
//       行选中高亮；单击多选；删除确认后批量删；移动浮层选目标分组后迁移并切 tab；
//       FAB ✕ 退出操作模式
//    4. 全程零 pageerror
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

// 长按（>500ms 触发操作模式 + startDrag）后垂直拖动：验证排序生效且面板不跟随关闭
async function longPressDrag(client, x, y, dy, steps = 10, gap = 16) {
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
  await sleep(650)
  for (let i = 1; i <= steps; i++) {
    await sleep(gap)
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + dy * i / steps }] })
  }
  await sleep(80)
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await sleep(TAP_GAP)
}

async function main() {
  const browser = await launch()
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2.75 })

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

    // confirm/prompt 自动处理（删除确认 accept；重命名 prompt 取消）
    page.on('dialog', async (d) => {
      if (d.type() === 'confirm') await d.accept()
      else await d.dismiss()
    })

    await page.goto('file://' + BUNDLE, { waitUntil: 'networkidle0', timeout: 30000 })
    await sleep(1200)

    const errors = []
    page.on('pageerror', e => errors.push('pageerror: ' + e.message))
    page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()) })

    // 注入快照/分组数据 + 打开面板
    await page.evaluate(() => {
      const rootId = App.DesktopCore.state.rootId
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

    // ── 1. 面板布局：70vh / 遮罩 / 关闭按钮 / footer / tab / 列表 ──
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
        overlayVisible: document.querySelector('#snapshot-sheet-overlay').classList.contains('snapshot-sheet-overlay-visible'),
        list: rect('#snapshot-list'),
        closeBtn: rect('#snapshot-close-btn'),
        footer: rect('.snapshot-sheet-footer'),
        tabsRect: rect('#snapshot-tabs'),
        tabs: tabs,
        addBtn: !!document.querySelector('.snapshot-tab-add'),
        items: document.querySelectorAll('#snapshot-list .snapshot-item').length,
        homeItems: document.querySelectorAll('#snapshot-list .snapshot-item.snapshot-home').length,
        groupSections: document.querySelectorAll('#snapshot-list .snapshot-group').length,
        fabVisible: (function () {
          const s = getComputedStyle(document.querySelector('#mode-switch-fab'))
          return s.visibility === 'visible' && s.pointerEvents !== 'none' && s.opacity !== '0'
        })()
      }
    })
    const seven = lay.vh * 0.7
    if (lay.panel && Math.abs(lay.panel.height - seven) <= 2) pass('面板高度 = 70vh（' + lay.panel.height.toFixed(1) + ' / ' + lay.vh + '）')
    else fail('面板高度 70vh', JSON.stringify(lay.panel))
    if (lay.panel && Math.abs(lay.panel.bottom - lay.vh) <= 1) pass('面板贴底')
    else fail('面板贴底', JSON.stringify(lay.panel))
    if (lay.overlayVisible) pass('遮罩可见')
    else fail('遮罩不可见')
    if (lay.closeBtn && lay.footer && lay.footer.height > 0) pass('关闭按钮 + footer 存在')
    else fail('关闭按钮/footer 缺失')
    if (lay.tabsRect && lay.tabs.length === 2 && lay.tabs[0].active && lay.tabs[0].count === '3') pass('标签栏默认选中 Home 分组（默认分组 3 项）')
    else fail('标签栏', JSON.stringify(lay.tabs))
    if (lay.items === 3 && lay.groupSections === 0) pass('列表只渲染当前分组（3 项无混排）')
    else fail('列表渲染', 'items=' + lay.items + ' sections=' + lay.groupSections)
    if (lay.homeItems === 1) pass('Home 位高亮 1 项')
    else fail('Home 高亮', String(lay.homeItems))
    if (lay.fabVisible) pass('快照面板打开时 FAB 仍可见（始终最高层级）')
    else fail('FAB 应始终可见')

    // ── 2. 长按快照行 → 进入操作模式 ──
    const row1 = await page.evaluate(() => {
      const r = document.querySelector('#snapshot-list .snapshot-item')
      const b = r.getBoundingClientRect()
      return { x: b.left + b.width / 2, y: b.top + b.height / 2, id: r.dataset.id }
    })
    await tap(client, row1.x, row1.y, 650) // 长按 > 500ms
    const op1 = await page.evaluate(() => ({
      opMode: App.SnapshotSheet.isOpMode(),
      bodyClass: document.body.classList.contains('snapshot-op-mode'),
      fabMode: document.querySelector('#fab-speed-dial').getAttribute('data-mode'),
      fabVisible: (function () {
        const s = getComputedStyle(document.querySelector('#mode-switch-fab'))
        return s.visibility === 'visible' && s.pointerEvents !== 'none' && s.opacity !== '0'
      })(),
      fabActive: document.querySelector('#mode-switch-fab').classList.contains('fab-speed-dial-active'),
      selected: document.querySelectorAll('#snapshot-list .snapshot-item.op-selected').length,
      selId: (document.querySelector('#snapshot-list .snapshot-item.op-selected') || {}).dataset && document.querySelector('#snapshot-list .snapshot-item.op-selected').dataset.id
    }))
    if (op1.opMode && op1.bodyClass) pass('长按快照行 → 进入操作模式')
    else fail('进入操作模式', JSON.stringify(op1))
    if (op1.fabMode === 'snapshot-operation' && op1.fabVisible && op1.fabActive) pass('FAB morph 展开（snapshot-operation 态）')
    else fail('FAB 展开', JSON.stringify(op1))
    if (op1.selected === 1 && op1.selId === row1.id) pass('长按行自动选中')
    else fail('自动选中', JSON.stringify(op1))

    // ── 3. 单击多选 ──
    const row2 = await page.evaluate(() => {
      const r = document.querySelectorAll('#snapshot-list .snapshot-item')[1]
      const b = r.getBoundingClientRect()
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
    })
    await tap(client, row2.x, row2.y, 60)
    const op2 = await page.evaluate(() => ({
      selected: document.querySelectorAll('#snapshot-list .snapshot-item.op-selected').length
    }))
    if (op2.selected === 2) pass('操作模式单击 → 多选 2 项')
    else fail('多选', JSON.stringify(op2))

    // ── 4. FAB 删除（confirm accept）→ 批量删 2 项，退出操作模式 ──
    const delBtn = await page.evaluate(() => {
      const b = document.querySelector('.fab-set-operation [data-action="snapshot-delete"]')
      const r = b.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })
    await tap(client, delBtn.x, delBtn.y, 60)
    await sleep(500)
    const afterDel = await page.evaluate(() => ({
      items: document.querySelectorAll('#snapshot-list .snapshot-item').length,
      opMode: App.SnapshotSheet.isOpMode(),
      bodyClass: document.body.classList.contains('snapshot-op-mode'),
      tabCounts: Array.from(document.querySelectorAll('.snapshot-tab-count')).map(t => t.textContent)
    }))
    if (afterDel.items === 1 && afterDel.tabCounts[0] === '1') pass('删除 2 项后剩 1 项（默认分组 1 条）')
    else fail('批量删除', JSON.stringify(afterDel))
    if (!afterDel.opMode && !afterDel.bodyClass) pass('删除后自动退出操作模式')
    else fail('删除后退出', JSON.stringify(afterDel))

    // ── 5. 再进操作模式 → 多选 → FAB 移动到其它分组 ──
    const rowA = await page.evaluate(() => {
      const r = document.querySelector('#snapshot-list .snapshot-item')
      const b = r.getBoundingClientRect()
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
    })
    await tap(client, rowA.x, rowA.y, 650)
    const moveBtn = await page.evaluate(() => {
      const b = document.querySelector('.fab-set-operation [data-action="snapshot-move"]')
      const r = b.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })
    await tap(client, moveBtn.x, moveBtn.y, 60)
    await sleep(300)
    const picker = await page.evaluate(() => {
      const overlay = document.querySelector('.snapshot-move-overlay')
      if (!overlay) return null
      const items = Array.from(overlay.querySelectorAll('.snapshot-move-item')).map(b => b.textContent)
      const target = overlay.querySelector('.snapshot-move-item')
      const r = target.getBoundingClientRect()
      return { items, tx: r.left + r.width / 2, ty: r.top + r.height / 2 }
    })
    if (picker && picker.items.length === 1 && picker.items[0].indexOf('项目A') >= 0) pass('移动浮层列出目标分组（项目A）')
    else fail('移动浮层', JSON.stringify(picker))
    await tap(client, picker.tx, picker.ty, 60)
    await sleep(400)
    const afterMove = await page.evaluate(() => ({
      activeTab: Array.from(document.querySelectorAll('.snapshot-tab')).findIndex(t => t.classList.contains('snapshot-tab-active')),
      tabCounts: Array.from(document.querySelectorAll('.snapshot-tab-count')).map(t => t.textContent),
      items: document.querySelectorAll('#snapshot-list .snapshot-item').length,
      opMode: App.SnapshotSheet.isOpMode()
    }))
    if (afterMove.activeTab === 1 && afterMove.items === 2 && afterMove.tabCounts[1] === '2') pass('移动后切到项目A tab（2 条）')
    else fail('移动结果', JSON.stringify(afterMove))
    if (!afterMove.opMode) pass('移动后退出操作模式')
    else fail('移动后退出', JSON.stringify(afterMove))

    // ── 6. 拖拽排序（项目A 2 项）：长按第 1 项向下拖 → 顺序变化 + 面板不跟随关闭 ──
    const beforeNames = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#snapshot-list .snapshot-name')).map(n => n.textContent))
    const dragRow = await page.evaluate(() => {
      const r = document.querySelector('#snapshot-list .snapshot-item')
      const b = r.getBoundingClientRect()
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
    })
    await longPressDrag(client, dragRow.x, dragRow.y, 140)
    const afterDrag = await page.evaluate(() => ({
      names: Array.from(document.querySelectorAll('#snapshot-list .snapshot-name')).map(n => n.textContent),
      panelTransform: document.querySelector('#snapshot-sheet-panel').style.transform,
      opMode: App.SnapshotSheet.isOpMode(),
      fabMode: document.querySelector('#fab-speed-dial').getAttribute('data-mode')
    }))
    if (afterDrag.names.length === 2 && afterDrag.names[0] !== beforeNames[0]) pass('长按拖拽 → 分组内排序生效（' + beforeNames[0] + ' → ' + afterDrag.names[0] + '）')
    else fail('拖拽排序', JSON.stringify({ before: beforeNames, after: afterDrag.names }))
    if (!afterDrag.panelTransform || afterDrag.panelTransform === 'translateY(0px)' || afterDrag.panelTransform === 'none') pass('拖拽时面板不跟随关闭（transform=' + afterDrag.panelTransform + '）')
    else fail('面板跟随关闭', afterDrag.panelTransform)
    if (afterDrag.opMode && afterDrag.fabMode === 'snapshot-operation') pass('拖拽后仍在操作模式（FAB 保持展开）')
    else fail('拖拽后操作模式', JSON.stringify(afterDrag))

    // ── 7. FAB ✕ 退出操作模式 ──
    const rowB = await page.evaluate(() => {
      const r = document.querySelector('#snapshot-list .snapshot-item')
      const b = r.getBoundingClientRect()
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
    })
    await tap(client, rowB.x, rowB.y, 650)
    const fabRect = await page.evaluate(() => {
      const b = document.querySelector('#mode-switch-fab').getBoundingClientRect()
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
    })
    await tap(client, fabRect.x, fabRect.y, 60) // FAB 原位 ✕ = 收起 + 退出
    const afterExit = await page.evaluate(() => ({
      opMode: App.SnapshotSheet.isOpMode(),
      fabMode: document.querySelector('#fab-speed-dial').getAttribute('data-mode'),
      fabVisible: (function () {
        const s = getComputedStyle(document.querySelector('#mode-switch-fab'))
        return s.visibility === 'visible' && s.pointerEvents !== 'none' && s.opacity !== '0'
      })()
    }))
    if (!afterExit.opMode && afterExit.fabMode === null && afterExit.fabVisible) pass('FAB ✕ → 退出操作模式 + FAB 收回（仍可见最高层）')
    else fail('FAB ✕ 退出', JSON.stringify(afterExit))

    // ── 8. 点击 tab 切换仍正常 ──
    const tab2 = await page.evaluate(() => {
      const t = document.querySelectorAll('.snapshot-tab')[1]
      const b = t.getBoundingClientRect()
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
    })
    await tap(client, tab2.x, tab2.y)
    const afterTab = await page.evaluate(() => document.querySelectorAll('#snapshot-list .snapshot-item').length)
    if (afterTab === 2) pass('tab 切换正常（项目A 2 条可见快照）')
    else fail('tab 切换', 'items=' + afterTab)

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
