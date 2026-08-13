// Drawer 工具栏 E2E 门禁：CDP 真实触摸序列验证
// ═══════════════════════════════════════════════════════════════
//  场景：无头 Chromium：
//    1. 汉堡按钮渲染可见
//    2. 点击汉堡 → Drawer 滑出（drawer-open + 遮罩可见）
//    3. 点遮罩 → Drawer 收起
//    4. 标题显示路径（无桥环境降级为 App.NAME）
//    5. 全程零 pageerror
//
//  用法: DESKTOP_BUNDLE=dist/desktop.bundle.min.html node scripts/verify-drawer.js
//  退出码: 0 通过 / 1 失败 / 2 无可用 Chromium
// ═══════════════════════════════════════════════════════════════
const { launch } = require('./lib/browser')
const path = require('path')

const BUNDLE = process.env.DESKTOP_BUNDLE || path.join(__dirname, '..', 'dist', 'desktop.bundle.html')
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const TAP_GAP = 350

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

async function main() {
  let browser
  try {
    browser = await launch()
  } catch (e) {
    console.log('  无可用 Chromium（' + e.message.split('\n')[0] + '）')
    process.exit(2)
  }
  const page = await browser.newPage()
  await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 1, hasTouch: true, isMobile: true })
  const pageErrors = []
  page.on('pageerror', e => pageErrors.push(e.message))
  await page.goto('file://' + BUNDLE)
  await sleep(1200)
  const client = await page.createCDPSession()

  // ── 1. 汉堡渲染 ──
  const btn = await page.evaluate(() => {
    const b = document.getElementById('btn-drawer')
    if (!b) return null
    const r = b.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, visible: r.width > 0 && r.height > 0 }
  })
  if (!btn || !btn.visible) { fail('汉堡按钮渲染可见'); process.exit(1) }
  pass('汉堡按钮渲染可见 (x=' + Math.round(btn.x) + ', y=' + Math.round(btn.y) + ')')

  // ── 2. 点击汉堡 → Drawer 滑出 ──
  await tap(client, btn.x, btn.y, 60)
  const opened = await page.evaluate(() => {
    const d = document.getElementById('drawer')
    const o = document.getElementById('drawer-overlay')
    return !!(d && d.classList.contains('drawer-open') &&
      o && o.classList.contains('drawer-overlay-visible'))
  })
  if (opened) pass('点击汉堡 Drawer 滑出')
  else fail('汉堡点击未滑出 Drawer')

  // Drawer 位移验证（transform 从 -100% 到 0）
  const drawerX = await page.evaluate(() => {
    const d = document.getElementById('drawer')
    const r = d.getBoundingClientRect()
    return Math.round(r.left)
  })
  if (drawerX === 0) pass('Drawer 完全滑入 (left=0)')
  else fail('Drawer 未完全滑入 (left=' + drawerX + ')')

  // ── 3. 点遮罩 → 收起 ──
  await tap(client, 390, 500, 60)
  const closed = await page.evaluate(() => {
    const d = document.getElementById('drawer')
    return !(d && d.classList.contains('drawer-open'))
  })
  if (closed) pass('点遮罩 Drawer 收起')
  else fail('点遮罩未收起')

  // ── 4. 标题显示路径（无桥环境降级为 App.NAME） ──
  const title = await page.evaluate(() => document.getElementById('app-title').textContent)
  if (title && title.length > 0) pass('标题有内容: "' + title + '"')
  else fail('标题为空')

  // ── 5. 零 pageerror ──
  if (pageErrors.length === 0) pass('全程零 pageerror')
  else fail('存在 pageerror: ' + pageErrors.join(' | '))

  await browser.close()
  if (FAIL > 0) {
    console.log('  [FAIL] 共 ' + FAIL + ' 项失败')
    process.exit(1)
  }
  console.log('  [ok] Drawer E2E 全部通过 (' + PASS + ' 项)')
  process.exit(0)
}

main().catch(e => {
  console.error('[FAIL] E2E 异常: ' + (e && e.message))
  process.exit(1)
})
