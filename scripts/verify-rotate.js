// 切换画布方向（旋转 90°）E2E 门禁：CDP 真实触摸序列验证
// ═══════════════════════════════════════════════════════════════
//  场景：无头 Chromium（evaluateOnNewDocument 预注入 FileBridge 内存桩，
//        根目录含 docs 文件夹，boot refresh 即成功）：
//    1. 顶栏 view-menu 按钮存在；打开菜单出现「切换画布方向」项
//    2. 根目录下旋转项可用（不 disabled）；点击 → canvas transform 出现 rotate(90deg)
//       + 勾选态 active + 旋转后坐标换算互逆（点击图标仍命中正确世界坐标）
//    3. 再点一次 → 转回（rotate 消失 + 勾选清除）
//    4. 进入子文件夹 → 旋转项禁用；返回根目录 → 恢复可用
//    5. 全程零 pageerror
//
//  用法: DESKTOP_BUNDLE=dist/desktop.bundle.min.html node scripts/verify-rotate.js
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
    // 预置布局：a.txt 放视口中心 (206, 457)（412×915），mock rootId 为空 → 旧 key
    try {
      localStorage.setItem('desktop.layout.v1',
        JSON.stringify({ version: 1, icons: { 'a.txt': { x: 206, y: 457 } }, camera: { x: 0, y: 0, zoom: 1 } }))
    } catch (e) {}
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

  // ── 1. 打开 view-menu → 旋转项存在且根目录下可用 ──
  const menuBtn = await rect('#btn-view-menu')
  if (!menuBtn) { fail('顶栏 view-menu 按钮缺失'); process.exit(1) }
  pass('顶栏 view-menu 按钮存在')
  await tap(client, menuBtn.x, menuBtn.y)
  const rotateItem = await page.evaluate(() => {
    const el = document.querySelector('[data-rotate="toggle"]')
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { disabled: el.disabled, x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  if (!rotateItem) { fail('view-menu 中旋转画布项缺失'); process.exit(1) }
  pass('view-menu 中「切换画布方向」项存在')
  // 勾选标记为 MD 图标（icon-check symbol），非文字 ✓
  const checkIcon = await page.evaluate(() => {
    const el = document.querySelector('[data-rotate="toggle"] .view-menu-check')
    if (!el) return null
    const use = el.querySelector('use')
    return use ? use.getAttribute('href') : null
  })
  if (checkIcon === '#icon-check') pass('勾选标记为 MD 图标（#icon-check）')
  else fail('勾选标记应为 MD 图标 #icon-check', String(checkIcon))
  if (!rotateItem.disabled) pass('根目录下旋转项可用')
  else fail('根目录下旋转项应可用（实际 disabled）')
  // 关闭菜单
  const overlay = await rect('#view-menu-overlay')
  if (overlay) await tap(client, overlay.x, overlay.y)

  // ── 2. 点击旋转项 → canvas transform 出现 rotate(90deg) + 勾选态 ──
  const t0 = await canvasTransform(page)
  if (t0.indexOf('rotate') >= 0) { fail('初始 canvas transform 不应含 rotate', t0); process.exit(1) }
  pass('初始 canvas transform 无 rotate')
  // 记录旋转前相机（Home 槽位为空时应保持原位置）
  const camBefore = await page.evaluate(() => {
    const t = document.getElementById('desktop-canvas').style.transform
    const m = /translate3d\((-?[\d.]+)px,\s*(-?[\d.]+)px,\s*(-?[\d.]+)px?\)\s*scale\(([\d.]+)\)/.exec(t)
    return m ? { tx: parseFloat(m[1]), ty: parseFloat(m[2]), s: parseFloat(m[4]) } : null
  })
  await tap(client, menuBtn.x, menuBtn.y)
  const rotRect = await rect('[data-rotate="toggle"]')
  await tap(client, rotRect.x, rotRect.y)
  await sleep(300)
  const t1 = await canvasTransform(page)
  if (t1.indexOf('rotate(90deg)') >= 0) pass('点击旋转项 → canvas transform 含 rotate(90deg)')
  else fail('旋转后 transform 应含 rotate(90deg)', t1)
  const active = await page.evaluate(() =>
    document.querySelector('[data-rotate="toggle"]').classList.contains('active'))
  if (active) pass('旋转后菜单项勾选态 active')
  else fail('旋转后菜单项应 active')

  // ── 2.5 切换方向先回 Home：初始无快照 → 旋转后保持原相机位置（仅加 rotate）──
  // 本场景 Home 槽位为空（evaluateOnNewDocument 未注入 home 数据），因此旋转前后
  // 相机 x/y/zoom 不变，只有 transform 追加 rotate(90deg)。
  const camAfter = await page.evaluate(() => {
    const t = document.getElementById('desktop-canvas').style.transform
    const m = /translate3d\((-?[\d.]+)px,\s*(-?[\d.]+)px,\s*(-?[\d.]+)px?\)\s*rotate\(90deg\)\s*scale\(([\d.]+)\)/.exec(t)
    if (!m) return null
    // rotation=90 的 transform 中 tx/ty 是「旋转后」的显示值，反推相机：
    //   tx = cam.y*zoom + (vw+vh)/2, ty = -cam.x*zoom + (vh-vw)/2
    const vw = window.innerWidth
    const vh = window.innerHeight
    const tx = parseFloat(m[1])
    const ty = parseFloat(m[2])
    const z = parseFloat(m[4])
    return { x: -(ty - (vh - vw) / 2) / z, y: (tx - (vw + vh) / 2) / z, s: z }
  })
  if (camBefore && camAfter && camAfter.s === camBefore.s) {
    pass('切换方向后相机 zoom 不变（先回 Home：无快照时保持原位置）')
  } else {
    fail('切换方向后相机 zoom 应不变', JSON.stringify({ before: camBefore, after: camAfter }))
  }

  // ── 3. 再次点击 → 转回 ──
  await tap(client, menuBtn.x, menuBtn.y)
  const rotRect2 = await rect('[data-rotate="toggle"]')
  await tap(client, rotRect2.x, rotRect2.y)
  await sleep(300)
  const t2 = await canvasTransform(page)
  if (t2.indexOf('rotate') < 0) pass('再次点击 → rotate 消失（转回）')
  else fail('转回后 transform 不应含 rotate', t2)
  const active2 = await page.evaluate(() =>
    document.querySelector('[data-rotate="toggle"]').classList.contains('active'))
  if (!active2) pass('转回后勾选态清除')
  else fail('转回后菜单项不应 active')

  // ── 3.5 旋转后点击图标仍准确（坐标换算旋转适配）──
  // a.txt 预置在视口中心 (206,457)（evaluateOnNewDocument 注入布局），旋转绕视口
  // 中心进行，中心附近图标旋转后仍在视口内 → 点击旋转后位置应准确命中。
  if (await waitFor(page, '[data-name="a.txt"]')) {
    await tap(client, menuBtn.x, menuBtn.y)
    const rot3 = await rect('[data-rotate="toggle"]')
    await tap(client, rot3.x, rot3.y)
    await sleep(300)
    const aInfo = await page.evaluate(() => {
      const el = document.querySelector('[data-name="a.txt"]')
      if (!el) return null
      const r = el.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight
      const visible = r.width > 0 && r.height > 0 &&
        r.left < vw && r.right > 0 && r.top < vh && r.bottom > 0
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, visible: visible }
    })
    if (aInfo && aInfo.visible) {
      await tap(client, aInfo.x, aInfo.y)
      await sleep(200)
      const selected = await page.evaluate(() => {
        const el = document.querySelector('[data-name="a.txt"]')
        return el ? el.classList.contains('selected') : false
      })
      if (selected) pass('旋转后点击 a.txt 屏幕位置 → 准确选中（坐标换算适配）')
      else fail('旋转后点击 a.txt 应选中（坐标换算可能错位）')
    } else {
      fail('旋转后 a.txt 应仍可见（预置视口中心，转纸 90° 中心附近必在视口内）')
    }
    // 转回原位
    await tap(client, menuBtn.x, menuBtn.y)
    const rot4 = await rect('[data-rotate="toggle"]')
    await tap(client, rot4.x, rot4.y)
    await sleep(300)
  } else {
    fail('a.txt 图标未渲染（旋转点击命中无法验证）')
  }

  // ── 4. 进入子文件夹 → 旋转项禁用；返回 → 恢复 ──
  if (await waitFor(page, '[data-name="docs"]')) {
    const icon = await rect('[data-name="docs"]')
    await doubleTap(client, icon.x, icon.y)
    await sleep(400)
    const inFolder = await page.evaluate(() =>
      document.querySelector('[data-rotate="toggle"]').disabled)
    if (inFolder) pass('子文件夹内旋转项禁用')
    else fail('子文件夹内旋转项应禁用')
    const upBtn = await rect('#bb-btn-up')
    if (upBtn) {
      await tap(client, upBtn.x, upBtn.y)
      await sleep(400)
      const backRoot = await page.evaluate(() =>
        !document.querySelector('[data-rotate="toggle"]').disabled)
      if (backRoot) pass('返回根目录后旋转项恢复可用')
      else fail('返回根目录后旋转项应恢复可用')
    }
  } else {
    fail('根目录 docs 图标未渲染（folder 场景跳过）')
  }

  // ── 4.5 横屏/竖屏 Home 槽位独立（切换画布方向后落在对应方向槽位位置）──
  // 竖屏平移相机 → 长按记录竖屏快照（位置 P1）→ 旋转到横屏：横屏无快照 → 保持
  // 当前位置只转方向 → 横屏再平移 → 长按记录横屏快照（位置 P2 ≠ P1）→ 转回竖屏：
  // 应落在竖屏槽位位置 P1 → 再转横屏：应落在横屏槽位位置 P2
  const homeRect = await rect('#bb-btn-home')
  const vp = await rect('#desktop-viewport')
  if (homeRect && vp) {
    // 竖屏：平移相机偏离原点 → 长按 Home 记录竖屏快照（P1）
    await pan(client, vp.x, vp.y + 200, 120, 0)
    await sleep(200)
    const camPortrait = await page.evaluate(() => {
      const t = document.getElementById('desktop-canvas').style.transform
      const m = /translate3d\((-?[\d.]+)px,\s*(-?[\d.]+)px,\s*(-?[\d.]+)px?\)\s*scale\(([\d.]+)\)/.exec(t)
      return m ? { tx: parseFloat(m[1]), ty: parseFloat(m[2]), s: parseFloat(m[4]) } : null
    })
    await tap(client, homeRect.x, homeRect.y, 650)
    await sleep(300)
    const snapP = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem('desktop.home.v1')) } catch (e) { return null }
    })
    if (snapP && snapP.home) pass('竖屏长按 Home → 快照写入顶层 home 槽位（tx=' + camPortrait.tx.toFixed(0) + '）')
    else fail('竖屏快照写入断言', JSON.stringify(snapP))
    // 旋转到横屏：横屏槽位尚无快照 → 保持当前位置只转方向（相机位置不变，仅加 rotate）
    await tap(client, menuBtn.x, menuBtn.y)
    const rot5 = await rect('[data-rotate="toggle"]')
    await tap(client, rot5.x, rot5.y)
    await sleep(300)
    const hasSnapLand = await page.evaluate(() =>
      document.getElementById('bb-btn-home').classList.contains('home-has-snapshot'))
    if (!hasSnapLand) pass('切横屏 → Home 高亮消失（横屏槽位独立无快照）')
    else fail('切横屏后 Home 不应高亮（横屏槽位应独立）')
    // 横屏：再平移相机（位置偏离竖屏槽位 P1）→ 长按记录横屏快照（P2 ≠ P1）
    await pan(client, vp.x, vp.y + 200, -60, 40)
    await sleep(200)
    await tap(client, homeRect.x, homeRect.y, 650)
    await sleep(300)
    const snapL = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem('desktop.home.v1')) } catch (e) { return null }
    })
    if (snapL && snapL.landscapeHome) pass('横屏长按 Home → 快照写入 landscapeHome 槽位')
    else fail('横屏快照写入断言', JSON.stringify(snapL))
    if (snapL && snapL.home && snapL.landscapeHome &&
        (Math.abs(snapL.home.x - snapL.landscapeHome.x) > 1 ||
         Math.abs(snapL.home.y - snapL.landscapeHome.y) > 1)) {
      pass('竖屏/横屏快照槽位独立且位置不同（home 与 landscapeHome 分存）')
    } else {
      fail('竖屏/横屏快照槽位应独立且位置不同', JSON.stringify(snapL))
    }
    // 竖屏更新快照 → 横屏槽位保留原值（互不覆盖）
    await tap(client, homeRect.x, homeRect.y, 650)
    await sleep(300)
    const snapP2 = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem('desktop.home.v1')) } catch (e) { return null }
    })
    if (snapP2 && snapP2.landscapeHome &&
        JSON.stringify(snapP2.landscapeHome) === JSON.stringify(snapL.landscapeHome)) {
      pass('更新竖屏快照 → 横屏槽位保留（互不覆盖）')
    } else {
      fail('更新竖屏后横屏槽位应保留', JSON.stringify(snapP2))
    }
    // 转回竖屏 → Home 高亮恢复（竖屏槽位有快照）
    await tap(client, menuBtn.x, menuBtn.y)
    const rot6 = await rect('[data-rotate="toggle"]')
    await tap(client, rot6.x, rot6.y)
    await sleep(300)
    const hasSnapPort = await page.evaluate(() =>
      document.getElementById('bb-btn-home').classList.contains('home-has-snapshot'))
    if (hasSnapPort) pass('切回竖屏 → Home 高亮恢复（竖屏槽位快照保留）')
    else fail('切回竖屏后 Home 应高亮（竖屏槽位快照应保留）')

    // ── 4.5b 核心断言：切到哪个方向就落在哪个方向的槽位位置 ──
    // 竖屏槽位（home）= P1（竖屏平移后）；横屏槽位（landscapeHome）= P2（横屏再平移后，
    // P2 ≠ P1）。验证：
    //   转回竖屏 → 相机应回到 P1（竖屏槽位位置）
    //   再转横屏 → 相机应落到 P2（横屏槽位位置，且 rotation=90）
    // 直接用 App.DesktopCore.camera 数据层断言（绕过 transform 解析的旋转换算）
    const camBackPortrait = await page.evaluate(() => {
      const c = App.DesktopCore.camera
      return { x: c.x, y: c.y, zoom: c.zoom, rotation: c.rotation }
    })
    if (camBackPortrait && camBackPortrait.rotation === 0 &&
        snapP && snapP.home &&
        Math.abs(camBackPortrait.x - snapP.home.x) < 1e-6 &&
        Math.abs(camBackPortrait.y - snapP.home.y) < 1e-6 &&
        Math.abs(camBackPortrait.zoom - snapP.home.zoom) < 1e-6) {
      pass('切回竖屏 → 相机落在竖屏槽位位置（home 槽位 P1）')
    } else {
      fail('切回竖屏应落在竖屏槽位位置',
        'slot=' + JSON.stringify(snapP && snapP.home) + ' cam=' + JSON.stringify(camBackPortrait))
    }
    // 再切横屏 → 应落在横屏槽位位置（landscapeHome 槽位 P2，rotation=90）
    await tap(client, menuBtn.x, menuBtn.y)
    const rot7 = await rect('[data-rotate="toggle"]')
    await tap(client, rot7.x, rot7.y)
    await sleep(300)
    const camLand = await page.evaluate(() => {
      const c = App.DesktopCore.camera
      return { x: c.x, y: c.y, zoom: c.zoom, rotation: c.rotation }
    })
    if (camLand && camLand.rotation === 90 &&
        snapL && snapL.landscapeHome &&
        Math.abs(camLand.x - snapL.landscapeHome.x) < 1e-6 &&
        Math.abs(camLand.y - snapL.landscapeHome.y) < 1e-6 &&
        Math.abs(camLand.zoom - snapL.landscapeHome.zoom) < 1e-6) {
      pass('再切横屏 → 相机落在横屏槽位位置（landscapeHome 槽位 P2，rotation=90）')
    } else {
      fail('再切横屏应落在横屏槽位位置',
        'slot=' + JSON.stringify(snapL && snapL.landscapeHome) + ' cam=' + JSON.stringify(camLand))
    }
    // 转回竖屏，恢复初始状态（供场景 5 pageerror 检查）
    await tap(client, menuBtn.x, menuBtn.y)
    const rot8 = await rect('[data-rotate="toggle"]')
    await tap(client, rot8.x, rot8.y)
    await sleep(300)
  } else {
    fail('底栏 Home 按钮缺失（槽位场景跳过）')
  }

  // ── 5. 全程零 pageerror ──
  if (pageErrors.length === 0) pass('全程零 pageerror')
  else fail('存在 pageerror: ' + pageErrors.join(' | '))

  console.log('')
  console.log('  rotate-e2e: ' + PASS + ' 通过, ' + FAIL + ' 失败')
  if (FAIL > 0) process.exit(1)
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
