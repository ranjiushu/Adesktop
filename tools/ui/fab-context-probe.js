// FAB 上下文感知探针：多场景（viewer 选中 / 回收站守卫 / 剪贴板）验证按钮显隐与槽位紧凑
// 用法: node tools/ui/fab-context-probe.js
const { launch, openPage } = require('../../scripts/lib/browser')
const path = require('path')

const BUNDLE = path.join(__dirname, '..', '..', 'dist', 'adesktop.bundle.html')
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function snapshot(page) {
  return page.evaluate(() => {
    const sd = document.getElementById('fab-speed-dial')
    const fab = document.getElementById('mode-switch-fab')
    const fabTop = fab.getBoundingClientRect().top
    return {
      state: App.fabSpeedDial.getState(),
      buttons: Array.from(sd.querySelectorAll('.fab-child')).filter(b => b.offsetParent !== null)
        .map(b => ({
          action: b.getAttribute('data-action'),
          top: +b.getBoundingClientRect().top.toFixed(1),
          overlapFab: Math.abs(b.getBoundingClientRect().top - fabTop) < 1
        }))
    }
  })
}

;(async () => {
  const browser = await launch()
  const page = await openPage(browser, BUNDLE, { width: 412, height: 915, dsf: 2.75 })
  await sleep(600)
  const results = {}

  // 场景 C：Viewer 实体选中 → 只显示 全屏预览/关闭预览
  await page.evaluate(() => {
    App.InternalViewer.anySelected = () => true
    App.InternalViewer.selectedInstance = () => ({ toFullscreen: () => {} })
    App.Desktop.getSelectionNames = () => ['viewer-entity']
    App.fabSpeedDial.setSelection(true)
  })
  await sleep(400)
  results.viewerSel = await snapshot(page)

  await page.evaluate(() => App.fabSpeedDial.setSelection(false)); await sleep(250)

  // 场景 D：选中含回收站（selHasTrash）→ 只留 打开
  await page.evaluate(() => {
    App.InternalViewer.anySelected = () => false
    App.Desktop.getSelectionNames = () => ['.trash']
    App.Desktop.isTrashPath = (n) => n === '.trash'
    App.Desktop.inTrash = () => false
    App.fabSpeedDial.setSelection(true)
  })
  await sleep(400)
  results.trashSel = await snapshot(page)

  await page.evaluate(() => App.fabSpeedDial.setSelection(false)); await sleep(250)

  // 场景 E：回收站视图内（inTrash）→ 禁 剪切/重命名/删除，保留 打开/复制
  await page.evaluate(() => {
    App.InternalViewer.anySelected = () => false
    App.Desktop.getSelectionNames = () => ['/trash/a.txt']
    App.Desktop.isTrashPath = () => false
    App.Desktop.inTrash = () => true
    App.fabSpeedDial.setSelection(true)
  })
  await sleep(400)
  results.inTrash = await snapshot(page)

  await page.evaluate(() => App.fabSpeedDial.setSelection(false)); await sleep(250)

  // 场景 F：desktop 模式 + 剪贴板有内容 → paste 显示，4 按钮紧凑
  await page.evaluate(() => {
    App.Clipboard.has = () => true
    App.fabSpeedDial.expand('desktop')
  })
  await sleep(400)
  results.desktopWithClip = await snapshot(page)

  await browser.close()
  console.log(JSON.stringify(results, null, 2))

  // 判读
  const assert = (label, cond, detail) => {
    console.log((cond ? '[PASS] ' : '[FAIL] ') + label + (detail ? ' — ' + detail : ''))
    if (!cond) process.exitCode = 1
  }
  const actions = (r) => r.buttons.map(b => b.action + '@' + b.top).join(', ')
  const tops = (r) => r.buttons.map(b => b.top)
  const fabTop = 771.5
  const expectSlots = (r, n) => {
    // 槽位位移 = -48 - 44*i（slot-1: -48, slot-2: -92, slot-3: -136 ...），间距 44px
    return r.buttons.length === n && r.buttons.every((b, i) => {
      const expect = fabTop - 48 - 44 * i
      return Math.abs(b.top - expect) < 1.5
    })
  }

  assert('C viewer选中: 按钮=全屏预览/关闭预览', actions(results.viewerSel) === 'fullscreen-preview@' + (fabTop - 48).toFixed(1) + ', close-preview@' + (fabTop - 92).toFixed(1), actions(results.viewerSel))
  assert('C viewer选中: 槽位紧凑无空缺', expectSlots(results.viewerSel, 2), JSON.stringify(tops(results.viewerSel)))
  assert('D 回收站选中: 按钮=仅打开', actions(results.trashSel) === 'open@' + (fabTop - 48).toFixed(1), actions(results.trashSel))
  assert('D 回收站选中: 槽位紧凑无空缺', expectSlots(results.trashSel, 1), JSON.stringify(tops(results.trashSel)))
  assert('E 回收站内: 无 剪切/重命名/删除', !results.inTrash.buttons.some(b => ['cut', 'rename', 'delete'].includes(b.action)), actions(results.inTrash))
  assert('E 回收站内: 槽位紧凑无空缺', expectSlots(results.inTrash, 2), JSON.stringify(tops(results.inTrash)))
  assert('F desktop+剪贴板: 按钮=4 个(含粘贴)', results.desktopWithClip.buttons.length === 4 && results.desktopWithClip.buttons.some(b => b.action === 'paste'), actions(results.desktopWithClip))
  assert('F desktop+剪贴板: 槽位紧凑无空缺', expectSlots(results.desktopWithClip, 4), JSON.stringify(tops(results.desktopWithClip)))
  assert('全部场景无按钮叠 FAB', [results.viewerSel, results.trashSel, results.inTrash, results.desktopWithClip].every(r => !r.buttons.some(b => b.overlapFab)), '')
})().catch(e => { console.error(e); process.exit(1) })
