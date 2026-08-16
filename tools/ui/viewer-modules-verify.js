// Viewer 三模块 × 两状态验证：
//   1. text/parsed Viewer 态 = 3:4 竖版卡片 + 视觉中心展开（相机中心世界坐标）
//   2. media 图/视频 Viewer 态 = 原始比例（文件位置锚点）
//   3. audio Viewer 态 = 3:4 封面卡片（占位封面 + 原生 controls）
//   4. text 完整预览态 = reader 工具条（字号缩放 + 自动换行）
// 用法: node tools/ui/viewer-modules-verify.js
'use strict'
const path = require('path')
const { launch } = require('/skills/ui-verify/scripts/lib/browser.js')
const HTML = 'file://' + path.join('/workspace/Desktop', 'dist', 'desktop.bundle.html')
let failures = 0
function check(cond, msg) { if (cond) console.log('  [ok] ' + msg); else { console.error('  [fail] ' + msg); failures++ } }
async function main() {
  const browser = await launch()
  const page = await browser.newPage()
  await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2.75, hasTouch: true })
  await page.evaluateOnNewDocument(function () {
    // 静音 WAV data URI（1s 8kHz 8bit mono），供 audio 元素正常加载不触发 error
    function silentWav() {
      var sr = 8000, n = sr, buf = new Uint8Array(44 + n)
      function w32(o, v) { buf[o] = v & 255; buf[o+1] = (v >> 8) & 255; buf[o+2] = (v >> 16) & 255; buf[o+3] = (v >> 24) & 255 }
      function w16(o, v) { buf[o] = v & 255; buf[o+1] = (v >> 8) & 255 }
      function str(o, s) { for (var i = 0; i < s.length; i++) buf[o+i] = s.charCodeAt(i) }
      str(0, 'RIFF'); w32(4, 36 + n); str(8, 'WAVE'); str(12, 'fmt '); w32(16, 16)
      w16(20, 1); w16(22, 1); w32(24, sr); w32(28, sr); w16(32, 1); w16(34, 8)
      str(36, 'data'); w32(40, n)
      for (var j = 0; j < n; j++) buf[44 + j] = 128
      var bin = ''
      for (var k = 0; k < buf.length; k++) bin += String.fromCharCode(buf[k])
      return 'data:audio/wav;base64,' + btoa(bin)
    }
    var WAV = silentWav()
    var SVG_IMG = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#3b82f6"/></svg>')
    const FILES = {
      '': [
        { name: 'readme.md', isDir: false, size: 1, mtime: 0 },
        { name: 'note.txt', isDir: false, size: 1, mtime: 0 },
        { name: 'song.mp3', isDir: false, size: 1, mtime: 0 },
        { name: 'photo.png', isDir: false, size: 1, mtime: 0 }
      ]
    }
    const CONTENT = { 'readme.md': '# 标题\n\n正文', 'note.txt': '一行很长的文本内容用于验证自动换行与字号缩放\n第二行', 'song.mp3': '', 'photo.png': '' }
    function __ok(id, data) { window.__fbResolve(id, { ok: true, data: data }) }
    function __err(id, msg) { window.__fbResolve(id, { ok: false, error: msg }) }
    window.FileBridge = {
      rootInfo: function (cb) { __ok(cb, { rootName: 'm', mode: 'private', displayPath: '/' }) },
      list: function (p, cb) { __ok(cb, FILES[p || ''] || []) },
      read: function (p, cb) { if (p in CONTENT) __ok(cb, CONTENT[p]); else __err(cb, 'x') },
      resolveUri: function (p, cb) { __ok(cb, p.indexOf('.mp3') >= 0 ? WAV : SVG_IMG) },
      openExternal: function (p, cb) { __err(cb, 'x') },
      vibrate: function () {}, requestRootAccess: function () {}
    }
  })
  await page.goto(HTML, { waitUntil: 'networkidle0' })
  await page.waitForFunction(function () { return window.App && document.querySelectorAll('.desktop-icon').length === 4 }, { timeout: 10000 })

  console.log('═══ 1. 文本模块（parsed: readme.md）Viewer 态 = 3:4 + 视觉中心 ═══')
  await page.evaluate(function () { App.Desktop.openItem('readme.md') })
  await page.waitForFunction(function () { return document.querySelector('.viewer-card-canvas') }, { timeout: 5000 })
  let r1 = await page.evaluate(function () {
    const card = document.querySelector('.viewer-card-canvas')
    const rect = { x: parseFloat(card.style.left), y: parseFloat(card.style.top), w: parseFloat(card.style.width), h: parseFloat(card.style.height) }
    return { w: rect.w, h: rect.h, ratio: rect.w / rect.h }
  })
  check(Math.abs(r1.ratio - 3 / 4) < 0.02, '文本模块 Viewer 态卡片 = 3:4 竖版（宽:高 ≈ 3:4，实测 ' + r1.ratio.toFixed(3) + '）')

  console.log('═══ 2. 视觉中心锚点（相机中心世界坐标）═══')
  const r2 = await page.evaluate(function () {
    const vw = document.getElementById('viewer-layer').clientWidth
    const vh = document.getElementById('viewer-layer').clientHeight
    const cam = App.DesktopCamera.create(200, 300, 1)  // 相机左上角世界点 (200,300)
    const vc = App.InternalViewer.visualCenter(cam, vw, vh)
    const rect = App.InternalViewer.worldRect(vc, 300, 400)
    return { cx: vc.x, cy: vc.y, rectCenterX: rect.x + rect.w / 2, rectCenterY: rect.y + rect.h / 2 }
  })
  check(Math.abs(r2.cx - r2.rectCenterX) < 0.001 && Math.abs(r2.cy - r2.rectCenterY) < 0.001,
    '视觉中心 = 相机中心世界点，卡片中心对齐该锚点')

  console.log('═══ 3. 文本完整预览态 = reader 工具条 + 缩放 + 换行 ═══')
  await page.evaluate(function () { App.InternalViewer.closeAll() })
  await page.evaluate(function () { App.Desktop.openItem('note.txt') })
  await page.waitForFunction(function () { return document.querySelector('.viewer-pre') }, { timeout: 5000 })
  await page.evaluate(function () {
    const hit = App.InternalViewer.topmostAt(200, 400)
    if (hit) { App.InternalViewer.selectOnly(hit.id); hit.toFullscreen() }
  })
  await page.waitForFunction(function () { return document.querySelector('.viewer-card-fullscreen .viewer-pre') }, { timeout: 5000 })
  const r3 = await page.evaluate(function () {
    const tools = document.querySelectorAll('.viewer-tool')
    const pre = document.querySelector('.viewer-pre')
    const before = parseFloat(getComputedStyle(pre).fontSize)
    // 点 A+ 两次（+0.4 倍字号）
    document.querySelector('[data-act="zoom-in"]').click()
    document.querySelector('[data-act="zoom-in"]').click()
    const after = parseFloat(getComputedStyle(pre).fontSize)
    // 换行开关：默认 wrap（pre-wrap）→ 点一次变 pre
    const wrapBefore = pre.style.whiteSpace
    document.querySelector('[data-act="wrap"]').click()
    const wrapAfter = pre.style.whiteSpace
    return { tools: tools.length, before: before, after: after, wrapBefore: wrapBefore, wrapAfter: wrapAfter }
  })
  check(r3.tools === 3, '文本完整预览态显示 3 个 reader 工具（A-/A+/换行）')
  check(r3.after > r3.before, 'A+ 两次 → 字号放大（' + r3.before + ' → ' + r3.after + 'px）')
  check(r3.wrapBefore === 'pre-wrap' && r3.wrapAfter === 'pre', '换行开关：pre-wrap ↔ pre 切换')

  console.log('═══ 4. 音频模块 Viewer 态 = 3:4 封面卡片 ═══')
  await page.evaluate(function () { App.handleSystemBack() })  // 退出文本全屏
  await page.evaluate(function () { App.InternalViewer.closeAll() })
  await page.evaluate(function () { App.Desktop.openItem('song.mp3') })
  await page.waitForFunction(function () { return document.querySelector('.viewer-audio') }, { timeout: 5000 })
  const r4 = await page.evaluate(function () {
    const card = document.querySelector('.viewer-card-canvas')
    const cover = document.querySelector('.viewer-audio-cover')
    const controls = document.querySelector('.viewer-audio-controls')
    return {
      ratio: parseFloat(card.style.width) / parseFloat(card.style.height),
      hasCover: !!cover, hasIcon: !!document.querySelector('.viewer-audio-icon'),
      hasName: !!(document.querySelector('.viewer-audio-name') && document.querySelector('.viewer-audio-name').textContent === 'song.mp3'),
      hasControls: !!controls && controls.controls === true
    }
  })
  check(Math.abs(r4.ratio - 3 / 4) < 0.02, '音频 Viewer 态卡片 = 3:4（实测 ' + r4.ratio.toFixed(3) + '）')
  check(r4.hasCover && r4.hasIcon && r4.hasName && r4.hasControls, '音频封面卡片：占位封面(音乐图标+文件名) + 原生播放控制')

  console.log('═══ 5. media 图片 Viewer 态 = 原始比例 ═══')
  await page.evaluate(function () { App.InternalViewer.closeAll() })
  await page.evaluate(function () { App.Desktop.openItem('photo.png') })
  await page.waitForFunction(function () { return document.querySelector('.viewer-media-img') }, { timeout: 5000 })
  await new Promise(function (res) { setTimeout(res, 300) })  // 等 load 事件 + fitAspectRect
  const rImg = await page.evaluate(function () {
    const card = document.querySelector('.viewer-card-canvas')
    return { w: parseFloat(card.style.width), h: parseFloat(card.style.height), ratio: parseFloat(card.style.width) / parseFloat(card.style.height) }
  })
  check(Math.abs(rImg.ratio - 320 / 180) < 0.03, '图片 Viewer 态 = 原始比例（320:180 ≈ 1.78，实测 ' + rImg.ratio.toFixed(3) + '）')

  console.log('═══ 5b. media 文件名栏 = 覆盖式（选中显示名字不改变媒体缩放比例） ═══')
  const rImgSel = await page.evaluate(function () {
    const inst = App.InternalViewer.list()[0]
    const card = inst._card
    const header = card.querySelector('.viewer-header')
    const body = card.querySelector('.viewer-body')
    const img = card.querySelector('.viewer-media-img')
    const cardBefore = { w: parseFloat(card.style.width), h: parseFloat(card.style.height) }
    const imgBefore = { w: img.getBoundingClientRect().width, h: img.getBoundingClientRect().height }
    const headerBefore = getComputedStyle(header).display
    App.InternalViewer.selectOnly(inst.id)
    const hs = getComputedStyle(header)
    const hr = header.getBoundingClientRect()
    const br = body.getBoundingClientRect()
    const cr = card.getBoundingClientRect()
    return {
      cardBefore: cardBefore,
      imgBefore: imgBefore,
      headerBeforeHidden: headerBefore === 'none',
      headerDisplay: hs.display,
      headerPosition: hs.position,
      headerOnTopOfBody: hr.top < br.bottom - 1,        // header 覆盖在 body 内容之上
      headerAtCardBottom: Math.abs(hr.bottom - cr.bottom) < 2,
      cardAfter: { w: parseFloat(card.style.width), h: parseFloat(card.style.height) },
      imgAfter: { w: img.getBoundingClientRect().width, h: img.getBoundingClientRect().height },
      mediaClass: card.classList.contains('viewer-card-media')
    }
  })
  check(rImgSel.headerBeforeHidden, 'media 打开未选中 → 文件名栏隐藏')
  check(rImgSel.mediaClass, 'media 卡片带 viewer-card-media 标记类')
  check(rImgSel.headerDisplay !== 'none' && rImgSel.headerPosition === 'absolute',
    'media 选中 → 文件名栏显示且为 absolute 覆盖')
  check(rImgSel.headerOnTopOfBody && rImgSel.headerAtCardBottom, '文件名栏覆盖在卡片底部（盖住内容）')
  check(rImgSel.cardAfter.w === rImgSel.cardBefore.w && rImgSel.cardAfter.h === rImgSel.cardBefore.h,
    '选中显示文件名 → 卡片尺寸不变（不占位）')
  check(Math.abs(rImgSel.imgAfter.w - rImgSel.imgBefore.w) < 1 && Math.abs(rImgSel.imgAfter.h - rImgSel.imgBefore.h) < 1,
    '选中显示文件名 → 媒体缩放比例不变（320:180 保持）')

  console.log('═══ 5c. 文档类文件名栏 = 占位式（底部条，非覆盖） ═══')
  await page.evaluate(function () { App.InternalViewer.closeAll() })
  await page.evaluate(function () { App.Desktop.openItem('note.txt') })
  await page.waitForFunction(function () { return document.querySelector('.viewer-card-canvas') }, { timeout: 5000 })
  const rDocSel = await page.evaluate(function () {
    const inst = App.InternalViewer.list()[0]
    const card = inst._card
    const header = card.querySelector('.viewer-header')
    const body = card.querySelector('.viewer-body')
    App.InternalViewer.selectOnly(inst.id)
    const hs = getComputedStyle(header)
    const hr = header.getBoundingClientRect()
    const br = body.getBoundingClientRect()
    const cr = card.getBoundingClientRect()
    return {
      headerPosition: hs.position,
      headerBelowBody: Math.abs(hr.top - br.bottom) < 2,   // 占位式：header 顶部紧贴 body 底部
      headerAtCardBottom: Math.abs(hr.bottom - cr.bottom) < 2,
      mediaClass: card.classList.contains('viewer-card-media')
    }
  })
  check(rDocSel.headerPosition !== 'absolute', '文档类选中 → 文件名栏非 absolute（占位式）')
  check(rDocSel.headerBelowBody && rDocSel.headerAtCardBottom, '文档类文件名栏 = 底部条（body 上方占位，非覆盖）')
  check(!rDocSel.mediaClass, '文档类卡片无 viewer-card-media 标记类')

  console.log('═══ 6. 框选划过未选中 Viewer → 触发选中 ═══')
  await page.evaluate(function () { App.InternalViewer.closeAll() })
  await page.evaluate(function () { App.Desktop.openItem('note.txt') })
  await page.waitForFunction(function () { return document.querySelector('.viewer-card-canvas') }, { timeout: 5000 })
  await new Promise(function (res) { setTimeout(res, 200) })
  const card = await page.evaluate(function () {
    const b = document.querySelector('.viewer-card-canvas').getBoundingClientRect()
    return { left: b.left, top: b.top, w: b.width, h: b.height, right: b.right }
  })
  const before = await page.evaluate(function () { return App.InternalViewer.anySelected() })
  const client = await page.target().createCDPSession()
  const sy = card.top + card.h / 2
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: Math.max(0, card.left - 40), y: sy, id: 1 }] })
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: card.left + card.w / 2, y: sy, id: 1 }] })
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: card.right + 40, y: sy, id: 1 }] })
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await new Promise(function (res) { setTimeout(res, 200) })
  const after = await page.evaluate(function () { return App.InternalViewer.anySelected() })
  check(!before && after, '框选划过未选中 Viewer → 触发选中（' + before + ' → ' + after + '）')

  console.log('═══ 7. 纯函数三模块映射 ═══')
  const r5 = await page.evaluate(function () {
    return {
      md: App.InternalViewer.moduleFor('markdown'),
      txt: App.InternalViewer.moduleFor('text'),
      mp3: App.InternalViewer.moduleFor('audio'),
      img: App.InternalViewer.moduleFor('image'),
      portraitTxt: App.InternalViewer.cardIsPortrait('text'),
      portraitImg: App.InternalViewer.cardIsPortrait('image'),
      centerMd: App.InternalViewer.anchorIsCenter('markdown'),
      centerMp3: App.InternalViewer.anchorIsCenter('audio')
    }
  })
  check(r5.md === 'parsed' && r5.txt === 'text' && r5.mp3 === 'media' && r5.img === 'media',
    'moduleFor 三模块分派正确')
  check(r5.portraitTxt && !r5.portraitImg, 'cardIsPortrait: 文本 3:4 / 图片原始比例')
  check(r5.centerMd && !r5.centerMp3, 'anchorIsCenter: 解析文本视觉中心 / 音频文件位置')

  await browser.close()
  if (failures > 0) { console.error('[FAIL] ' + failures + ' 项失败'); process.exit(1) }
  console.log('[ok] 三模块 × 两状态验证通过')
}
main().catch(function (e) { console.error('[FAIL]', e.message); process.exit(1) })
