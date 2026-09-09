// 底部工具栏 E2E 门禁：CDP 真实触摸序列验证
// ═══════════════════════════════════════════════════════════════
//  场景：无头 Chromium（注入 FileBridge 内存桩）：
//    1. 底栏渲染：5 个按钮、高度 = 屏高 1/10（10vh）、Home 按钮居中、快照按钮存在（无加号）
//    2. Home / 快照（相机）按钮存在且在根目录可用；新建（加号）已由 Morph FAB 承担，底栏不再有
//    3. 底栏右划 → Drawer 跟手拉出（中途 inline transform 跟手）→ 打开
//    4. Drawer 左滑 → 跟手关闭
//    5. 底栏小幅慢滑（<30%）→ 弹回不打开
//    6. Drawer 打开后点遮罩 → 收起（原路径回归）
//    7. 全程零 pageerror
//
//  用法: DESKTOP_BUNDLE=dist/adesktop.bundle.min.html node scripts/verify-bottom-bar.js
//  退出码: 0 通过 / 1 失败 / 2 无可用 Chromium
// ═══════════════════════════════════════════════════════════════
const { launch } = require('./lib/browser')
const path = require('path')

const BUNDLE = process.env.DESKTOP_BUNDLE || path.join(__dirname, '..', 'dist', 'adesktop.bundle.html')
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

