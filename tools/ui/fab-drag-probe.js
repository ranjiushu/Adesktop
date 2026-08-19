// FAB 悬浮球拖动定位 E2E 探针：CDP 真实触摸序列
// 验证: 1) 初始右档 2) 拖到左半屏 → 吸附左侧 + localStorage 3) 刷新保持 4) 拖回右侧
//       5) 菜单展开时禁拖 6) 短按仍可展开菜单（拖动不误伤点击）
// 用法: node tools/ui/fab-drag-probe.js
const { launch, openPage } = require('../../scripts/lib/browser')
const path = require('path')
const BUNDLE = path.join(__dirname, '..', '..', 'dist', 'adesktop.bundle.html')
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

let PASS = 0, FAIL = 0
const pass = (l, d) => { console.log('  [PASS] ' + l + (d ? ' — ' + d : '')); PASS++ }
const fail = (l, d) => { console.log('  [FAIL] ' + l + (d ? ' — ' + d : '')); FAIL++ }

async function touchDrag(client, from, to, steps = 8) {
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] })
  await sleep(40)
  for (let i = 1; i <= steps; i++) {
    const x = from.x + (to.x - from.x) * i / steps
    const y = from.y + (to.y - from.y) * i / steps
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] })
    await sleep(30)
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

async function fabState(page) {
  return page.evaluate(() => {
    const fab = document.getElementById('mode-switch-fab')
    const r = fab.getBoundingClientRect()
    return {
      left: +r.left.toFixed(1),
      bodyLeft: document.body.classList.contains('fab-pos-left'),
      stored: (() => { try { return localStorage.getItem('desktop_fab_position') } catch (e) { return null } })()
    }
  })
}

;(async () => {
  const browser = await launch()
  const page = await openPage(browser, BUNDLE, { width: 412, height: 915, dsf: 2.75 })
  await sleep(600)
  const client = await page.target().createCDPSession()

  // 1. 初始右档
  let s = await fabState(page)
  if (s.left > 300 && !s.bodyLeft) pass('初始 FAB 在右侧 (left=' + s.left + ')')
  else fail('初始位置异常: ' + JSON.stringify(s))

  // 2. 拖到左半屏 → 吸附左侧
  await touchDrag(client, { x: s.left + 18, y: 790 }, { x: 80, y: 700 })
  await sleep(600) // 吸附动画 240ms + 余量
  s = await fabState(page)
  if (s.left < 60 && s.bodyLeft && s.stored === 'left')
    pass('拖动吸附左侧 (left=' + s.left + ', body.fab-pos-left, localStorage=left)')
  else fail('吸附左侧失败: ' + JSON.stringify(s))

  // 3. 刷新 → 位置保持
  await page.reload({ waitUntil: 'networkidle0' })
  await sleep(800)
  s = await fabState(page)
  if (s.left < 60 && s.bodyLeft) pass('刷新后 FAB 保持左侧 (left=' + s.left + ')')
  else fail('刷新后位置丢失: ' + JSON.stringify(s))

  // 4. 拖回右侧
  await touchDrag(client, { x: s.left + 18, y: 790 }, { x: 350, y: 700 })
  await sleep(600)
  s = await fabState(page)
  if (s.left > 300 && !s.bodyLeft && s.stored === 'right')
    pass('拖回右侧 (left=' + s.left + ', localStorage=right)')
  else fail('拖回右侧失败: ' + JSON.stringify(s))

  // 5. 菜单展开时禁拖：展开菜单后拖动不应改变位置
  await page.evaluate(() => App.fabSpeedDial.expand('desktop'))
  await sleep(400)
  const before = await fabState(page)
  await touchDrag(client, { x: before.left + 18, y: 790 }, { x: 80, y: 700 })
  await sleep(600)
  const after = await fabState(page)
  if (Math.abs(after.left - before.left) < 2 && after.stored === 'right')
    pass('菜单展开时禁拖（位置未变）')
  else fail('展开态拖动未拦截: ' + JSON.stringify({ before, after }))
  await page.evaluate(() => App.fabSpeedDial.collapse())
  await sleep(300)

  // 6. 短按 FAB 仍可展开菜单（拖动不误伤点击）
  await page.evaluate(() => {
    document.getElementById('mode-switch-fab').dispatchEvent(new Event('click', { bubbles: true }))
  })
  await sleep(400)
  const tapState = await page.evaluate(() => ({
    expanded: App.fabSpeedDial.isExpanded(),
    mode: App.fabSpeedDial.getMode()
  }))
  if (tapState.expanded && tapState.mode === 'desktop') pass('短按 FAB 正常展开菜单（拖动不误伤点击）')
  else fail('短按展开异常: ' + JSON.stringify(tapState))

  await browser.close()
  console.log(`\n结果: ${PASS} 通过, ${FAIL} 失败`)
  process.exit(FAIL ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
