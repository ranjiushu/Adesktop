// Morph FAB + 取景器 E2E 门禁：CDP 真实触摸序列验证
// ═══════════════════════════════════════════════════════════════
//  场景：无头 Chromium 真实触摸事件（CDP Input.dispatchTouchEvent）：
//    1. FAB 渲染就绪（fab-speed-dial-ready）
//    2. 短按 FAB → Speed Dial 展开（expanded/active/backdrop）
//    3. 点遮罩 → 收起
//    4. 长按 FAB 800ms → 取景器激活（scope-highlight 存在）
//    5. 点击元素 → 信息面板显示
//    6. 「取消」→ 取景器 DOM 全部清理
//    7. 全程零 pageerror
//
//  用法: DESKTOP_BUNDLE=dist/desktop.bundle.min.html node scripts/verify-fab-inspector.js
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

  // ── 1. FAB 渲染就绪 ──
  const fabInfo = await page.evaluate(() => {
    const fab = document.getElementById('mode-switch-fab')
    if (!fab) return null
    const r = fab.getBoundingClientRect()
    return {
      ready: fab.classList.contains('fab-speed-dial-ready'),
      x: r.left + r.width / 2,
      y: r.top + r.height / 2,
      visible: r.width > 0 && r.height > 0
    }
  })
  if (!fabInfo || !fabInfo.visible) { fail('FAB 渲染可见'); process.exit(1) }
  pass('FAB 渲染可见 (x=' + Math.round(fabInfo.x) + ', y=' + Math.round(fabInfo.y) + ')')
  if (fabInfo.ready) pass('FAB speed-dial-ready 就绪')
  else fail('FAB 未就绪（缺 fab-speed-dial-ready）')

  // ── 2. 短按 FAB → 展开 ──
  await tap(client, fabInfo.x, fabInfo.y, 60)
  const expanded = await page.evaluate(() => {
    const sd = document.getElementById('fab-speed-dial')
    const bd = document.getElementById('fab-backdrop')
    const fab = document.getElementById('mode-switch-fab')
    return !!(sd && sd.classList.contains('fab-speed-dial-expanded') &&
      bd && bd.classList.contains('fab-backdrop-visible') &&
      fab && fab.classList.contains('fab-speed-dial-active'))
  })
  if (expanded) pass('短按展开 Speed Dial')
  else fail('短按未展开 Speed Dial')

  // ── 3. 点遮罩 → 收起 ──
  await tap(client, 40, 400, 60)
  const collapsed = await page.evaluate(() => {
    const sd = document.getElementById('fab-speed-dial')
    return !(sd && sd.classList.contains('fab-speed-dial-expanded'))
  })
  if (collapsed) pass('点遮罩收起')
  else fail('点遮罩未收起')

  // ── 4. 长按 FAB 800ms → 取景器激活 ──
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: fabInfo.x, y: fabInfo.y }] })
  await sleep(900)
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await sleep(400)
  const scopeActive = await page.evaluate(() => {
    return !!(document.getElementById('scope-highlight') &&
      document.getElementById('scope-panel') &&
      document.getElementById('scope-toolbar') &&
      window.App.inspector.isActive())
  })
  if (scopeActive) pass('长按 800ms 激活取景器')
  else fail('长按未激活取景器')

  // ── 5. 点击元素 → 面板显示 ──
  await tap(client, fabInfo.x, fabInfo.y, 60)  // 点 FAB 自身（取景器内：选中元素）
  const panelShown = await page.evaluate(() => {
    const p = document.getElementById('scope-panel')
    const hl = document.getElementById('scope-highlight')
    return !!(p && p.style.display === 'block' && hl && hl.style.display === 'block')
  })
  if (panelShown) pass('点击元素弹出信息面板')
  else fail('点击元素未弹出面板')

  // ── 6. 「取消」→ DOM 清理 ──
  const cancelBtn = await page.evaluate(() => {
    const b = document.getElementById('scope-btn-cancel')
    if (!b) return null
    const r = b.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  if (cancelBtn) {
    await tap(client, cancelBtn.x, cancelBtn.y, 60)
    await sleep(700)
    const cleaned = await page.evaluate(() => {
      return !document.getElementById('scope-highlight') &&
        !document.getElementById('scope-panel') &&
        !document.getElementById('scope-toolbar') &&
        !window.App.inspector.isActive()
    })
    if (cleaned) pass('取消后取景器 DOM 全部清理')
    else fail('取消后残留取景器 DOM')
  } else {
    fail('找不到「取消」按钮')
  }

  // ── 7. 零 pageerror ──
  if (pageErrors.length === 0) pass('全程零 pageerror')
  else fail('存在 pageerror: ' + pageErrors.join(' | '))

  await browser.close()
  if (FAIL > 0) {
    console.log('  [FAIL] 共 ' + FAIL + ' 项失败')
    process.exit(1)
  }
  console.log('  [ok] FAB + 取景器 E2E 全部通过 (' + PASS + ' 项)')
  process.exit(0)
}

main().catch(e => {
  console.error('[FAIL] E2E 异常: ' + (e && e.message))
  process.exit(1)
})
