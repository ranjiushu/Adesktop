/* 职责: Morph FAB Speed Dial——点击 FAB 展开/收起多按钮菜单（移植自 LexiCull，动作适配文件系统）
 * 依赖: namespace.js, utils.js, bridge.js, toast.js, file-api.js, desktop.js
 * 导出: App.fabSpeedDial
 * 副作用: 管理子按钮事件、遮罩、展开/收起动画与 FAB 图标状态
 * 触发: 短按 FAB = 展开菜单；长按 800ms = 取景器（inspector.js 接管）
 */
'use strict'

App.fabSpeedDial = (function () {
  let SPEED_DIAL_ID = 'fab-speed-dial'
  let BACKDROP_ID = 'fab-backdrop'
  let FAB_ID = 'mode-switch-fab'

  let _expanded = false
  let _mode = null
  let _selectionActive = false

  function _getEl(id) { return document.getElementById(id) }

  // ── 动作路由（共享 App.Actions，与 Drawer 同源） ──
  function _onChildClick(e) {
    let action = this.getAttribute('data-action')
    if (!action) return
    switch (action) {
      case 'close-speed-dial':
        collapse()
        return
      case 'new-folder':
        App.Actions.createFolder()
        break
      case 'new-file':
        App.Actions.createFile()
        break
      case 'refresh':
        App.Actions.refresh()
        break
      case 'switch-root':
        collapse()
        App.Actions.switchRoot()
        return
      case 'clear-selection':
        if (App.Desktop && typeof App.Desktop.clearSelection === 'function') {
          App.Desktop.clearSelection()
        }
        collapse()
        return
      case 'open':
      case 'rename':
      case 'delete':
      case 'properties':
        // 阶段 C 实现操作动作，阶段 B 占位
        if (App.toast) App.toast.show('操作「' + action + '」阶段 C 实现')
        collapse()
        return
    }
    collapse()
  }

  // ── 遮罩点击 ──
  function _onBackdropClick(e) {
    e.preventDefault()
    e.stopPropagation()
    collapse()
  }

  // ── 展开 ──
  function expand(mode) {
    if (_expanded) return
    _expanded = true
    _mode = mode || 'desktop'
    let fab = _getEl(FAB_ID), sd = _getEl(SPEED_DIAL_ID), bd = _getEl(BACKDROP_ID)
    if (!fab || !sd) return
    sd.setAttribute('data-mode', _mode)
    if (bd) bd.classList.add('fab-backdrop-visible')
    sd.classList.add('fab-speed-dial-expanded')
    fab.classList.add('fab-speed-dial-active')
    App.bridge.vibrate()
  }

  // ── 收起 ──
  function collapse() {
    if (!_expanded) return
    _expanded = false
    _mode = null
    let fab = _getEl(FAB_ID), sd = _getEl(SPEED_DIAL_ID), bd = _getEl(BACKDROP_ID)
    if (bd) bd.classList.remove('fab-backdrop-visible')
    if (fab) fab.classList.remove('fab-speed-dial-active')
    if (sd) { sd.classList.remove('fab-speed-dial-expanded'); sd.removeAttribute('data-mode') }
  }

  function isExpanded() { return _expanded }
  function getMode() { return _mode }
  function getState() { return { expanded: _expanded, mode: _mode } }

  // 选中态驱动：非空 → 自动展开 selection 按钮集；空 → 收起
  // 选中态操作栏是「非模态」的：不加全屏遮罩，桌面保持可交互（长按拖拽/框选/点空白清空）
  function setSelection(hasSelection) {
    _selectionActive = !!hasSelection
    let fab = _getEl(FAB_ID)
    let sd = _getEl(SPEED_DIAL_ID)
    let bd = _getEl(BACKDROP_ID)
    if (!fab || !sd) return
    if (hasSelection) {
      _expanded = true
      _mode = 'selection'
      sd.setAttribute('data-mode', 'selection')
      if (bd) bd.classList.remove('fab-backdrop-visible')
      sd.classList.add('fab-speed-dial-expanded')
      fab.classList.add('fab-speed-dial-active')
    } else {
      collapse()
    }
  }

  function isSelectionActive() { return _selectionActive }

  // ── 初始化 ──
  function init() {
    let bd = _getEl(BACKDROP_ID)
    if (bd) App.utils.bindPress(bd, _onBackdropClick)
    let sd = _getEl(SPEED_DIAL_ID)
    if (sd) {
      let children = sd.querySelectorAll('.fab-child')
      for (let i = 0; i < children.length; i++) {
        App.utils.bindPress(children[i], _onChildClick)
      }
    }
    let fab = _getEl(FAB_ID)
    if (fab) fab.classList.add('fab-speed-dial-ready')
  }

  return {
    expand: expand,
    collapse: collapse,
    isExpanded: isExpanded,
    getMode: getMode,
    getState: getState,
    setSelection: setSelection,
    isSelectionActive: isSelectionActive,
    init: init
  }
})()
