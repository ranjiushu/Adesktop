// 桌面选中态视觉验证（Windows/macOS 桌面范式：淡强调色圆角块 + 强调色标签芯片）。
// ═══════════════════════════════════════════════════════════════
//  断言的是**视觉契约**（computed style），不是手势逻辑（手势由 test-desktop-* 覆盖）：
//    1. 网格选中块：圆角 10px + 1px 强调色描边 + 淡强调色底（不再是无描边的淡色方块）
//    2. 选中标签芯片：逐行贴合（span + box-decoration-break: clone）+ 强调色底白字
//    3. 未选中项无高亮块；按压态只铺淡底（不描边、不给芯片）
//    4. 列表视图行：整行淡底 + 左侧 3px 强调条（不显示网格态的块与芯片）
//    5. 框选矩形：圆角 + 淡强调色底（与选中块同一视觉语言）
//    6. 选中态 token 单一来源（--color-select-*）
//  选中方式：网格用真实触摸点按（走完整链路）；列表用选中集合 + applySelection
//  （列表行点击同样走手势，这里只验视觉，避免滚动/定位带来的采样抖动）。
//  用法: node tools/ui/selection-verify.js   退出码: 0 通过 / 1 失败
// ═══════════════════════════════════════════════════════════════
'use strict'
const path = require('path')
const { launch } = require('/skills/ui-verify/scripts/lib/browser.js')
const HTML = 'file://' + (process.env.DESKTOP_BUNDLE
  ? path.resolve(process.env.DESKTOP_BUNDLE)
  : path.join(__dirname, '..', '..', 'dist', 'adesktop.bundle.html'))

