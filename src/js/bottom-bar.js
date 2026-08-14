/* 底部工具栏：5 个按钮。
 * 左 1 = 后退（＜）驱动 Desktop.goBack，左 2 = 前进（＞）驱动 Desktop.goForward，
 * 中间加号弹新建对话框，右 2 个 UI 占位（无动作）。
 * 后退/前进禁用态：根目录不可后退、栈尾不可前进（随 refresh 更新）。
 * 依赖: namespace.js, utils.js, create-dialog.js, desktop.js
 * 导出: App.BottomBar
 * 手势: 底栏区域右滑呼出 Drawer 由 drawer-swipe.js 负责（监听底栏 touch 事件）
 */
'use strict'

App.BottomBar = (function () {
  function _getEl(id) { return document.getElementById(id) }

  // 更新后退/前进禁用态（根目录 / 栈尾不可用）
  function updateNavButtons() {
    let back = _getEl('bb-btn-back')
    let fwd = _getEl('bb-btn-forward')
    if (!back || !fwd || !App.Desktop) return
    const canBack = typeof App.Desktop.canGoBack === 'function' && App.Desktop.canGoBack()
    const canFwd = typeof App.Desktop.canGoForward === 'function' && App.Desktop.canGoForward()
    if (canBack) {
      back.removeAttribute('disabled')
      back.setAttribute('aria-disabled', 'false')
    } else {
      back.setAttribute('disabled', '')
      back.setAttribute('aria-disabled', 'true')
    }
    if (canFwd) {
      fwd.removeAttribute('disabled')
      fwd.setAttribute('aria-disabled', 'false')
    } else {
      fwd.setAttribute('disabled', '')
      fwd.setAttribute('aria-disabled', 'true')
    }
  }

  function init() {
    let add = _getEl('bb-btn-add')
    if (add) {
      App.utils.bindPress(add, function () {
        if (App.CreateDialog && typeof App.CreateDialog.open === 'function') {
          App.CreateDialog.open()
        }
      })
    }
    let back = _getEl('bb-btn-back')
    if (back) {
      App.utils.bindPress(back, function () {
        if (App.Desktop && typeof App.Desktop.goBack === 'function') {
          App.Desktop.goBack()
        }
      })
    }
    let fwd = _getEl('bb-btn-forward')
    if (fwd) {
      App.utils.bindPress(fwd, function () {
        if (App.Desktop && typeof App.Desktop.goForward === 'function') {
          App.Desktop.goForward()
        }
      })
    }
  }

  return {
    init: init,
    updateNavButtons: updateNavButtons
  }
})()
