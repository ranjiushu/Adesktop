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

  // ── 动作路由（Desktop：文件系统操作） ──
  function _onChildClick(e) {
    var action = this.getAttribute('data-action')
    if (!action) return
    switch (action) {
      case 'close-speed-dial':
        collapse()
        return
      case 'new-folder':
        _createFolder()
        break
      case 'new-file':
        _createFile()
        break
      case 'refresh':
        App.Desktop.refresh()
        App.toast.show('已刷新')
        break
      case 'switch-root':
        collapse()
        if (!App.bridge.requestRootAccess()) {
          App.toast.show('当前环境不支持切换根目录')
        }
        return
    }
    collapse()
  }

  // ── 新建文件夹（重名自动加序号） ──
  function _createFolder() {
    var base = '新建文件夹'
    var name = base
    var seq = 2
    App.FileAPI.list('').then(function (items) {
      function exists(n) {
        for (var i = 0; i < items.length; i++) {
          if (items[i].name === n && items[i].isDir) return true
        }
        return false
      }
      while (exists(name)) { name = base + ' ' + seq; seq++ }
      return App.FileAPI.mkdir(name)
    }).then(function () {
      App.toast.show('已创建文件夹')
      App.Desktop.refresh()
    }).catch(function (err) {
      App.toast.show('创建失败: ' + err.message)
    })
  }

  // ── 新建文本文件（重名自动加序号） ──
  function _createFile() {
    var base = '新建文件.txt'
    var name = base
    var seq = 2
    App.FileAPI.list('').then(function (items) {
      function exists(n) {
        for (var i = 0; i < items.length; i++) {
          if (items[i].name === n && !items[i].isDir) return true
        }
        return false
      }
      while (exists(name)) { name = '新建文件 ' + seq + '.txt'; seq++ }
      return App.FileAPI.write(name, '')
    }).then(function () {
      App.toast.show('已创建文件')
      App.Desktop.refresh()
    }).catch(function (err) {
      App.toast.show('创建失败: ' + err.message)
    })
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
