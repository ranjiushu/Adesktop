/* 桌面模块：以真实文件系统为数据源，渲染图标（世界坐标绝对定位，无限画布 + 网格吸附）。
 * 阶段 B：选择系统——单击选中/反选、框选、长按拿起整组拖移（网格吸附）、FAB 自动展开操作栏、
 *        localStorage 布局持久化（位置 + 相机视角）。
 * 根目录 = SAF 授权目录 或 私有目录兜底（由桥决定）。
 */
'use strict'

App.Desktop = (function () {
  const ICON_W = 84
  const ICON_H = 76
  // 网格常量统一在 App.DesktopGrid（origin 16,16 / step 100,92）

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
  let dragTargets = []        // 移动的图标 name 列表（组移动）
  let dragStartWorld = null   // 手指起始世界坐标
  let dragStartPositions = {} // name → 起始世界坐标（保持组内相对位置）

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

  // 自动排布：世界坐标按网格铺开（已有位置优先，位置来自 LayoutStore 持久化）
  function layout(items) {
    let cols = Math.max(3, Math.min(8, Math.floor(viewportWidth() / App.DesktopGrid.GRID_W)))
    return items.map(function (item, i) {
      let pos = positions[item.name]
      if (!pos) {
        pos = App.DesktopGrid.cellToWorld(i % cols, Math.floor(i / cols))
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
    // 长按未选中 → 先单选再移；已选中 → 拿起整个选中组（Windows 组合拖动语义）
    if (!selection.has(name)) {
      selection = App.DesktopSelection.selectOnly(name)
      applySelection()
    }
    dragTargets = Array.from(selection)
    dragStartWorld = { x: world.x, y: world.y }
    dragStartPositions = {}
    dragTargets.forEach(function (n) {
      dragStartPositions[n] = { x: positions[n].x, y: positions[n].y }
      setPickedUp(n, true)
    })
    if (App.bridge && typeof App.bridge.vibrate === 'function') App.bridge.vibrate(30)
  }

  // 拖动过程：无极跟随（不吸附），放置时再吸附 + 避让
  function applyDrag(world) {
    const dx = world.x - dragStartWorld.x
    const dy = world.y - dragStartWorld.y
    dragTargets.forEach(function (n) {
      const x = dragStartPositions[n].x + dx
      const y = dragStartPositions[n].y + dy
      positions[n] = { x: x, y: y }
      bounds[n] = { x: x, y: y, w: bounds[n].w, h: bounds[n].h }
      const el = iconEls[n]
      if (el) {
        el.style.left = x + 'px'
        el.style.top = y + 'px'
      }
    })
  }

  function handleDrag(world) {
    if (dragTargets.length) applyDrag(world)
  }

  function handleDrop(world, moved) {
    if (!dragTargets.length) return
    if (moved) {
      // 1. 移动组期望位：snap 到网格
      const dx = world.x - dragStartWorld.x
      const dy = world.y - dragStartWorld.y
      const moving = dragTargets.map(function (n) {
        const raw = { x: dragStartPositions[n].x + dx, y: dragStartPositions[n].y + dy }
        const snapped = App.DesktopGrid.snapToGrid(raw.x, raw.y)
        return { name: n, x: snapped.x, y: snapped.y }
      })
      // 2. 静止图标（非移动组）
      const movingSet = new Set(dragTargets)
      const statics = Object.keys(positions).filter(function (n) {
        return !movingSet.has(n)
      }).map(function (n) {
        return { name: n, x: positions[n].x, y: positions[n].y }
      })
      // 3. 避让解析：移动组放期望位，冲突的静止图标让位到最近空位
      const resolved = App.DesktopGrid.resolvePlacement(moving, statics)
      Object.keys(resolved).forEach(function (n) {
        positions[n] = resolved[n]
        bounds[n] = { x: resolved[n].x, y: resolved[n].y, w: bounds[n].w, h: bounds[n].h }
        const el = iconEls[n]
        if (el) {
          el.style.left = resolved[n].x + 'px'
          el.style.top = resolved[n].y + 'px'
        }
      })
    }
    dragTargets.forEach(function (n) { setPickedUp(n, false) })
    dragTargets = []
    dragStartWorld = null
    dragStartPositions = {}
    if (moved) saveLayout()
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
        // 清理失效布局条目（文件已删/改名，避免残留在存储表）
        const valid = {}
        items.forEach(function (it) { valid[it.name] = true })
        Object.keys(positions).forEach(function (name) {
          if (!valid[name]) delete positions[name]
        })
        render()
      })
      .catch(function (err) {
        let statusEl = document.getElementById('status-text')
        if (statusEl) statusEl.textContent = '读取失败: ' + err.message
      })
  }

  // 加载布局（位置 + 相机视角），无数据/损坏回退默认
  function initLayout() {
    const saved = App.LayoutStore.load()
    if (saved && saved.icons) {
      Object.keys(saved.icons).forEach(function (name) {
        positions[name] = saved.icons[name]
      })
    }
    if (saved && saved.camera) {
      camera = App.DesktopCamera.create(saved.camera.x, saved.camera.y, saved.camera.zoom)
    } else {
      camera = App.DesktopCamera.create()
    }
  }

  // 保存布局（位置 + 相机），失败告警（铁律：写入路径失败必须告警）
  function saveLayout() {
    const data = {
      version: 1,
      icons: positions,
      camera: { x: camera.x, y: camera.y, zoom: camera.zoom }
    }
    if (!App.LayoutStore.save(data)) {
      if (App.toast && typeof App.toast.show === 'function') App.toast.show('布局保存失败')
    }
  }

  // 启动相机 + 手势（pan/zoom + tap/marquee/longpress/drag）
  function initGesture() {
    initLayout()
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
