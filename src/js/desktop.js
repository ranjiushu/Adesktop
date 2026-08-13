/* 桌面模块：以真实文件系统为数据源，渲染图标（世界坐标绝对定位，无限画布）。
 * 阶段 A：图标自动排布（世界坐标网格铺开），双指平移缩放由 DesktopGesture 接管。
 * 根目录 = SAF 授权目录 或 私有目录兜底（由桥决定）。
 */
'use strict'

App.Desktop = (function () {
  const ICON_W = 84
  const ICON_H = 76
  const GAP = 16
  const CELL_W = ICON_W + GAP
  const CELL_H = ICON_H + GAP

  let state = {
    rootName: '…',
    mode: 'unknown',
    items: []
  }

  let camera = null

  function el(tag, className, text) {
    let node = document.createElement(tag)
    if (className) node.className = className
    if (text != null) node.textContent = text
    return node
  }

  function viewportWidth() {
    let vp = document.getElementById('desktop-viewport')
    return (vp && vp.clientWidth) || 360
  }

  // 自动排布：世界坐标按网格铺开（阶段 D 改为读 .desktop-layout.json）
  function layout(items) {
    let cols = Math.max(3, Math.min(8, Math.floor(viewportWidth() / CELL_W)))
    return items.map(function (item, i) {
      return {
        item: item,
        x: GAP + (i % cols) * CELL_W,
        y: GAP + Math.floor(i / cols) * CELL_H
      }
    })
  }

  function render() {
    let statusEl = document.getElementById('status-text')
    let gridEl = document.getElementById('desktop-grid')
    if (!gridEl) return
    gridEl.innerHTML = ''

    if (statusEl) {
      statusEl.textContent = '根目录: ' + state.rootName +
        (state.mode === 'private' ? '（应用私有目录，可在设置中授权外部存储）' : '')
    }

    let placed = layout(state.items)
    placed.forEach(function (p) {
      let card = el('div', 'desktop-icon' + (p.item.isDir ? ' is-dir' : ''))
      let icon = el('div', 'desktop-icon-glyph', p.item.isDir ? '📁' : '📄')
      let name = el('div', 'desktop-icon-name', p.item.name)
      card.appendChild(icon)
      card.appendChild(name)
      card.style.left = p.x + 'px'
      card.style.top = p.y + 'px'
      gridEl.appendChild(card)
    })
  }

  function refresh() {
    return App.FileAPI.rootInfo()
      .then(function (info) {
        state.rootName = info.rootName
        state.mode = info.mode
        // 顶栏标题 + Drawer 头部显示授权路径
        if (App.Drawer && typeof App.Drawer.updatePath === 'function') {
          App.Drawer.updatePath(info.displayPath || info.rootName, info.rootName, info.mode)
        }
      })
      .catch(function () {
        state.rootName = '无法读取'
        if (App.Drawer && typeof App.Drawer.updatePath === 'function') {
          App.Drawer.updatePath(App.NAME, App.NAME, '')
        }
      })
      .then(function () { return App.FileAPI.list('') })
      .then(function (items) {
        state.items = items
        render()
      })
      .catch(function (err) {
        let statusEl = document.getElementById('status-text')
        if (statusEl) statusEl.textContent = '读取失败: ' + err.message
      })
  }

  // 启动相机 + 双指手势（pan/zoom），camera 经 onUpdate 同步供后续命中测试使用
  function initGesture() {
    camera = App.DesktopCamera.create()
    App.DesktopGesture.init({
      viewport: document.getElementById('desktop-viewport'),
      camera: camera,
      onUpdate: function (c) { camera = c }
    })
  }

  return {
    refresh: refresh,
    render: render,
    initGesture: initGesture
  }
})()
