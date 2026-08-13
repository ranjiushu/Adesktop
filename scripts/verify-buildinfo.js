// 提交与构建面板 E2E 门禁：CDP 真实触摸序列验证
// ═══════════════════════════════════════════════════════════════
//  场景：无头 Chromium：
//    1. 打开 Drawer → 点「提交与构建」→ 面板滑出
//    2. 构建统计有值（构建次数/提交总数/分支，注入变量非空）
//    3. 最近提交列表渲染
//    4. 关闭按钮关闭面板
//    5. 全程零 pageerror
//
//  用法: DESKTOP_BUNDLE=dist/desktop.bundle.min.html node scripts/verify-buildinfo.js
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
  await sleep(1200)
  const client = await page.createCDPSession()

  // ── 1. 打开 Drawer → 点「提交与构建」 ──
  const btn = await page.evaluate(() => {
    const b = document.getElementById('btn-drawer')
    const r = b.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  await tap(client, btn.x, btn.y, 60)
  await sleep(400)
  const buildBtn = await page.evaluate(() => {
    const b = document.getElementById('btn-build-info')
    const r = b.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, visible: r.width > 0 && r.height > 0 }
  })
  if (!buildBtn || !buildBtn.visible) { fail('Drawer 操作区「提交与构建」按钮可见'); process.exit(1) }
  pass('「提交与构建」按钮渲染可见（Drawer 操作区）')
  await tap(client, buildBtn.x, buildBtn.y, 60)
  const opened = await page.evaluate(() => {
    const p = document.getElementById('buildinfo')
    return !!(p && p.classList.contains('buildinfo-open'))
  })
  if (opened) pass('点击后构建信息面板打开')
  else fail('面板未打开')

  // ── 2. 构建统计有值（新版 renderKvCard 结构） ──
  const stats = await page.evaluate(() => {
    const map = {}
    document.querySelectorAll('#buildinfo-body .sub-info-card-row').forEach(el => {
      const label = el.querySelector('.sub-info-label')
      const value = el.querySelector('.sub-info-value')
      if (label && value) map[label.textContent] = value.textContent
    })
    return map
  })
  if (/^\d+ 次$/.test(stats['建构次数'] || '')) pass('建构次数有值: ' + stats['建构次数'])
  else fail('建构次数缺失: ' + stats['建构次数'])
  if (/^\d+ 次$/.test(stats['提交总数'] || '')) pass('提交总数有值: ' + stats['提交总数'])
  else fail('提交总数缺失: ' + stats['提交总数'])
  if (stats['当前分支'] && stats['当前分支'] !== '--') pass('分支有值: ' + stats['当前分支'])
  else fail('分支缺失: ' + stats['当前分支'])

  // ── 3. 最近提交列表 ──
  const commits = await page.evaluate(() => {
    return document.querySelectorAll('#build-commit-list .build-commit-item').length
  })
  if (commits > 0) pass('最近提交列表渲染 (' + commits + ' 条)')
  else fail('提交列表为空')

  // ── 3b. 完整区块：热力图 / 仓库规模 / 更新日志 ──
  const heatmap = await page.evaluate(() => {
    const grid = document.querySelector('.heatmap-grid')
    if (!grid) return null
    return { cells: grid.querySelectorAll('.heatmap-cell').length, levels: grid.querySelectorAll('.heatmap-cell[data-level="1"]').length }
  })
  if (heatmap && heatmap.cells > 0) pass('贡献热力图渲染 (' + heatmap.cells + ' 格)')
  else fail('热力图未渲染')

  const repo = await page.evaluate(() => {
    const rows = document.querySelectorAll('.sub-info-card-row')
    let found = false
    rows.forEach(r => {
      if (r.textContent.indexOf('源码行数') >= 0) found = true
    })
    return found
  })
  if (repo) pass('仓库规模统计渲染')
  else fail('仓库规模未渲染')

  const changelog = await page.evaluate(() => {
    const content = document.getElementById('build-guide-content')
    return !!(content && content.innerHTML.length > 0)
  })
  if (changelog) pass('更新日志注入')
  else fail('更新日志缺失')

  // 更新日志折叠交互（面板内滚动区，先用 evaluate 滚动到可见）
  const toggle = await page.evaluate(() => {
    const t = document.getElementById('build-guide-toggle')
    if (!t) return null
    t.scrollIntoView({ block: 'center' })
    const r = t.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, visible: r.width > 0 && r.height > 0 }
  })
  if (toggle && toggle.visible) {
    await sleep(300)
    await tap(client, toggle.x, toggle.y, 60)
    const shown = await page.evaluate(() => {
      const c = document.getElementById('build-guide-content')
      return !!(c && c.style.display !== 'none')
    })
    if (shown) pass('更新日志折叠展开')
    else fail('更新日志折叠未展开')
  } else {
    fail('找不到更新日志折叠区')
  }

  // ── 4. 返回按钮关闭面板（history.back → popstate） ──
  const backBtn = await page.evaluate(() => {
    const b = document.getElementById('buildinfo-back')
    const r = b.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  await tap(client, backBtn.x, backBtn.y, 60)
  await sleep(400)
  const closedByBack = await page.evaluate(() => {
    const p = document.getElementById('buildinfo')
    return !(p && p.classList.contains('buildinfo-open'))
  })
  if (closedByBack) pass('返回按钮关闭面板')
  else fail('返回按钮未关闭面板')

  // ── 4b. 系统返回键（Android 壳 onKeyDown → evaluateJavascript('App.handleSystemBack()')） ──
  // 注：page.goBack() 只测 Web 端 history.back() 语义，与真机 WebView 返回键不等价
  // （MainActivity.onKeyDown 先试 canGoBack，再询问 App.handleSystemBack）。
  // 此处直接验证前端消费函数本体。
  const reopen = await page.evaluate(() => window.App.BuildInfo.open())
  await sleep(400)
  const reopened = await page.evaluate(() => {
    const p = document.getElementById('buildinfo')
    return !!(p && p.classList.contains('buildinfo-open'))
  })
  if (reopened) pass('再次打开面板')
  else fail('未能重新打开面板')
  const handled = await page.evaluate(() => window.App.handleSystemBack() === true)
  await sleep(400)
  const closedBySystem = await page.evaluate(() => {
    const p = document.getElementById('buildinfo')
    return !(p && p.classList.contains('buildinfo-open'))
  })
  if (handled && closedBySystem) pass('系统返回键退出面板（handleSystemBack=true）')
  else if (!handled) fail('handleSystemBack 未消费返回键')
  else fail('系统返回键未退出面板')

  // ── 4c. 无 overlay 时 handleSystemBack 必须返回 false（壳才可退出 App） ──
  const notHandled = await page.evaluate(() => window.App.handleSystemBack() === false)
  if (notHandled) pass('无 overlay 时 handleSystemBack 返回 false')
  else fail('无 overlay 时 handleSystemBack 误返回 true（App 将无法退出）')

  // ── 5. 零 pageerror ──
  if (pageErrors.length === 0) pass('全程零 pageerror')
  else fail('存在 pageerror: ' + pageErrors.join(' | '))

  await browser.close()
  if (FAIL > 0) {
    console.log('  [FAIL] 共 ' + FAIL + ' 项失败')
    process.exit(1)
  }
  console.log('  [ok] 提交与构建 E2E 全部通过 (' + PASS + ' 项)')
  process.exit(0)
}

main().catch(e => {
  console.error('[FAIL] E2E 异常: ' + (e && e.message))
  process.exit(1)
})
