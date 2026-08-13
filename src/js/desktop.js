/* 桌面模块：以真实文件系统为数据源，渲染图标（世界坐标绝对定位，无限画布）。
 * 阶段 B：选择系统——单击选中/反选、矩形框选、长按拿起拖移、FAB 自动展开操作栏。
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
  let positions = {}   // name → {x, y}（世界坐标，移动后保留）
  let bounds = {}      // name → {x, y, w, h}（世界坐标 AABB，命中测试用）
  let selection = new Set()
  let iconEls = {}     // name → DOM 元素
  let dragTarget = null
  let dragOffset = null

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

  // 自动排布：世界坐标按网格铺开（已有位置优先，阶段 D 改为读 .desktop-layout.json）
  function layout(items) {
    let cols = Math.max(3, Math.min(8, Math.floor(viewportWidth() / CELL_W)))
    return items.map(function (item, i) {
      let pos = positions[item.name]
      if (!pos) {
        pos = {
          x: GAP + (i % cols) * CELL_W,
          y: GAP + Math.floor(i / cols) * CELL_H
        }
      }
      return { item: item, x: pos.x, y: pos.y }
    })
  }

  function render() {
    let statusEl = document.getElementById('status-text')
    let gridEl = document.getElementById('desktop-grid')
    if (!gridEl) return
    gridEl.innerHTML = ''
    iconEls = {}

    if (statusEl) {
      statusEl.textContent = '根目录: ' + state.rootName +
        (state.mode === 'private' ? '（应用私有目录，可在设置中授权外部存储）' : '')
    }

    let placed = layout(state.items)
    placed.forEach(function (p) {
      positions[p.item.name] = { x: p.x, y: p.y }
      bounds[p.item.name] = { x: p.x, y: p.y, w: ICON_W, h: ICON_H }
      let card = el('div', 'desktop-icon' + (p.item.isDir ? ' is-dir' : ''))
      card.setAttribute('data-name', p.item.name)
      let icon = el('div', 'desktop-icon-glyph', p.item.isDir ? '📁' : '📄')
      let name = el('div', 'desktop-icon-name', p.item.name)
      card.appendChild(icon)
      card.appendChild(name)
      card.style.left = p.x + 'px'
      card.style.top = p.y + 'px'
      if (selection.has(p.item.name)) card.classList.add('selected')
      iconEls[p.item.name] = card
      gridEl.appendChild(card)
    })

    // 用实测高度校准命中边界（宽度 CSS 固定 84，高度由内容撑开）
    Object.keys(iconEls).forEach(function (name) {
      const el = iconEls[name]
      bounds[name].w = el.offsetWidth || ICON_W
      bounds[name].h = el.offsetHeight || ICON_H
    })
  }

  // ── 选中态同步：图标 class + FAB 操作栏路由 ──
  function applySelection() {
    Object.keys(iconEls).forEach(function (name) {
      if (selection.has(name)) iconEls[name].classList.add('selected')
      else iconEls[name].classList.remove('selected')
    })
    if (App.fabSpeedDial && typeof App.fabSpeedDial.setSelection === 'function') {
      App.fabSpeedDial.setSelection(selection.size > 0)
    }
  }

  function clearSelection() {
    selection = new Set()
    applySelection()
  }

  // ── 手势回调（世界坐标）──
  function handleTap(world) {
    const name = App.DesktopSelection.pointHitTest(world.x, world.y, bounds)
    if (name) {
      selection = selection.has(name)
        ? App.DesktopSelection.toggle(selection, name)
        : App.DesktopSelection.selectOnly(name)
    } else {
      selection = App.DesktopSelection.clear()
    }
    applySelection()
  }

  function showMarquee(startWorld, currentWorld) {
    const mq = document.getElementById('desktop-marquee')
    if (!mq) return
    const a = App.DesktopCamera.worldToScreen(startWorld.x, startWorld.y, camera)
    const b = App.DesktopCamera.worldToScreen(currentWorld.x, currentWorld.y, camera)
    mq.style.left = Math.min(a.x, b.x) + 'px'
    mq.style.top = Math.min(a.y, b.y) + 'px'
    mq.style.width = Math.abs(b.x - a.x) + 'px'
    mq.style.height = Math.abs(b.y - a.y) + 'px'
    mq.style.display = 'block'
  }

  function hideMarquee() {
    const mq = document.getElementById('desktop-marquee')
    if (mq) mq.style.display = 'none'
  }

  function handleMarqueeStart(world) { showMarquee(world, world) }
  function handleMarqueeLive(start, cur) { showMarquee(start, cur) }

  function handleMarqueeEnd(start, cur) {
    hideMarquee()
    const rect = App.DesktopSelection.rectFromPoints(start.x, start.y, cur.x, cur.y)
    selection = new Set(App.DesktopSelection.marqueeHitTest(rect, bounds))
    applySelection()
  }

  function setPickedUp(name, on) {
    const el = iconEls[name]
    if (el) {
      if (on) el.classList.add('picked-up')
      else el.classList.remove('picked-up')
    }
  }

  function handleLongPress(world) {
    const name = App.DesktopSelection.pointHitTest(world.x, world.y, bounds)
    if (!name) return
    dragTarget = name
    dragOffset = { dx: positions[name].x - world.x, dy: positions[name].y - world.y }
    setPickedUp(name, true)
    if (App.bridge && typeof App.bridge.vibrate === 'function') App.bridge.vibrate(30)
  }

  function handleDrag(world) {
    if (!dragTarget) return
    const x = world.x + dragOffset.dx
    const y = world.y + dragOffset.dy
    positions[dragTarget] = { x: x, y: y }
    bounds[dragTarget] = { x: x, y: y, w: bounds[dragTarget].w, h: bounds[dragTarget].h }
    const el = iconEls[dragTarget]
    if (el) {
      el.style.left = x + 'px'
      el.style.top = y + 'px'
    }
  }

  function handleDrop(world, moved) {
    if (!dragTarget) return
    setPickedUp(dragTarget, false)
    if (moved) {
      const x = world.x + dragOffset.dx
      const y = world.y + dragOffset.dy
      positions[dragTarget] = { x: x, y: y }
      bounds[dragTarget] = { x: x, y: y, w: bounds[dragTarget].w, h: bounds[dragTarget].h }
    }
    // 阶段 D：写盘 .desktop-layout.json
    dragTarget = null
    dragOffset = null
  }

  function refresh() {
    return App.FileAPI.rootInfo()
      .then(function (info) {
        state.rootName = info.rootName
        state.mode = info.mode
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

  // 启动相机 + 手势（pan/zoom + tap/marquee/longpress/drag）
  function initGesture() {
    camera = App.DesktopCamera.create()
    App.DesktopGesture.init({
      viewport: document.getElementById('desktop-viewport'),
      canvas: document.getElementById('desktop-canvas'),
      camera: camera,
      onUpdate: function (c) { camera = c },
      onTap: handleTap,
      onMarqueeStart: handleMarqueeStart,
      onMarqueeLive: handleMarqueeLive,
      onMarqueeEnd: handleMarqueeEnd,
      onLongPress: handleLongPress,
      onDrag: handleDrag,
      onDrop: handleDrop
    })
  }

  return {
    refresh: refresh,
    render: render,
    initGesture: initGesture,
    clearSelection: clearSelection
  }
})()
