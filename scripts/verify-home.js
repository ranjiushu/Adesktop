// Home 位置快照 E2E 门禁：CDP 真实触摸序列验证
// ═══════════════════════════════════════════════════════════════
//  场景：无头 Chromium（evaluateOnNewDocument 预注入 FileBridge 内存桩，
//        根目录含 docs 文件夹，boot refresh 即成功）：
//    1. Home 按钮存在且根目录下可用，初始无快照标记，相机 (0,0,1)
//    2. 双击进入子文件夹 → Home 禁用；点上级目录 → 恢复可用
//    3. 双指平移 + 捏合偏离 → 长按 Home（650ms）→ 快照写入 localStorage
//       + home-has-snapshot 类 + toast
//    4. 再次平移偏离 → 点按 Home → 相机回到快照（transform 数值断言，含 zoom）
//    5. Drawer「设为默认视角」→ fallback 写入，home 保留
//    6. 全程零 pageerror
//
//  用法: DESKTOP_BUNDLE=dist/desktop.bundle.min.html node scripts/verify-home.js
//  退出码: 0 通过 / 1 失败 / 2 无可用 Chromium
// ═══════════════════════════════════════════════════════════════
const { launch } = require('./lib/browser')
const path = require('path')

const BUNDLE = process.env.DESKTOP_BUNDLE || path.join(__dirname, '..', 'dist', 'desktop.bundle.html')
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

// 双击：两次 touchend 间隔 < 300ms（双击窗口）
async function doubleTap(client, x, y) {
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
  await sleep(40)
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await sleep(150)
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
  await sleep(40)
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await sleep(TAP_GAP)
}

// 双指水平平移：两指同向移动 dx/dy
async function pan(client, x, y, dx, dy, steps = 10, gap = 12) {
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: x - 30, y }, { x: x + 30, y }]
  })
  for (let i = 1; i <= steps; i++) {
    await sleep(gap)
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: x - 30 + dx * i / steps, y: y + dy * i / steps },
        { x: x + 30 + dx * i / steps, y: y + dy * i / steps }
      ]
    })
  }
  await sleep(gap)
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await sleep(200)
}

// 双指捏合（放大）：指距 50 → 80，锚点不动
async function pinchIn(client, x, y) {
  const pts = (d) => [{ x: x - d, y }, { x: x + d, y }]
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(25) })
  for (let d = 26; d <= 40; d += 2) {
    await sleep(10)
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(d) })
  }
  await sleep(10)
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await sleep(200)
}

// 解析 canvas transform：translate3d(TXpx,TYpx,TZpx) scale(S)
function parseTransform(t) {
  const m = /translate3d\((-?[\d.]+)px,\s*(-?[\d.]+)px,\s*(-?[\d.]+)px?\)\s*scale\(([\d.]+)\)/.exec(t || '')
  if (!m) return null
  return { tx: parseFloat(m[1]), ty: parseFloat(m[2]), s: parseFloat(m[4]) }
}

const canvasTransform = (page) => page.evaluate(() => document.getElementById('desktop-canvas').style.transform)

