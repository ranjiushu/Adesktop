/* 职责: Morph FAB Speed Dial——点击 FAB 展开/收起多按钮菜单（移植自 LexiCull，动作适配文件系统）
 * 依赖: namespace.js, utils.js, bridge.js, toast.js, file-api.js, desktop.js
 * 导出: App.fabSpeedDial
 * 副作用: 管理子按钮事件、遮罩、展开/收起动画与 FAB 图标状态
 * 触发: 短按 FAB = 展开菜单；长按 800ms = 取景器（inspector.js 接管）
 */
'use strict'

App.fabSpeedDial = (function () {
  var SPEED_DIAL_ID = 'fab-speed-dial'
  var BACKDROP_ID = 'fab-backdrop'
  var FAB_ID = 'mode-switch-fab'

  var _expanded = false
  var _mode = null

  function _getEl(id) { return document.getElementById(id) }

  // ── 动作路由（共享 App.Actions，与 Drawer 同源） ──
  function _onChildClick(e) {
    var action = this.getAttribute('data-action')
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
    var fab = _getEl(FAB_ID), sd = _getEl(SPEED_DIAL_ID), bd = _getEl(BACKDROP_ID)
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
    var fab = _getEl(FAB_ID), sd = _getEl(SPEED_DIAL_ID), bd = _getEl(BACKDROP_ID)
    if (bd) bd.classList.remove('fab-backdrop-visible')
    if (fab) fab.classList.remove('fab-speed-dial-active')
    if (sd) { sd.classList.remove('fab-speed-dial-expanded'); sd.removeAttribute('data-mode') }
  }

  function isExpanded() { return _expanded }
  function getMode() { return _mode }
  function getState() { return { expanded: _expanded, mode: _mode } }

  // ── 初始化 ──
  function init() {
    var bd = _getEl(BACKDROP_ID)
    if (bd) App.utils.bindPress(bd, _onBackdropClick)
    var sd = _getEl(SPEED_DIAL_ID)
    if (sd) {
      var children = sd.querySelectorAll('.fab-child')
      for (var i = 0; i < children.length; i++) {
        App.utils.bindPress(children[i], _onChildClick)
      }
    }
    var fab = _getEl(FAB_ID)
    if (fab) fab.classList.add('fab-speed-dial-ready')
  }

  return {
    expand: expand,
    collapse: collapse,
    isExpanded: isExpanded,
    getMode: getMode,
    getState: getState,
    init: init
  }
})()
