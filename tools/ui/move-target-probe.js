// 移动功能 E2E 探针：FAB「移动」→ 目标选择器 → 守卫 → 导航 → 执行
// 注意：mock 数据必须内联进 page.evaluate（页面上下文访问不到 Node 变量）
// 用法: node tools/ui/move-target-probe.js
const { launch, openPage } = require('../../scripts/lib/browser')
const path = require('path')
const BUNDLE = path.join(__dirname, '..', '..', 'dist', 'adesktop.bundle.html')
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const FS_JSON = JSON.stringify({
  '': [{ name: 'docs', isDir: true }, { name: 'photos', isDir: true }, { name: 'readme.txt', isDir: false }],
  'docs': [{ name: 'notes', isDir: true }, { name: 'report.txt', isDir: false }],
  'docs/notes': [{ name: 'deep.md', isDir: false }],
  'photos': [{ name: 'a.jpg', isDir: false }]
})

const MOCK_SCRIPT = `
  (function (FS) {
    window.__moves = []
    App.FileAPI.list = function (p) { return Promise.resolve(FS[p || ''] || []) }
    App.FileAPI.move = function (src, dst) { window.__moves.push([src, dst]); return Promise.resolve() }
    App.FileAPI.copy = function () { return Promise.resolve() }
    App.Desktop.getCurPath = function () { return 'docs' }
    App.Desktop.getSelectionEntries = function () { return [{ path: 'docs/report.txt', isDir: false }] }
    App.Desktop.getSelectionNames = function () { return ['report.txt'] }
    App.Desktop.getLockedPaths = function () { return [] }
    App.Desktop.clearSelection = function () {}
    App.Desktop.refresh = function () {}
    App.Desktop.applyMoves = function () {}
    App.Clipboard.planPaste = function (cb, items, curPath) {
      var taken = (items || []).map(function (it) { return it.name })
      return cb.entries.map(function (en) {
        var base = en.path.split('/').pop()
        var dstName = base
        var n = 2
        while (taken.indexOf(dstName) >= 0) {
          var dot = base.lastIndexOf('.')
          dstName = dot > 0 ? base.slice(0, dot) + ' ' + n + base.slice(dot) : base + ' ' + n
          n++
        }
        taken.push(dstName)
        return { src: en.path, dst: curPath ? curPath + '/' + dstName : dstName }
      })
    }
    App.Clipboard.clear = function () {}
  })(${FS_JSON})
`

