// 底部工具栏 E2E 门禁：CDP 真实触摸序列验证
// ═══════════════════════════════════════════════════════════════
//  场景：无头 Chromium（注入 FileBridge 内存桩）：
//    1. 底栏渲染：5 个按钮、高度 = 屏高 1/8、加号居中
//    2. 点加号 → 新建对话框打开（遮罩 + 输入框聚焦）
//    3. 输入名称 + 选文件/文件夹 + 确定 → 创建成功（toast）+ 对话框关闭
//    4. 点遮罩空白 → 对话框关闭
//    5. 底栏右划 → Drawer 跟手拉出（中途 inline transform 跟手）→ 打开
//    6. Drawer 左滑 → 跟手关闭
//    7. 底栏小幅慢滑（<30%）→ 弹回不打开
//    8. Drawer 打开后点遮罩 → 收起（原路径回归）
//    9. 全程零 pageerror
//
//  用法: DESKTOP_BUNDLE=dist/desktop.bundle.min.html node scripts/verify-bottom-bar.js
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
  await page.goto('file://' + BUNDLE)
  await sleep(1000)
  const client = await page.createCDPSession()

  // 注入 FileBridge 内存桩：list 空目录，mkdir/write 成功（file-api 运行时检查 window.FileBridge）
  await page.evaluate(() => {
    window.FileBridge = {
      rootInfo: function (cb) {
        window.__fbResolve(cb, { ok: true, data: { rootName: 'mock', displayPath: '/mock', mode: 'mock' } })
      },
      list: function (p, cb) { window.__fbResolve(cb, { ok: true, data: [] }) },
      mkdir: function (p, cb) { window.__fbResolve(cb, { ok: true, data: true }) },
      write: function (p, c, cb) { window.__fbResolve(cb, { ok: true, data: true }) }
    }
  })
  await sleep(200)

  // ── 1. 底栏渲染 ──
  const bar = await page.evaluate(() => {
    const b = document.getElementById('bottom-bar')
    const btns = document.querySelectorAll('.bottom-bar-btn')
    const add = document.getElementById('bb-btn-add')
    if (!b) return null
    const r = b.getBoundingClientRect()
    let addInfo = null
    if (add) {
      const ar = add.getBoundingClientRect()
      addInfo = { x: ar.left + ar.width / 2, y: ar.top + ar.height / 2 }
    }
    return {
      visible: r.width > 0 && r.height > 0,
      height: r.height,
      btnCount: btns.length,
      addInfo: addInfo
    }
  })
  if (!bar || !bar.visible) { fail('底栏渲染可见'); process.exit(1) }
  pass('底栏渲染可见')
  if (bar.btnCount === 5) pass('底栏 5 个按钮')
  else fail('底栏按钮数 = ' + bar.btnCount + '（期望 5）')
  const expectH = Math.round(915 / 8)
  if (Math.abs(Math.round(bar.height) - expectH) <= 2) pass('底栏高度 ≈ 屏高 1/8 (' + expectH + 'px, 实测 ' + Math.round(bar.height) + ')')
  else fail('底栏高度 ' + Math.round(bar.height) + 'px，期望 ≈' + expectH)
  if (bar.addInfo && Math.abs(bar.addInfo.x - 206) <= 30) pass('加号居中 (x=' + Math.round(bar.addInfo.x) + ')')
  else fail('加号未居中 x=' + (bar.addInfo && Math.round(bar.addInfo.x)))

  // ── 2. 点加号 → 对话框打开 ──
  await tap(client, bar.addInfo.x, bar.addInfo.y, 60)
  const dlgOpen = await page.evaluate(() => {
    const o = document.getElementById('create-dialog-overlay')
    const input = document.getElementById('create-name')
    return !!(o && o.classList.contains('dialog-overlay-visible') &&
      o.getAttribute('aria-hidden') === 'false' &&
      document.activeElement === input)
  })
  if (dlgOpen) pass('加号点击 → 对话框打开且输入框聚焦')
  else fail('加号点击未打开对话框')

  // ── 3. 输入名称 + 选文件 + 确定 → 创建成功 ──
  await page.evaluate(() => {
    const input = document.getElementById('create-name')
    input.value = '报告.txt'
    document.querySelector('input[name="create-type"][value="file"]').checked = true
  })
  const okBtn = await page.evaluate(() => {
    const b = document.getElementById('create-ok')
    const r = b.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  await tap(client, okBtn.x, okBtn.y, 60)
  await sleep(2000)  // 等 toast 轮播
  const fileResult = await page.evaluate(() => {
    const o = document.getElementById('create-dialog-overlay')
    const t = document.querySelector('.toast')
    return {
      closed: !o.classList.contains('dialog-overlay-visible'),
      toast: t ? t.textContent : ''
    }
  })
  if (fileResult.closed) pass('确定后对话框关闭')
  else fail('确定后对话框未关闭')
  if (fileResult.toast === '已创建文件') pass('创建文件 toast: "已创建文件"')
  else fail('创建文件 toast 异常: "' + fileResult.toast + '"')

  // ── 3b. 再开对话框：选文件夹 + 确定 ──
  await tap(client, bar.addInfo.x, bar.addInfo.y, 60)
  await page.evaluate(() => {
    document.getElementById('create-name').value = '我的文件夹'
    document.querySelector('input[name="create-type"][value="folder"]').checked = true
  })
  const okBtn2 = await page.evaluate(() => {
    const b = document.getElementById('create-ok')
    const r = b.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  await tap(client, okBtn2.x, okBtn2.y, 60)
  await sleep(2000)
  const folderResult = await page.evaluate(() => {
    const o = document.getElementById('create-dialog-overlay')
    const t = document.querySelector('.toast')
    return {
      closed: !o.classList.contains('dialog-overlay-visible'),
      toast: t ? t.textContent : ''
    }
  })
  if (folderResult.closed) pass('文件夹创建后对话框关闭')
  else fail('文件夹创建后对话框未关闭')
  if (folderResult.toast === '已创建文件夹') pass('创建文件夹 toast: "已创建文件夹"')
  else fail('创建文件夹 toast 异常: "' + folderResult.toast + '"')

  // ── 4. 点遮罩空白 → 对话框关闭 ──
  await tap(client, bar.addInfo.x, bar.addInfo.y, 60)
  await tap(client, 10, 300, 60)
  const dlgClosed = await page.evaluate(() => {
    const o = document.getElementById('create-dialog-overlay')
    return !o.classList.contains('dialog-overlay-visible')
  })
  if (dlgClosed) pass('点遮罩空白 → 对话框关闭')
  else fail('点遮罩空白未关闭对话框')

  // ── 5. 底栏右划 → Drawer 跟手拉出并打开 ──
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

  // ── 6. Drawer 左滑 → 跟手关闭 ──
  await swipe(client, 250, 450, 80, 450, 12, 12)
  await sleep(450)
  const swipedClosed = await page.evaluate(() => {
    const d = document.getElementById('drawer')
    return !(d && d.classList.contains('drawer-open'))
  })
  if (swipedClosed) pass('Drawer 左滑 → 跟手关闭')
  else fail('Drawer 左滑未关闭')

  // ── 7. 底栏小幅慢滑（<30% 且低速）→ 弹回不打开 ──
  await swipe(client, 40, bbY, 100, bbY, 12, 40)
  await sleep(450)
  const bounced = await page.evaluate(() => {
    const d = document.getElementById('drawer')
    return !(d && d.classList.contains('drawer-open'))
  })
  if (bounced) pass('小幅慢滑 → 弹回不打开')
  else fail('小幅慢滑误打开 Drawer')

  // ── 8. 右划打开后点遮罩 → 收起（原路径回归） ──
  await swipe(client, 40, bbY, 340, bbY, 12, 12)
  await sleep(450)
  await tap(client, 390, 500, 60)
  const tapClosed = await page.evaluate(() => {
    const d = document.getElementById('drawer')
    return !(d && d.classList.contains('drawer-open'))
  })
  if (tapClosed) pass('右划打开后点遮罩 → 收起')
  else fail('点遮罩未收起 Drawer')

  // ── 9. 零 pageerror ──
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
