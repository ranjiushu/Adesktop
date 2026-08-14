/* 底部工具栏：5 个按钮。
 * 左 1 = 后退（＜）驱动 Desktop.goBack，左 2 = 前进（＞）驱动 Desktop.goForward，
 * 中间加号弹新建对话框，右 1 UI 占位，右 2 = 上级目录（↑）驱动 Desktop.goUp。
 * 后退/前进禁用态：根目录不可后退、栈尾不可前进；上级禁用态：根目录不可上（随 refresh 更新）。
 * 依赖: namespace.js, utils.js, create-dialog.js, desktop.js
 * 导出: App.BottomBar
 * 手势: 底栏区域右滑呼出 Drawer 由 drawer-swipe.js 负责（监听底栏 touch 事件）
 */
'use strict'

App.BottomBar = (function () {
  function _getEl(id) { return document.getElementById(id) }

  // 更新后退/前进/上级禁用态（根目录不可后退与上、栈尾不可前进）
  function updateNavButtons() {
    let back = _getEl('bb-btn-back')
    let fwd = _getEl('bb-btn-forward')
    let up = _getEl('bb-btn-up')
    if (!back || !fwd || !App.Desktop) return
    const canBack = typeof App.Desktop.canGoBack === 'function' && App.Desktop.canGoBack()
    const canFwd = typeof App.Desktop.canGoForward === 'function' && App.Desktop.canGoForward()
    const canUp = typeof App.Desktop.canGoUp === 'function' && App.Desktop.canGoUp()
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
    if (up) {
      if (canUp) {
        up.removeAttribute('disabled')
        up.setAttribute('aria-disabled', 'false')
      } else {
        up.setAttribute('disabled', '')
        up.setAttribute('aria-disabled', 'true')
      }
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
    let up = _getEl('bb-btn-up')
    if (up) {
      App.utils.bindPress(up, function () {
        if (App.Desktop && typeof App.Desktop.goUp === 'function') {
          App.Desktop.goUp()
        }
      })
    }
  }

  return {
    init: init,
    updateNavButtons: updateNavButtons
  }
})()
