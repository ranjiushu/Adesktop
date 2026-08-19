/* 演示快照面板（App.SnapshotSheet）：底栏上滑呼出快照列表 + 循环演示。
 * 手势：底栏区域垂直上滑跟手抬出面板，下滑/点遮罩/点关闭按钮关闭。
 * 分组：标签栏横排在列表顶部（点击或左右滑动切换分组），列表只显示当前分组；
 *       长按标签重命名/删除分组，标签栏末尾 + 新建分组。
 * 操作模式（参考 LexiCull）：长按快照行进入——FAB morph 展开操作按钮
 *       （删除 / 移动到其它分组 / ✕ 退出）；操作模式下长按行拖动排序
 *       （边缘智能滚动），单击行切换选中（多选）。
 * 循环演示：无「演示模式」开关——桌面空间存在快照时，底栏前进/后退直接按全部
 *       分组扁平顺序循环翻页（无第一页/最后一页概念），从「当前页」进入；
 *       呼出列表时当前页高亮，点击任意快照即跳转并成为当前页。
 * 编号：快照带字母编号（页代码，创建时分配，拖动排序不变）+ 页码（扁平顺序，排序后更新）。
 * 依赖: namespace.js, utils.js, drag-sort.js, snapshot-store.js, fab-speed-dial.js,
 *       desktop-core.js, desktop-navigation.js, bottom-bar.js, toast.js, bridge.js
 * 导出: App.SnapshotSheet
 */
'use strict'

