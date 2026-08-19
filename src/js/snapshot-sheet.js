/* 演示快照面板（App.SnapshotSheet）：底栏上滑呼出快照列表 + 演示模式。
 * 手势：底栏区域垂直上滑跟手抬出面板，下滑/点遮罩/点关闭按钮关闭。
 * 列表：按分组展示快照，点击切换，长按/拖动把手分组内排序。
 * 分组：支持新建、重命名、删除；分组内快照独立排序。
 * 菜单：右上角三点按钮，可开启/关闭演示模式、切换新快照插入位置（顶部/底部）、
 *       删除当前选中的快照。
 * 演示模式：开启后底栏前进/后退按钮变为「下一个/上一个快照」，边界禁用并吐司提示。
 * 依赖: namespace.js, utils.js, dialog.js, drag-sort.js, snapshot-store.js, desktop-core.js,
 *       desktop-navigation.js, bottom-bar.js, toast.js, bridge.js
 * 导出: App.SnapshotSheet
 */
'use strict'

App.SnapshotSheet = (function () {
  const C = App.DesktopCore
  const TAN_VERTICAL = 2.14       // tan(65°)，超过此角度视为垂直上滑
  const SWIPE_THRESHOLD = 24      // 上滑激活阈值 px
  const DEADZONE = 6              // 决策死区 px

  /** @type {'closed' | 'opening' | 'open' | 'closing'} */
  let _state = 'closed'
  /** @type {HTMLElement | null} */
  let _panel = null
  /** @type {HTMLElement | null} */
  let _overlay = null
  /** @type {HTMLElement | null} */
  let _list = null
  /** @type {HTMLElement | null} */
  let _menu = null
  /** @type {Array<{engine: any, groupIdx: number}>} */
  let _dragEngines = []
  /** @type {SnapshotData | null} */
  let _currentData = null
  /** @type {number} */
  let _currentIndex = -1
  let _presentationMode = false
  /** @type {{deciding: boolean, active: boolean, sx: number, sy: number} | null} */
  let _swipe = null
  /** @type {number | null} */
  let _openRaf = null

  function _getEl(id) { return document.getElementById(id) }

  function _now() {
    return (typeof performance === 'object' && typeof performance.now === 'function')
      ? performance.now() : Date.now()
  }

  function _raf(cb) {
    return (typeof requestAnimationFrame === 'function')
      ? requestAnimationFrame(cb)
      : setTimeout(cb, 16)
  }

  function _caf(id) {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id)
    else clearTimeout(id)
  }

  // 当前 rootId 若为空（尚未初始化）则拒绝打开
  function _rootId() {
    return C.state.rootId
  }

  function _isDesktop() {
    return !C.isFolderView()
  }

  function _data() {
    const rootId = _rootId()
    if (!rootId) return { version: App.SnapshotStore.VERSION, groups: [] }
    return App.SnapshotStore.load(rootId)
  }

  function _homeGroup() {
    return App.SnapshotStore.getHomeGroup(_data(), App.SnapshotStore.getInsertPosition())
  }

  function _flatSnapshots() {
    const rootId = _rootId()
    if (!rootId) return []
    return App.SnapshotStore.flatSnapshots(rootId)
  }

  function _findSnapshotFlatIndex(snapshotId) {
    const data = _data()
    const found = App.SnapshotStore.findIndex(data, snapshotId)
    if (!found) return -1
    let cursor = 0
    for (let i = 0; i < found.groupIdx; i++) {
      cursor += data.groups[i].snapshots.length
    }
    return cursor + found.snapshotIdx
  }

  // 刷新 Home 高亮（BottomBar 已有 home-has-snapshot 类，这里只更新）
  function _updateHomeHighlight() {
    if (App.BottomBar && typeof App.BottomBar.updateHomeState === 'function') {
      App.BottomBar.updateHomeState()
    }
  }

  // 渲染快照列表（按分组）
  function _renderList() {
    if (!_list) return
    const data = _data()
    _currentData = data
    _cleanupDragEngines()
    _list.innerHTML = ''
    if (data.groups.length === 0 || !_hasAnySnapshot(data)) {
      const empty = document.createElement('div')
      empty.className = 'snapshot-empty'
      empty.textContent = '长按底栏 Home 记录快照'
      _list.appendChild(empty)
      return
    }
    const homeGroup = _homeGroup()
    data.groups.forEach(function (group, groupIdx) {
      const section = document.createElement('div')
      section.className = 'snapshot-group'

      const header = document.createElement('div')
      header.className = 'snapshot-group-header'

      const title = document.createElement('span')
      title.className = 'snapshot-group-title'
      title.textContent = group.name
      header.appendChild(title)

      const menuBtn = document.createElement('button')
      menuBtn.className = 'snapshot-group-menu-btn'
      menuBtn.setAttribute('aria-label', '分组菜单')
      menuBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="19" r="1.5" fill="currentColor" stroke="none"/></svg>'
      App.utils.bindPress(menuBtn, function () { _openGroupMenu(groupIdx) })
      header.appendChild(menuBtn)

      section.appendChild(header)

      const body = document.createElement('div')
      body.className = 'snapshot-group-body'
      body.dataset.groupIdx = String(groupIdx)
      group.snapshots.forEach(function (s, idx) {
        const item = _createSnapshotItem(s, groupIdx, idx, group.id === (homeGroup && homeGroup.id))
        body.appendChild(item)
      })
      section.appendChild(body)

      _list.appendChild(section)
      _bindGroupDrag(body, groupIdx)
    })
    _markCurrentInList()
  }

  function _hasAnySnapshot(data) {
    return data.groups.some(function (g) { return g.snapshots.length > 0 })
  }

  function _createSnapshotItem(s, groupIdx, idx, isHomeGroup) {
    const item = document.createElement('div')
    item.className = 'snapshot-item'
    item.dataset.id = s.id
    item.dataset.groupIdx = String(groupIdx)
    item.dataset.index = String(idx)
    if (isHomeGroup && idx === App.SnapshotStore.homeSnapshotIndex([s], App.SnapshotStore.getInsertPosition())) {
      item.classList.add('snapshot-home')
    }

    const handle = document.createElement('span')
    handle.className = 'snapshot-drag-handle'
    handle.setAttribute('aria-label', '拖动排序')
    handle.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.5" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.5" fill="currentColor" stroke="none"/></svg>'

    const name = document.createElement('span')
    name.className = 'snapshot-name'
    name.textContent = s.name

    const meta = document.createElement('span')
    meta.className = 'snapshot-meta'
    meta.textContent = 'z' + Number(s.camera.zoom).toFixed(2)

    item.appendChild(handle)
    item.appendChild(name)
    item.appendChild(meta)

    item.addEventListener('click', function (e) {
      if (e.target === handle || handle.contains(/** @type {Node} */(e.target))) return
      if (item.dataset._dragSortJustFinished === '1') return
      _flyToSnapshot(groupIdx, idx)
    })

    handle.addEventListener('touchstart', function (e) {
      const engine = _dragEngines[groupIdx]
      if (!engine) return
      e.preventDefault()
      if (App.bridge && typeof App.bridge.vibrate === 'function') App.bridge.vibrate(20)
      engine.engine.startDrag(item, e.touches[0].clientY)
    }, { passive: false })

    return item
  }

  function _cleanupDragEngines() {
    _dragEngines.forEach(function (entry) {
      if (entry && entry.engine && typeof entry.engine.cleanup === 'function') entry.engine.cleanup()
    })
    _dragEngines = []
  }

  function _bindGroupDrag(body, groupIdx) {
    if (!body) return
    const engine = App.dragSort.createDragSortEngine({
      container: body,
      itemSelector: '.snapshot-item',
      dragClass: 'snapshot-item-dragging',
      dragActiveClass: 'snapshot-list-dragging',
      targetClass: 'snapshot-item-target',
      isActive: function () { return true },
      onCommit: function (from, to) { _commitReorder(groupIdx, from, to) },
      edgeZone: 56,
      edgeInsetTop: 0,
      edgeInsetBottom: function () {
        return 10 * (window.innerHeight / 100) + parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-bottom') || '0')
      }
    })
    _dragEngines[groupIdx] = { engine: engine, groupIdx: groupIdx }
  }

  function _flyToSnapshot(groupIdx, snapshotIdx) {
    const rootId = _rootId()
    if (!rootId) return
    const data = App.SnapshotStore.load(rootId)
    const group = data.groups[groupIdx]
    const s = group && group.snapshots[snapshotIdx]
    if (!s) return
    _currentIndex = _findSnapshotFlatIndex(s.id)
    _markCurrentInList()
    if (App.DesktopNavigation && typeof App.DesktopNavigation.animateCameraTo === 'function') {
      const target = App.DesktopCamera.create(s.camera.x, s.camera.y, s.camera.zoom, s.camera.rotation || 0)
      App.DesktopNavigation.animateCameraTo(target)
    }
  }

  function _flyToIndex(idx) {
    const rootId = _rootId()
    if (!rootId) return
    const data = App.SnapshotStore.load(rootId)
    let cursor = 0
    for (let i = 0; i < data.groups.length; i++) {
      const g = data.groups[i]
      if (idx >= cursor && idx < cursor + g.snapshots.length) {
        _flyToSnapshot(i, idx - cursor)
        return
      }
      cursor += g.snapshots.length
    }
  }

  function _markCurrentInList() {
    if (!_list) return
    const data = _data()
    let cursor = 0
    let currentId = null
    for (let i = 0; i < data.groups.length; i++) {
      const g = data.groups[i]
      if (_currentIndex >= cursor && _currentIndex < cursor + g.snapshots.length) {
        currentId = g.snapshots[_currentIndex - cursor].id
        break
      }
      cursor += g.snapshots.length
    }
    Array.prototype.forEach.call(_list.querySelectorAll('.snapshot-item'), function (el) {
      el.classList.toggle('snapshot-current', el.dataset.id === currentId)
    })
  }

  // 排序提交（分组内）
  function _commitReorder(groupIdx, from, to) {
    const rootId = _rootId()
    if (!rootId) return
    let data = App.SnapshotStore.load(rootId)
    const group = data.groups[groupIdx]
    if (!group) return
    data = App.SnapshotStore.reorder(data, group.id, from, to)
    App.SnapshotStore.save(data, rootId)
    _renderList()
    _updateHomeHighlight()
  }

  // 菜单显隐
  function _toggleMenu() {
    if (!_menu) return
    const hidden = _menu.classList.contains('snapshot-menu-hidden')
    if (hidden) _openMenu()
    else _closeMenu()
  }

  function _openMenu() {
    if (!_menu) return
    _menu.classList.remove('snapshot-menu-hidden')
    _menu.setAttribute('aria-hidden', 'false')
    _updateMenuLabels()
  }

  function _closeMenu() {
    if (!_menu) return
    _menu.classList.add('snapshot-menu-hidden')
    _menu.setAttribute('aria-hidden', 'true')
  }

  function _updateMenuLabels() {
    if (!_menu) return
    const presBtn = _menu.querySelector('[data-action="presentation"]')
    const pos = App.SnapshotStore.getInsertPosition()
    if (presBtn) presBtn.textContent = _presentationMode ? '关闭演示模式' : '开启演示模式'
    const topBtn = _menu.querySelector('[data-action="insert-top"]')
    const bottomBtn = _menu.querySelector('[data-action="insert-bottom"]')
    if (topBtn) topBtn.textContent = (pos === 'top' ? '✓ ' : '') + '新快照插入顶部'
    if (bottomBtn) bottomBtn.textContent = (pos === 'bottom' ? '✓ ' : '') + '新快照插入底部'
  }

  function _onMenuAction(action) {
    if (action === 'presentation') {
      setPresentationMode(!_presentationMode)
      _closeMenu()
      return
    }
    if (action === 'insert-top') {
      App.SnapshotStore.setInsertPosition('top')
      _renderList()
      _updateHomeHighlight()
      _closeMenu()
      return
    }
    if (action === 'insert-bottom') {
      App.SnapshotStore.setInsertPosition('bottom')
      _renderList()
      _updateHomeHighlight()
      _closeMenu()
      return
    }
    if (action === 'delete-current') {
      _deleteCurrent()
      _closeMenu()
      return
    }
    if (action === 'new-group') {
      _promptNewGroup()
      _closeMenu()
    }
  }

  function _promptNewGroup() {
    const name = window.prompt('新建分组名称', '新分组')
    if (!name) return
    const rootId = _rootId()
    if (!rootId) return
    const result = App.SnapshotStore.createGroup(rootId, name)
    if (!result) {
      if (App.toast && typeof App.toast.show === 'function') App.toast.show('创建分组失败')
      return
    }
    _renderList()
    if (App.toast && typeof App.toast.show === 'function') App.toast.show('已创建分组：' + result.group.name)
  }

  function _openGroupMenu(groupIdx) {
    const data = _data()
    const group = data.groups[groupIdx]
    if (!group) return
    const newName = window.prompt('重命名分组', group.name)
    if (newName === null) return
    const rootId = _rootId()
    if (!rootId) return
    const trimmed = newName.trim()
    if (trimmed) {
      App.SnapshotStore.renameGroup(rootId, group.id, trimmed)
    }
    const shouldDelete = window.confirm('是否删除分组「' + (trimmed || group.name) + '」？组内快照将一并删除。')
    if (shouldDelete) {
      App.SnapshotStore.deleteGroup(rootId, group.id)
      _currentIndex = -1
    }
    _renderList()
    _updateHomeHighlight()
  }

  function _deleteCurrent() {
    const rootId = _rootId()
    if (!rootId) return
    let data = App.SnapshotStore.load(rootId)
    const found = App.SnapshotStore.findIndex(data, _currentSnapshotId())
    if (!found) return
    const group = data.groups[found.groupIdx]
    const s = group.snapshots[found.snapshotIdx]
    if (!s) return
    data = App.SnapshotStore.delete(data, group.id, s.id)
    App.SnapshotStore.save(data, rootId)
    _currentIndex = -1
    _renderList()
    _updateHomeHighlight()
    if (App.toast && typeof App.toast.show === 'function') App.toast.show('已删除快照')
  }

  function _currentSnapshotId() {
    const flat = _flatSnapshots()
    return flat[_currentIndex] ? flat[_currentIndex].id : null
  }

  // 面板动画
  function _setPanelTranslate(y) {
    if (!_panel) return
    _panel.style.transform = 'translateY(' + y + 'px)'
  }

  function _panelHeight() {
    return _panel ? _panel.offsetHeight : 0
  }

  function _openSheet() {
    if (!_isDesktop()) {
      if (App.toast && typeof App.toast.show === 'function') App.toast.show('快照仅在桌面空间可用')
      return
    }
    if (_state === 'open' || _state === 'opening') return
    if (!_panel || !_overlay) return
    _state = 'opening'
    _renderList()
    _overlay.classList.add('snapshot-sheet-overlay-visible')
    _overlay.setAttribute('aria-hidden', 'false')
    const target = 0
    const from = _panelHeight()
    _setPanelTranslate(from)
    const t0 = _now()
    const dur = 280
    function frame() {
      const k = Math.min(1, (_now() - t0) / dur)
      const y = from * (1 - App.DesktopCamera.easeInOutCubic(k))
      _setPanelTranslate(y)
      if (k < 1) _openRaf = _raf(frame)
      else {
        _state = 'open'
        _openRaf = null
      }
    }
    _openRaf = _raf(frame)
  }

  function _closeSheet() {
    if (_state === 'closed' || _state === 'closing') return
    if (!_panel || !_overlay) return
    _state = 'closing'
    _closeMenu()
    const from = 0
    const target = _panelHeight()
    const t0 = _now()
    const dur = 240
    function frame() {
      const k = Math.min(1, (_now() - t0) / dur)
      const y = target * App.DesktopCamera.easeInOutCubic(k)
      _setPanelTranslate(y)
      if (k < 1) _openRaf = _raf(frame)
      else {
        _state = 'closed'
        _openRaf = null
        _overlay.classList.remove('snapshot-sheet-overlay-visible')
        _overlay.setAttribute('aria-hidden', 'true')
      }
    }
    _openRaf = _raf(frame)
  }

  // 底栏上滑手势
  function _initBarSwipe() {
    const bar = _getEl('bottom-bar')
    if (!bar) return

    bar.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) return
      // Drawer 已打开时不抢占
      if (App.Drawer && App.Drawer.isOpen && App.Drawer.isOpen()) return
      const t = e.touches[0]
      _swipe = { deciding: true, active: false, sx: t.clientX, sy: t.clientY }
    }, { passive: true, capture: true })

    bar.addEventListener('touchmove', function (e) {
      if (!_swipe || !_swipe.deciding) return
      if (e.touches.length !== 1) return
      const t = e.touches[0]
      const dx = t.clientX - _swipe.sx
      const dy = t.clientY - _swipe.sy
      if (Math.abs(dx) < DEADZONE && Math.abs(dy) < DEADZONE) return
      // 右滑 Drawer 方向：放弃
      if (dx > 0 && Math.abs(dy) <= Math.abs(dx) * 0.466) {
        _swipe.deciding = false
        return
      }
      // 垂直上滑：激活 sheet
      if (dy < -SWIPE_THRESHOLD && Math.abs(dy) > Math.abs(dx) * TAN_VERTICAL) {
        _swipe.active = true
        _swipe.deciding = false
        e.stopImmediatePropagation()
        e.preventDefault()
        _openSheet()
      } else if (Math.abs(dx) > SWIPE_THRESHOLD || Math.abs(dy) > SWIPE_THRESHOLD) {
        _swipe.deciding = false
      }
    }, { passive: false, capture: true })

    function end(e) {
      if (!_swipe) return
      if (_swipe.active) {
        if (e) { e.stopImmediatePropagation(); e.preventDefault() }
      }
      _swipe = null
    }
    bar.addEventListener('touchend', end, { passive: false, capture: true })
    bar.addEventListener('touchcancel', end, { passive: false, capture: true })
  }

  // 面板跟手下滑关闭
  function _initSheetDrag() {
    if (!_panel || !_overlay) return
    let startY = 0
    let startScrollTop = 0
    let tracking = false
    let activeTouchId = null

    _overlay.addEventListener('click', function () {
      _closeSheet()
    })

    const closeBtn = _getEl('snapshot-close-btn')
    if (closeBtn) closeBtn.addEventListener('click', function () { _closeSheet() })

    function isHeaderOrFooter(target) {
      return !!(target.closest('.snapshot-sheet-header') || target.closest('.snapshot-sheet-footer'))
    }

    _panel.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) return
      const t = e.touches[0]
      const target = /** @type {HTMLElement} */(e.target)
      activeTouchId = t.identifier
      startY = t.clientY
      if (isHeaderOrFooter(target)) {
        tracking = true
        startScrollTop = 0
        return
      }
      const list = target.closest('.snapshot-list')
      if (list) {
        startScrollTop = list.scrollTop
        if (startScrollTop <= 0) {
          tracking = true
        }
      }
    }, { passive: true })

    _panel.addEventListener('touchmove', function (e) {
      if (!tracking) return
      const t = _findTouch(e.touches, activeTouchId)
      if (!t) return
      const dy = t.clientY - startY
      if (dy > 0) {
        _setPanelTranslate(dy)
        e.preventDefault()
      }
    }, { passive: false })

    function end(e) {
      if (!tracking) return
      const t = _findTouch(e.changedTouches, activeTouchId)
      const dy = t ? t.clientY - startY : 0
      tracking = false
      activeTouchId = null
      if (dy > 80) _closeSheet()
      else _setPanelTranslate(0)
    }
    _panel.addEventListener('touchend', end, { passive: true })
    _panel.addEventListener('touchcancel', end, { passive: true })
  }

  function _findTouch(list, id) {
    if (!list || id == null) return null
    for (let i = 0; i < list.length; i++) {
      if (list[i].identifier === id) return list[i]
    }
    return null
  }

  // 演示模式
  function setPresentationMode(on) {
    _presentationMode = !!on
    if (_presentationMode && !_isDesktop()) {
      _presentationMode = false
      if (App.toast && typeof App.toast.show === 'function') App.toast.show('演示模式仅在桌面空间可用')
      return
    }
    _updateMenuLabels()
    _updatePresentationButtons()
    if (App.toast && typeof App.toast.show === 'function') {
      App.toast.show(_presentationMode ? '演示模式已开启' : '演示模式已关闭')
    }
  }

  function isPresentationMode() {
    return _presentationMode
  }

  function _updatePresentationButtons() {
    const back = _getEl('bb-btn-back')
    const fwd = _getEl('bb-btn-forward')
    if (!back || !fwd) return
    if (_presentationMode) {
      back.classList.add('presentation-mode')
      fwd.classList.add('presentation-mode')
    } else {
      back.classList.remove('presentation-mode')
      fwd.classList.remove('presentation-mode')
    }
    updatePresentationState()
  }

  // 由 bottom-bar 调用：返回当前是否应走演示模式导航
  function updatePresentationState() {
    const back = _getEl('bb-btn-back')
    const fwd = _getEl('bb-btn-forward')
    if (!back || !fwd) return
    const rootId = _rootId()
    const flat = rootId ? App.SnapshotStore.flatSnapshots(rootId) : []
    const has = flat.length > 0
    if (!_presentationMode || !has) {
      if (App.BottomBar && typeof App.BottomBar.updateNavButtons === 'function') {
        App.BottomBar.updateNavButtons()
      }
      return
    }
    if (_currentIndex < 0 || _currentIndex >= flat.length) {
      _currentIndex = App.SnapshotStore.homeSnapshotIndex(flat, App.SnapshotStore.getInsertPosition())
    }
    back.removeAttribute('disabled')
    back.setAttribute('aria-disabled', 'false')
    fwd.removeAttribute('disabled')
    fwd.setAttribute('aria-disabled', 'false')
    if (_currentIndex <= 0) {
      back.setAttribute('disabled', '')
      back.setAttribute('aria-disabled', 'true')
    }
    if (_currentIndex >= flat.length - 1) {
      fwd.setAttribute('disabled', '')
      fwd.setAttribute('aria-disabled', 'true')
    }
  }

  function goNextSnapshot() {
    const rootId = _rootId()
    if (!_presentationMode || !rootId) return false
    const flat = App.SnapshotStore.flatSnapshots(rootId)
    if (_currentIndex < 0) _currentIndex = App.SnapshotStore.homeSnapshotIndex(flat, App.SnapshotStore.getInsertPosition())
    if (_currentIndex >= flat.length - 1) {
      if (App.toast && typeof App.toast.showAction === 'function') {
        App.toast.showAction('已经是最后一页了', '回到第一页', function () {
          _flyToIndex(0)
          updatePresentationState()
        })
      } else if (App.toast && typeof App.toast.show === 'function') {
        App.toast.show('已经是最后一页了')
      }
      return false
    }
    _flyToIndex(_currentIndex + 1)
    updatePresentationState()
    return true
  }

  function goPrevSnapshot() {
    const rootId = _rootId()
    if (!_presentationMode || !rootId) return false
    const flat = App.SnapshotStore.flatSnapshots(rootId)
    if (_currentIndex < 0) _currentIndex = App.SnapshotStore.homeSnapshotIndex(flat, App.SnapshotStore.getInsertPosition())
    if (_currentIndex <= 0) {
      const last = flat.length - 1
      if (App.toast && typeof App.toast.showAction === 'function') {
        App.toast.showAction('已经是第一页了', '回到最后一页', function () {
          _flyToIndex(last)
          updatePresentationState()
        })
      } else if (App.toast && typeof App.toast.show === 'function') {
        App.toast.show('已经是第一页了')
      }
      return false
    }
    _flyToIndex(_currentIndex - 1)
    updatePresentationState()
    return true
  }

  function refresh() {
    _renderList()
    _updateHomeHighlight()
    if (_presentationMode && !_isDesktop()) {
      setPresentationMode(false)
    }
  }

  function init() {
    _panel = _getEl('snapshot-sheet-panel')
    _overlay = _getEl('snapshot-sheet-overlay')
    _list = _getEl('snapshot-list')
    _menu = _getEl('snapshot-menu')
    if (!_panel || !_overlay || !_list) return

    _initBarSwipe()
    _initSheetDrag()

    const menuBtn = _getEl('snapshot-menu-btn')
    if (menuBtn) App.utils.bindPress(menuBtn, _toggleMenu)

    if (_menu) {
      _menu.addEventListener('click', function (e) {
        const btn = e.target.closest('[data-action]')
        if (btn && btn.dataset.action) _onMenuAction(btn.dataset.action)
      })
    }

    document.addEventListener('touchstart', function (e) {
      if (!_menu || _menu.classList.contains('snapshot-menu-hidden')) return
      if (e.target.closest('#snapshot-menu') || e.target.closest('#snapshot-menu-btn')) return
      _closeMenu()
    }, { passive: true })
  }

  return {
    init: init,
    refresh: refresh,
    open: _openSheet,
    close: _closeSheet,
    isOpen: function () { return _state === 'open' || _state === 'opening' },
    setPresentationMode: setPresentationMode,
    isPresentationMode: isPresentationMode,
    goNext: goNextSnapshot,
    goPrev: goPrevSnapshot,
    updatePresentationState: updatePresentationState,
    currentIndex: function () { return _currentIndex },
    setCurrentIndex: function (idx) { _currentIndex = idx; _markCurrentInList() }
  }
})()