let failures = 0
function check(cond, msg) {
  if (cond) console.log('  [ok] ' + msg)
  else { console.error('  [fail] ' + msg); failures++ }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function main() {
  const browser = await launch()
  const page = await browser.newPage()
  await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2, hasTouch: true, isMobile: true })
  const pageErrors = []
  page.on('pageerror', e => pageErrors.push(e.message))

  await page.evaluateOnNewDocument(function () {
    const ROOT = [
      { name: 'docs', isDir: true, size: 0, mtime: 1 },
      { name: 'note.txt', isDir: false, size: 10, mtime: 2 },
      { name: 'photo.jpg', isDir: false, size: 20, mtime: 3 },
      { name: '一个很长很长很长需要换行截断的文件名.txt', isDir: false, size: 30, mtime: 4 }
    ]
    const TREE = { '': ROOT, 'docs': [{ name: 'inner.txt', isDir: false, size: 1, mtime: 1 }, { name: 'sub', isDir: true, size: 0, mtime: 2 }] }
    function ok(cb, data) { window.__fbResolve(cb, { ok: true, data: data }) }
    function err(cb, msg) { window.__fbResolve(cb, { ok: false, error: msg }) }
    window.FileBridge = {
      rootInfo: function (cb) { ok(cb, { rootName: 'mock', mode: 'private', displayPath: '/mock', trashName: '.trash' }) },
      list: function (p, cb) { ok(cb, (TREE[p || ''] || []).slice()) },
      thumb: function (p, cb) { err(cb, '无缩略图') },
      read: function (p, cb) { ok(cb, 'text') },
      write: function (p, c, cb) { ok(cb, true) },
      resolveUri: function (p, cb) { err(cb, '无 URI') },
      previewUri: function (p, cb) { err(cb, '无预览档') },
      openExternal: function (p, cb) { err(cb, '无外部应用') },
      vibrate: function () {},
      requestRootAccess: function () {}
    }
  })

  await page.goto(HTML, { waitUntil: 'networkidle0' })
  await page.waitForFunction(function () {
    return window.App && document.querySelectorAll('.desktop-icon').length === 4
  }, { timeout: 10000 })
  await page.evaluate(function () { if (window.App.Dialog) App.Dialog.close('all-files-dialog-overlay') })
  await sleep(300)

  // ── 1. token 单一来源 ──
  console.log('═══ 选中态 token ═══')
  const tokens = await page.evaluate(function () {
    const cs = getComputedStyle(document.documentElement)
    return {
      surface: cs.getPropertyValue('--color-select-surface').trim(),
      border: cs.getPropertyValue('--color-select-border').trim(),
      strong: cs.getPropertyValue('--color-select-strong').trim(),
      press: cs.getPropertyValue('--color-select-press').trim(),
      marquee: cs.getPropertyValue('--color-select-marquee').trim()
    }
  })
  check(tokens.surface === 'rgba(59, 130, 246, 0.14)', '--color-select-surface = 14% 强调色（' + tokens.surface + '）')
  check(tokens.strong === '#2563eb', '--color-select-strong = #2563eb（白字对比 5.2:1，' + tokens.strong + '）')
  check(!!tokens.border && !!tokens.press && !!tokens.marquee, '描边/按压/框选 token 均存在')

  // ── 2. 网格选中块 + 标签芯片（真实点按触发）──
  console.log('═══ 网格选中态 ═══')
  const target = await page.evaluate(function () {
    const el = document.querySelector('.desktop-icon[data-name="note.txt"]')
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  await page.touchscreen.tap(Math.round(target.x), Math.round(target.y))
  await sleep(500)

  const grid = await page.evaluate(function () {
    const el = document.querySelector('.desktop-icon[data-name="note.txt"]')
    const other = document.querySelector('.desktop-icon[data-name="photo.jpg"]')
    const before = getComputedStyle(el, '::before')
    const chip = el.querySelector('.desktop-icon-name-text')
    const chipCs = chip ? getComputedStyle(chip) : null
    return {
      selected: el.classList.contains('selected'),
      radius: before.borderRadius,
      borderWidth: before.borderTopWidth,
      borderStyle: before.borderTopStyle,
      borderColor: before.borderTopColor,
      blockBg: before.backgroundColor,
      blockInset: before.top + ' / ' + before.right,
      chipExists: !!chip,
      chipBg: chipCs ? chipCs.backgroundColor : null,
      chipColor: chipCs ? chipCs.color : null,
      chipRadius: chipCs ? chipCs.borderRadius : null,
      chipPadding: chipCs ? chipCs.paddingLeft : null,
      chipClone: chipCs ? (chipCs.webkitBoxDecorationBreak || chipCs.boxDecorationBreak) : null,
      chipText: chip ? chip.textContent : null,
      otherBefore: getComputedStyle(other, '::before').content,
      clamp: getComputedStyle(el.querySelector('.desktop-icon-name')).webkitLineClamp
    }
  })
  check(grid.selected, '点按后图标进入选中态')
  check(grid.radius === '10px', '选中块圆角 10px（当前 ' + grid.radius + '）')
  check(grid.borderWidth === '1px' && grid.borderStyle === 'solid', '选中块 1px 描边（当前 ' + grid.borderWidth + ' ' + grid.borderStyle + '）')
  check(grid.borderColor === 'rgba(37, 99, 235, 0.65)', '描边走 --color-select-border（当前 ' + grid.borderColor + '）')
  check(grid.blockBg === 'rgba(59, 130, 246, 0.14)', '块底走 --color-select-surface（当前 ' + grid.blockBg + '）')
  check(grid.blockInset === '4px / 6px', '块 inset 4px/6px（四周呼吸均匀，当前 ' + grid.blockInset + '）')
  check(grid.chipExists && grid.chipText === 'note.txt', '标签文本包在 .desktop-icon-name-text 里（芯片前置）')
  check(grid.chipBg === 'rgb(37, 99, 235)' && grid.chipColor === 'rgb(255, 255, 255)', '芯片：强调色底 + 白字')
  check(grid.chipRadius === '5px' && grid.chipPadding === '5px', '芯片圆角 5px / 左右内边距 5px')
  check(grid.chipClone === 'clone', '芯片 box-decoration-break: clone（换行逐行贴合，当前 ' + grid.chipClone + '）')
  check(grid.clamp === '2', '名字仍受两行截断约束（-webkit-line-clamp: 2）')
  check(grid.otherBefore === 'none', '未选中项无高亮块（::before content: none）')

  // ── 3. 列表视图行 ──
  console.log('═══ 列表视图行选中态 ═══')
  await page.evaluate(function () { App.Desktop.openItem('docs') })
  await sleep(400)
  await page.evaluate(function () { App.Desktop.applyViewPrefs({ viewStyle: 'list', sortBy: 'name', sortDir: 1 }) })
  await sleep(400)
  await page.evaluate(function () {
    const C = App.DesktopCore
    C.selection = new Set()
    document.querySelectorAll('.desktop-icon').forEach(function (n) {
      if (n.getAttribute('data-name') === 'inner.txt') C.selection.add(n.getAttribute('data-path'))
    })
    App.DesktopRender.applySelection()
  })
  await sleep(300)
  const list = await page.evaluate(function () {
    const el = document.querySelector('.desktop-icon[data-name="inner.txt"]')
    const row = getComputedStyle(el)
    const bar = getComputedStyle(el, '::after')
    const chip = el.querySelector('.desktop-icon-name-text')
    return {
      isRow: el.classList.contains('desktop-list-row') && el.classList.contains('selected'),
      bg: row.backgroundColor,
      beforeContent: getComputedStyle(el, '::before').content,
      barWidth: bar.width,
      barBg: bar.backgroundColor,
      barRadius: bar.borderRadius,
      chipBg: chip ? getComputedStyle(chip).backgroundColor : null
    }
  })
  check(list.isRow, '列表行进入选中态（.desktop-list-row.selected）')
  check(list.bg === 'rgba(59, 130, 246, 0.14)', '整行淡底走 --color-select-surface（当前 ' + list.bg + '）')
  check(list.beforeContent === 'none', '列表行不显示网格态的选中块')
  check(list.barWidth === '3px' && list.barBg === 'rgb(37, 99, 235)', '左侧 3px 强调条（当前 ' + list.barWidth + ' / ' + list.barBg + '）')
  check(list.barRadius === '0px 3px 3px 0px', '强调条右侧圆角（当前 ' + list.barRadius + '）')
  check(list.chipBg === 'rgba(0, 0, 0, 0)', '列表行名字不做芯片（背景透明）')

  // ── 4. 按压态规则（:active 无法在无头里直接触发，改断言样式表契约）──
  console.log('═══ 按压态（未选中）═══')
  const press = await page.evaluate(function () {
    const out = { found: false, bg: null, border: null }
    for (let i = 0; i < document.styleSheets.length; i++) {
      let rules
      try { rules = document.styleSheets[i].cssRules } catch (e) { continue }
      for (let j = 0; j < rules.length; j++) {
        const sel = rules[j].selectorText || ''
        if (sel.indexOf(':active:not(.selected)::before') < 0) continue
        out.found = true
        out.bg = rules[j].style.getPropertyValue('background')
        out.border = rules[j].style.getPropertyValue('border')
      }
    }
    return out
  })
  check(press.found, '存在 .desktop-icon:active:not(.selected)::before 按压规则')
  check(press.bg === 'var(--color-select-press)' && !press.border, '按压态只铺 --color-select-press 淡底、不描边（按压不等于选中）')

  // ── 5. 框选矩形 ──
  console.log('═══ 框选矩形 ═══')
  const marquee = await page.evaluate(function () {
    const cs = getComputedStyle(document.getElementById('desktop-marquee'))
    return { radius: cs.borderRadius, bg: cs.backgroundColor }
  })
  check(marquee.radius === '6px', '框选矩形圆角 6px（当前 ' + marquee.radius + '）')
  check(marquee.bg === 'rgba(59, 130, 246, 0.08)', '框选矩形底走 --color-select-marquee（当前 ' + marquee.bg + '）')

  check(pageErrors.length === 0, '全程零 pageerror' + (pageErrors.length ? '：' + pageErrors.join(' | ') : ''))

  await browser.close()
  if (failures > 0) { console.error('[FAIL] ' + failures + ' 项失败'); process.exit(1) }
  console.log('[ok] 桌面选中态视觉验证通过')
}
main().catch(function (e) { console.error('[FAIL]', e.message || e); process.exit(1) })