App.SnapshotSheet = (function () {
  const C = App.DesktopCore
  const TAN_VERTICAL = 2.14       // tan(65°)，超过此角度视为垂直上滑
  const SWIPE_THRESHOLD = 24      // 上滑激活阈值 px
  const DEADZONE = 6              // 决策死区 px
  const TAB_SWIPE_X = 60          // 列表内左右滑动切换分组的水平位移阈值 px
  const TAB_SWIPE_RATIO = 1.5     // 水平判定：|dx| > |dy| * ratio
  const LP_MS = 500               // 长按进入操作模式/触发拖拽
  const LP_TOL = 10               // 长按容差 px（静置微抖不取消，滚动/滑动取消）

  /** @type {'closed' | 'opening' | 'open' | 'closing'} */
  let _state = 'closed'
  /** @type {HTMLElement | null} */
  let _panel = null
  /** @type {HTMLElement | null} */
  let _overlay = null
  /** @type {HTMLElement | null} */
  let _list = null
  /** @type {HTMLElement | null} */
  let _tabs = null
  /** @type {HTMLElement | null} */
  let _menu = null
  /** @type {HTMLElement | null} */
  let _moveOverlay = null
  /** @type {any} */
  let _dragEngine = null
  /** @type {SnapshotData | null} */
  let _currentData = null
  /** @type {number} */
  let _currentGroupIdx = 0
  /** @type {number} 扁平索引（所有分组快照按顺序），演示循环与跨组选中共用 */
  let _currentIndex = -1
  /** @type {boolean} 操作模式（长按快照行进入，FAB morph 展开操作按钮） */
  let _opMode = false
  /** @type {Set<string>} 操作模式选中快照 id */
  let _opSelection = new Set()
  /** @type {{deciding: boolean, active: boolean, sx: number, sy: number} | null} */
  let _swipe = null
  /** @type {number | null} */
  let _openRaf = null
  /** @type {{sx: number, sy: number, id: number | null} | null} */
  let _tabSwipe = null

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

  // 刷新底栏状态：Home 锚点高亮 + 前进/后退可用态（演示循环开启与否由 BottomBar 判定）
  function _updateHomeHighlight() {
    if (App.BottomBar && typeof App.BottomBar.updateHomeState === 'function') {
      App.BottomBar.updateHomeState()
    }
    if (App.BottomBar && typeof App.BottomBar.updateNavButtons === 'function') {
      App.BottomBar.updateNavButtons()
    }
  }

  // 解析「当前页」扁平索引：已访问过快照 → 沿用；从未访问 → 用相机匹配最近快照
  //（当前视角恰好在某快照上，如 reload 后落回快照位）；仍不匹配 → -1（前进=第 1 页，后退=最后一页）。
  /** @returns {number} */
  function _resolveCurrentIndex() {
    const flat = _flatSnapshots()
    if (flat.length === 0) return -1
    if (_currentIndex >= 0 && _currentIndex < flat.length) return _currentIndex
    const m = _matchSnapshotByCamera(flat)
    if (m >= 0) _currentIndex = m
    return _currentIndex
  }

  /** @param {Array<Snapshot>} flat @returns {number} */
  function _matchSnapshotByCamera(flat) {
    const c = C.camera
    if (!c) return -1
    let best = -1
    let bestDist = Infinity
    flat.forEach(function (s, i) {
      if ((s.camera.rotation || 0) !== (c.rotation || 0)) return
      const dx = s.camera.x - c.x
      const dy = s.camera.y - c.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      const z1 = s.camera.zoom || 1
      const z2 = c.zoom || 1
      const zoomRatio = Math.max(z1 / z2, z2 / z1)
      if (dist <= 24 && zoomRatio <= 1.25 && dist < bestDist) {
        bestDist = dist
        best = i
      }
    })
    return best
  }

  // ── 渲染：标签栏 + 当前分组列表 ──
  function _renderList() {
    _renderTabs()
    _renderGroupList()
  }

  function _renderTabs() {
    if (!_tabs) return
    const data = _data()
    _tabs.innerHTML = ''
    data.groups.forEach(function (group, idx) {
      const tab = document.createElement('button')
      tab.className = 'snapshot-tab' + (idx === _currentGroupIdx ? ' snapshot-tab-active' : '')
      tab.setAttribute('role', 'tab')
      tab.setAttribute('aria-selected', idx === _currentGroupIdx ? 'true' : 'false')
      tab.dataset.groupIdx = String(idx)

      const name = document.createElement('span')
      name.className = 'snapshot-tab-name'
      name.textContent = group.name
      tab.appendChild(name)

      const count = document.createElement('span')
      count.className = 'snapshot-tab-count'
      count.textContent = String(group.snapshots.length)
      tab.appendChild(count)

      // 点击切换分组；长按弹出分组菜单（重命名 / 删除）
      App.utils.bindPressSplit(tab, {
        onTap: function () { _switchGroup(idx) },
        onLongPress: function () { _openTabMenu(idx) }
      }, { longPressMs: LP_MS, moveThreshold: 12 })

      _tabs.appendChild(tab)
    })

    // 新建分组按钮
    const add = document.createElement('button')
    add.className = 'snapshot-tab-add'
    add.setAttribute('aria-label', '新建分组')
    add.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>'
    App.utils.bindPress(add, function () { _promptNewGroup() })
    _tabs.appendChild(add)

    // 当前 tab 滚入视野
    const activeTab = _tabs.querySelector('.snapshot-tab-active')
    if (activeTab && typeof activeTab.scrollIntoView === 'function') {
      activeTab.scrollIntoView({ inline: 'nearest', block: 'nearest' })
    }
  }

  function _renderGroupList() {
    if (!_list) return
    const data = _data()
    _currentData = data
    _cleanupDragEngine()
    _list.innerHTML = ''

    const group = data.groups[_currentGroupIdx]
    if (!group || group.snapshots.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'snapshot-empty'
      empty.textContent = group ? '此分组暂无快照，长按底栏 Home 记录' : '长按底栏 Home 记录快照'
      _list.appendChild(empty)
      return
    }
    group.snapshots.forEach(function (s, idx) {
      const item = _createSnapshotItem(s, _currentGroupIdx, idx)
      _list.appendChild(item)
    })
    _bindGroupDrag(_list, _currentGroupIdx)
    _markCurrentInList()
    _syncOpSelection()
  }

  function _createSnapshotItem(s, groupIdx, idx) {
    const item = document.createElement('div')
    item.className = 'snapshot-item'
    item.dataset.id = s.id
    item.dataset.groupIdx = String(groupIdx)
    item.dataset.index = String(idx)
    if (_opSelection.has(s.id)) item.classList.add('op-selected')

    // 字母编号徽标（页代码，随快照稳定）+ 名称 + 页码（扁平顺序，排序后更新）
    const code = document.createElement('span')
    code.className = 'snapshot-code'
    code.textContent = s.code || '?'

    const name = document.createElement('span')
    name.className = 'snapshot-name'
    name.textContent = s.name

    const meta = document.createElement('span')
    meta.className = 'snapshot-meta'
    const flatIdx = _findSnapshotFlatIndex(s.id)
    meta.textContent = '第 ' + (flatIdx + 1) + ' 页'

    item.appendChild(code)
    item.appendChild(name)
    item.appendChild(meta)

    // 长按 500ms（10px 容差）：普通模式 = 进入操作模式 + 选中 + 直接拖拽排序；
    // 操作模式 = 直接拖拽排序。单击：操作模式切换选中，普通模式飞行。
    // 滚动/滑动（位移 > 10px 或手指滑出行外）不算点击（参考 LexiCull SWIPE_THRESHOLD）。
    let lpTimer = null
    let lpStartX = 0
    let lpStartY = 0
    let lpLastY = 0
    let lpHandled = false
    let lpMoved = false

    item.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) return
      if (_tabSwipe) _tabSwipe = null
      lpHandled = false
      lpMoved = false
      lpStartX = e.touches[0].clientX
      lpStartY = e.touches[0].clientY
      lpLastY = lpStartY
      lpTimer = setTimeout(function () {
        lpTimer = null
        lpHandled = true
        if (!_opMode) _enterOpMode(groupIdx, s.id)
        if (_dragEngine && typeof _dragEngine.isDragging === 'function' && !_dragEngine.isDragging()) {
          _dragEngine.startDrag(item, lpLastY)
        }
      }, LP_MS)
    }, { passive: true })

    item.addEventListener('touchmove', function (e) {
      const t = e.touches[0]
      lpLastY = t.clientY
      if (lpHandled) return // 拖拽中：drag-sort 全权接管，不做 tap/长按判定
      if (!lpTimer) return
      const r = item.getBoundingClientRect()
      if (Math.abs(t.clientX - lpStartX) > LP_TOL || Math.abs(t.clientY - lpStartY) > LP_TOL ||
          t.clientX < r.left - 12 || t.clientX > r.right + 12 ||
          t.clientY < r.top - 12 || t.clientY > r.bottom + 12) {
        lpMoved = true
        clearTimeout(lpTimer)
        lpTimer = null
      }
    }, { passive: true })

    item.addEventListener('touchend', function () {
      if (lpTimer) { clearTimeout(lpTimer); lpTimer = null }
      if (lpHandled) { lpHandled = false; return } // 长按已处理（操作模式/拖拽），不再做 tap
      if (lpMoved) { lpMoved = false; return }     // 滚动/滑动手势不算点击
      if (item.dataset._dragSortJustFinished === '1') return
      if (_opMode) {
        _toggleOpSelect(s.id)
      } else {
        _flyToSnapshot(groupIdx, idx)
      }
    }, { passive: true })

    item.addEventListener('touchcancel', function () {
      if (lpTimer) { clearTimeout(lpTimer); lpTimer = null }
      lpHandled = false
      lpMoved = false
    }, { passive: true })

    return item
  }

  function _cleanupDragEngine() {
    if (_dragEngine && typeof _dragEngine.cleanup === 'function') _dragEngine.cleanup()
    _dragEngine = null
  }

  function _bindGroupDrag(container, groupIdx) {
    _dragEngine = App.dragSort.createDragSortEngine({
      container: container,
      itemSelector: '.snapshot-item',
      dragClass: 'snapshot-item-dragging',
      dragActiveClass: 'snapshot-list-dragging',
      targetClass: 'snapshot-item-target',
      isActive: function () { return _opMode },
      onDragActivate: function () {
        // 拖动手势真正开始 → 清空选中（拖动即排序，不留选中态）
        _opSelection.clear()
        _syncOpSelection()
      },
      onCommit: function (from, to) { _commitReorder(groupIdx, from, to) },
      edgeZone: 56,
      edgeInsetTop: 0,
      edgeInsetBottom: function () {
        // 有效边缘内缩到列表可视底缘（footer 关闭条 + 安全区）之上：
        // 手指搭在关闭条上也吃到越界加速（参考 LexiCull 底栏遮挡内缩思路）
        const footer = document.querySelector('.snapshot-sheet-footer')
        const footerH = footer ? footer.offsetHeight : 0
        return footerH + parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-bottom') || '0')
      }
    })
  }

  // ── 操作模式 ──
  function _enterOpMode(groupIdx, snapshotId) {
    if (_opMode) return
    _opMode = true
    _opSelection = new Set([snapshotId])
    document.body.classList.add('snapshot-op-mode')
    if (_list) _list.classList.add('op-mode')
    _syncOpSelection()
    // FAB morph 展开操作按钮（若被桌面 selection 态占用先收起）
    if (App.fabSpeedDial) {
      if (App.fabSpeedDial.getState && App.fabSpeedDial.getState().mode !== 'collapsed') {
        App.fabSpeedDial.collapse()
      }
      if (typeof App.fabSpeedDial.expand === 'function') {
        App.fabSpeedDial.expand('snapshot-operation')
      }
    }
    if (App.bridge && typeof App.bridge.vibrate === 'function') App.bridge.vibrate(20)
    if (App.toast && typeof App.toast.show === 'function') {
      App.toast.show('长按拖动排序，单击多选，点 FAB 操作')
    }
  }

  function exitOpMode() {
    if (!_opMode) return
    _opMode = false
    _opSelection.clear()
    document.body.classList.remove('snapshot-op-mode')
    if (_list) _list.classList.remove('op-mode')
    _syncOpSelection()
    if (App.fabSpeedDial && App.fabSpeedDial.getState &&
        App.fabSpeedDial.getState().mode === 'snapshot-operation') {
      App.fabSpeedDial.collapse() // collapse 会回调 exitOpMode，_opMode 已 false 防重入
    }
  }

  function _syncOpSelection() {
    if (!_list) return
    Array.prototype.forEach.call(_list.querySelectorAll('.snapshot-item'), function (el) {
      el.classList.toggle('op-selected', _opSelection.has(/** @type {string} */(el.dataset.id)))
    })
  }

  function _toggleOpSelect(snapshotId) {
    if (_opSelection.has(snapshotId)) _opSelection.delete(snapshotId)
    else _opSelection.add(snapshotId)
    _syncOpSelection()
    if (App.bridge && typeof App.bridge.vibrate === 'function') App.bridge.vibrate(10)
    if (_opSelection.size === 0) {
      // 全部取消选中 → 退出操作模式（语义收敛：FAB 展开 ⇔ 选中态一致）
      exitOpMode()
    }
  }

  // FAB 操作按钮路由（fab-speed-dial 调用）
  function onFabAction(action) {
    if (action === 'snapshot-delete') _deleteSelected()
    else if (action === 'snapshot-move') _showMovePicker()
  }

  function _selectedSnapshotIds() {
    const flat = _flatSnapshots()
    const ids = []
    flat.forEach(function (s) {
      if (_opSelection.has(s.id)) ids.push(s.id)
    })
    return ids
  }

  function _deleteSelected() {
    const rootId = _rootId()
    const ids = _selectedSnapshotIds()
    if (!rootId || ids.length === 0) {
      if (App.toast && typeof App.toast.show === 'function') App.toast.show('请先选中快照')
      return
    }
    if (!window.confirm('删除选中的 ' + ids.length + ' 个快照？')) return
    let data = App.SnapshotStore.load(rootId)
    ids.forEach(function (id) {
      const found = App.SnapshotStore.findIndex(data, id)
      if (found) {
        data = App.SnapshotStore.delete(data, data.groups[found.groupIdx].id, id)
      }
    })
    App.SnapshotStore.save(data, rootId)
    _opSelection.clear()
    _currentIndex = -1
    _renderList()
    _updateHomeHighlight()
    exitOpMode()
    if (App.toast && typeof App.toast.show === 'function') App.toast.show('已删除 ' + ids.length + ' 个快照')
  }

  // ── 移动分组选择浮层（面板内覆盖）──
  function _showMovePicker() {
    const rootId = _rootId()
    const ids = _selectedSnapshotIds()
    if (!rootId || ids.length === 0) {
      if (App.toast && typeof App.toast.show === 'function') App.toast.show('请先选中快照')
      return
    }
    if (!_panel) return
    const data = App.SnapshotStore.load(rootId)
    const curGroup = data.groups[_currentGroupIdx]
    _closeMovePicker()
    const overlay = document.createElement('div')
    overlay.className = 'snapshot-move-overlay'
    const title = document.createElement('div')
    title.className = 'snapshot-move-title'
    title.textContent = '移动 ' + ids.length + ' 个快照到分组'
    overlay.appendChild(title)

    const listEl = document.createElement('div')
    listEl.className = 'snapshot-move-list'
    data.groups.forEach(function (g) {
      if (curGroup && g.id === curGroup.id) return
      const btn = document.createElement('button')
      btn.className = 'snapshot-move-item'
      const name = document.createElement('span')
      name.textContent = g.name
      const count = document.createElement('span')
      count.className = 'snapshot-move-count'
      count.textContent = g.snapshots.length + ' 个'
      btn.appendChild(name)
      btn.appendChild(count)
      btn.addEventListener('click', function () {
        _doMove(rootId, curGroup.id, g.id, ids)
      })
      listEl.appendChild(btn)
    })
    overlay.appendChild(listEl)

    const cancel = document.createElement('button')
    cancel.className = 'snapshot-move-cancel'
    cancel.textContent = '取消'
    cancel.addEventListener('click', function () { _closeMovePicker() })
    overlay.appendChild(cancel)

    _panel.appendChild(overlay)
    _moveOverlay = overlay
  }

  function _closeMovePicker() {
    if (_moveOverlay && _moveOverlay.parentNode) {
      _moveOverlay.parentNode.removeChild(_moveOverlay)
    }
    _moveOverlay = null
  }

  function _doMove(rootId, fromGroupId, toGroupId, ids) {
    let data = App.SnapshotStore.load(rootId)
    data = App.SnapshotStore.move(data, fromGroupId, toGroupId, ids)
    App.SnapshotStore.save(data, rootId)
    _closeMovePicker()
    _opSelection.clear()
    _currentIndex = -1
    // 切到目标分组 tab
    const targetIdx = data.groups.findIndex(function (g) { return g.id === toGroupId })
    if (targetIdx >= 0) _currentGroupIdx = targetIdx
    _renderList()
    _updateHomeHighlight()
    exitOpMode()
    if (App.toast && typeof App.toast.show === 'function') App.toast.show('已移动 ' + ids.length + ' 个快照')
  }

  // 切换分组（点击 tab）
  function _switchGroup(idx) {
    const data = _data()
    if (idx < 0 || idx >= data.groups.length || idx === _currentGroupIdx) return
    exitOpMode() // 跨组切换退出操作模式，防下标错位
    _closeMovePicker()
    _currentGroupIdx = idx
    _renderGroupList()
    if (_list) _list.scrollTop = 0
    _updateTabActive()
  }

  function _updateTabActive() {
    if (!_tabs) return
    Array.prototype.forEach.call(_tabs.querySelectorAll('.snapshot-tab'), function (tab) {
      const on = Number(tab.dataset.groupIdx) === _currentGroupIdx
      tab.classList.toggle('snapshot-tab-active', on)
      tab.setAttribute('aria-selected', on ? 'true' : 'false')
    })
  }

  // ── 分组菜单（长按标签）：重命名 / 删除 ──
  function _openTabMenu(groupIdx) {
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
      if (_currentGroupIdx >= data.groups.length - 1) {
        _currentGroupIdx = Math.max(0, data.groups.length - 2)
      }
      _currentIndex = -1
    }
    _renderList()
    _updateHomeHighlight()
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
    // 新建分组后切换到新分组 tab
    const data = _data()
    _currentGroupIdx = Math.max(0, data.groups.length - 1)
    _renderList()
    if (App.toast && typeof App.toast.show === 'function') App.toast.show('已创建分组：' + result.group.name)
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
    const flat = _flatSnapshots()
    const cur = _resolveCurrentIndex()
    const currentId = flat[cur] ? flat[cur].id : null
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
    // 排序后扁平顺序变化：重置当前页索引，由相机匹配重新锚定（字母编号不变）
    _currentIndex = -1
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
    const pos = App.SnapshotStore.getInsertPosition()
    const topBtn = _menu.querySelector('[data-action="insert-top"]')
    const bottomBtn = _menu.querySelector('[data-action="insert-bottom"]')
    if (topBtn) topBtn.textContent = (pos === 'top' ? '✓ ' : '') + '新快照插入顶部'
    if (bottomBtn) bottomBtn.textContent = (pos === 'bottom' ? '✓ ' : '') + '新快照插入底部'
  }

  function _onMenuAction(action) {
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
    // 默认打开第一个分组 tab（Home 与快照彻底分离，无 Home 位概念）；
    // 解析「当前页」供列表高亮（相机匹配，未访问过快照时）
    _currentGroupIdx = 0
    _resolveCurrentIndex()
    _renderList()
    _updateHomeHighlight()
    document.body.classList.add('snapshot-sheet-open')
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
    _closeMovePicker()
    exitOpMode()
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
        document.body.classList.remove('snapshot-sheet-open')
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

  // 列表内左右滑动切换分组（tab swipe）
  function _initTabSwipe() {
    if (!_list) return
    _list.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) return
      // 拖动排序进行中 / 操作模式长按中不响应
      if (App.dragSort && App.dragSort.isDragSortActive && App.dragSort.isDragSortActive()) return
      const t = e.touches[0]
      _tabSwipe = { sx: t.clientX, sy: t.clientY, id: t.identifier }
    }, { passive: true })

    _list.addEventListener('touchend', function (e) {
      if (!_tabSwipe) return
      const t = _findTouch(e.changedTouches, _tabSwipe.id)
      const dx = t ? t.clientX - _tabSwipe.sx : 0
      const dy = t ? t.clientY - _tabSwipe.sy : 0
      _tabSwipe = null
      if (Math.abs(dx) < TAB_SWIPE_X) return
      if (Math.abs(dy) > Math.abs(dx) / TAB_SWIPE_RATIO) return
      const data = _data()
      if (dx < 0 && _currentGroupIdx < data.groups.length - 1) {
        _switchGroup(_currentGroupIdx + 1)
      } else if (dx > 0 && _currentGroupIdx > 0) {
        _switchGroup(_currentGroupIdx - 1)
      }
    }, { passive: true })
    _list.addEventListener('touchcancel', function () {
      _tabSwipe = null
    }, { passive: true })
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
      // 拖拽排序活跃时不参与面板关闭手势
      if (App.dragSort && App.dragSort.isDragSortActive && App.dragSort.isDragSortActive()) return
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
      // 拖拽排序活跃：面板让权，drag-sort 全权接管（不位移面板、不 preventDefault）
      if (App.dragSort && App.dragSort.isDragSortActive && App.dragSort.isDragSortActive()) {
        tracking = false
        return
      }
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

  // 循环演示：桌面空间存在快照时，前进/后退直接按全部分组扁平顺序循环翻页
  //（无第一页/最后一页概念，无边界禁用）；从「当前页」进入——当前页 = 已访问的
  // 快照（或相机匹配到的最近快照），从未进入过时前进 = 第 1 页、后退 = 最后一页。

  /** @returns {boolean} 是否处于可循环演示状态（桌面空间 + 有快照） */
  function _canLoop() {
    if (!_isDesktop()) return false
    const rootId = _rootId()
    if (!rootId) return false
    const flat = App.SnapshotStore.flatSnapshots(rootId)
    return flat.length > 0
  }

  /** @returns {boolean} */
  function goNextSnapshot() {
    if (!_canLoop()) return false
    const rootId = _rootId()
    const flat = App.SnapshotStore.flatSnapshots(rootId)
    const cur = _resolveCurrentIndex()
    const next = (cur + 1) % flat.length
    _flyToIndex(next)
    return true
  }

  /** @returns {boolean} */
  function goPrevSnapshot() {
    if (!_canLoop()) return false
    const rootId = _rootId()
    const flat = App.SnapshotStore.flatSnapshots(rootId)
    const cur = _resolveCurrentIndex()
    const prev = (cur - 1 + flat.length) % flat.length
    _flyToIndex(prev)
    return true
  }

  function refresh() {
    _renderList()
    _updateHomeHighlight()
  }

  function init() {
    _panel = _getEl('snapshot-sheet-panel')
    _overlay = _getEl('snapshot-sheet-overlay')
    _list = _getEl('snapshot-list')
    _tabs = _getEl('snapshot-tabs')
    _menu = _getEl('snapshot-menu')
    if (!_panel || !_overlay || !_list || !_tabs) return

    _initBarSwipe()
    _initSheetDrag()
    _initTabSwipe()

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
    goNext: goNextSnapshot,
    goPrev: goPrevSnapshot,
    currentIndex: function () { return _currentIndex },
    setCurrentIndex: function (idx) { _currentIndex = idx; _markCurrentInList() },
    isOpMode: function () { return _opMode },
    exitOpMode: exitOpMode,
    onFabAction: onFabAction
  }
})()
