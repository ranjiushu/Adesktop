// 创建压缩文件 E2E 门禁：CDP 真实触摸序列验证（FAB「压缩」→ 对话框 → 桥层参数）
// ═══════════════════════════════════════════════════════════════
//  场景：无头 Chromium（evaluateOnNewDocument 预注入 FileBridge 内存桩，
//        根目录含 apks 文件夹 + 报告.txt / 笔记.md）：
//    1. 单选 apks → FAB 展开 selection 操作栏，「压缩」可见
//    2. 点「压缩」→ 创建压缩文件对话框：默认名 apks.zip（主名选中）、格式仅 zip、
//       级别默认标准、两个勾选项默认关
//    3. 选「仅存储」→ 确定 → 桥 compress 收到 srcPaths=['apks']、dstPath='apks.zip'、
//       level=-1（仅存储）
//    4. 多选报告.txt+笔记.md → 勾「单独压缩每个」（文件名输入随之禁用）+「压缩后删除源」
//       → 确定 → 桥 compress 各出一个 报告.zip / 笔记.zip（level=6 标准），
//       源经 move 管道进回收站（.trash/…）
//    5. 再开对话框 → 取消 → 桥不新增 compress 调用
//    6. 全程零 pageerror
//
//  用法: DESKTOP_BUNDLE=dist/adesktop.bundle.min.html node scripts/verify-compress.js
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

async function waitFor(page, sel, timeoutMs) {
  const start = Date.now()
  while (Date.now() < start + (timeoutMs || 5000)) {
    const ok = await page.evaluate((s) => !!document.querySelector(s), sel)
    if (ok) return true
    await sleep(100)
  }
  return false
}

