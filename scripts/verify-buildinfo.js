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

  // ── 3c. 源码规模排序标签（切换排列方式） ──
  const sortChipTest = await page.evaluate(() => {
    const body = document.getElementById('build-source-body')
    const chip = body ? body.querySelector('[data-sort="name"]') : null
    if (!chip) return { ok: false, reason: '无 名称 标签' }
    chip.scrollIntoView({ block: 'center' })
    const firstRow = body.querySelector('.file-bar-row')
    const before = firstRow ? firstRow.textContent.slice(0, 30) : ''
    chip.click()
    const after = document.querySelector('#build-source-body .file-bar-row')
    const afterText = after ? after.textContent.slice(0, 30) : ''
    return { ok: before !== afterText, before, after: afterText }
  })
  if (sortChipTest.ok) pass('源码规模「名称」排序标签生效')
  else fail('排序标签不生效: ' + JSON.stringify(sortChipTest))

  // ── 3d. 文件详情弹窗：统一模板 + 文字可复制 + 无取消按钮 + 返回键关闭 ──
  const fileModal = await page.evaluate(() => {
    window.App.BuildInfo.showFileDetailModal(window.FILE_STATS[0])
    const ov = document.getElementById('detail-modal-overlay')
    if (!ov) return { open: false }
    const modal = ov.querySelector('.dialog')
    const cs = getComputedStyle(modal)
    return {
      open: true,
      unified: !!modal && !!modal.className.match(/\bdialog\b/),
      radius: cs.borderRadius,
      userSelect: cs.userSelect,
      noCloseBtn: modal.textContent.indexOf('关闭') < 0 && modal.textContent.indexOf('取消') < 0,
      title: modal.querySelector('.dialog-title').textContent,
      path: modal.querySelector('.build-detail-path').textContent
    }
  })
  if (fileModal.open && fileModal.unified && fileModal.radius === '0px')
    pass('文件详情弹窗使用统一模板（矩形 .dialog）')
  else fail('弹窗未用统一模板: ' + JSON.stringify(fileModal))
  if (fileModal.userSelect === 'text') pass('弹窗文字可复制（user-select: text）')
  else fail('弹窗文字不可复制: ' + fileModal.userSelect)
  if (fileModal.noCloseBtn) pass('弹窗无「关闭/取消」按钮')
  else fail('弹窗仍有关闭/取消按钮')
  const expected = await page.evaluate(() => {
    const f = window.FILE_STATS[0]
    return { name: f.name.split('/').pop(), path: f.name }
  })
  if (fileModal.title === expected.name && fileModal.path === expected.path)
    pass('文件详情信息准确（名称/路径）')
  else fail('文件详情信息不准确: ' + JSON.stringify(fileModal))

  // 返回键：先关弹窗，面板保持打开
  const modalBack = await page.evaluate(() => {
    const before = document.getElementById('detail-modal-overlay') != null
    const handled = window.App.handleSystemBack() === true
    const closed = document.getElementById('detail-modal-overlay') == null
    const panelOpen = document.getElementById('buildinfo').classList.contains('buildinfo-open')
    return { before, handled, closed, panelOpen }
  })
  if (modalBack.before && modalBack.handled && modalBack.closed && modalBack.panelOpen)
    pass('系统返回键关闭详情弹窗（面板保持打开）')
  else fail('返回键关闭弹窗异常: ' + JSON.stringify(modalBack))

  // ── 3d2. 点击即复制（「点击谁就复制谁」+ 吐司） ──
  const tapCopy = await page.evaluate(() => {
    // 拦截复制实现记录调用（headless 无剪贴板权限，验证参数 + 吐司即可）
    window.__copies = []
    window.App.ui.copyText = function (text, msg) {
      window.__copies.push({ text: text, msg: msg })
      window.App.toast.show(msg)
      return true
    }
    window.App.BuildInfo.showFileDetailModal(window.FILE_STATS[0])
    const ov = document.getElementById('detail-modal-overlay')
    ov.querySelector('.dialog-title').click()   // 点击标题 → 复制文件名
    ov.querySelector('.build-detail-path').click()  // 点击路径 → 复制路径
    ov.querySelector('.build-detail-value').click() // 点击行数值 → 复制值
    const copies = window.__copies.slice()
    const toastMsg = document.querySelector('.toast') ? document.querySelector('.toast').textContent : ''
    window.App.Dialog.close('detail-modal-overlay')
    const o = document.getElementById('detail-modal-overlay')
    if (o) o.remove()
    return { copies: copies, toastMsg: toastMsg }
  })
  const f0 = await page.evaluate(() => window.FILE_STATS[0])
  const expName = f0.name.split('/').pop()
  const tc1 = tapCopy.copies && tapCopy.copies[0]
  const tc2 = tapCopy.copies && tapCopy.copies[1]
  const tc3 = tapCopy.copies && tapCopy.copies[2]
  if (tc1 && tc1.text === expName && tc1.msg === '已复制文件名') pass('点击标题复制文件名 + 吐司')
  else fail('点击标题复制异常: ' + JSON.stringify(tc1))
  if (tc2 && tc2.text === f0.name && tc2.msg === '已复制路径') pass('点击路径复制路径 + 吐司')
  else fail('点击路径复制异常: ' + JSON.stringify(tc2))
  if (tc3 && tc3.text === String(f0.lines) && tc3.msg === '已复制') pass('点击行数值复制 + 吐司')
  else fail('点击行数值复制异常: ' + JSON.stringify(tc3))
  if (tapCopy.toastMsg && tapCopy.toastMsg.indexOf('已复制') >= 0) pass('吐司提示复制成功: ' + tapCopy.toastMsg)
  else fail('吐司未提示: ' + tapCopy.toastMsg)

  // ── 3e. 提交详情弹窗：北京时间 + 点击内容不关闭（保证长按选字） ──
  const commitModal = await page.evaluate(() => {
    const c = window.RECENT_COMMITS[0]
    window.App.BuildInfo.showCommitDetailModal(c)
    const ov = document.getElementById('detail-modal-overlay')
    if (!ov) return { open: false }
    const modal = ov.querySelector('.dialog')
    const meta = modal.querySelector('.build-detail-meta').textContent
    modal.click()  // 点击弹窗本体不应关闭
    const stillOpen = document.getElementById('detail-modal-overlay') != null
    // 期望显示 = git UTC 时间 + 8 小时（北京口径）
    const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/.exec(c.date)
    let expected = ''
    if (m) {
      const sign = m[7] === '-' ? -1 : 1
      const off = sign * (+m[8] * 60 + +m[9])
      const utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - off * 60000
      const d = new Date(utc + 8 * 3600000)
      const p = function (n) { return (n < 10 ? '0' : '') + n }
      expected = d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) +
        ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes())
    }
    return { open: true, meta: meta, stillOpen: stillOpen, expected: expected }
  })
  if (commitModal.open && commitModal.stillOpen) pass('点击弹窗本体不关闭（文字可选择复制）')
  else fail('点击弹窗本体误关闭')
  if (commitModal.open && commitModal.meta.indexOf(commitModal.expected) >= 0)
    pass('提交时间显示北京时间格式: ' + commitModal.meta)
  else fail('提交时间未转北京时间: ' + commitModal.meta + ' (期望含 ' + commitModal.expected + ')')
  await page.evaluate(() => {
    // 生产关闭路径：App.Dialog.close 出栈 + 移除 DOM（closeDetailModal 同款）
    window.App.Dialog.close('detail-modal-overlay')
    const o = document.getElementById('detail-modal-overlay')
    if (o) o.remove()
  })

  // ── 3e2. 提交弹窗点击复制：hash / 作者时间 / 文件行 ──
  const commitCopy = await page.evaluate(() => {
    const c = window.RECENT_COMMITS[0]
    window.App.BuildInfo.showCommitDetailModal(c)
    const ov = document.getElementById('detail-modal-overlay')
    window.__copies = []
    window.App.ui.copyText = function (text, msg) {
      window.__copies.push({ text: text, msg: msg })
      window.App.toast.show(msg)
      return true
    }
    const hash = ov.querySelector('.build-detail-path')
    const meta = ov.querySelector('.build-detail-meta')
    const fileRow = ov.querySelector('.build-detail-file')
    hash.click()
    meta.click()
    if (fileRow) fileRow.click()
    const copies = window.__copies.slice()
    const toastMsg = document.querySelector('.toast') ? document.querySelector('.toast').textContent : ''
    window.App.Dialog.close('detail-modal-overlay')
    const o = document.getElementById('detail-modal-overlay')
    if (o) o.remove()
    return { copies: copies, toastMsg: toastMsg, firstFile: c.files && c.files[0] ? c.files[0].name : null }
  })
  const fullHash = await page.evaluate(() => window.RECENT_COMMITS[0].fullHash)
  const ch1 = commitCopy.copies && commitCopy.copies[0]
  const ch2 = commitCopy.copies && commitCopy.copies[1]
  const ch3 = commitCopy.copies && commitCopy.copies[2]
  if (ch1 && ch1.text === fullHash && ch1.msg === '已复制完整 Hash') pass('点击 hash 复制完整 Hash + 吐司')
  else fail('点击 hash 复制异常: ' + JSON.stringify(ch1))
  if (ch2 && ch2.msg === '已复制作者与时间' && typeof ch2.text === 'string' && ch2.text.indexOf('Desktop Dev') >= 0)
    pass('点击作者时间复制 + 吐司')
  else fail('点击作者时间复制异常: ' + JSON.stringify(ch2))
  if (commitCopy.firstFile && ch3 && ch3.text === commitCopy.firstFile && ch3.msg === '已复制文件路径')
    pass('点击文件行复制文件路径 + 吐司')
  else fail('点击文件行复制异常: ' + JSON.stringify(ch3))
  if (commitCopy.toastMsg && commitCopy.toastMsg.indexOf('已复制') >= 0) pass('提交弹窗吐司提示复制成功')
  else fail('提交弹窗吐司未提示')

  // ── 3f. 更新日志 md 渲染：h3 标题 / 多行列表项 ──
  const changelogMd = await page.evaluate(() => {
    const c = document.getElementById('build-guide-content')
    if (!c) return { h3Count: 0, multiLineItem: '' }
    c.style.display = ''
    const r = {
      h3Count: c.querySelectorAll('h3').length,
      multiLineItem: (function () {
        const lis = c.querySelectorAll('li')
        for (const li of lis) {
          if (li.textContent.indexOf('并入') >= 0) return li.textContent.replace(/\s+/g, ' ')
        }
        return ''
      })()
    }
    c.style.display = 'none'
    return r
  })
  if (changelogMd.h3Count > 0) pass('更新日志 h3 标题渲染 (' + changelogMd.h3Count + ' 个)')
  else fail('更新日志 h3 标题未渲染')
  if (changelogMd.multiLineItem.indexOf('成为首个开发基线') >= 0) pass('更新日志多行列表项并入同一 <li>')
  else fail('更新日志列表续行被拆段: ' + changelogMd.multiLineItem)

  // ── 3g. 展开后无横向溢出（changelog 含超长无空格 ASCII token，曾撑宽滚动容器） ──
  const noHScroll = await page.evaluate(() => {
    const c = document.getElementById('build-guide-content')
    c.style.display = ''
    const body = document.getElementById('buildinfo-body')
    const r = { scrollW: body.scrollWidth, clientW: body.clientWidth }
    c.style.display = 'none'
    return r
  })
  if (noHScroll.scrollW <= noHScroll.clientW) pass('更新日志展开后无横向溢出 (' + noHScroll.scrollW + ' ≤ ' + noHScroll.clientW + ')')
  else fail('更新日志展开后横向溢出: scrollW=' + noHScroll.scrollW + ' > clientW=' + noHScroll.clientW)

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
