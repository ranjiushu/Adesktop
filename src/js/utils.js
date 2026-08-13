/* 工具函数：escapeHtml + bindPress（按钮一触即发，长短按均执行 handler） */
'use strict'

App.utils = (function () {
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  // 方案A：按钮一触即发，长短按均执行 handler
  // 解决 WebView 长按后 :active/focus 不释放、文本选择弹出等问题
  function bindPress(btn, handler) {
    if (!btn) return
    if (btn._bindPressBound) return
    btn._bindPressBound = true
    btn.removeAttribute('onclick')

    var touchFired = false
    var pressed = false

    btn.addEventListener('touchstart', function (e) {
      e.preventDefault()
      pressed = true
      touchFired = false
    }, { passive: false })

    // touchmove：手指滑出按钮区域则取消点击，避免误触
    btn.addEventListener('touchmove', function (e) {
      if (!pressed) return
      var touch = e.touches[0]
      var rect = btn.getBoundingClientRect()
      if (touch.clientX < rect.left || touch.clientX > rect.right ||
          touch.clientY < rect.top || touch.clientY > rect.bottom) {
        pressed = false
      }
    }, { passive: true })

    btn.addEventListener('touchend', function (e) {
      if (!pressed) return
      pressed = false
      touchFired = true
      handler.call(btn, e)
    }, { passive: true })

    btn.addEventListener('touchcancel', function () {
      pressed = false
    }, { passive: true })

    // 桌面/鼠标兜底（无触摸时 click 可用）
    btn.addEventListener('click', function (e) {
      if (touchFired) return  // 触摸已处理，防双触发
      handler.call(btn, e)
    })
  }

  return {
    escapeHtml: escapeHtml,
    bindPress: bindPress
  }
})()
