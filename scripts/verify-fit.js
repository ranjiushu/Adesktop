// 双击 Home「一览全部文件」E2E 门禁：CDP 真实触摸序列验证 fit-bounds
// ═══════════════════════════════════════════════════════════════
//  场景：无头 Chromium（evaluateOnNewDocument 预注入 FileBridge 内存桩，
//        5 个文件分散在 0..900 × 0..600 世界范围，render 即成功）：
//    1. 初始（zoom=1）视口内只有部分图标（分散范围超出屏幕）——先证明「不全可见」
//    2. 双击底栏 Home → 平滑飞行后全部图标 rect 完整落在视口内（fit-bounds 生效）
//    3. 单击 Home → 回空间锚点（出厂 0,0,1），不被双击视野污染
//    4. 旋转 90° 后再双击 Home → 横屏下全部图标仍可见（rotation 感知）
//    5. 全程零 pageerror
//
//  用法: DESKTOP_BUNDLE=dist/adesktop.bundle.min.html node scripts/verify-fit.js
//  退出码: 0 通过 / 1 失败 / 2 无可用 Chromium
// ═══════════════════════════════════════════════════════════════
const { launch } = require('./lib/browser')
const path = require('path')

const BUNDLE = process.env.DESKTOP_BUNDLE || path.join(__dirname, '..', 'dist', 'adesktop.bundle.html')
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const TAP_GAP = 250

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

// 双击：两次 touchend 间隔 < 300ms（bindPressSplit 双击窗口）
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

const rect = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}, sel)

