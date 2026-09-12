// 目录导航秒开 E2E 门禁：无头 Chromium（注入 FileBridge 内存桩）
// ═══════════════════════════════════════════════════════════════
//  场景（refresh({nav:true}) 的清单缓存 / 根信息复用 / loading 延迟显示）：
//    1. 启动：根目录渲染 + rootInfo 取 1 次（清单缓存落地）
//    2. 进入子目录：渲染子目录内容
//    3. 退出子目录 = 秒开：goUp 同步返回时父目录图标已渲染（同一 JS 任务内断言），
//       且未弹「加载中」——不再有「退出要等加载」的等待
//    4. 退出后静默对齐：后台重取父目录清单；rootInfo 不重复取（导航复用根信息）
//    5. 未缓存目录 + 慢清单：180ms 内不弹「加载中」（避免闪一下），超过才弹，返回后关闭
//    6. 全程零 pageerror
//
//  导航经 App.Desktop.openItem / goUp 驱动（本门禁验证刷新/缓存链路，不是手势）。
//  用法: DESKTOP_BUNDLE=dist/adesktop.bundle.min.html node scripts/verify-folder-nav.js
//  退出码: 0 通过 / 1 失败 / 2 无可用 Chromium
// ═══════════════════════════════════════════════════════════════
const { launch } = require('./lib/browser')
const path = require('path')