;(async () => {
  const browser = await launch()
  const page = await openPage(browser, BUNDLE, { width: 412, height: 915, dsf: 2.75 })
  await sleep(600)

  await page.evaluate(MOCK_SCRIPT)
  await sleep(200)

  let PASS = 0, FAIL = 0
  const pass = (l, d) => { console.log('  [PASS] ' + l + (d ? ' — ' + d : '')); PASS++ }
  const fail = (l, d) => { console.log('  [FAIL] ' + l + (d ? ' — ' + d : '')); FAIL++ }

  // 1. FAB selection 菜单含「移动」按钮
  await page.evaluate(() => App.fabSpeedDial.setSelection(true))
  await sleep(400)
  const hasMove = await page.evaluate(() => {
    const b = document.querySelector('.fab-child[data-action="move"]')
    return { visible: b && b.offsetParent !== null, top: b ? Math.round(b.getBoundingClientRect().top) : null }
  })
  if (hasMove.visible) pass('FAB selection 菜单显示「移动」按钮 (top=' + hasMove.top + ')')
  else fail('FAB 未显示「移动」按钮')

  // 2. 点击移动 → 选择器打开（初始=docs → notes 文件夹 + 按钮禁用「已在目标位置」）
  await page.evaluate(() => {
    const btn = document.querySelector('.fab-child[data-action="move"]')
    btn.dispatchEvent(new Event('click', { bubbles: true }))
  })
  await sleep(400)
  const picker = await page.evaluate(() => {
    const ov = document.getElementById('move-target-overlay')
    const crumbs = Array.from(document.querySelectorAll('.move-crumb')).map(c => c.textContent)
    const dirs = Array.from(document.querySelectorAll('.move-dir-row')).map(r => r.textContent.trim())
    const btn = document.getElementById('move-target-confirm')
    return {
      open: ov.classList.contains('dialog-overlay-visible'),
      crumbs, dirs,
      confirmText: btn.textContent, confirmInvalid: btn.classList.contains('move-confirm-invalid')
    }
  })
  if (picker.open && picker.crumbs.join('/') === '根目录/docs' && picker.dirs.join(',') === 'notes')
    pass('选择器打开，面包屑=根目录/docs，列表=notes')
  else fail('选择器状态不符: ' + JSON.stringify(picker))
  if (picker.confirmInvalid && picker.confirmText === '确认')
    pass('守卫: 源所在目录 → 确认按钮变灰，文字固定「确认」')
  else fail('守卫失效: ' + JSON.stringify(picker))
  // 2b. 点击变灰的确认 → 吐司提示原因（不静默）
  await page.evaluate(() => {
    document.getElementById('move-target-confirm').dispatchEvent(new Event('click', { bubbles: true }))
  })
  await sleep(300)
  const toastMsg = await page.evaluate(() => {
    const t = document.querySelector('.toast')
    return t ? t.textContent : ''
  })
  if (toastMsg.indexOf('已在目标位置') >= 0) pass('点击变灰确认 → 吐司「已在目标位置」')
  else fail('吐司提示缺失: ' + JSON.stringify(toastMsg))

  // 3. 进入 notes 子目录 → 按钮恢复「移动到此处」
  await page.evaluate(() => {
    const row = document.querySelector('.move-dir-row')
    row.dispatchEvent(new Event('click', { bubbles: true }))
  })
  await sleep(400)
  const sub = await page.evaluate(() => {
    const crumbs = Array.from(document.querySelectorAll('.move-crumb')).map(c => c.textContent)
    const btn = document.getElementById('move-target-confirm')
    return { crumbs: crumbs.join('/'), confirmText: btn.textContent, confirmInvalid: btn.classList.contains('move-confirm-invalid') }
  })
  if (sub.crumbs === '根目录/docs/notes' && !sub.confirmInvalid && sub.confirmText === '确认')
    pass('进入 notes → 面包屑更新，确认按钮恢复可移动态（文字固定「确认」）')
  else fail('子目录导航失败: ' + JSON.stringify(sub))

  // 4. 在 notes（docs 子目录，场景 3 已进入）直接确认 → 移动执行（mock move 记录调用）
  const subConfirm = await page.evaluate(() => {
    const btn = document.getElementById('move-target-confirm')
    return { text: btn.textContent, disabled: btn.disabled }
  })
  if (subConfirm.text === '确认') pass('确认按钮文字固定「确认」')
  else fail('确认按钮文字异常: ' + JSON.stringify(subConfirm))
  await page.evaluate(() => {
    document.getElementById('move-target-confirm').dispatchEvent(new Event('click', { bubbles: true }))
  })
  await sleep(500)
  const moved = await page.evaluate(() => {
    return { moves: window.__moves, moveTargetOpen: App.MoveTarget.isOpen() }
  })
  const closedAfterMove = await page.evaluate(() => {
    const ov = document.getElementById('move-target-overlay')
    return !ov.classList.contains('dialog-overlay-visible')
  })
  if (moved.moves.length === 1 && moved.moves[0][0] === 'docs/report.txt' && moved.moves[0][1] === 'docs/notes/report.txt')
    pass('执行移动: FileAPI.move 已调用 (docs/report.txt → docs/notes/report.txt)')
  else fail('移动执行异常: ' + JSON.stringify(moved))
  if (closedAfterMove) pass('确认后选择器自动关闭')
  else fail('确认后选择器未关闭, MoveTarget.isOpen=' + moved.moveTargetOpen)

  // 5. 循环移动守卫：源是文件夹 docs，目标 = docs 自身 → 按钮禁用
  //    先等场景 4 的「已移动 1 项」toast（1800ms）消失，避免队列残留干扰断言
  await sleep(2000)
  await page.evaluate(() => {
    App.Desktop.getCurPath = function () { return '' }
    App.Desktop.getSelectionEntries = function () { return [{ path: 'docs', isDir: true }] }
    App.Desktop.getSelectionNames = function () { return ['docs'] }
    App.Desktop.hasSelection = function () { return true }
    window.__moves = []
    App.fabSpeedDial.setSelection(true)
  })
  await sleep(400)
  await page.evaluate(() => {
    const btn = document.querySelector('.fab-child[data-action="move"]')
    btn.dispatchEvent(new Event('click', { bubbles: true }))
  })
  await sleep(400)
  await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll('.move-dir-row')).find(r => r.textContent.trim() === 'docs')
    if (row) row.dispatchEvent(new Event('click', { bubbles: true }))
  })
  await sleep(400)
  const guardState = await page.evaluate(() => {
    const btn = document.getElementById('move-target-confirm')
    return { text: btn.textContent, invalid: btn.classList.contains('move-confirm-invalid') }
  })
  if (guardState.invalid && guardState.text === '确认')
    pass('守卫: 源=docs → 目标=docs（自身）确认按钮变灰')
  else fail('循环移动守卫失效: ' + JSON.stringify(guardState))
  await page.evaluate(() => {
    document.getElementById('move-target-confirm').dispatchEvent(new Event('click', { bubbles: true }))
  })
  await sleep(300)
  const toastMsg2 = await page.evaluate(() => {
    const t = document.querySelector('.toast')
    return t ? t.textContent : ''
  })
  if (toastMsg2.indexOf('不能移动到自身或子文件夹') >= 0) pass('点击变灰确认 → 吐司「不能移动到自身或子文件夹」')
  else fail('循环移动吐司缺失: ' + JSON.stringify(toastMsg2))

  // 6. 取消 → 弹层关闭；FAB 收起（case 'move' 让位给选择器）但选中数据保持；
  //    短按 FAB 应重新唤起 selection 操作栏（main.js 有选中 → setSelection(true)）
  await page.evaluate(() => {
    document.getElementById('move-target-cancel').dispatchEvent(new Event('click', { bubbles: true }))
  })
  await sleep(300)
  const closed = await page.evaluate(() => {
    const ov = document.getElementById('move-target-overlay')
    return {
      closed: !ov.classList.contains('dialog-overlay-visible'),
      fabState: App.fabSpeedDial.getState().mode,      // 应为 collapsed（case 'move' 已收起）
      selStill: App.Desktop.getSelectionEntries().length === 1 // 选中数据保持
    }
  })
  if (closed.closed && closed.fabState === null && closed.selStill)
    pass('取消 → 选择器关闭，选中数据保持（FAB 已收起）')
  else fail('取消清理异常: ' + JSON.stringify(closed))
  // 模拟短按 FAB（与 main.js 绑定同一逻辑）：有选中 → 唤起 selection 菜单
  await page.evaluate(() => {
    const fab = document.getElementById('mode-switch-fab')
    fab.dispatchEvent(new Event('click', { bubbles: true }))
  })
  await sleep(400)
  const revived = await page.evaluate(() => {
    const b = document.querySelector('.fab-child[data-action="move"]')
    return {
      mode: App.fabSpeedDial.getState().mode,
      moveVisible: b && b.offsetParent !== null
    }
  })
  if (revived.mode === 'selection' && revived.moveVisible)
    pass('短按 FAB → 重新唤起 selection 菜单（移动按钮可见）')
  else fail('FAB 重唤失败: ' + JSON.stringify(revived))

  await browser.close()
  console.log(`\n结果: ${PASS} 通过, ${FAIL} 失败`)
  process.exit(FAIL ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
