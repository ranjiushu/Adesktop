/* 重命名对话框：选中态操作栏「重命名」弹出。输入新名，确认后执行重命名。
 * 复用 create-dialog 的对话框样式（dialog.css）；预填原名 + 聚焦全选。
 * 依赖: namespace.js, utils.js, actions.js, toast.js, dialog.js
 * 导出: App.RenameDialog
 * 触发: fab-speed-dial.js 路由 rename 动作
 */
// @ts-check
'use strict'

App.RenameDialog = (function () {
  let OVERLAY_ID = 'rename-dialog-overlay'
  let INPUT_ID = 'rename-name'
  let _open = false
  /** @type {string | null} */
  let _target = null   // 当前待重命名的完整路径

  /** @param {string} id @returns {HTMLElement | null} */
  function _getEl(id) { return document.getElementById(id) }

  /** @param {string} name @returns {void} */
  function open(name) {
    if (_open || !name) return
    _open = true
    _target = name
    App.Dialog.open(OVERLAY_ID, close)
    let input = /** @type {HTMLInputElement | null} */ (_getEl(INPUT_ID))
    if (input) {
      input.value = name
      // 同步聚焦（手势上下文内，Android WebView 才允许拉起软键盘）+ 全选方便直接覆盖
      input.focus()
      input.select()
      setTimeout(function () {
        if (document.activeElement !== input) {
          input.focus()
          input.select()
        }
      }, 120)
    }
  }

  /** @returns {void} */
  function close() {
    if (!_open) return
    _open = false
    _target = null
    App.Dialog.close(OVERLAY_ID)
    let input = /** @type {HTMLInputElement | null} */ (_getEl(INPUT_ID))
    if (input && document.activeElement === input) input.blur()
  }

  /** @returns {boolean} */
  function isOpen() { return _open }

  /** @returns {void} */
  function _submit() {
    let input = /** @type {HTMLInputElement | null} */ (_getEl(INPUT_ID))
    let newName = input ? input.value.trim() : ''
    let target = _target
    close()
    if (!target) return
    if (!newName || newName === target) {
      App.toast.show('名称未变化')
      return
    }
    // 重命名限同目录：newName 为纯文件名，目标目录由 Actions.rename 内部从 oldPath 推导
    //（领域语义见 operation-contract.md 2.2；跨目录 = move 管道，不走 rename）
    App.Actions.rename(target, newName)
  }

  /** @returns {void} */
  function init() {
    let confirmBtn = document.getElementById('rename-confirm')
    if (confirmBtn) App.utils.bindPress(confirmBtn, _submit)
    let overlay = _getEl(OVERLAY_ID)
    if (overlay) App.utils.bindPress(overlay, function (e) {
      if (e.target === overlay) close()
    })
    let input = /** @type {HTMLInputElement | null} */ (_getEl(INPUT_ID))
    if (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.keyCode === 13) {
          e.preventDefault()
          _submit()
        }
      })
    }
  }

  /** @type {RenameDialog} */
  return {
    open: open,
    close: close,
    isOpen: isOpen,
    init: init
  }
})()
