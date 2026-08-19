// 快照面板 E2E 门禁：CDP 无头 Chromium 实地验证
// ═══════════════════════════════════════════════════════════════
//  场景（evaluateOnNewDocument 预注入 FileBridge 内存桩）：
//    1. 面板打开后高度 = 视口 50%（固定高度，参考 MT 管理器）
//    2. 遮罩覆盖全屏且可见；面板贴底
//    3. 底部有关闭按钮 + footer 条
//    4. 快照按分组渲染（默认分组 3 项 + 项目A 1 项），分组标题正确
//    5. Home 位快照有高亮类；菜单按钮存在
//    6. 全程零 pageerror
//
//  用法: DESKTOP_BUNDLE=dist/adesktop.bundle.min.html node scripts/verify-snapshot-sheet.js
//  退出码: 0 通过 / 1 失败
// ═══════════════════════════════════════════════════════════════
'use strict'
const { launch } = require('./lib/browser')

const BUNDLE = process.env.DESKTOP_BUNDLE || require('path').join(__dirname, '..', 'dist', 'adesktop.bundle.html')
const SHOT = process.env.SHOT_PATH || '/tmp/snapshot-sheet.png'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

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
    const diag = await page.evaluate(() => {
      const core = App.DesktopCore
      const rootId = core.state.rootId
      const out = { rootId }
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
          out.written = true
        }
      } catch (e) { out.err = String(e) }
      App.SnapshotSheet.open()
      out.sheetOpen = App.SnapshotSheet.isOpen()
      return out
    })
    console.log('DIAG: ' + JSON.stringify(diag))
    await sleep(700)

    const r = await page.evaluate(() => {
      const rect = sel => {
        const el = document.querySelector(sel)
        if (!el) return null
        const b = el.getBoundingClientRect()
        return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, width: b.width, height: b.height }
      }
      const panel = rect('#snapshot-sheet-panel')
      const overlay = rect('#snapshot-sheet-overlay')
      const list = rect('#snapshot-list')
      const closeBtn = rect('#snapshot-close-btn')
      const groups = Array.from(document.querySelectorAll('.snapshot-group')).map(g => {
        const title = g.querySelector('.snapshot-group-title')
        const items = g.querySelectorAll('.snapshot-item').length
        return { title: title ? title.textContent : '', items }
      })
      const homeItems = document.querySelectorAll('.snapshot-item.snapshot-home').length
      const menuBtn = rect('#snapshot-menu-btn')
      const overlayVisible = document.querySelector('#snapshot-sheet-overlay').classList.contains('snapshot-sheet-overlay-visible')
      const footer = rect('.snapshot-sheet-footer')
      const groupHeaders = document.querySelectorAll('.snapshot-group-header').length
      return {
        viewportH: window.innerHeight,
        panel, overlay, list, closeBtn, menuBtn, footer,
        groups, groupHeaders, homeItems, overlayVisible
      }
    })
    console.log('READINGS: ' + JSON.stringify(r))

    const checks = []
    const vh = r.viewportH
    const half = vh / 2
    checks.push(['面板高度 = 50vh (±2px)', r.panel && Math.abs(r.panel.height - half) <= 2])
    checks.push(['面板贴底（bottom = viewportH）', r.panel && Math.abs(r.panel.bottom - vh) <= 1])
    checks.push(['遮罩覆盖全屏且可见', r.overlay && r.overlay.top === 0 && r.overlayVisible])
    checks.push(['关闭按钮存在', r.closeBtn && r.closeBtn.height > 0])
    checks.push(['footer 存在', r.footer && r.footer.height > 0])
    checks.push(['列表可滚动（有高度）', r.list && r.list.height > 60])
    checks.push(['两个分组标题渲染', r.groups.length === 2 && r.groups[0].title === '默认分组' && r.groups[1].title === '项目A'])
    checks.push(['分组1 有 3 项', r.groups[0] && r.groups[0].items === 3])
    checks.push(['分组2 有 1 项', r.groups[1] && r.groups[1].items === 1])
    checks.push(['Home 高亮 1 项', r.homeItems === 1])
    checks.push(['菜单按钮存在', r.menuBtn && r.menuBtn.height > 0])

    let failed = 0
    for (const [label, ok] of checks) {
      console.log((ok ? '  [PASS] ' : '  [FAIL] ') + label)
      if (!ok) failed++
    }
    await page.screenshot({ path: SHOT })
    console.log('SHOT: ' + SHOT)
    console.log('ERRORS: ' + JSON.stringify(errors))
    process.exit(failed > 0 || errors.length > 0 ? 1 : 0)
  } finally {
    await browser.close()
  }
}
main().catch(e => { console.error(e); process.exit(1) })
