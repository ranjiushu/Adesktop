// Viewer 无头 UI 验证：注入模拟 FileBridge → 打开各类文件 → 断言渲染/锚定/隔离/关闭恢复
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
        { name: 'page.html', isDir: false, size: 300, mtime: 0 },
        { name: 'pic.png', isDir: false, size: 999, mtime: 0 }
      ]
    }
    const CONTENT = {
      'readme.md': '# 标题\n\n**粗体** 和 *斜体*\n\n- 甲\n- 乙\n\n```js\nconst a = 1\n```',
      'data.json': '{"a": 1, "b": "x", "c": [1, 2, 3], "d": {"e": null}}',
      'note.txt': '纯文本内容\n第二行',
      'page.html': '<!DOCTYPE html><html><head></head><body><h1 id="t">Hello</h1>' +
        '<script>' +
        'var leak = "BRIDGE_UNKNOWN";' +
        'try { leak = (window.parent && window.parent.FileBridge) ? "BRIDGE_LEAK" : "BRIDGE_ISOLATED"; }' +
        'catch (e) { leak = "BRIDGE_BLOCKED"; }' +
        'document.body.setAttribute("data-leak", leak);' +
        '</script></body></html>'
    }
    const URIS = { 'pic.png': 'file:///mock/pic.png' }
    function __ok(id, data) { window.__fbResolve(id, { ok: true, data: data }) }
    function __err(id, msg) { window.__fbResolve(id, { ok: false, error: msg }) }
    window.FileBridge = {
      rootInfo: function (cb) { __ok(cb, { rootName: 'mock', mode: 'private', displayPath: '/mock' }) },
      list: function (p, cb) { __ok(cb, FILES[p || ''] || []) },
      read: function (p, cb) {
        if (p in CONTENT) __ok(cb, CONTENT[p])
        else __err(cb, '不存在: ' + p)
      },
      resolveUri: function (p, cb) {
        if (p in URIS) __ok(cb, URIS[p])
        else __err(cb, '无 URI: ' + p)
      },
      openExternal: function (p, cb) { __err(cb, '浏览器环境无外部应用') },
      vibrate: function () {},
      requestRootAccess: function () {}
    }
  })

  await page.goto(HTML, { waitUntil: 'networkidle0' })
  await page.waitForFunction(function () {
    return window.App && App.Desktop && document.querySelectorAll('.desktop-icon').length > 0
  }, { timeout: 10000 })

  console.log('═══ 1. Markdown（desktop 锚点模式）═══')
  await page.evaluate(function () {
    App.FileOpener.open({ name: 'readme.md', path: 'readme.md' }, { wx: 180, wy: 320 })
  })
  await page.waitForFunction(function () {
    return document.querySelector('.viewer-md h1')
  }, { timeout: 5000 })
  let r = await page.evaluate(function () {
    const layer = document.getElementById('viewer-layer')
    const lb = layer.getBoundingClientRect()
    const c = document.querySelector('.viewer-card').getBoundingClientRect()
    const md = document.querySelector('.viewer-md')
    return {
      x: c.x - lb.x, y: c.y - lb.y, w: c.width, h: c.height,
      layerOpen: layer.classList.contains('viewer-layer-open'),
      ariaHidden: layer.getAttribute('aria-hidden'),
      h1: md.querySelector('h1') && md.querySelector('h1').textContent,
      strong: md.querySelector('strong') && md.querySelector('strong').textContent,
      liCount: md.querySelectorAll('li').length,
      pre: md.querySelector('pre') && md.querySelector('pre').textContent.trim()
    }
  })
  check(Math.abs(r.x - (180 - r.w / 2)) < 1 && Math.abs(r.y - (320 - r.h / 2)) < 1,
    '卡片以锚点 (180,320) 为中心定位（layer 局部坐标）')
  check(r.w >= 380 && r.w <= 412 && r.h > 600,
    '卡片尺寸接近屏幕（宽≈' + r.w.toFixed(0) + ' 高≈' + r.h.toFixed(0) + '）')
  check(r.layerOpen && r.ariaHidden === 'false', 'layer 打开态（pointer-events 接管）')
  check(r.h1 === '标题' && r.strong === '粗体' && r.liCount === 2 && r.pre === 'const a = 1',
    'Markdown 渲染：h1/粗体/列表/代码块')

  console.log('═══ 2. 画布平移跟随 ═══')
  const before = await page.evaluate(function () {
    return document.querySelector('.viewer-card').getBoundingClientRect().x
  })
  await page.evaluate(function () {
    // 模拟相机右移 40px：卡片应左移 40（随文件移动）
    App.InternalViewer.syncCamera({ x: 40, y: 0, zoom: 1 })
  })
  const after = await page.evaluate(function () {
    return document.querySelector('.viewer-card').getBoundingClientRect().x
  })
  check(Math.abs((before - after) - 40) < 1, '相机右移 40 → 卡片左移 40（跟随锚点）')

  console.log('═══ 3. 缩放不改变尺寸 ═══')
  const size1 = await page.evaluate(function () {
    return { w: document.querySelector('.viewer-card').getBoundingClientRect().width,
             h: document.querySelector('.viewer-card').getBoundingClientRect().height }
  })
  await page.evaluate(function () {
    App.InternalViewer.syncCamera({ x: 40, y: 0, zoom: 2 })
  })
  const size2 = await page.evaluate(function () {
    return { w: document.querySelector('.viewer-card').getBoundingClientRect().width,
             h: document.querySelector('.viewer-card').getBoundingClientRect().height }
  })
  check(Math.abs(size1.w - size2.w) < 1 && Math.abs(size1.h - size2.h) < 1,
    'zoom 2× 后尺寸不变（不随世界缩放）')

  console.log('═══ 4. 关闭恢复 ═══')
  await page.evaluate(function () { App.InternalViewer.close() })
  const closed = await page.evaluate(function () {
    const layer = document.getElementById('viewer-layer')
    return {
      open: App.InternalViewer.isOpen(),
      layerOpen: layer.classList.contains('viewer-layer-open'),
      ariaHidden: layer.getAttribute('aria-hidden'),
      bodyEmpty: !layer.querySelector('.viewer-body').innerHTML
    }
  })
  check(!closed.open && !closed.layerOpen && closed.ariaHidden === 'true' && closed.bodyEmpty,
    '关闭后：isOpen=false / layer 隐藏 / 内容清空')

  console.log('═══ 5. JSON 树 ═══')
  await page.evaluate(function () {
    App.FileOpener.open({ name: 'data.json', path: 'data.json' }, { wx: 200, wy: 400 })
  })
  await page.waitForFunction(function () {
    return document.querySelector('.viewer-json')
  }, { timeout: 5000 })
  const j = await page.evaluate(function () {
    const tree = document.querySelector('.viewer-json')
    return {
      details: tree.querySelectorAll('details').length,
      summaries: Array.prototype.map.call(tree.querySelectorAll('summary'), function (s) { return s.textContent }),
      stringVal: tree.querySelector('.viewer-json-string') ? tree.querySelector('.viewer-json-string').textContent : ''
    }
  })
  check(j.details >= 2 && j.summaries.some(function (s) { return s.indexOf('Array[3]') >= 0 }),
    'JSON 树：对象/数组可折叠节点')
  check(j.stringVal === '"x"', 'JSON 标量值渲染')

  console.log('═══ 6. HTML 隔离 Java Bridge（安全）═══')
  await page.evaluate(function () {
    App.InternalViewer.close()
    App.FileOpener.open({ name: 'page.html', path: 'page.html' }, { wx: 200, wy: 400 })
  })
  await page.waitForFunction(function () {
    return document.querySelector('.viewer-frame')
  }, { timeout: 5000 })
  await new Promise(function (res) { setTimeout(res, 800) })   // 等 iframe 内脚本执行
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
    'HTML 内脚本无法触达 Java 桥（sandbox 隔离，实测=' + leak + '）')

  console.log('═══ 7. TXT 文本 ═══')
  await page.evaluate(function () {
    App.InternalViewer.close()
    App.FileOpener.open({ name: 'note.txt', path: 'note.txt' }, { wx: 200, wy: 400 })
  })
  await page.waitForFunction(function () {
    return document.querySelector('.viewer-pre')
  }, { timeout: 5000 })
  const txt = await page.evaluate(function () {
    return document.querySelector('.viewer-pre').textContent
  })
  check(txt.indexOf('纯文本内容') >= 0 && txt.indexOf('第二行') >= 0, 'TXT 纯文本渲染')

  if (SHOT) {
    await page.evaluate(function () {
      App.InternalViewer.close()
      App.FileOpener.open({ name: 'readme.md', path: 'readme.md' }, { wx: 206, wy: 450 })
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
