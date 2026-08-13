/* 底部工具栏：5 个按钮，中间加号弹新建对话框，其余 4 个 UI 占位（无动作）。
 * 依赖: namespace.js, utils.js, create-dialog.js
 * 导出: App.BottomBar
 * 手势: 底栏区域右滑呼出 Drawer 由 drawer-swipe.js 负责（监听底栏 touch 事件）
 */
'use strict'

App.BottomBar = (function () {
  function init() {
    let add = document.getElementById('bb-btn-add')
    if (add) {
      App.utils.bindPress(add, function () {
        if (App.CreateDialog && typeof App.CreateDialog.open === 'function') {
          App.CreateDialog.open()
        }
      })
    }
  }

  return {
    init: init
  }
})()
