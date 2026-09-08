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
//  用法: DESKTOP_BUNDLE=dist/adesktop.bundle.min.html node scripts/verify-rotate.js
//  退出码: 0 通过 / 1 失败 / 2 无可用 Chromium
// ═══════════════════════════════════════════════════════════════
const { launch } = require('./lib/browser')
const path = require('path')

const BUNDLE = process.env.DESKTOP_BUNDLE || path.join(__dirname, '..', 'dist', 'adesktop.bundle.html')
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
    const m = /translate3d\((-?[\d.]+(?:e-?\d+)?)px,\s*(-?[\d.]+(?:e-?\d+)?)px,\s*(-?[\d.]+(?:e-?\d+)?)px?\)\s*scale\(([\d.]+)\)/.exec(t)
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
    const m = /translate3d\((-?[\d.]+(?:e-?\d+)?)px,\s*(-?[\d.]+(?:e-?\d+)?)px,\s*(-?[\d.]+(?:e-?\d+)?)px?\)\s*rotate\(90deg\)\s*scale\(([\d.]+)\)/.exec(t)
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

  // ── 4.5 横屏/竖屏快照槽位独立 ──
  // 快照按钮长按记录当前方向的快照槽位（竖屏/横屏各自独立、互不覆盖）。
  // 旋转本身是纯保中心（不跳槽位，见 4.5b）；Home 与快照彻底分离（点 Home 回 Home 锚点，
  // 无锚点则出厂）。此段验证：长按快照按钮可分别写入 portrait / landscape 槽位且位置不同、
  // 互不覆盖，且快照不触发 Home 锚点类。
  const homeRect = await rect('#bb-btn-home')
  const snapRect = await rect('#bb-btn-snapshot')
  const vp = await rect('#desktop-viewport')
  if (homeRect && vp && snapRect) {
    // 竖屏：平移相机偏离原点 → 长按快照按钮记录竖屏快照（P1）
    await pan(client, vp.x, vp.y + 200, 120, 0)
    await sleep(200)
    const camPortrait = await page.evaluate(() => {
      const t = document.getElementById('desktop-canvas').style.transform
      const m = /translate3d\((-?[\d.]+(?:e-?\d+)?)px,\s*(-?[\d.]+(?:e-?\d+)?)px,\s*(-?[\d.]+(?:e-?\d+)?)px?\)\s*scale\(([\d.]+)\)/.exec(t)
      return m ? { tx: parseFloat(m[1]), ty: parseFloat(m[2]), s: parseFloat(m[4]) } : null
    })
    await tap(client, snapRect.x, snapRect.y, 650)
    await sleep(300)
    const bundleP = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem('desktop.snapshots.legacy.v3')) } catch (e) { return null }
    })
    const snapP = bundleP && bundleP.portrait && bundleP.portrait.groups[0] && bundleP.portrait.groups[0].snapshots && bundleP.portrait.groups[0].snapshots[0]
    if (snapP && snapP.camera) pass('竖屏长按快照按钮 → 快照写入 portrait 槽位（tx=' + camPortrait.tx.toFixed(0) + '）')
    else fail('竖屏快照写入断言', JSON.stringify(bundleP))
    // 旋转到横屏：横屏槽位尚无快照 → 保持当前位置只转方向（相机位置不变，仅加 rotate）
    await tap(client, menuBtn.x, menuBtn.y)
    const rot5 = await rect('[data-rotate="toggle"]')
    await tap(client, rot5.x, rot5.y)
    await sleep(300)
    const hasSnapLand = await page.evaluate(() =>
      document.getElementById('bb-btn-home').classList.contains('home-has-snapshot'))
    if (!hasSnapLand) pass('切横屏 → Home 不高亮（无锚点；快照与 Home 分离）')
    else fail('快照不应触发 Home 锚点类')
    // 横屏：再平移相机（位置偏离竖屏槽位 P1）→ 长按快照按钮记录横屏快照（P2 ≠ P1）
    await pan(client, vp.x, vp.y + 200, -60, 40)
    await sleep(200)
    await tap(client, snapRect.x, snapRect.y, 650)
    await sleep(300)
    const bundleL = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem('desktop.snapshots.legacy.v3')) } catch (e) { return null }
    })
    const snapL = bundleL && bundleL.landscape && bundleL.landscape.groups[0] && bundleL.landscape.groups[0].snapshots && bundleL.landscape.groups[0].snapshots[0]
    if (snapL && snapL.camera) pass('横屏长按快照按钮 → 快照写入 landscape 槽位')
    else fail('横屏快照写入断言', JSON.stringify(bundleL))
    // 记录横屏平移后的相机位置（P2'——保中心转回竖屏的参照）
    const camLandBefore = await page.evaluate(() => {
      const c = App.DesktopCore.camera
      return { x: c.x, y: c.y, zoom: c.zoom, rotation: c.rotation }
    })
    const homeCam = snapP && snapP.camera
    const landCam = snapL && snapL.camera
    if (homeCam && landCam &&
        (Math.abs(homeCam.x - landCam.x) > 1 ||
         Math.abs(homeCam.y - landCam.y) > 1)) {
      pass('竖屏/横屏快照槽位独立且位置不同（portrait 与 landscape 分存）')
    } else {
      fail('竖屏/横屏快照槽位应独立且位置不同', JSON.stringify({ homeCam, landCam }))
    }
    // 竖屏更新快照 → 横屏槽位保留原值（互不覆盖）
    await tap(client, snapRect.x, snapRect.y, 650)
    await sleep(300)
    const bundleP2 = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem('desktop.snapshots.legacy.v3')) } catch (e) { return null }
    })
    const snapP2 = bundleP2 && bundleP2.portrait && bundleP2.portrait.groups[0] && bundleP2.portrait.groups[0].snapshots && bundleP2.portrait.groups[0].snapshots[0]
    const stillLand = bundleP2 && bundleP2.landscape && bundleP2.landscape.groups[0] && bundleP2.landscape.groups[0].snapshots && bundleP2.landscape.groups[0].snapshots[0]
    if (stillLand && stillLand.camera &&
        JSON.stringify(stillLand.camera) === JSON.stringify(snapL.camera)) {
      pass('更新竖屏快照 → 横屏槽位保留（互不覆盖）')
    } else {
      fail('更新竖屏后横屏槽位应保留', JSON.stringify(bundleP2))
    }
    // 转回竖屏 → Home 高亮恢复（竖屏槽位有快照）
    await tap(client, menuBtn.x, menuBtn.y)
    const rot6 = await rect('[data-rotate="toggle"]')
    await tap(client, rot6.x, rot6.y)
    await sleep(300)
    const hasSnapPort = await page.evaluate(() =>
      document.getElementById('bb-btn-home').classList.contains('home-has-snapshot'))
    if (!hasSnapPort) pass('切回竖屏 → Home 仍不高亮（快照槽位保留但不再驱动锚点类）')
    else fail('快照不应触发 Home 锚点类（分离）')

    // ── 4.5b 核心断言：旋转 = 纯保中心（不跳槽位）──
    // 语义变更（2026-08-19）：toggleRotate 只改 rotation（x/y/zoom 不动）——旋转前后
    // 屏幕中心世界点相同（screenToWorld 推导），整理区域/自由摆放图标不丢。
    // 曾「旋转跳目标方向槽位」：历史残留槽位与整理区域脱节 → 视野整体漂移（找不到）。
    // Home 与快照彻底分离：点 Home 回 Home 锚点（无锚点则出厂），不再跳快照槽位。
    // 验证：
    //   转回竖屏（已在上方 rot6 执行）→ 相机 x/y/zoom = 横屏平移后（保中心）
    //   竖屏点 Home → 回出厂 (0,0,1)（无锚点）
    //   再转横屏 → 相机 x/y/zoom 不变（保中心，rotation=90）
    //   横屏点 Home → 回出厂 (0,0,1) 且 rotation=90
    // 直接用 App.DesktopCore.camera 数据层断言（绕过 transform 解析的旋转换算）
    const camBackPortrait = await page.evaluate(() => {
      const c = App.DesktopCore.camera
      return { x: c.x, y: c.y, zoom: c.zoom, rotation: c.rotation }
    })
    if (camBackPortrait && camBackPortrait.rotation === 0 &&
        camLandBefore &&
        Math.abs(camBackPortrait.x - camLandBefore.x) < 1e-6 &&
        Math.abs(camBackPortrait.y - camLandBefore.y) < 1e-6 &&
        Math.abs(camBackPortrait.zoom - camLandBefore.zoom) < 1e-6) {
      pass('旋转保中心：转回竖屏相机 x/y/zoom 不变（仅 rotation 归 0，不跳槽位）')
    } else {
      fail('转回竖屏应保中心（不跳槽位）',
        'land=' + JSON.stringify(camLandBefore) + ' cam=' + JSON.stringify(camBackPortrait))
    }
    // 竖屏点 Home（单击：双击窗口 300ms + 飞行动画 400ms → 等待 900ms）→ 回出厂（无锚点）
    await tap(client, homeRect.x, homeRect.y)
    await sleep(900)
    const camHomeP = await page.evaluate(() => {
      const c = App.DesktopCore.camera
      return { x: c.x, y: c.y, zoom: c.zoom, rotation: c.rotation }
    })
    if (camHomeP &&
        Math.abs(camHomeP.x) < 1e-6 && Math.abs(camHomeP.y) < 1e-6 &&
        Math.abs(camHomeP.zoom - 1) < 1e-6 && camHomeP.rotation === 0) {
      pass('竖屏点 Home → 回出厂 (0,0,1)（无锚点，快照不影响）')
    } else {
      fail('竖屏点 Home 应回出厂',
        'cam=' + JSON.stringify(camHomeP))
    }
    // 再切横屏 → 保中心（x/y/zoom 不变，仅 rotation=90）
    await tap(client, menuBtn.x, menuBtn.y)
    const rot7 = await rect('[data-rotate="toggle"]')
    await tap(client, rot7.x, rot7.y)
    await sleep(300)
    const camLand = await page.evaluate(() => {
      const c = App.DesktopCore.camera
      return { x: c.x, y: c.y, zoom: c.zoom, rotation: c.rotation }
    })
    if (camLand && camLand.rotation === 90 &&
        camHomeP &&
        Math.abs(camLand.x - camHomeP.x) < 1e-6 &&
        Math.abs(camLand.y - camHomeP.y) < 1e-6 &&
        Math.abs(camLand.zoom - camHomeP.zoom) < 1e-6) {
      pass('旋转保中心：再切横屏相机 x/y/zoom 不变（仅 rotation=90，不跳槽位）')
    } else {
      fail('再切横屏应保中心（不跳槽位）',
        'pre=' + JSON.stringify(camHomeP) + ' cam=' + JSON.stringify(camLand))
    }
    // ── 4.6 横屏下点 Home 按钮：rotation 应保持 90（P0-1 回归守卫）──
    // 此时处于横屏（rotation=90）。点按 Home → 回出厂 (0,0,1) 且 rotation=90，不闪回竖屏。
    // 先平移相机偏离横屏槽位位置
    await pan(client, vp.x, vp.y + 200, 50, -30)
    await sleep(200)
    const camBeforeHome = await page.evaluate(() => {
      const c = App.DesktopCore.camera
      return { x: c.x, y: c.y, zoom: c.zoom, rotation: c.rotation }
    })
    // 点按 Home（短按，非长按；单击经 300ms 双击窗口延迟触发 + 400ms 动画 → 等待 900ms）
    await tap(client, homeRect.x, homeRect.y)
    await sleep(900)   // 等 Home 动画完成（双击窗口 300ms + HOME_ANIM_MS=400 + 余量）
    const camAfterHome = await page.evaluate(() => {
      const c = App.DesktopCore.camera
      return { x: c.x, y: c.y, zoom: c.zoom, rotation: c.rotation }
    })
    if (camAfterHome && camAfterHome.rotation === 90) {
      pass('横屏下点 Home → rotation 保持 90（不闪回竖屏）')
    } else {
      fail('横屏下点 Home 应保持 rotation=90',
        'before=' + JSON.stringify(camBeforeHome) + ' after=' + JSON.stringify(camAfterHome))
    }
    if (camAfterHome &&
        Math.abs(camAfterHome.x) < 1e-6 && Math.abs(camAfterHome.y) < 1e-6 &&
        Math.abs(camAfterHome.zoom - 1) < 1e-6 && camAfterHome.rotation === 90) {
      pass('横屏下点 Home → 回出厂 (0,0,1) 且 rotation=90（不闪回竖屏）')
    } else {
      fail('横屏下点 Home 应回出厂',
        'cam=' + JSON.stringify(camAfterHome))
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
