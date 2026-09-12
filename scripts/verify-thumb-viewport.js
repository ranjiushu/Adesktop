// 缩略图按需加载 E2E 门禁：无头 Chromium（注入 FileBridge 内存桩）
// ═══════════════════════════════════════════════════════════════
//  场景（进大目录不再一次性排满整目录缩略图任务）：
//    1. 进 200 个图片的目录：只为**视口内**（含半屏外扩）条目发出 thumb 桥调用
//       （离屏条目 0 请求——省桥层采样解码与 base64 内存）
//    2. 滚动到中段：节流补齐新进入视口的条目（新增请求 > 0，总量仍 < 目录条目数）
//    3. 滚动到底：此前未请求的末尾条目被补齐（按需加载覆盖全目录）
//    4. 全程零 pageerror
//
//  用法: DESKTOP_BUNDLE=dist/adesktop.bundle.min.html node scripts/verify-thumb-viewport.js
//  退出码: 0 通过 / 1 失败 / 2 无可用 Chromium
// ═══════════════════════════════════════════════════════════════
const { launch } = require('./lib/browser')
const path = require('path')

const BUNDLE = process.env.DESKTOP_BUNDLE || path.join(__dirname, '..', 'dist', 'adesktop.bundle.html')
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const BIG = 200

let PASS = 0, FAIL = 0
function pass(label) { console.log('  [PASS] ' + label); PASS++ }
function fail(label, detail) {
  console.log('  [FAIL] ' + label + (detail ? ' — ' + detail : ''))
  FAIL++
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

  // 桥桩：根 1 个目录；目录内 200 张图。thumb 计数（__stats.thumb = 调用顺序）
  await page.evaluateOnNewDocument((n) => {
    const big = []
    for (let i = 0; i < n; i++) big.push({ name: 'p' + i + '.jpg', isDir: false, size: 1000, mtime: i })
    const TREE = { '': [{ name: 'big', isDir: true, size: 0, mtime: 0 }], 'big': big }
    window.__stats = { list: [], thumb: [] }
    // 合法 1x1 PNG（缩略图能真正加载成功，走完 onload 验证链路）
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    function ok(cb, data) { window.__fbResolve(cb, { ok: true, data: data }) }
    function err(cb, msg) { window.__fbResolve(cb, { ok: false, error: msg }) }
    window.FileBridge = {
      rootInfo: function (cb) { ok(cb, { rootName: 'mock', mode: 'private', displayPath: '/mock', trashName: '.trash', rootId: 'mock-root' }) },
      list: function (p, cb) { p = p || ''; window.__stats.list.push(p); ok(cb, (TREE[p] || []).slice()) },
      thumb: function (p, cb) { window.__stats.thumb.push(p); ok(cb, PNG) },
      read: function (p, cb) { ok(cb, 'text') },
      write: function (p, c, cb) { ok(cb, true) },
      resolveUri: function (p, cb) { err(cb, '无 URI') },
      previewUri: function (p, cb) { err(cb, '无预览档') },
      openExternal: function (p, cb) { err(cb, '无外部应用') },
      vibrate: function () {},
      requestRootAccess: function () {}
    }
  }, BIG)

  await page.goto('file://' + BUNDLE, { waitUntil: 'networkidle0' })
  await page.waitForFunction(() => window.App && document.querySelectorAll('.desktop-icon').length === 1, { timeout: 10000 })
  await page.evaluate(() => {
    if (window.App.Dialog && typeof App.Dialog.close === 'function') App.Dialog.close('all-files-dialog-overlay')
  })

  // ── 1. 进大目录：只请求视口内 ──
  await page.evaluate(() => App.Desktop.openItem('big'))
  await page.waitForFunction((n) => document.querySelectorAll('.desktop-icon').length === n, { timeout: 15000 }, BIG)
  await sleep(300)   // 等缩略图派发（含 deferApplyIcon 一个宏任务）
  const first = await page.evaluate(() => window.__stats.thumb.slice())
  if (first.length > 0) pass('视口内条目发出 thumb 请求（' + first.length + ' 个）')
  else fail('视口内应发出 thumb 请求')
  if (first.length < BIG) pass('离屏条目未发出请求（' + first.length + ' < ' + BIG + '，不再一次性排满整目录）')
  else fail('离屏条目也被请求了', String(first.length))
  if (first.indexOf('big/p0.jpg') >= 0) pass('首屏可见条目（big/p0.jpg）已请求')
  else fail('首屏条目未请求')
  if (first.indexOf('big/p' + (BIG - 1) + '.jpg') < 0) pass('末尾离屏条目未请求')
  else fail('末尾离屏条目不应请求')

  // ── 2. 滚动到中段：补齐新进入视口的条目 ──
  const mid = await page.evaluate(() => {
    const CH = App.DesktopCore.state.canvasH || 0
    const cam = { x: 0, y: Math.round(CH / 2), zoom: 1 }
    App.DesktopGesture.setCamera(cam)
    App.DesktopRender.scheduleVisibleThumbs()
    return { before: window.__stats.thumb.length, canvasH: CH }
  })
  await sleep(400)   // 等节流窗口
  const afterMid = await page.evaluate(() => window.__stats.thumb.length)
  if (afterMid > mid.before) pass('滚动到中段 → 补齐新进入视口的条目（+' + (afterMid - mid.before) + ' 个）')
  else fail('滚动后未补齐缩略图', mid.before + ' → ' + afterMid)
  if (afterMid < BIG) pass('滚动到中段后总量仍小于目录条目数（' + afterMid + ' < ' + BIG + '）')
  else fail('滚动中段即请求了全部条目', String(afterMid))

  // ── 3. 滚动到底：末尾条目被按需补齐 ──
  await page.evaluate(() => {
    const CH = App.DesktopCore.state.canvasH || 0
    const vh = App.DesktopCore.viewportHeight()
    const cam = { x: 0, y: Math.max(0, CH - vh), zoom: 1 }
    App.DesktopGesture.setCamera(cam)
    App.DesktopRender.scheduleVisibleThumbs()
  })
  await page.waitForFunction((n) => window.__stats.thumb.indexOf('big/p' + (n - 1) + '.jpg') >= 0,
    { timeout: 5000 }, BIG).then(() => pass('滚动到底 → 此前未请求的末尾条目被按需补齐'))
    .catch(() => fail('滚动到底后末尾条目仍未请求'))

  // ── 4. 零 pageerror ──
  if (pageErrors.length === 0) pass('全程零 pageerror')
  else fail('pageerror', pageErrors.join(' | '))

  await browser.close()
  if (FAIL > 0) {
    console.log('\n  thumb-viewport E2E: ' + PASS + ' 通过 / ' + FAIL + ' 失败')
    process.exit(1)
  }
  console.log('\n  thumb-viewport E2E 全部通过（' + PASS + ' 项）')
  process.exit(0)
}

main().catch(function (e) {
  console.error('  [ERROR] ' + (e && e.stack || e))
  process.exit(1)
})
