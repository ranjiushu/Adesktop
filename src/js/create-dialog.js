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
    _open = App.Dialog.open(OVERLAY_ID, close)
    let input = _getEl(INPUT_ID)
    if (input) {
      input.value = ''
      // 同步聚焦：open() 由加号 touchend 手势同步调用，仍在用户手势上下文内，
      // Android WebView 才允许拉起软键盘（延迟聚焦会脱离手势上下文导致不弹键盘）。
      // 延迟补一次：防 WebView 渲染时序吞掉同步焦点。
      input.focus()
      setTimeout(function () {
        if (document.activeElement !== input) input.focus()
      }, 120)
    }
  }

  function close() {
    if (!_open) return
    _open = false
    App.Dialog.close(OVERLAY_ID)
    // 创建/取消后收起软键盘：释放输入框焦点（WebView 内核检测焦点离开自动隐藏 IME）
    let input = _getEl(INPUT_ID)
    if (input && document.activeElement === input) input.blur()
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
