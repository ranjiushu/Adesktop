/* 桌面模块：以真实文件系统为数据源，渲染图标（世界坐标绝对定位，无限画布 + 网格吸附）。
 * 阶段 B：选择系统——单击选中/反选、框选、长按拿起整组拖移（网格吸附）、FAB 自动展开操作栏、
 *        localStorage 布局持久化（位置 + 相机视角）。
 * 阶段 C：目录导航——当前目录（curPath）+ 历史栈（后退/前进）+ 双击打开（文件夹进入）。
 * 布局 key = 完整相对路径（join(curPath, name)），跨目录不冲突。
 * 根目录 = SAF 授权目录 或 私有目录兜底（由桥决定）。
 */
'use strict'

App.Desktop = (function () {
  const ICON_W = 84
  const ICON_H = 76
  const DOUBLE_TAP_MS = 300   // 双击窗口（interaction.md §7）

  let state = {
    rootName: '…',
    mode: 'unknown',
    items: [],
    curPath: ''          // 当前目录（相对根，'' = 根）
  }

  let nav = null             // App.DesktopNav 历史栈
  let camera = null
  let positions = {}   // fullPath → {x, y}（世界坐标，移动后保留）
  let bounds = {}      // fullPath → {x, y, w, h}（世界坐标 AABB，命中测试用）
  let selection = new Set()
  let iconEls = {}     // fullPath → DOM 元素
  let dragTargets = []        // 移动的图标 fullPath 列表（组移动）
  let dragStartWorld = null   // 手指起始世界坐标
  let dragStartPositions = {} // fullPath → 起始世界坐标（保持组内相对位置）

  // 双击窗口状态
  let _tapState = null            // App.DoubleTap 状态
  let _pendingDeselect = null     // { name } 待反选（双击窗口确认）
  let _deselectTimer = null

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

  // 完整路径（布局 key）：根目录下 = 短名，子目录 = curPath/name
  function fullPath(name) {
    return App.DesktopNav.join(state.curPath, name)
  }

  // 自动排布：世界坐标按网格铺开（已有位置优先，位置来自 LayoutStore 持久化）
  function layout(items) {
    let cols = Math.max(3, Math.min(8, Math.floor(viewportWidth() / App.DesktopGrid.GRID_W)))
    return items.map(function (item, i) {
      const key = fullPath(item.name)
      let pos = positions[key]
      if (!pos) {
        pos = App.DesktopGrid.cellToWorld(i % cols, Math.floor(i / cols))
      }
      return { item: item, key: key, x: pos.x, y: pos.y }
    })
  }

  function render() {
    let statusEl = document.getElementById('status-text')
    let gridEl = document.getElementById('desktop-grid')
    if (!gridEl) return
    gridEl.innerHTML = ''
    iconEls = {}
    bounds = {}   // 清空重建，防止已删/不可见文件（如隐藏文件）的旧 bounds 残留导致命中测试选中幽灵项

    if (statusEl) {
      const cur = state.curPath ? '/' + state.curPath : ''
      statusEl.textContent = state.curPath
        ? '当前: ' + state.rootName + cur
        : '根目录: ' + state.rootName +
          (state.mode === 'private' ? '（应用私有目录，可在设置中授权外部存储）' : '')
    }

    let placed = layout(state.items)
    placed.forEach(function (p) {
      positions[p.key] = { x: p.x, y: p.y }
      bounds[p.key] = { x: p.x, y: p.y, w: ICON_W, h: ICON_H }
      let card = el('div', 'desktop-icon' + (p.item.isDir ? ' is-dir' : ''))
      card.setAttribute('data-name', p.item.name)
      card.setAttribute('data-path', p.key)
      // 剪切源半透明标记（Windows 式视觉反馈，文件仍真实存在）
      if (App.Clipboard && App.Clipboard.isCut(p.key)) {
        card.classList.add('clip-cut')
      }
      let icon = el('div', 'desktop-icon-glyph', p.item.isDir ? '📁' : '📄')
      let name = el('div', 'desktop-icon-name', p.item.name)
      card.appendChild(icon)
      card.appendChild(name)
      card.style.left = p.x + 'px'
      card.style.top = p.y + 'px'
      if (selection.has(p.key)) card.classList.add('selected')
      iconEls[p.key] = card
      gridEl.appendChild(card)
    })

    // 用实测高度校准命中边界（宽度 CSS 固定 84，高度由内容撑开）
    Object.keys(iconEls).forEach(function (key) {
      const node = iconEls[key]
      bounds[key].w = node.offsetWidth || ICON_W
      bounds[key].h = node.offsetHeight || ICON_H
    })
  }

  // ── 选中态同步：图标 class + FAB 操作栏路由 ──
  function applySelection() {
    Object.keys(iconEls).forEach(function (key) {
      if (selection.has(key)) iconEls[key].classList.add('selected')
      else iconEls[key].classList.remove('selected')
    })
    if (App.fabSpeedDial && typeof App.fabSpeedDial.setSelection === 'function') {
      App.fabSpeedDial.setSelection(selection.size > 0)
    }
  }

  function clearSelection() {
    selection = new Set()
    applySelection()
  }

  // 当前选中完整路径列表（复制/剪切/重命名用）
  function getSelectionNames() {
    return Array.from(selection)
  }

  // 当前选中条目 [{path, isDir}]（剪贴板跨目录粘贴需要源类型）
  function getSelectionEntries() {
    return Array.from(selection).map(function (path) {
      let isDir = false
      state.items.forEach(function (it) {
        if (fullPath(it.name) === path) isDir = it.isDir
      })
      return { path: path, isDir: isDir }
    })
  }

  // 重命名后布局 key 迁移：positions/bounds 以完整路径为 key，
  // 旧 key → 新 key，否则新名字刷新后回退自动排布丢位置。随后重绘。
  function applyRename(oldPath, newPath) {
    if (!oldPath || !newPath || oldPath === newPath) return
    if (positions[oldPath]) {
      positions[newPath] = positions[oldPath]
      delete positions[oldPath]
    }
    if (bounds[oldPath]) {
      bounds[newPath] = bounds[oldPath]
      delete bounds[oldPath]
    }
    if (selection.has(oldPath)) {
      selection.delete(oldPath)
      selection.add(newPath)
    }
    saveLayout()
    refresh()
  }

  // ── 打开：文件夹进入 / 文件打开（阶段 C 占位）──
  function openItem(full) {
    if (!full) return
    const item = state.items.filter(function (it) {
      return fullPath(it.name) === full
    })[0]
    if (!item) return
    clearSelection()
    if (item.isDir) {
      enterFolder(full)
    } else if (App.toast) {
      App.toast.show('打开文件（阶段 C 后续实现）')
    }
  }

  // 进入子目录：压栈历史 + 切换视图
  function enterFolder(full) {
    nav = App.DesktopNav.enter(nav, full)
    state.curPath = full
    refresh()
  }

  // 后退 / 前进（底栏按钮驱动）
  function goBack() {
    if (!App.DesktopNav.canBack(nav)) return false
    nav = App.DesktopNav.back(nav)
    state.curPath = App.DesktopNav.current(nav)
    refresh()
    return true
  }

  function goForward() {
    if (!App.DesktopNav.canForward(nav)) return false
    nav = App.DesktopNav.forward(nav)
    state.curPath = App.DesktopNav.current(nav)
    refresh()
    return true
  }

  function canGoBack() { return App.DesktopNav.canBack(nav) }
  function canGoForward() { return App.DesktopNav.canForward(nav) }
  function getCurPath() { return state.curPath }

  // ── 手势回调（世界坐标）──
  function handleTap(world) {
    const name = App.DesktopSelection.pointHitTest(world.x, world.y, bounds)
    const now = Date.now()
    const r = App.DoubleTap.hit(_tapState, name, now, DOUBLE_TAP_MS)
    _tapState = r.state
    if (r.double) {
      // 双击：取消待反选，打开
      if (_deselectTimer) { clearTimeout(_deselectTimer); _deselectTimer = null }
      _pendingDeselect = null
      openItem(name)
      return
    }
    if (name) {
      if (!selection.has(name)) {
        // 未选中 → 立即选中（视觉即时）
        selection = App.DesktopSelection.selectOnly(name)
        applySelection()
      } else {
        // 已选中 → 反选延迟（双击窗口确认，防止双击时先反选再打开）
        _pendingDeselect = { name: name }
        if (_deselectTimer) clearTimeout(_deselectTimer)
        _deselectTimer = setTimeout(function () {
          _deselectTimer = null
          if (_pendingDeselect && selection.has(_pendingDeselect.name)) {
            selection = App.DesktopSelection.toggle(selection, _pendingDeselect.name)
            applySelection()
          }
          _pendingDeselect = null
        }, DOUBLE_TAP_MS)
      }
    } else {
      selection = App.DesktopSelection.clear()
      applySelection()
    }
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
    const node = iconEls[name]
    if (node) {
      if (on) node.classList.add('picked-up')
      else node.classList.remove('picked-up')
    }
  }

  // 命中类型：selected=已选中（可直接拿起）/ icon=未选中图标 / empty=空白
  function hitTest(world) {
    const name = App.DesktopSelection.pointHitTest(world.x, world.y, bounds)
    if (name) {
      return selection.has(name) ? 'selected' : 'icon'
    }
    if (selection.size > 0) {
      const rect = App.DesktopSelection.unionRect(bounds, Array.from(selection))
      if (App.DesktopSelection.pointInRect(world.x, world.y, rect)) {
        return 'selected'
      }
    }
    return 'empty'
  }

  // 拿起整个选中组并开始拖（组内相对位置不变）
  function startGroupDrag(world) {
    // 过滤掉 positions/bounds 缺失的幽灵项（文件已删/不可见），避免访问 undefined 中断拖动
    dragTargets = Array.from(selection).filter(function (n) {
      return positions[n] && bounds[n]
    })
    dragStartWorld = { x: world.x, y: world.y }
    dragStartPositions = {}
    dragTargets.forEach(function (n) {
      dragStartPositions[n] = { x: positions[n].x, y: positions[n].y }
      setPickedUp(n, true)
    })
    if (App.bridge && typeof App.bridge.vibrate === 'function') App.bridge.vibrate(30)
  }

  function handleLongPress(world) {
    // 1. 多选组：拿取判定覆盖整个组合区域（union AABB，含组内空隙，一整块）
    if (selection.size > 1) {
      const rect = App.DesktopSelection.unionRect(bounds, Array.from(selection))
      if (App.DesktopSelection.pointInRect(world.x, world.y, rect)) {
        startGroupDrag(world)
        return
      }
    }
    // 2. 单个图标命中：未选中则先单选，再拿
    const name = App.DesktopSelection.pointHitTest(world.x, world.y, bounds)
    if (name) {
      if (!selection.has(name)) {
        selection = App.DesktopSelection.selectOnly(name)
        applySelection()
      }
      startGroupDrag(world)
    }
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
      const node = iconEls[n]
      if (node) {
        node.style.left = x + 'px'
        node.style.top = y + 'px'
      }
    })
  }

  // 已选中组上直接拿起（拖动即拿取，不必长按）
  function handleDragStart(world) {
    if (selection.size > 0) startGroupDrag(world)
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
        const node = iconEls[n]
        if (node) {
          node.style.left = resolved[n].x + 'px'
          node.style.top = resolved[n].y + 'px'
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
          const base = info.displayPath || info.rootName
          App.Drawer.updatePath(state.curPath ? base + '/' + state.curPath : base,
            info.rootName, info.mode)
        }
      })
      .catch(function () {
        state.rootName = '无法读取'
        if (App.Drawer && typeof App.Drawer.updatePath === 'function') {
          App.Drawer.updatePath(App.NAME, App.NAME, '')
        }
      })
      .then(function () { return App.FileAPI.list(state.curPath) })
      .then(function (items) {
        state.items = items
        // 清理失效布局条目（文件已删/改名，避免残留在存储表）
        const valid = {}
        items.forEach(function (it) { valid[fullPath(it.name)] = true })
        Object.keys(positions).forEach(function (key) {
          // 仅清理当前目录下的 key（根目录无斜杠 / 子目录带前缀）
          const inCur = state.curPath
            ? key.indexOf(state.curPath + '/') === 0
            : key.indexOf('/') < 0
          if (inCur && !valid[key]) delete positions[key]
        })
        render()
        // 后退/前进按钮禁用态随目录切换更新
        if (App.BottomBar && typeof App.BottomBar.updateNavButtons === 'function') {
          App.BottomBar.updateNavButtons()
        }
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
      Object.keys(saved.icons).forEach(function (key) {
        positions[key] = saved.icons[key]
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
    nav = App.DesktopNav.create()
    initLayout()
    App.DesktopGesture.init({
      viewport: document.getElementById('desktop-viewport'),
      canvas: document.getElementById('desktop-canvas'),
      camera: camera,
      onUpdate: function (c) { camera = c },
      onHitTest: hitTest,
      onTap: handleTap,
      onMarqueeStart: handleMarqueeStart,
      onMarqueeLive: handleMarqueeLive,
      onMarqueeEnd: handleMarqueeEnd,
      onLongPress: handleLongPress,
      onDragStart: handleDragStart,
      onDrag: handleDrag,
      onDrop: handleDrop
    })
  }

  return {
    refresh: refresh,
    render: render,
    initGesture: initGesture,
    clearSelection: clearSelection,
    getSelectionNames: getSelectionNames,
    getSelectionEntries: getSelectionEntries,
    applyRename: applyRename,
    openItem: openItem,
    enterFolder: enterFolder,
    goBack: goBack,
    goForward: goForward,
    canGoBack: canGoBack,
    canGoForward: canGoForward,
    getCurPath: getCurPath
  }
})()