// 全部图标 rect 是否完整落在视口内（双击 fit 的核心断言）
async function allIconsInViewport(page, label) {
  const info = await page.evaluate(() => {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const icons = document.querySelectorAll('.desktop-icon')
    let inView = 0
    let firstOut = null
    icons.forEach((el) => {
      const r = el.getBoundingClientRect()
      const ok = r.width > 0 && r.height > 0 &&
        r.left >= -1 && r.right <= vw + 1 && r.top >= -1 && r.bottom <= vh + 1
      if (ok) inView++
      else if (!firstOut) {
        firstOut = { name: el.getAttribute('data-name'), left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), vw: vw, vh: vh }
      }
    })
    return { total: icons.length, inView: inView, firstOut: firstOut }
  })
  if (!info || info.total === 0) { fail(label + '：无图标可断言'); return false }
  if (info.inView === info.total) {
    pass(label + '：' + info.inView + '/' + info.total + ' 个图标全部在视口内')
    return true
  }
  fail(label + '：可见 ' + info.inView + '/' + info.total, JSON.stringify(info.firstOut))
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

  // 预注入 FileBridge 内存桩 + 5 个分散文件（0..900 × 0..600，zoom=1 时不可能全可见）
  await page.evaluateOnNewDocument(() => {
    window.FileBridge = {
      vibrate: function () {},
      rootInfo: function (cb) {
        window.__fbResolve(cb, { ok: true, data: { rootName: 'mock', displayPath: '/mock', mode: 'mock' } })
      },
      list: function (p, cb) {
        const items = p ? [] : [
          { name: 'a.txt', isDir: false, size: 10, mtime: 0 },
          { name: 'b.txt', isDir: false, size: 20, mtime: 0 },
          { name: 'c.txt', isDir: false, size: 30, mtime: 0 },
          { name: 'd.txt', isDir: false, size: 40, mtime: 0 },
          { name: 'e.txt', isDir: false, size: 50, mtime: 0 }
        ]
        window.__fbResolve(cb, { ok: true, data: items })
      }
    }
    // 预置分散布局：5 个文件横跨 900×600 世界范围（zoom=1 时超出视口）
    try {
      localStorage.setItem('desktop.layout.v1',
        JSON.stringify({
          version: 1,
          icons: {
            'a.txt': { x: 0, y: 0 },
            'b.txt': { x: 400, y: 0 },
            'c.txt': { x: 800, y: 0 },
            'd.txt': { x: 400, y: 300 },
            'e.txt': { x: 400, y: 600 }
          },
          camera: { x: 0, y: 0, zoom: 1 }
        }))
    } catch (e) {}
  })
  await page.goto('file://' + BUNDLE)
  await sleep(1000)
  const client = await page.createCDPSession()

  // ── 1. 初始 zoom=1：分散图标不可能全可见（前置条件证明）──
  const initInfo = await page.evaluate(() => {
    const vw = window.innerWidth
    const icons = document.querySelectorAll('.desktop-icon')
    let inView = 0
    icons.forEach((el) => {
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.height > 0 && r.left >= -1 && r.right <= vw + 1) inView++
    })
    return { total: icons.length, inView: inView }
  })
  if (initInfo && initInfo.total === 5 && initInfo.inView < 5) {
    pass('初始 zoom=1：部分图标在视口外（' + initInfo.inView + '/5，前置条件成立）')
  } else {
    fail('初始应只有部分图标可见', JSON.stringify(initInfo))
  }

  // ── 2. 双击 Home → 全部图标进视口 ──
  const homeBtn = await rect(page, '#bb-btn-home')
  if (!homeBtn) { fail('底栏 Home 按钮缺失'); process.exit(1) }
  await doubleTap(client, homeBtn.x, homeBtn.y)
  await sleep(900)   // 等待平滑飞行动画结束
  await allIconsInViewport(page, '[双击 Home]')

  // ── 3. 单击 Home → 回空间锚点（出厂 0,0,1，不被双击视野污染）──
  // 双击窗口使单击延迟 300ms 触发 + 飞行动画 400ms → 轮询等待 zoom 还原 1（鲁棒）
  await tap(client, homeBtn.x, homeBtn.y)
  let camAfter = null
  for (let i = 0; i < 20; i++) {
    await sleep(100)
    camAfter = await page.evaluate(() => {
      const t = document.getElementById('desktop-canvas').style.transform
      const m = /translate3d\((-?[\d.]+(?:e-?\d+)?)px,\s*(-?[\d.]+(?:e-?\d+)?)px,\s*(-?[\d.]+(?:e-?\d+)?)px?\)\s*scale\(([\d.]+)\)/.exec(t)
      return m ? { tx: parseFloat(m[1]), ty: parseFloat(m[2]), s: parseFloat(m[4]) } : null
    })
    if (camAfter && Math.abs(camAfter.s - 1) < 0.001) break
  }
  if (camAfter && Math.abs(camAfter.s - 1) < 0.001) {
    pass('单击 Home → zoom 还原 1（回空间锚点，双击 fit 不污染锚）')
  } else {
    fail('单击 Home 应回出厂锚点 zoom=1', JSON.stringify(camAfter))
  }

  // ── 4. 旋转 90° 后再双击 Home → 横屏下全部图标仍可见 ──
  const menuBtn = await rect(page, '#btn-view-menu')
  const rotItem = async () => rect(page, '[data-rotate="toggle"]')
  if (menuBtn) {
    await tap(client, menuBtn.x, menuBtn.y)
    const rr = await rotItem()
    if (rr) {
      await tap(client, rr.x, rr.y)
      await sleep(400)
      const t = await page.evaluate(() => document.getElementById('desktop-canvas').style.transform)
      if (t.indexOf('rotate(90deg)') >= 0) {
        // 横屏下双击 Home：横屏 fit 后全部图标可见（rotation 感知）
        await doubleTap(client, homeBtn.x, homeBtn.y)
        await sleep(900)
        await allIconsInViewport(page, '[旋转 90° 后双击 Home]')
        // 转回竖屏收尾
        await tap(client, menuBtn.x, menuBtn.y)
        const rr2 = await rotItem()
        if (rr2) await tap(client, rr2.x, rr2.y)
        await sleep(400)
      } else {
        fail('旋转 90° 失败', t)
      }
    } else {
      fail('view-menu 旋转项缺失')
    }
  } else {
    fail('顶栏 view-menu 按钮缺失')
  }

  // ── 5. 全程零 pageerror ──
  if (pageErrors.length === 0) pass('全程零 pageerror')
  else fail('存在 pageerror: ' + pageErrors.join(' | '))

  console.log('')
  console.log('  fit-e2e: ' + PASS + ' 通过, ' + FAIL + ' 失败')
  if (FAIL > 0) process.exit(1)
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
