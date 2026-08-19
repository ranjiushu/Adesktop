/* 工具函数：escapeHtml + bindPress（按钮一触即发）+ bindPressSplit（长短按分流） */
// @ts-check
'use strict'

App.utils = (function () {
  /** @param {any} str @returns {string} */
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
  /** @param {HTMLElement | null} btn @param {(e: Event) => void} handler */
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
      let t = /** @type {HTMLElement | null} */ (e.target)
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
      if (!touch) return
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
  /** @param {HTMLElement | null} btn @param {PressHandlers} handlers @param {PressOpts} [opts] */
  function bindPressSplit(btn, handlers, opts) {
    if (!btn || !handlers) return
    if (btn._bindPressSplitBound) return
    btn._bindPressSplitBound = true

    const longPressMs = (opts && typeof opts.longPressMs === 'number') ? opts.longPressMs : 500
    const moveThreshold = (opts && typeof opts.moveThreshold === 'number') ? opts.moveThreshold : 12
    const doubleTapMs = (opts && typeof opts.doubleTapMs === 'number') ? opts.doubleTapMs : 300
    // 双击仅在提供 onDoubleTap 时启用（未提供则单击立即触发，行为与旧版完全一致）
    const hasDouble = typeof handlers.onDoubleTap === 'function'
    let pressed = false
    let longFired = false
    let touchFired = false
    /** @type {number | null} */
    let timer = null
    // 双击状态：pendingTap = 第一击已松手、双击窗口内等待第二击；tapTimer = 双击窗口定时器
    // （双击模式下单击**立即**执行，窗口仅用于检测第二击——不引入单击延迟，见 touchend）
    let pendingTap = false
    /** @type {number | null} */
    let tapTimer = null

    function cancelTimer() {
      if (timer) { clearTimeout(timer); timer = null }
    }
    function cancelTapTimer() {
      if (tapTimer) { clearTimeout(tapTimer); tapTimer = null }
    }

    btn.addEventListener('touchstart', function (e) {
      // 可编辑元素不拦截默认行为（同 bindPress：输入框触摸聚焦/软键盘）
      let t = /** @type {HTMLElement | null} */ (e.target)
      let editable = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ||
        t.tagName === 'SELECT' || t.isContentEditable)
      if (!editable) e.preventDefault()
      pressed = true
      longFired = false
      touchFired = false
      cancelTimer()
      if (hasDouble && pendingTap) {
        // 双击第二击按下：取消待触发的单击（touchend 时改判双击）
        cancelTapTimer()
      }
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
      if (!touch) return
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
      if (hasDouble) {
        if (pendingTap) {
          // 双击第二击：取消双击窗口，改触发 onDoubleTap
          // （第一击已立即执行 onTap——双击场景下其动画会被 onDoubleTap 打断覆盖，
          //   见 goHome/fitAllFiles 的 animateCameraTo cancelCameraAnim）
          pendingTap = false
          cancelTapTimer()
          if (handlers.onDoubleTap) handlers.onDoubleTap.call(btn, e)
          return
        }
        // 第一击：**立即**执行 onTap（单击零延迟，双击窗口仅作第二击检测——
        // 曾延迟 300ms 判定，用户感知点击无反应/动画变慢，2026-08-19 真机反馈）
        pendingTap = true
        tapTimer = setTimeout(function () {
          pendingTap = false
          tapTimer = null
        }, doubleTapMs)
        if (handlers.onTap) handlers.onTap.call(btn, e)
        return
      }
      if (handlers.onTap) handlers.onTap.call(btn, e)
    }, { passive: true })

    btn.addEventListener('touchcancel', function () {
      pressed = false
      longFired = false
      cancelTimer()
      pendingTap = false
      cancelTapTimer()
    }, { passive: true })

    // 桌面/鼠标兜底（无触摸时 click 可用；触摸已处理防双触发）。
    // 双击仅在触摸路径判定（桌面连点无双击语义，直接单击——E2E/真机均为触摸路径）
    btn.addEventListener('click', function (e) {
      if (touchFired || longFired) return
      if (handlers.onTap) handlers.onTap.call(btn, e)
    })
  }

  /** @type {AppUtils} */
  return {
    escapeHtml: escapeHtml,
    bindPress: bindPress,
    bindPressSplit: bindPressSplit
  }
})()
