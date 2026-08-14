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
        const items = p ? [] : [
          { name: 'docs', isDir: true, size: 0, mtime: 0 },
          { name: 'a.txt', isDir: false, size: 10, mtime: 0 },
          { name: 'b.txt', isDir: false, size: 20, mtime: 0 },
          { name: 'c.txt', isDir: false, size: 30, mtime: 0 }
        ]
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

  // ── 4. 再次平移偏离 → 点按 Home → 相机平滑过渡到快照（中间态 + 终态） ──
  const tSnap = parseTransform(await canvasTransform(page))
  await pan(client, vp.x, vp.y + 200, 80, 0)
  const tAway = parseTransform(await canvasTransform(page))
  if (tAway && Math.abs(tAway.tx - tSnap.tx) > 1) pass('再次平移后相机偏离（tx=' + tAway.tx.toFixed(1) + '）')
  else fail('再次平移偏离断言', JSON.stringify(tAway))

  await sleep(1500)  // 等 toast1 过期，避免干扰后续 toast 断言
  // 点按 Home（手动序列：tap() 内置 300ms 等待会错过 400ms 动画中段）
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: homeRect.x, y: homeRect.y }] })
  await sleep(60)
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await sleep(100)                                // 动画中段采样（k≈0.25，easeInOutCubic 已推进 ~6%，仍严格介于两端）
  const tMid = parseTransform(await canvasTransform(page))
  // 中间态：位于偏离态与快照态之间（非瞬切），且尚未到达终点
  const between = tMid && (tMid.tx - tSnap.tx) * (tMid.tx - tAway.tx) < 0 &&
    Math.abs(tMid.tx - tSnap.tx) > 1 && Math.abs(tMid.tx - tAway.tx) > 1
  if (between) pass('动画中间态：tx=' + tMid.tx.toFixed(1) + ' 介于偏离 ' + tAway.tx.toFixed(1) + ' 与快照 ' + tSnap.tx.toFixed(1) + ' 之间')
  else fail('动画中间态断言', 'away=' + JSON.stringify(tAway) + ' mid=' + JSON.stringify(tMid) + ' snap=' + JSON.stringify(tSnap))
  await sleep(500)                                // 等动画（400ms）结束
  const tBack = parseTransform(await canvasTransform(page))
  const okBack = tBack && Math.abs(tBack.tx - tSnap.tx) < 1 && Math.abs(tBack.ty - tSnap.ty) < 1 && Math.abs(tBack.s - tSnap.s) < 0.01
  if (okBack) pass('点按 Home → 动画结束后回到快照（tx=' + tBack.tx.toFixed(1) + ', zoom=' + tBack.s.toFixed(2) + '）')
  else fail('回到快照断言', 'snap=' + JSON.stringify(tSnap) + ' back=' + JSON.stringify(tBack))

  // ── 4b. 动画中手势打断：tap Home 后立即双指平移 → 相机跟随手指，不被动画拉回 ──
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: homeRect.x, y: homeRect.y }] })
  await sleep(60)
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await sleep(100)                                // 动画进行中
  await pan(client, vp.x, vp.y + 200, 60, 0)      // 手势接管 → 应打断动画
  const tInterrupt = parseTransform(await canvasTransform(page))
  await sleep(600)                                // 若动画未被取消，此处会被拉回 Home 目标
  const tAfter = parseTransform(await canvasTransform(page))
  const okInterrupt = tInterrupt && tAfter && Math.abs(tAfter.tx - tInterrupt.tx) < 1
  if (okInterrupt) pass('动画中手势打断：相机停在手势位置（tx=' + tAfter.tx.toFixed(1) + '），无回拉')
  else fail('手势打断断言', 'interrupt=' + JSON.stringify(tInterrupt) + ' after=' + JSON.stringify(tAfter))

  // ── 4c. zoom 变化回 Home：缩小场景动画全程图标不出界（防「甩出屏幕再拉回」）──
  // 背景：同进度插值（zoom 与屏幕中心点共用同一缓动）时图标屏幕位置 = (P-W)·z 中途
  // 出现极值，边缘图标被推出视口再拉回（单测扫描复现出界 120px）。三段式修复后
  // 全程不出界。本场景：捏合放大偏离（zoom 2.5）→ 点按 Home（快照 zoom 1.60）→
  // 动画 400ms 内逐帧采样所有图标矩形，断言中心点始终在 viewport 内。
  await pan(client, vp.x, vp.y + 200, 160, 0)      // 大幅平移偏离
  await pinchIn(client, vp.x, vp.y + 200)          // 捏合放大（zoom 2.5）
  await sleep(400)
  const tZoomed = parseTransform(await canvasTransform(page))
  // 动画前基线：记录各图标中心点（起点）
  const basePos = await page.evaluate(() => {
    const vp = document.getElementById('desktop-viewport').getBoundingClientRect()
    const out = {}
    document.querySelectorAll('.desktop-icon').forEach(function (el) {
      const r = el.getBoundingClientRect()
      out[el.getAttribute('data-name')] = { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })
    return { vp: { l: vp.left, t: vp.top, r: vp.right, b: vp.bottom }, icons: out }
  })
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: homeRect.x, y: homeRect.y }] })
  await sleep(60)
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  const zoomAnim = await page.evaluate(async (base) => {
    const vp = base.vp
    const inVP = (x, y) => x >= vp.l && x <= vp.r && y >= vp.t && y <= vp.b
    // 起点在视口内的图标（动画中应始终不出界；起点已出界的图标不参与断言）
    const tracked = Object.keys(base.icons).filter(function (n) {
      return inVP(base.icons[n].x, base.icons[n].y)
    })
    const worst = { d: 0, name: '', x: 0, y: 0 }
    const t0 = performance.now()
    while (performance.now() - t0 < 500) {          // 覆盖 400ms 动画全程
      document.querySelectorAll('.desktop-icon').forEach(function (el) {
        const n = el.getAttribute('data-name')
        if (tracked.indexOf(n) < 0) return
        const r = el.getBoundingClientRect()
        const cx = r.left + r.width / 2
        const cy = r.top + r.height / 2
        const d = Math.max(0, vp.l - cx, cx - vp.r, vp.t - cy, cy - vp.b)
        if (d > worst.d) {
          worst.d = d
          worst.name = n
          worst.x = Math.round(cx)
          worst.y = Math.round(cy)
        }
      })
      await new Promise(r => setTimeout(r, 16))
    }
    return worst
  }, basePos)
  if (tZoomed && tZoomed.s > snap.home.zoom + 0.1) {
    if (zoomAnim.d === 0) {
      pass('zoom 变化回 Home 动画中图标不出界（zoom ' + tZoomed.s.toFixed(2) + ' → 快照 ' + snap.home.zoom.toFixed(2) + '）')
    } else {
      fail('zoom 变化图标出界', zoomAnim.name + ' 中心 (' + zoomAnim.x + ',' + zoomAnim.y + ') 越界 ' + zoomAnim.d.toFixed(0) + 'px')
    }
  } else {
    fail('zoom 变化场景构造断言', 'tZoomed=' + JSON.stringify(tZoomed) + ' snap=' + snap.home.zoom)
  }
  await sleep(700)                                 // 等动画结束，避免影响后续场景

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

  // ── 5c. 图标位置持久化：拖动 docs → reload → 位置保持（曾因 HomeStore 快照分支丢恢复） ──
  const docsIcon = await rect('[data-name="docs"]')
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: docsIcon.x, y: docsIcon.y }] })
  await sleep(600)   // 长按拿起（500ms 触发）
  for (let i = 1; i <= 10; i++) {
    await sleep(16)
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: docsIcon.x + 42 * i / 10, y: docsIcon.y + 90 * i / 10 }]
    })
  }
  await sleep(16)
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await sleep(300)
  const layoutAfter = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('desktop.layout.v1')) } catch (e) { return null }
  })
  const docsPos = layoutAfter && layoutAfter.icons && layoutAfter.icons.docs
  if (docsPos && (docsPos.x !== 16 || docsPos.y !== 16)) pass('拖动后布局已持久化（docs @ ' + docsPos.x + ',' + docsPos.y + '）')
  else fail('拖动持久化断言', JSON.stringify(docsPos))

  await page.reload({ waitUntil: 'networkidle0' })
  await sleep(1200)
  const docsAfterReload = await page.evaluate(() => {
    const el = document.querySelector('[data-name="docs"]')
    return el ? { left: el.style.left, top: el.style.top } : null
  })
  if (docsPos && docsAfterReload &&
      parseInt(docsAfterReload.left) === docsPos.x && parseInt(docsAfterReload.top) === docsPos.y) {
    pass('重新进入 → docs 图标位置保持（' + docsAfterReload.left + ',' + docsAfterReload.top + '）')
  } else {
    fail('图标位置保持断言', 'expect=' + JSON.stringify(docsPos) + ' got=' + JSON.stringify(docsAfterReload))
  }

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