// 分段滑动：steps 段 touchMove，每段间隔 gap ms；中途可选回调检查跟手状态
async function swipe(client, x1, y1, x2, y2, steps = 12, gap = 12, onMidway) {
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y: y1 }] })
  for (let i = 1; i <= steps; i++) {
    await sleep(gap)
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x1 + (x2 - x1) * i / steps, y: y1 + (y2 - y1) * i / steps }]
    })
    if (onMidway && i === Math.ceil(steps / 2)) await onMidway()
  }
  await sleep(gap)
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
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
  // 预注入 FileBridge 内存桩：boot refresh 即成功，Home/快照按钮才被 updateNavButtons 启用
  //（drawer 场景需 rootInfo/list；evaluateOnNewDocument 在导航前注入，与 verify-home/rotate 同款）
  await page.evaluateOnNewDocument(() => {
    window.FileBridge = {
      rootInfo: function (cb) {
        window.__fbResolve(cb, { ok: true, data: { rootName: 'mock', displayPath: '/mock', mode: 'mock' } })
      },
      list: function (p, cb) { window.__fbResolve(cb, { ok: true, data: [] }) }
    }
  })
  await page.goto('file://' + BUNDLE)
  await sleep(1000)
  const client = await page.createCDPSession()

  // ── 1. 底栏渲染：5 按钮、高度 1/10、Home 居中、快照存在、无加号 ──
  const bar = await page.evaluate(() => {
    const b = document.getElementById('bottom-bar')
    const btns = document.querySelectorAll('.bottom-bar-btn')
    const home = document.getElementById('bb-btn-home')
    const snap = document.getElementById('bb-btn-snapshot')
    const add = document.getElementById('bb-btn-add')
    if (!b) return null
    const r = b.getBoundingClientRect()
    const homeInfo = home ? (() => { const hr = home.getBoundingClientRect(); return { x: hr.left + hr.width / 2, y: hr.top + hr.height / 2 } })() : null
    return {
      visible: r.width > 0 && r.height > 0,
      height: r.height,
      btnCount: btns.length,
      homeInfo: homeInfo,
      hasHome: !!home,
      hasSnap: !!snap,
      hasAdd: !!add
    }
  })
  if (!bar || !bar.visible) { fail('底栏渲染可见'); process.exit(1) }
  pass('底栏渲染可见')
  if (bar.btnCount === 5) pass('底栏 5 个按钮')
  else fail('底栏按钮数 = ' + bar.btnCount + '（期望 5）')
  const expectH = Math.round(915 / 10)
  if (Math.abs(Math.round(bar.height) - expectH) <= 2) pass('底栏高度 ≈ 屏高 1/10 (' + expectH + 'px, 实测 ' + Math.round(bar.height) + ')')
  else fail('底栏高度 ' + Math.round(bar.height) + 'px，期望 ≈' + expectH)
  if (bar.hasHome && bar.homeInfo && Math.abs(bar.homeInfo.x - 206) <= 30) pass('Home 按钮居中 (x=' + Math.round(bar.homeInfo.x) + ')')
  else fail('Home 按钮未居中 x=' + (bar.homeInfo && Math.round(bar.homeInfo.x)))
  if (bar.hasSnap) pass('快照（相机）按钮存在')
  else fail('快照按钮缺失')
  if (!bar.hasAdd) pass('加号已移除（新建由 Morph FAB 承担）')
  else fail('加号仍存在（应移除）')

  // ── 2. Home / 快照按钮在根目录可用 ──
  const btnState = await page.evaluate(() => {
    const home = document.getElementById('bb-btn-home')
    const snap = document.getElementById('bb-btn-snapshot')
    return {
      homeDisabled: home ? home.disabled : true,
      snapDisabled: snap ? snap.disabled : true
    }
  })
  if (!btnState.homeDisabled) pass('Home 按钮根目录可用')
  else fail('Home 按钮根目录应可用（实际 disabled）')
  if (!btnState.snapDisabled) pass('快照按钮根目录可用')
  else fail('快照按钮根目录应可用（实际 disabled）')

  // ── 3. 底栏右划 → Drawer 跟手拉出并打开 ──
  const bbY = Math.round(915 - expectH / 2)
  let midTransform = null
  await swipe(client, 40, bbY, 340, bbY, 12, 12, async () => {
    midTransform = await page.evaluate(() => {
      const d = document.getElementById('drawer')
      return d ? d.style.transform : null
    })
  })
  await sleep(450)
  if (midTransform && /translateX\(-\d+px\)/.test(midTransform)) pass('右划中途 Drawer 跟手 (transform=' + midTransform + ')')
  else fail('右划中途未跟手: ' + midTransform)
  const revealed = await page.evaluate(() => {
    const d = document.getElementById('drawer')
    const o = document.getElementById('drawer-overlay')
    return !!(d && d.classList.contains('drawer-open') &&
      o && o.classList.contains('drawer-overlay-visible'))
  })
  if (revealed) pass('底栏右划 → Drawer 打开')
  else fail('底栏右划未打开 Drawer')

  // ── 4. Drawer 左滑 → 跟手关闭 ──
  // 起滑点 y=520 刻意选在末个按钮底边几 px 内：Blink 触摸目标调整（touch adjustment）
  // 会把该 touchstart 吸附到按钮上——回归「按钮吸附区起滑关不掉 Drawer」的坑
  // （修复：handleStart 不再跳过按钮，消费为关闭滑动时 stopPropagation 掉 touchend）。
  await swipe(client, 250, 520, 80, 520, 12, 12)
  await sleep(450)
  const swipedClosed = await page.evaluate(() => {
    const d = document.getElementById('drawer')
    return !(d && d.classList.contains('drawer-open'))
  })
  if (swipedClosed) pass('Drawer 左滑 → 跟手关闭（按钮吸附区起滑）')
  else fail('Drawer 左滑未关闭')

  // ── 4b. 从按钮正中起滑左滑 → Drawer 关闭且按钮动作不触发 ──
  await swipe(client, 40, bbY, 340, bbY, 12, 12)
  await sleep(450)
  const btnRect = await page.evaluate(() => {
    const b = document.getElementById('btn-build-info')
    if (!b) return null
    const r = b.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  })
  if (btnRect) {
    const endX = Math.max(20, btnRect.x - 170)
    await swipe(client, btnRect.x, btnRect.y, endX, btnRect.y, 12, 12)
    await sleep(450)
    const btnSwipe = await page.evaluate(() => {
      const d = document.getElementById('drawer')
      const bi = document.getElementById('buildinfo')
      return {
        drawerClosed: !(d && d.classList.contains('drawer-open')),
        buildinfoOpen: !!(bi && bi.classList.contains('buildinfo-open'))
      }
    })
    if (btnSwipe.drawerClosed && !btnSwipe.buildinfoOpen) pass('按钮正中起滑 → 关闭且不误触发按钮动作')
    else fail('按钮起滑异常: ' + JSON.stringify(btnSwipe))
  } else fail('btn-build-info 缺失')

  // ── 5. 底栏小幅慢滑（<30% 且低速）→ 弹回不打开 ──
  await swipe(client, 40, bbY, 100, bbY, 12, 40)
  await sleep(450)
  const bounced = await page.evaluate(() => {
    const d = document.getElementById('drawer')
    return !(d && d.classList.contains('drawer-open'))
  })
  if (bounced) pass('小幅慢滑 → 弹回不打开')
  else fail('小幅慢滑误打开 Drawer')

  // ── 6. 右划打开后点遮罩 → 收起（原路径回归） ──
  await swipe(client, 40, bbY, 340, bbY, 12, 12)
  await sleep(450)
  await tap(client, 390, 500, 60)
  const tapClosed = await page.evaluate(() => {
    const d = document.getElementById('drawer')
    return !(d && d.classList.contains('drawer-open'))
  })
  if (tapClosed) pass('右划打开后点遮罩 → 收起')
  else fail('点遮罩未收起 Drawer')

  // ── 7. 零 pageerror ──
  if (pageErrors.length === 0) pass('全程零 pageerror')
  else fail('存在 pageerror: ' + pageErrors.join(' | '))

  await browser.close()
  if (FAIL > 0) {
    console.log('  [FAIL] 共 ' + FAIL + ' 项失败')
    process.exit(1)
  }
  console.log('  [ok] 底部工具栏 E2E 全部通过 (' + PASS + ' 项)')
  process.exit(0)
}

main().catch(e => {
  console.error('[FAIL] E2E 异常: ' + (e && e.message))
  process.exit(1)
})
