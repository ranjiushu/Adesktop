// 回收站安全删除验证：rootInfo 返回 trashName → 根目录渲染回收站图标（🗑️）
// → deleteSelection 移入 .trash（copy+del 源，文件从根目录消失、回收站内出现）
// → 进入回收站（inTrash）查看被删文件。不做还原/彻底删除。
'use strict'
const path = require('path')
const { launch } = require('/skills/ui-verify/scripts/lib/browser.js')
const HTML = 'file://' + path.join('/workspace/Desktop', 'dist', 'adesktop.bundle.html')
let failures = 0
function check(cond, msg) {
  if (cond) console.log('  [ok] ' + msg)
  else { console.error('  [fail] ' + msg); failures++ }
}

async function main() {
  const browser = await launch()
  const page = await browser.newPage()
  await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2.75 })
  await page.evaluateOnNewDocument(function () {
    // 内存文件系统（可变）：copy/del 真实改 FILES，refresh 后渲染反映真实状态
    const FILES = {
      '': [
        { name: '.trash', isDir: true, size: 0, mtime: 1 },
        { name: 'a.txt', isDir: false, size: 10, mtime: 2 },
        { name: 'docs', isDir: true, size: 0, mtime: 3 }
      ],
      '.trash': [],
      'docs': [{ name: 'b.txt', isDir: false, size: 5, mtime: 4 }]
    }
    function __ok(id, data) { window.__fbResolve(id, { ok: true, data: data }) }
    function __err(id, msg) { window.__fbResolve(id, { ok: false, error: msg }) }
    function parentOf(p) { return p.split('/').slice(0, -1).join('/') }
    function nameOf(p) { return p.split('/').pop() }
    window.FileBridge = {
      rootInfo: function (cb) {
        __ok(cb, { rootName: 'mock', mode: 'private', displayPath: '/mock', trashName: '.trash' })
      },
      list: function (p, cb) { __ok(cb, (FILES[p || ''] || []).slice()) },
      read: function (p, cb) { __err(cb, '无内容') },
      write: function (p, c, cb) { __ok(cb, true) },
      mkdir: function (p, cb) { __ok(cb, true) },
      rename: function (o, n, cb) { __ok(cb, true) },
      copy: function (s, d, cb) {
        const parent = parentOf(d)
        const entry = (FILES[parentOf(s)] || []).find(function (it) { return it.name === nameOf(s) })
        if (!FILES[parent]) FILES[parent] = []
        FILES[parent].push({ name: nameOf(d), isDir: entry ? entry.isDir : false, size: entry ? entry.size : 0, mtime: 9 })
        __ok(cb, true)
      },
      delete: function (p, cb) {
        const parent = parentOf(p)
        if (FILES[parent]) FILES[parent] = FILES[parent].filter(function (it) { return it.name !== nameOf(p) })
        __ok(cb, true)
      },
      resolveUri: function (p, cb) { __err(cb, '无 URI') },
      openExternal: function (p, cb) { __err(cb, '浏览器无外部应用') },
      vibrate: function () {}, requestRootAccess: function () {}
    }
  })
  await page.goto(HTML, { waitUntil: 'networkidle0' })
  await page.waitForFunction(function () {
    return window.App && document.querySelectorAll('.desktop-icon').length >= 3
  }, { timeout: 10000 })

  console.log('═══ 回收站图标渲染（根目录特判 🗑️） ═══')
  const iconInfo = await page.evaluate(function () {
    const trash = document.querySelector('.desktop-icon.is-trash')
    const glyph = trash ? trash.querySelector('.desktop-icon-glyph').textContent : null
    const name = trash ? trash.querySelector('.desktop-icon-name').textContent : null
    return {
      hasTrash: !!trash,
      glyph: glyph,
      name: name,
      trashName: App.Desktop.getTrashName()
    }
  })
  check(iconInfo.hasTrash, '回收站图标渲染（.desktop-icon.is-trash 存在）')
  check(iconInfo.trashName === '.trash', 'Desktop.getTrashName() = .trash（桥返回透传）')
  check(iconInfo.glyph === '🗑️' && iconInfo.name === '.trash', '回收站图标 = 🗑️ + 名字 .trash')

  console.log('═══ 删除闭环：deleteSelection → 移入 .trash ═══')
  const before = await page.evaluate(function () {
    return document.querySelectorAll('.desktop-icon').length
  })
  await page.evaluate(function () {
    return new Promise(function (resolve) {
      const done = function () { setTimeout(resolve, 300) }
      // 观察 refresh 完成：Desktop.refresh 无回调，这里用 Loading 隐藏 + 轮询判断
      App.Actions.deleteSelection([{ path: 'a.txt', isDir: false }])
      const t = setInterval(function () {
        const names = []
        document.querySelectorAll('.desktop-icon').forEach(function (el) {
          names.push(el.getAttribute('data-name'))
        })
        if (names.indexOf('a.txt') < 0) { clearInterval(t); resolve() }
      }, 50)
      setTimeout(function () { clearInterval(t); resolve() }, 3000)
    })
  })
  const after = await page.evaluate(function () {
    const names = []
    document.querySelectorAll('.desktop-icon').forEach(function (el) {
      names.push(el.getAttribute('data-name'))
    })
    return { names: names, trashStillThere: !!document.querySelector('.desktop-icon.is-trash') }
  })
  check(before === 3, '删除前根目录 3 个图标（.trash + a.txt + docs）')
  check(after.names.indexOf('a.txt') < 0, '删除后 a.txt 从根目录消失')
  check(after.names.indexOf('.trash') >= 0 && after.trashStillThere, '回收站图标仍在根目录')

  console.log('═══ 进入回收站（inTrash）查看被删文件 ═══')
  const enter = await page.evaluate(function () {
    App.Desktop.openItem('.trash')
    return new Promise(function (resolve) {
      const t = setInterval(function () {
        if (App.Desktop.inTrash()) {
          const names = []
          document.querySelectorAll('.desktop-icon').forEach(function (el) {
            names.push(el.getAttribute('data-name'))
          })
          clearInterval(t)
          resolve({ inTrash: true, names: names, cur: App.Desktop.getCurPath() })
        }
      }, 50)
      setTimeout(function () { clearInterval(t); resolve({ inTrash: false, names: [] }) }, 3000)
    })
  })
  check(enter.inTrash && enter.cur === '.trash', '进入回收站视图（curPath=.trash）')
  check(enter.names.indexOf('a.txt') >= 0, '回收站内可见被删文件 a.txt')

  await browser.close()
  if (failures > 0) { console.error('[FAIL] ' + failures + ' 项失败'); process.exit(1) }
  console.log('[ok] 回收站安全删除验证通过')
}
main().catch(function (e) { console.error('[FAIL]', e.message); process.exit(1) })