async function waitFor(page, sel, timeoutMs) {
  const start = Date.now()
  while (Date.now() - start < (timeoutMs || 5000)) {
    const ok = await page.evaluate((s) => !!document.querySelector(s), sel)
    if (ok) return true
    await sleep(100)
  }
  return false
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

  // 预注入 FileBridge 内存桩：boot refresh 即成功，根目录一个 docs 文件夹
  await page.evaluateOnNewDocument(() => {
    window.FileBridge = {
      vibrate: function () {},
      rootInfo: function (cb) {
        window.__fbResolve(cb, { ok: true, data: { rootName: 'mock', displayPath: '/mock', mode: 'mock' } })
      },
      list: function (p, cb) {
        const items = p ? [] : [{ name: 'docs', isDir: true, size: 0, mtime: 0 }]
        window.__fbResolve(cb, { ok: true, data: items })
      }
    }
  })
  await page.goto('file://' + BUNDLE)
  await sleep(1000)
  const client = await page.createCDPSession()

  const rect = (sel) => page.evaluate((s) => {
    const el = document.querySelector(s)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }, sel)

  // ── 1. Home 按钮存在、根目录可用、无快照标记、相机 (0,0,1) ──
  const homeRect = await rect('#bb-btn-home')
  const homeState = await page.evaluate(() => {
    const b = document.getElementById('bb-btn-home')
    return { disabled: b.disabled, hasClass: b.classList.contains('home-has-snapshot') }
  })
  if (homeRect && !homeState.disabled) pass('Home 按钮存在且根目录下可用')
  else fail('Home 按钮可用态', JSON.stringify(homeState))
  if (!homeState.hasClass) pass('初始无 home-has-snapshot 标记')
  else fail('初始不应有快照标记')
  const t0 = parseTransform(await canvasTransform(page))
  if (t0 && Math.abs(t0.tx) < 1 && Math.abs(t0.ty) < 1 && Math.abs(t0.s - 1) < 0.01) pass('初始相机 = (0,0,1)')
  else fail('初始相机断言', JSON.stringify(t0))

  // ── 2. 双击进入子文件夹 → Home 禁用；上级返回 → 恢复可用 ──
  if (await waitFor(page, '[data-name="docs"]')) {
    const icon = await rect('[data-name="docs"]')
    await doubleTap(client, icon.x, icon.y)
    await sleep(400)
    const inFolder = await page.evaluate(() => document.getElementById('bb-btn-home').disabled)
    if (inFolder) pass('子文件夹容器内 Home 按钮禁用')
    else fail('子文件夹内 Home 应禁用')
    const upBtn = await rect('#bb-btn-up')
    await tap(client, upBtn.x, upBtn.y)
    await sleep(400)
    const backRoot = await page.evaluate(() => !document.getElementById('bb-btn-home').disabled)
    if (backRoot) pass('返回根目录后 Home 恢复可用')
    else fail('根目录 Home 应可用')
  } else {
    fail('根目录 docs 图标未渲染')
  }

  // ── 3. 平移 + 捏合偏离 → 长按 Home 记录快照 ──
  const vp = await rect('#desktop-viewport')
  await pan(client, vp.x, vp.y + 200, 120, 0)
  await pinchIn(client, vp.x, vp.y + 200)
  const tPan = parseTransform(await canvasTransform(page))
  if (tPan && tPan.s > 1.3) pass('捏合后 zoom ≈ ' + tPan.s.toFixed(2))
  else fail('捏合后 zoom 断言', JSON.stringify(tPan))

  await tap(client, homeRect.x, homeRect.y, 650)  // 长按 650ms > 500ms
  const snap = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('desktop.home.v1')) } catch (e) { return null }
  })
  if (snap && snap.home && typeof snap.home.zoom === 'number' && snap.home.zoom > 1.3) {
    pass('长按 Home → 快照写入 localStorage（zoom=' + snap.home.zoom.toFixed(2) + '）')
  } else {
    fail('快照写入断言', JSON.stringify(snap))
  }
  const afterLong = await page.evaluate(() => document.getElementById('bb-btn-home').classList.contains('home-has-snapshot'))
  if (afterLong) pass('home-has-snapshot 类已应用')
  else fail('home-has-snapshot 类缺失')
  const toast1 = await page.evaluate(() => { const t = document.querySelector('.toast'); return t ? t.textContent : '' })
  if (toast1.indexOf('已记录 Home 视角') >= 0) pass('长按 toast: ' + toast1)
  else fail('长按 toast 断言', toast1)

  // ── 4. 再次平移偏离 → 点按 Home → 相机回到快照 ──
  const tSnap = parseTransform(await canvasTransform(page))
  await pan(client, vp.x, vp.y + 200, 80, 0)
  const tAway = parseTransform(await canvasTransform(page))
  if (tAway && Math.abs(tAway.tx - tSnap.tx) > 1) pass('再次平移后相机偏离（tx=' + tAway.tx.toFixed(1) + '）')
  else fail('再次平移偏离断言', JSON.stringify(tAway))

  await sleep(1500)  // 等 toast1 过期，避免干扰后续 toast 断言
  await tap(client, homeRect.x, homeRect.y, 60)   // 短按 = 回 Home
  const tBack = parseTransform(await canvasTransform(page))
  const okBack = tBack && Math.abs(tBack.tx - tSnap.tx) < 1 && Math.abs(tBack.ty - tSnap.ty) < 1 && Math.abs(tBack.s - tSnap.s) < 0.01
  if (okBack) pass('点按 Home → 相机回到快照（tx=' + tBack.tx.toFixed(1) + ', zoom=' + tBack.s.toFixed(2) + '）')
  else fail('回到快照断言', 'snap=' + JSON.stringify(tSnap) + ' back=' + JSON.stringify(tBack))

  // ── 5. Drawer「设为默认视角」→ fallback 写入且 home 保留 ──
  await sleep(1500)  // 等上一个 toast 过期
  const drawerBtn = await rect('#btn-drawer')
  await tap(client, drawerBtn.x, drawerBtn.y)
  await sleep(400)  // 等抽屉展开动画（0.28s）落定
  const setView = await rect('[data-action="set-default-view"]')
  await tap(client, setView.x, setView.y)
  await sleep(400)
  const snap2 = await page.evaluate(() => JSON.parse(localStorage.getItem('desktop.home.v1')))
  if (snap2 && snap2.fallback && snap2.home && snap2.home.zoom === snap.home.zoom) {
    pass('设为默认视角 → fallback 写入且 home 保留')
  } else {
    fail('fallback 断言', JSON.stringify(snap2))
  }
  const toast2 = await page.evaluate(() => { const t = document.querySelector('.toast'); return t ? t.textContent : '' })
  if (toast2.indexOf('已设置默认视角') >= 0) pass('默认视角 toast: ' + toast2)
  else fail('默认视角 toast 断言', toast2)

  // ── 5b. 重新进入（reload）：启动相机 = Home 快照（> 默认视角 > 上次布局 > 出厂） ──
  // 期望 transform：tx = -x*zoom, ty = -y*zoom, s = zoom
  const expectT = (c) => ({ tx: -c.x * c.zoom, ty: -c.y * c.zoom, s: c.zoom })
  const homeData = await page.evaluate(() => JSON.parse(localStorage.getItem('desktop.home.v1')))
  const tHomeExpect = expectT(homeData.home)
  await page.reload({ waitUntil: 'networkidle0' })
  await sleep(1200)
  const tAfterReload = parseTransform(await canvasTransform(page))
  const okReloadHome = tAfterReload &&
    Math.abs(tAfterReload.tx - tHomeExpect.tx) < 1 &&
    Math.abs(tAfterReload.ty - tHomeExpect.ty) < 1 &&
    Math.abs(tAfterReload.s - tHomeExpect.s) < 0.01
  if (okReloadHome) pass('重新进入 → 启动相机落在 Home 快照（tx=' + tAfterReload.tx.toFixed(1) + ', zoom=' + tAfterReload.s.toFixed(2) + '）')
  else fail('重新进入落快照断言', 'expect=' + JSON.stringify(tHomeExpect) + ' got=' + JSON.stringify(tAfterReload))

  // 清掉快照只留默认视角 → reload → 启动相机落在默认视角
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('desktop.home.v1'))
    delete d.home
    localStorage.setItem('desktop.home.v1', JSON.stringify(d))
  })
  await page.reload({ waitUntil: 'networkidle0' })
  await sleep(1200)
  const tAfterReload2 = parseTransform(await canvasTransform(page))
  const fallbackData = await page.evaluate(() => JSON.parse(localStorage.getItem('desktop.home.v1')).fallback)
  const tFbExpect = expectT(fallbackData)
  const okReloadFb = tAfterReload2 &&
    Math.abs(tAfterReload2.tx - tFbExpect.tx) < 1 &&
    Math.abs(tAfterReload2.ty - tFbExpect.ty) < 1 &&
    Math.abs(tAfterReload2.s - tFbExpect.s) < 0.01
  if (okReloadFb) pass('清快照后重新进入 → 启动相机落在默认视角（tx=' + tAfterReload2.tx.toFixed(1) + ', zoom=' + tAfterReload2.s.toFixed(2) + '）')
  else fail('重新进入落默认视角断言', 'expect=' + JSON.stringify(tFbExpect) + ' got=' + JSON.stringify(tAfterReload2))

  // 快照与默认视角都清掉 → reload → 启动出厂 (0,0,1)
  await page.evaluate(() => localStorage.removeItem('desktop.home.v1'))
  await page.reload({ waitUntil: 'networkidle0' })
  await sleep(1200)
  const tAfterReload3 = parseTransform(await canvasTransform(page))
  const okReloadDefault = tAfterReload3 &&
    Math.abs(tAfterReload3.tx) < 1 && Math.abs(tAfterReload3.ty) < 1 && Math.abs(tAfterReload3.s - 1) < 0.01
  if (okReloadDefault) pass('无快照/默认视角重新进入 → 启动出厂 (0,0,1)')
  else fail('重新进入出厂断言', JSON.stringify(tAfterReload3))

  // ── 6. 零 pageerror ──
  if (pageErrors.length === 0) pass('全程零 pageerror')
  else fail('pageerror', pageErrors.join(' | '))

  await browser.close()
  if (FAIL > 0) {
    console.log('\n  Home E2E: ' + PASS + ' 通过 / ' + FAIL + ' 失败')
    process.exit(1)
  }
  console.log('\n  Home E2E 全部通过（' + PASS + ' 项）')
  process.exit(0)
}

main().catch(function (e) {
  console.error('  [ERROR] ' + (e && e.message))
  process.exit(1)
})
