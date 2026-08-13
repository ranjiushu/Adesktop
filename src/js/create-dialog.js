/* 新建对话框：加号弹出。输入名称，点「文件/文件夹」按对应类型创建（名称原样使用，
 * 不自动补后缀；重名由 App.Actions 自动加序号）。
 * 依赖: namespace.js, utils.js, actions.js, toast.js
 * 导出: App.CreateDialog
 * 触发: 底栏中间加号（bottom-bar.js 绑定）
 */
'use strict'

App.CreateDialog = (function () {
  let OVERLAY_ID = 'create-dialog-overlay'
  let INPUT_ID = 'create-name'
  let _open = false

  function _getEl(id) { return document.getElementById(id) }

  function open() {
    if (_open) return
    _open = true
    let o = _getEl(OVERLAY_ID)
    if (o) {
      o.classList.add('dialog-overlay-visible')
      o.setAttribute('aria-hidden', 'false')
    }
    let input = _getEl(INPUT_ID)
    if (input) {
      input.value = ''
      // 延迟聚焦：等 overlay 可见后再拉起软键盘（WebView 下立即聚焦可能被吞）
      setTimeout(function () { input.focus() }, 120)
    }
  }

  function close() {
    if (!_open) return
    _open = false
    let o = _getEl(OVERLAY_ID)
    if (o) {
      o.classList.remove('dialog-overlay-visible')
      o.setAttribute('aria-hidden', 'true')
    }
  }

  function isOpen() { return _open }

  // 读取输入名（原样，不做后缀处理），关闭后按类型创建
  function _submit(isFolder) {
    let input = _getEl(INPUT_ID)
    let name = input ? input.value.trim() : ''
    close()
    if (isFolder) {
      App.Actions.createFolder(name)
    } else {
      App.Actions.createFile(name)
    }
  }

  function init() {
    let fileBtn = document.getElementById('create-file')
    if (fileBtn) App.utils.bindPress(fileBtn, function () { _submit(false) })
    let folderBtn = document.getElementById('create-folder')
    if (folderBtn) App.utils.bindPress(folderBtn, function () { _submit(true) })
    let cancel = document.getElementById('create-cancel')
    if (cancel) App.utils.bindPress(cancel, close)
    let overlay = _getEl(OVERLAY_ID)
    if (overlay) App.utils.bindPress(overlay, function (e) {
      // 仅点击遮罩空白（非对话框本体）时关闭
      if (e.target === overlay) close()
    })
    // 软键盘「完成」键 = 创建文件（最常见操作）
    let input = _getEl(INPUT_ID)
    if (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.keyCode === 13) {
          e.preventDefault()
          _submit(false)
        }
      })
    }
  }

  return {
    open: open,
    close: close,
    isOpen: isOpen,
    init: init
  }
})()
