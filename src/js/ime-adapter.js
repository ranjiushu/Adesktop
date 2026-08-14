/* IME 键盘适配：监听原生 desktop:ime 事件（键盘弹/收边沿，由 Java 侧
 * WindowInsets 监听器派发），切换对话框 .ime-open 类——键盘弹出时对话框
 * 上移到键盘上方（dialog.css 依据 --panel-bottom 定位）。
 * 数据源唯一：insets → --panel-bottom 注入 + desktop:ime 事件，CSS 单机制生效。
 * 依赖: namespace.js
 * 导出: App.ImeAdapter
 */
'use strict'

App.ImeAdapter = (function () {
  function init() {
    window.addEventListener('desktop:ime', function (e) {
      let open = !!(e.detail && e.detail.open)
      let overlays = document.querySelectorAll('.dialog-overlay')
      for (let i = 0; i < overlays.length; i++) {
        overlays[i].classList.toggle('ime-open', open)
      }
    })
  }

  return { init: init }
})()
