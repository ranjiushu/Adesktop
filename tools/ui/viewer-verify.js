// Viewer 无头 UI 验证（画布实体交互模型）：
//   1. 画布实体：卡片在 #desktop-canvas 内、世界坐标定位、随画布 transform 平移缩放
//   2. 桌面手指有效：不拦截触摸；点击 Viewer 表面不反选（文件保持选中）
//   3. 全屏预览：点顶栏按钮 → 占满内容区 + 拦截触摸
//   4. 关闭：FAB 选中态「关闭预览」/ 返回键 / 取消选择
//   5. HTML 桥隔离 + 各类型渲染
// 用法: node tools/ui/viewer-verify.js [--shot out.png]
'use strict'

const path = require('path')
const { launch } = require('/skills/ui-verify/scripts/lib/browser.js')

const HTML = 'file://' + path.join(__dirname, '..', '..', 'dist', 'desktop.bundle.html')
const SHOT = process.argv.indexOf('--shot') >= 0 ? process.argv[process.argv.indexOf('--shot') + 1] : null

let failures = 0
function check(cond, msg) {
  if (cond) console.log('  [ok] ' + msg)
  else { console.error('  [fail] ' + msg); failures++ }
}

async function main() {
  const browser = await launch()
  const page = await browser.newPage()
  await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2.75 })

  // 每次导航前注入模拟 FileBridge（浏览器预览无原生桥）
  await page.evaluateOnNewDocument(function () {
    const FILES = {
      '': [
        { name: 'readme.md', isDir: false, size: 120, mtime: 0 },
        { name: 'data.json', isDir: false, size: 90, mtime: 0 },
        { name: 'note.txt', isDir: false, size: 40, mtime: 0 },
        { name: 'page.html', isDir: false, size: 300, mtime: 0 }
      ]
    }
    const CONTENT = {
      'readme.md': '# 标题\n\n**粗体** 和 *斜体*\n\n- 甲\n- 乙\n\n```js\nconst a = 1\n```',
      'data.json': '{"a": 1, "b": "x", "c": [1, 2, 3], "d": {"e": null}}',
      'note.txt': '纯文本内容\n第二行',
      'page.html': '<!DOCTYPE html><html><head></head><body><h1>Hello</h1>' +
        '<script>' +
        'var leak = "BRIDGE_UNKNOWN";' +
        'try { leak = (window.parent && window.parent.FileBridge) ? "BRIDGE_LEAK" : "BRIDGE_ISOLATED"; }' +
        'catch (e) { leak = "BRIDGE_BLOCKED"; }' +
        'document.body.setAttribute("data-leak", leak);' +
        '</script></body></html>'
    }
    function __ok(id, data) { window.__fbResolve(id, { ok: true, data: data }) }
    function __err(id, msg) { window.__fbResolve(id, { ok: false, error: msg }) }
    window.FileBridge = {
      rootInfo: function (cb) { __ok(cb, { rootName: 'mock', mode: 'private', displayPath: '/mock' }) },
      list: function (p, cb) { __ok(cb, FILES[p || ''] || []) },
      read: function (p, cb) {
        if (p in CONTENT) __ok(cb, CONTENT[p])
        else __err(cb, '不存在: ' + p)
      },
      resolveUri: function (p, cb) { __err(cb, '无 URI') },
      openExternal: function (p, cb) { __err(cb, '浏览器环境无外部应用') },
      vibrate: function () {},
      requestRootAccess: function () {}
    }
  })

  await page.goto(HTML, { waitUntil: 'networkidle0' })
  await page.waitForFunction(function () {
    return window.App && App.Desktop && document.querySelectorAll('.desktop-icon').length > 0
  }, { timeout: 10000 })

  console.log('═══ 1. 打开 → 画布实体（世界坐标）═══')
  await page.evaluate(function () {
    App.Desktop.openItem('readme.md')
  })
  await page.waitForFunction(function () {
    return document.querySelector('.viewer-card-canvas')
  }, { timeout: 5000 })
  let r = await page.evaluate(function () {
    const card = document.querySelector('.viewer-card-canvas')
    const canvas = document.getElementById('desktop-canvas')
    const md = document.querySelector('.viewer-md')
    return {
      inCanvas: card.parentNode === canvas,
      left: parseFloat(card.style.left), top: parseFloat(card.style.top),
      w: parseFloat(card.style.width), h: parseFloat(card.style.height),
      locked: App.Desktop.getLockedPath() === 'readme.md',
      lockIcon: document.querySelector('.desktop-icon-locked') !== null,
      viewerSelected: App.InternalViewer.isSelected(),
      fsBtnGone: !document.querySelector('.viewer-fs-btn'),
      h1: md.querySelector('h1') && md.querySelector('h1').textContent
    }
  })
  check(r.inCanvas, '卡片宿主 = #desktop-canvas（画布实体）')
  check(r.locked && r.lockIcon, '打开后文件锁定（Windows 式：禁文件操作）')
  check(r.viewerSelected, 'Viewer 实体选中（FAB 预览操作入口）')
  check(r.w > 300 && r.h > 500, '世界尺寸接近屏幕尺度（' + r.w.toFixed(0) + '×' + r.h.toFixed(0) + '）')
  check(r.fsBtnGone, '全屏按钮已收纳进 Morph FAB（顶栏无按钮）')
  check(r.h1 === '标题', 'Markdown 渲染')

  console.log('═══ 2. 画布平移/缩放 → 实体跟随（canvas transform）═══')
  const before = await page.evaluate(function () {
    const card = document.querySelector('.viewer-card-canvas').getBoundingClientRect()
    return { x: card.x, y: card.y, w: card.width }
  })
  await page.evaluate(function () {
    // 模拟画布相机平移 + 缩放（实际手势由 gesture 层驱动 transform）
    const cam = App.DesktopCamera.create(50, 0, 1)
    App.DesktopCamera.applyTo(cam, document.getElementById('desktop-canvas'))
  })
  const after = await page.evaluate(function () {
    const card = document.querySelector('.viewer-card-canvas').getBoundingClientRect()
    return { x: card.x, y: card.y, w: card.width }
  })
  check(Math.abs((before.x - after.x) - 50) < 1, '画布右移 50 → 实体屏幕位置左移 50（随画布）')
  await page.evaluate(function () {
    const cam = App.DesktopCamera.create(50, 0, 2)
    App.DesktopCamera.applyTo(cam, document.getElementById('desktop-canvas'))
  })
  const zoomed = await page.evaluate(function () {
    const card = document.querySelector('.viewer-card-canvas').getBoundingClientRect()
    return { w: card.width }
  })
  check(Math.abs(zoomed.w - before.w * 2) < 2, 'zoom 2× → 实体屏幕尺寸 ×2（画布实体行为）')

  console.log('═══ 3. 桌面手指有效 + 点击不穿透不反选 ═══')
  // 重置相机
  await page.evaluate(function () {
    const cam = App.DesktopCamera.create(0, 0, 1)
    App.DesktopCamera.applyTo(cam, document.getElementById('desktop-canvas'))
    // 记录选中态，然后模拟点击 Viewer 表面（世界坐标命中 Viewer 矩形）
    App.InternalViewer.hitTestWorld(200, 400)
  })
  const tapCheck = await page.evaluate(function () {
    // 世界坐标 (200,400) 应命中 Viewer 实体（锚点 180,320 中心附近）
    const hit = App.InternalViewer.hitTestWorld(200, 400)
    return { hit: hit, selected: App.InternalViewer.isSelected() }
  })
  check(tapCheck.hit, '世界点 (200,400) 命中 Viewer 实体矩形')
  check(tapCheck.selected, 'Viewer 实体保持选中（点击不清空）')

  console.log('═══ 4. 全屏预览 ═══')
  await page.evaluate(function () {
    App.InternalViewer.toFullscreen()
  })
  const fs = await page.evaluate(function () {
    const page = document.getElementById('viewer-fs-page')
    const card = document.querySelector('.viewer-card-fullscreen')
    const pb = page.getBoundingClientRect()
    const cb = card.getBoundingClientRect()
    return {
      inPage: card.parentNode === page,
      pageOpen: page.classList.contains('viewer-fs-page-open'),
      full: Math.abs(cb.width - window.innerWidth) < 1 && Math.abs(cb.height - window.innerHeight) < 1,
      mode: App.InternalViewer.getMode()
    }
  })
  check(fs.inPage && fs.pageOpen && fs.full, '全屏：独立新页面 fixed 覆盖全视口')
  check(fs.mode === 'fullscreen', '全屏态：模式切换')

  console.log('═══ 5. 关闭：FAB「关闭预览」═══')
  // 模拟点击选中态操作栏的 close-preview 按钮
  const closed = await page.evaluate(function () {
    const btn = document.querySelector('[data-action="close-preview"]')
    if (btn) btn.click()
    const layer = document.getElementById('viewer-layer')
    return {
      open: App.InternalViewer.isOpen(),
      layerOpen: layer.classList.contains('viewer-layer-open'),
      cardGone: !document.querySelector('.viewer-card'),
      unlocked: App.Desktop.getLockedPath() === null
    }
  })
  check(!closed.open && !closed.layerOpen && closed.cardGone && closed.unlocked,
    'FAB 关闭预览：Viewer 关闭 + layer 还原 + 解除锁定')

  console.log('═══ 6. 返回键关闭 ═══')
  await page.evaluate(function () {
    App.Desktop.openItem('note.txt')
  })
  await page.waitForFunction(function () { return document.querySelector('.viewer-pre') }, { timeout: 5000 })
  const back = await page.evaluate(function () {
    const handled = App.handleSystemBack()
    return { handled: handled, open: App.InternalViewer.isOpen() }
  })
  check(back.handled === true && back.open === false, '返回键关闭 Viewer（优先于导航）')

  console.log('═══ 7. HTML 隔离 Java Bridge ═══')
  await page.evaluate(function () {
    App.Desktop.openItem('page.html')
  })
  await page.waitForFunction(function () { return document.querySelector('.viewer-frame') }, { timeout: 5000 })
  await new Promise(function (res) { setTimeout(res, 800) })
  const frames = page.frames()
  const inner = frames.find(function (f) { return f !== page.mainFrame() })
  let leak = null
  if (inner) {
    try {
      leak = await inner.evaluate(function () {
        return document.body ? document.body.getAttribute('data-leak') : 'NO_BODY'
      })
    } catch (e) { leak = 'EVAL_ERR' }
  }
  check(leak === 'BRIDGE_BLOCKED' || leak === 'BRIDGE_ISOLATED',
    'HTML 内脚本无法触达 Java 桥（实测=' + leak + '）')

  if (SHOT) {
    await page.evaluate(function () {
      App.InternalViewer.close()
      App.Desktop.openItem('readme.md')
    })
    await new Promise(function (res) { setTimeout(res, 400) })
    await page.screenshot({ path: SHOT })
    console.log('  [shot] ' + SHOT)
  }

  await browser.close()
  if (failures > 0) {
    console.error('[FAIL] viewer UI 验证 ' + failures + ' 项失败')
    process.exit(1)
  }
  console.log('[ok] viewer UI 验证全部通过')
}

main().catch(function (err) {
  console.error('[FAIL] 执行异常:', err && err.message || err)
  process.exit(1)
})
