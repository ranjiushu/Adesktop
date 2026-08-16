// FAB 空缺复现探针：无头 Chromium 测量展开后各子按钮的显示与位置
// 用法: node tools/ui/fab-gap-probe.js [bundle路径]
const { launch, openPage } = require('../../scripts/lib/browser')
const path = require('path')

const BUNDLE = process.argv[2] || path.join(__dirname, '..', '..', 'dist', 'desktop.bundle.html')
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function measureButtons(page, label) {
  const data = await page.evaluate(() => {
    const sd = document.getElementById('fab-speed-dial')
    const fab = document.getElementById('mode-switch-fab')
    const fabRect = fab.getBoundingClientRect()
    const out = {
      label: null,
      mode: sd.getAttribute('data-mode'),
      fab: { top: +fabRect.top.toFixed(1), bottom: +fabRect.bottom.toFixed(1), left: +fabRect.left.toFixed(1) },
      buttons: []
    }
    sd.querySelectorAll('.fab-child').forEach((b) => {
      const r = b.getBoundingClientRect()
      const cs = getComputedStyle(b)
      out.buttons.push({
        action: b.getAttribute('data-action'),
        display: cs.display,
        opacity: cs.opacity,
        transform: cs.transform,
        top: r.height ? +r.top.toFixed(1) : null,
        bottom: r.height ? +r.bottom.toFixed(1) : null,
        left: r.height ? +r.left.toFixed(1) : null,
        overlapFab: r.height > 0 && Math.abs(r.top - fabRect.top) < 1 && Math.abs(r.left - fabRect.left) < 1
      })
    })
    return out
  })
  data.label = label
  return data
}

;(async () => {
  const browser = await launch()
  const page = await openPage(browser, BUNDLE, { width: 412, height: 915, dsf: 2.75 })
  await sleep(600)

  // 场景 A：desktop 模式展开（剪贴板空 → paste 应被隐藏）
  await page.evaluate(() => App.fabSpeedDial.expand('desktop'))
  await sleep(400)
  const sceneA = await measureButtons(page, 'A: expand(desktop) 剪贴板空')

  // 收起
  await page.evaluate(() => App.fabSpeedDial.collapse())
  await sleep(300)

  // 场景 B：文件选中（setSelection(true)，无 viewer 选中）
  await page.evaluate(() => App.fabSpeedDial.setSelection(true))
  await sleep(400)
  const sceneB = await measureButtons(page, 'B: setSelection(true) 文件选中')

  await browser.close()

  console.log(JSON.stringify({ scenes: [sceneA, sceneB] }, null, 2))

  // 判读（可见性用 top!==null = rect 有布局框；computed display 对 display:none 祖先的
  // 后代返回自身值 flex，不可靠——与 _applySlots 的 offsetParent 判断同坑）
  console.log('\n=== 判读 ===')
  sceneA.buttons.forEach(b => {
    if (b.top !== null)
      console.log(`A ${b.action}: top=${b.top} (期望依次 -48/-92/-136/-180 递增)` )
  })
  const aVisible = sceneA.buttons.filter(b => b.top !== null)
  if (aVisible.length === 3 && aVisible[0].top === 723.5 && aVisible[1].top === 679.5 && aVisible[2].top === 635.5)
    console.log('[A] 检测: paste 隐藏后 3 按钮紧凑顶位(-48/-92/-136)，无 -180 空洞 [修复验证通过]')
  else console.log('[A] 检测: 场景 A 异常 ' + JSON.stringify(aVisible))
  sceneB.buttons.forEach(b => {
    if (b.top !== null)
      console.log(`B ${b.action}: top=${b.top} overlapFab=${b.overlapFab}`)
  })
  const bOverlap = sceneB.buttons.filter(b => b.overlapFab)
  if (bOverlap.length) console.log('[B] 检测: ' + bOverlap.map(b => b.action).join(',') + ' 与 FAB 重叠(无 translateY 位移规则)')
})().catch(e => { console.error(e); process.exit(1) })
