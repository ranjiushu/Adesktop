/* 新建对话框：加号弹出。输入名称 + 文件/文件夹单选，确定后走 App.Actions。
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

  // 确定：读取名称与类型，委托 App.Actions 创建（重名自动加序号）
  function _submit() {
    let input = _getEl(INPUT_ID)
    let name = input ? input.value.trim() : ''
    let typeEl = document.querySelector('input[name="create-type"]:checked')
    let isFolder = typeEl && typeEl.value === 'folder'
    close()
    if (isFolder) {
      App.Actions.createFolder(name)
    } else {
      App.Actions.createFile(name)
    }
  }

  function init() {
    let ok = document.getElementById('create-ok')
    if (ok) App.utils.bindPress(ok, _submit)
    let cancel = document.getElementById('create-cancel')
    if (cancel) App.utils.bindPress(cancel, close)
    let overlay = _getEl(OVERLAY_ID)
    if (overlay) App.utils.bindPress(overlay, function (e) {
      // 仅点击遮罩空白（非对话框本体）时关闭
      if (e.target === overlay) close()
    })
    // 软键盘「完成」键 = 确定
    let input = _getEl(INPUT_ID)
    if (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.keyCode === 13) {
          e.preventDefault()
          _submit()
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