const rect = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, visible: r.width > 0 && r.height > 0 }
}, sel)

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

  // 预注入 FileBridge 内存桩：根目录三件套 + compress/move 调用记录
  await page.evaluateOnNewDocument(() => {
    window.__compressCalls = []
    window.__moveCalls = []
    const ROOT = [
      { name: 'apks', isDir: true, size: 0, mtime: 0 },
      { name: '报告.txt', isDir: false, size: 10, mtime: 0 },
      { name: '笔记.md', isDir: false, size: 20, mtime: 0 }
    ]
    const resolve = (cb, data) => window.__fbResolve(cb, { ok: true, data })
    window.FileBridge = {
      vibrate: function () {},
      rootInfo: function (cb) {
        resolve(cb, { rootName: 'mock', displayPath: '/mock', mode: 'mock', trashName: '.trash', rootId: 'mock' })
      },
      list: function (p, cb) { resolve(cb, p ? [] : ROOT) },
      read: function (p, cb) { resolve(cb, '') },
      write: function (p, c, cb) { resolve(cb, true) },
      compress: function (srcPaths, dstPath, level, cb) {
        window.__compressCalls.push({ srcPaths: srcPaths, dstPath: dstPath, level: level })
        resolve(cb, true)
      },
      move: function (src, dst, cb) {
        window.__moveCalls.push({ src: src, dst: dst })
        resolve(cb, true)
      },
      cancelTransfer: function (cb) { resolve(cb, true) }
    }
  })
  await page.goto('file://' + BUNDLE)
  await sleep(1000)
  const client = await page.createCDPSession()

  // 选中态注入（同 verify-fab-inspector 模式：桩 getSelection* + 驱动 setSelection）
  async function selectEntries(entries) {
    await page.evaluate((ents) => {
      App.InternalViewer.anySelected = () => false
      App.Desktop.getSelectionNames = () => ents.map(e => e.path)
      App.Desktop.getSelectionEntries = () => ents
      App.Desktop.hasSelection = () => true
      App.fabSpeedDial.setSelection(true)
    }, entries)
    await sleep(400)
  }

  // ── 1. 单选 apks → FAB selection 操作栏自动展开，「压缩」可见 ──
  // 注意：selection 态 FAB 已自动展开（fab-inspector 同款语义），此时再点 FAB = 取消选中，
  // 所以这里直接量「压缩」按钮，不再点 FAB。
  await selectEntries([{ path: 'apks', isDir: true }])
  const fabRect = await rect(page, '#mode-switch-fab')
  if (fabRect && fabRect.visible) pass('FAB 渲染可见')
  else { fail('FAB 渲染可见'); process.exit(1) }
  const selExpanded = await page.evaluate(() => {
    const sd = document.getElementById('fab-speed-dial')
    return !!sd && sd.classList.contains('fab-speed-dial-expanded') && sd.getAttribute('data-mode') === 'selection'
  })
  if (selExpanded) pass('选中后 FAB 自动展开 selection 操作栏')
  else fail('选中后未展开 selection 操作栏')
  const compressBtn = await rect(page, '[data-action="compress"]')
  if (compressBtn && compressBtn.visible) pass('「压缩」按钮可见')
  else fail('「压缩」按钮未显示', JSON.stringify(compressBtn))

  // ── 2. 点「压缩」→ 对话框默认值 ──
  await tap(client, compressBtn.x, compressBtn.y)
  const dialogVisible = await waitFor(page, '#compress-dialog-overlay.dialog-overlay-visible')
  if (dialogVisible) pass('点「压缩」→ 创建压缩文件对话框打开')
  else fail('对话框未打开')
  const defaults = await page.evaluate(() => {
    const name = document.getElementById('compress-name')
    const format = document.getElementById('compress-format')
    const level = document.getElementById('compress-level')
    const sep = document.getElementById('compress-separate')
    const del = document.getElementById('compress-delete-after')
    return {
      name: name ? name.value : null,
      selected: name ? [name.selectionStart, name.selectionEnd] : null,
      formatOptions: format ? Array.prototype.map.call(format.options, o => o.value) : [],
      level: level ? level.value : null,
      separate: sep ? sep.checked : null,
      deleteAfter: del ? del.checked : null
    }
  })
  if (defaults.name === 'apks.zip') pass('默认文件名 apks.zip（主名 + .zip，MT 同款）')
  else fail('默认文件名断言', JSON.stringify(defaults))
  if (defaults.selected && defaults.selected[0] === 0 && defaults.selected[1] === 4) {
    pass('主名「apks」自动选中（输入即覆盖）')
  } else fail('主名选中断言', JSON.stringify(defaults.selected))
  if (defaults.formatOptions.length === 1 && defaults.formatOptions[0] === 'zip') {
    pass('格式下拉仅 zip（现阶段唯一格式）')
  } else fail('格式下拉断言', JSON.stringify(defaults.formatOptions))
  if (defaults.level === 'normal' && defaults.separate === false && defaults.deleteAfter === false) {
    pass('级别默认标准，单独压缩/删除源默认关')
  } else fail('默认选项断言', JSON.stringify(defaults))

  // ── 3. 选「仅存储」→ 确定 → 桥参数断言 ──
  await page.select('#compress-level', 'store')
  const confirm1 = await rect(page, '#compress-confirm')
  await tap(client, confirm1.x, confirm1.y)
  await sleep(800)
  const call1 = await page.evaluate(() => window.__compressCalls)
  if (call1.length === 1 && call1[0].dstPath === 'apks.zip' &&
      call1[0].srcPaths.length === 1 && call1[0].srcPaths[0] === 'apks' &&
      call1[0].level === -1) {
    pass('确定 → 桥 compress(srcPaths=[apks], dst=apks.zip, level=-1 仅存储)')
  } else fail('桥 compress 参数断言', JSON.stringify(call1))
  const closed1 = await page.evaluate(() =>
    !document.getElementById('compress-dialog-overlay').classList.contains('dialog-overlay-visible'))
  if (closed1) pass('确定后对话框关闭')
  else fail('确定后对话框未关闭')

  // ── 4. 多选 + 单独压缩 + 压缩后删除源 ──
  await selectEntries([
    { path: '报告.txt', isDir: false },
    { path: '笔记.md', isDir: false }
  ])
  const compressBtn2 = await rect(page, '[data-action="compress"]')
  await tap(client, compressBtn2.x, compressBtn2.y)
  await waitFor(page, '#compress-dialog-overlay.dialog-overlay-visible')
  await sleep(300)   // 等弹窗缩放动画落定（rect 测量基于最终布局）
  // 勾「单独压缩每个文件/文件夹」+「压缩后删除源文件」（点整行）
  const sepRect = await page.evaluate(() => {
    const el = document.getElementById('compress-separate')
    const row = el && el.parentElement
    if (!row) return null
    const r = row.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  await tap(client, sepRect.x, sepRect.y)
  const delRect = await page.evaluate(() => {
    const el = document.getElementById('compress-delete-after')
    const row = el && el.parentElement
    if (!row) return null
    const r = row.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  await tap(client, delRect.x, delRect.y)
  const toggled = await page.evaluate(() => {
    const name = document.getElementById('compress-name')
    return {
      separate: document.getElementById('compress-separate').checked,
      deleteAfter: document.getElementById('compress-delete-after').checked,
      nameDisabled: name.disabled
    }
  })
  if (toggled.separate && toggled.deleteAfter) pass('两个勾选项均可勾选')
  else fail('勾选项断言', JSON.stringify(toggled))
  if (toggled.nameDisabled) pass('单独压缩模式：文件名输入禁用（每项用自身主名）')
  else fail('单独压缩模式文件名输入未禁用')
  const confirm2 = await rect(page, '#compress-confirm')
  await tap(client, confirm2.x, confirm2.y)
  await sleep(1200)
  const call2 = await page.evaluate(() => window.__compressCalls)
  const moves2 = await page.evaluate(() => window.__moveCalls)
  if (call2.length === 3 &&
      call2[1].dstPath === '报告.zip' && call2[1].srcPaths.length === 1 && call2[1].level === 6 &&
      call2[2].dstPath === '笔记.zip' && call2[2].srcPaths.length === 1 && call2[2].level === 6) {
    pass('单独压缩：报告.zip / 笔记.zip 各一个归档（level=6 标准）')
  } else fail('单独压缩参数断言', JSON.stringify(call2))
  if (moves2.length === 2 && moves2.every(m => m.dst.indexOf('.trash/') === 0)) {
    pass('压缩后删除源：源经 move 管道进回收站（.trash/…）')
  } else fail('删除源断言', JSON.stringify(moves2))

  // ── 5. 取消 → 不触发压缩 ──
  await selectEntries([{ path: '报告.txt', isDir: false }])
  const compressBtn3 = await rect(page, '[data-action="compress"]')
  await tap(client, compressBtn3.x, compressBtn3.y)
  await waitFor(page, '#compress-dialog-overlay.dialog-overlay-visible')
  await sleep(300)
  const cancelRect = await rect(page, '#compress-cancel')
  await tap(client, cancelRect.x, cancelRect.y)
  await sleep(500)
  const call3 = await page.evaluate(() => window.__compressCalls)
  const closed3 = await page.evaluate(() =>
    !document.getElementById('compress-dialog-overlay').classList.contains('dialog-overlay-visible'))
  if (call3.length === 3 && closed3) pass('取消 → 对话框关闭且不触发压缩')
  else fail('取消路径断言', JSON.stringify({ calls: call3.length, closed: closed3 }))

  // ── 6. 零 pageerror ──
  if (pageErrors.length === 0) pass('全程零 pageerror')
  else fail('存在 pageerror', pageErrors.join(' | '))

  await browser.close()
  console.log('  ── compress-e2e: ' + PASS + ' 通过, ' + FAIL + ' 失败 ──')
  process.exit(FAIL > 0 ? 1 : 0)
}

main().catch(function (e) {
  console.error('  [FAIL] E2E 执行异常: ' + (e && e.message))
  process.exit(1)
})