const BUNDLE = process.env.DESKTOP_BUNDLE || path.join(__dirname, '..', 'dist', 'adesktop.bundle.html')
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

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

  // 桥桩：内存文件树 + 调用计数（__stats）；__slowPath 指定路径的 list 延迟 400ms（模拟慢目录）
  await page.evaluateOnNewDocument(() => {
    const TREE = {
      '': [
        { name: 'docs', isDir: true, size: 0, mtime: 1 },
        { name: 'a.txt', isDir: false, size: 12, mtime: 2 },
        { name: 'b.txt', isDir: false, size: 7, mtime: 3 }
      ],
      'docs': [
        { name: 'inner.txt', isDir: false, size: 5, mtime: 4 },
        { name: 'sub', isDir: true, size: 0, mtime: 5 }
      ],
      'slow': [{ name: 's.txt', isDir: false, size: 3, mtime: 6 }]
    }
    window.__stats = { rootInfo: 0, list: [] }
    window.__slowPath = null
    function ok(cb, data) { window.__fbResolve(cb, { ok: true, data: data }) }
    function err(cb, msg) { window.__fbResolve(cb, { ok: false, error: msg }) }
    window.FileBridge = {
      rootInfo: function (cb) { window.__stats.rootInfo++; ok(cb, { rootName: 'mock', mode: 'private', displayPath: '/mock', trashName: '.trash', rootId: 'mock-root' }) },
      list: function (p, cb) {
        p = p || ''
        window.__stats.list.push(p)
        const items = (TREE[p] || []).slice()
        if (window.__slowPath === p) setTimeout(function () { ok(cb, items) }, 400)
        else ok(cb, items)
      },
      read: function (p, cb) { ok(cb, 'text') },
      write: function (p, c, cb) { ok(cb, true) },
      resolveUri: function (p, cb) { err(cb, '无 URI') },
      previewUri: function (p, cb) { err(cb, '无预览档') },
      thumb: function (p, cb) { err(cb, '无缩略图') },
      openExternal: function (p, cb) { err(cb, '无外部应用') },
      vibrate: function () {},
      requestRootAccess: function () {}
    }
  })

  await page.goto('file://' + BUNDLE, { waitUntil: 'networkidle0' })
  await page.waitForFunction(() => window.App && document.querySelectorAll('.desktop-icon').length === 3, { timeout: 10000 })
  await page.evaluate(() => {
    if (window.App.Dialog && typeof App.Dialog.close === 'function') App.Dialog.close('all-files-dialog-overlay')
  })

  const iconNames = () => page.evaluate(() =>
    Array.from(document.querySelectorAll('.desktop-icon')).map(n => n.getAttribute('data-name')))
  const loadingVisible = () => page.evaluate(() => {
    const d = document.getElementById('loading-dialog')
    return !!d && d.classList.contains('dialog-overlay-visible')
  })

  // ── 1. 启动 ──
  const boot = await page.evaluate(() => ({ rootInfo: window.__stats.rootInfo, list: window.__stats.list.slice() }))
  if (boot.rootInfo === 1 && boot.list.filter(p => p === '').length === 1) pass('启动：rootInfo 1 次 + list 根目录 1 次')
  else fail('启动桥调用', JSON.stringify(boot))

  // ── 2. 进入子目录 ──
  await page.evaluate(() => App.Desktop.openItem('docs'))
  await page.waitForFunction(() => document.querySelectorAll('.desktop-icon').length === 2, { timeout: 5000 })
  const inFolder = await iconNames()
  if (inFolder.indexOf('inner.txt') >= 0) pass('进入 docs：渲染子目录内容（' + inFolder.join(',') + '）')
  else fail('进入 docs 渲染', inFolder.join(','))

  // ── 3. 退出 = 秒开（同一 JS 任务内断言）+ 不弹 loading ──
  const up = await page.evaluate(() => {
    App.Desktop.goUp()
    // goUp 同步返回：此刻父目录图标应已渲染（缓存秒开），且无「加载中」弹窗
    const d = document.getElementById('loading-dialog')
    return {
      names: Array.from(document.querySelectorAll('.desktop-icon')).map(n => n.getAttribute('data-name')),
      loading: !!d && d.classList.contains('dialog-overlay-visible'),
      path: App.Desktop.getCurPath()
    }
  })
  if (up.names.length === 3 && up.names.indexOf('a.txt') >= 0 && up.names.indexOf('b.txt') >= 0) {
    pass('退出文件夹：goUp 返回时已同步渲染父目录 3 项（秒开）')
  } else fail('退出秒开（同步渲染）', JSON.stringify(up.names))
  if (!up.loading) pass('退出文件夹：未弹「加载中」')
  else fail('退出文件夹不应弹「加载中」')
  if (up.path === '') pass('退出后 curPath 回根')
  else fail('退出后 curPath', up.path)

  // ── 4. 退出后静默对齐（stale-while-revalidate）+ 根信息复用 ──
  await sleep(200)
  const after = await page.evaluate(() => ({ rootInfo: window.__stats.rootInfo, list: window.__stats.list.slice() }))
  const rootLists = after.list.filter(p => p === '').length
  if (rootLists === boot.list.filter(p => p === '').length + 1) pass('退出后静默向桥层重取父目录清单（对齐真相）')
  else fail('退出后未重取清单', JSON.stringify(after.list))
  if (after.rootInfo === 1) pass('导航全程 rootInfo 仍 1 次（复用根信息，省桥往返）')
  else fail('导航不应重复取 rootInfo', String(after.rootInfo))
  const stillNames = await iconNames()
  if (stillNames.length === 3) pass('内容未变 → 不重复重渲染（仍 3 项）')
  else fail('内容未变却重渲染', stillNames.join(','))

  // ── 5. 未缓存目录 + 慢清单：loading 延迟显示 ──
  // 经 enterFolder（不经 openItem）：慢清单目录不在根清单里，本步只验证刷新链路
  await page.evaluate(() => { window.__slowPath = 'slow'; App.Desktop.enterFolder('slow') })
  await sleep(120)
  if (!(await loadingVisible())) pass('未缓存目录：180ms 内不弹「加载中」（避免闪一下）')
  else fail('未缓存目录不应立刻弹「加载中」')
  await sleep(200)
  if (await loadingVisible()) pass('超过 180ms 仍在加载 → 弹出「加载中」')
  else fail('慢目录应弹出「加载中」')
  await page.waitForFunction(() => document.querySelectorAll('.desktop-icon').length === 1, { timeout: 5000 })
  await sleep(120)
  if (!(await loadingVisible())) pass('加载完成 → 关闭「加载中」')
  else fail('加载完成后应关闭「加载中」')

  // ── 6. 零 pageerror ──
  if (pageErrors.length === 0) pass('全程零 pageerror')
  else fail('pageerror', pageErrors.join(' | '))

  await browser.close()
  if (FAIL > 0) {
    console.log('\n  folder-nav E2E: ' + PASS + ' 通过 / ' + FAIL + ' 失败')
    process.exit(1)
  }
  console.log('\n  folder-nav E2E 全部通过（' + PASS + ' 项）')
  process.exit(0)
}

main().catch(function (e) {
  console.error('  [ERROR] ' + (e && e.stack || e))
  process.exit(1)
})
