/* 通用弹窗模块：overlay 显隐 + aria 状态单点管理 + 系统返回键关闭栈。
 * 供 CreateDialog / RenameDialog / AppList 确认框 / BuildInfo 详情弹窗复用——
 * 弹窗显隐逻辑一处维护，各对话框只保留自身业务（输入、提交、进度）。
 * 关闭途径（模块统一约定）：点击遮罩空白（业务侧绑定）+ 系统返回键（handleBack，
 * MainActivity 返回键 → App.handleSystemBack → App.Dialog.handleBack 关闭栈顶弹窗），
 * 双操作弹窗另设文字式「取消」按钮（左），主操作按钮靠右（见 dialog.css）。
 * 依赖: namespace.js
 * 导出: App.Dialog
 */
// @ts-check
'use strict'

App.Dialog = (function () {
  // 打开中的弹窗栈（栈顶 = 最上层），元素：[{ overlayId, closeFn }]
  // closeFn：业务侧完整关闭函数（含收尾如 blur 输入框 / 移除 DOM），缺省时仅关 overlay
  /** @type {Array<{overlayId: string, closeFn?: (() => void)}>} */
  let _stack = []

  /** @param {string} id @returns {HTMLElement | null} */
  function _getEl(id) { return document.getElementById(id) }

  // 打开：overlay 加 dialog-overlay-visible + aria。返回是否真的打开。
  // closeFn 供系统返回键（handleBack）调用；同 overlay 重复 open 只更新 closeFn 不重复入栈。
  /** @param {string} overlayId @param {(() => void) | null} [closeFn] @returns {boolean} */
  function open(overlayId, closeFn) {
    let o = _getEl(overlayId)
    if (!o) return false
    if (!o.classList.contains('dialog-overlay-visible')) {
      o.classList.add('dialog-overlay-visible')
      o.setAttribute('aria-hidden', 'false')
    }
    for (let i = 0; i < _stack.length; i++) {
      if (_stack[i].overlayId === overlayId) {
        if (typeof closeFn === 'function') _stack[i].closeFn = closeFn
        return true
      }
    }
    if (typeof closeFn === 'function') {
      _stack.push({ overlayId: overlayId, closeFn: closeFn })
    }
    return true
  }

  // 关闭：移除 visible + aria + 出栈。返回是否真的关闭。
  /** @param {string} overlayId @returns {boolean} */
  function close(overlayId) {
    let o = _getEl(overlayId)
    if (!o) return false
    if (o.classList.contains('dialog-overlay-visible')) {
      o.classList.remove('dialog-overlay-visible')
      o.setAttribute('aria-hidden', 'true')
    }
    for (let i = _stack.length - 1; i >= 0; i--) {
      if (_stack[i].overlayId === overlayId) {
        _stack.splice(i, 1)
        break
      }
    }
    return true
  }

  // 系统返回键消费：关闭最上层弹窗，返回是否消费（有弹窗开着 = true）。
  // 弹窗关闭后返回 true，返回键不再向下传递（再次返回才关下层面板）。
  /** @returns {boolean} */
  function handleBack() {
    let top = _stack[_stack.length - 1]
    if (!top) return false
    try {
      if (typeof top.closeFn === 'function') top.closeFn()
      else close(top.overlayId)
    } catch (e) {
      close(top.overlayId)
    }
    return true
  }

  /** @param {string} overlayId @returns {boolean} */
  function isOpen(overlayId) {
    let o = _getEl(overlayId)
    return !!(o && o.classList.contains('dialog-overlay-visible'))
  }

  /** @type {Dialog} */
  return {
    open: open,
    close: close,
    handleBack: handleBack,
    isOpen: isOpen
  }
})()
