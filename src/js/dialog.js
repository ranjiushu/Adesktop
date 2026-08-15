/* 通用弹窗模块：overlay 显隐 + aria 状态单点管理。
 * 供 CreateDialog / RenameDialog / Loading 复用——弹窗显隐逻辑一处维护，
 * 各对话框只保留自身业务（输入、提交、进度）。
 * 依赖: namespace.js
 * 导出: App.Dialog
 */
'use strict'

App.Dialog = (function () {
  function _getEl(id) { return document.getElementById(id) }

  // 打开：overlay 加 dialog-overlay-visible + aria。返回是否真的打开。
  function open(overlayId) {
    let o = _getEl(overlayId)
    if (!o) return false
    o.classList.add('dialog-overlay-visible')
    o.setAttribute('aria-hidden', 'false')
    return true
  }

  // 关闭：移除 visible + aria。返回是否真的关闭。
  function close(overlayId) {
    let o = _getEl(overlayId)
    if (!o) return false
    o.classList.remove('dialog-overlay-visible')
    o.setAttribute('aria-hidden', 'true')
    return true
  }

  function isOpen(overlayId) {
    let o = _getEl(overlayId)
    return !!(o && o.classList.contains('dialog-overlay-visible'))
  }

  return {
    open: open,
    close: close,
    isOpen: isOpen
  }
})()
