/* 工具函数：escapeHtml + bindPress（按钮一触即发）+ bindPressSplit（长短按分流） */
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

    let touchFired = false
    let pressed = false

    btn.addEventListener('touchstart', function (e) {
      // 可编辑元素不拦截默认行为：否则输入框无法触摸聚焦、软键盘不拉起
      // （touchstart preventDefault 会阻止触摸聚焦；输入框事件冒泡到遮罩的
      //   bindPress 时同样命中，须豁免 INPUT/TEXTAREA/SELECT/contentEditable）
      let t = e.target
      let editable = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ||
        t.tagName === 'SELECT' || t.isContentEditable)
      if (!editable) e.preventDefault()
      pressed = true
      touchFired = false
    }, { passive: false })

    // touchmove：手指滑出按钮区域则取消点击，避免误触
    btn.addEventListener('touchmove', function (e) {
      if (!pressed) return
      let touch = e.touches[0]
      let rect = btn.getBoundingClientRect()
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

  // 方案B：长短按分流——按住超时（默认 500ms）= 长按只触发一次，
  // 提前抬起 = 短按（tap）。位移超阈值取消（防与底栏右滑 Drawer 手势打架）。
  // handlers: { onTap?, onLongPress? }，opts: { longPressMs?, moveThreshold? }
  function bindPressSplit(btn, handlers, opts) {
    if (!btn || !handlers) return
    if (btn._bindPressSplitBound) return
    btn._bindPressSplitBound = true

    const longPressMs = (opts && typeof opts.longPressMs === 'number') ? opts.longPressMs : 500
    const moveThreshold = (opts && typeof opts.moveThreshold === 'number') ? opts.moveThreshold : 12
    let pressed = false
    let longFired = false
    let touchFired = false
    let timer = null

    function cancelTimer() {
      if (timer) { clearTimeout(timer); timer = null }
    }

    btn.addEventListener('touchstart', function (e) {
      // 可编辑元素不拦截默认行为（同 bindPress：输入框触摸聚焦/软键盘）
      let t = e.target
      let editable = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ||
        t.tagName === 'SELECT' || t.isContentEditable)
      if (!editable) e.preventDefault()
      pressed = true
      longFired = false
      touchFired = false
      cancelTimer()
      timer = setTimeout(function () {
        timer = null
        if (!pressed) return
        longFired = true
        if (handlers.onLongPress) handlers.onLongPress.call(btn, e)
      }, longPressMs)
    }, { passive: false })

    // touchmove：手指滑出按钮区域（含阈值余量）则取消本次按压，避免误触发
    btn.addEventListener('touchmove', function (e) {
      if (!pressed) return
      let touch = e.touches[0]
      let rect = btn.getBoundingClientRect()
      if (touch.clientX < rect.left - moveThreshold || touch.clientX > rect.right + moveThreshold ||
          touch.clientY < rect.top - moveThreshold || touch.clientY > rect.bottom + moveThreshold) {
        pressed = false
        longFired = false
        cancelTimer()
      }
    }, { passive: true })

    btn.addEventListener('touchend', function (e) {
      if (!pressed) return
      pressed = false
      cancelTimer()
      touchFired = true
      if (longFired) return
      if (handlers.onTap) handlers.onTap.call(btn, e)
    }, { passive: true })

    btn.addEventListener('touchcancel', function () {
      pressed = false
      longFired = false
      cancelTimer()
    }, { passive: true })

    // 桌面/鼠标兜底（无触摸时 click 可用；触摸已处理防双触发）
    btn.addEventListener('click', function (e) {
      if (touchFired || longFired) return
      if (handlers.onTap) handlers.onTap.call(btn, e)
    })
  }

  return {
    escapeHtml: escapeHtml,
    bindPress: bindPress,
    bindPressSplit: bindPressSplit
  }
})()
