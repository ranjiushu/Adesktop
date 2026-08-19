/* 轻量吐司：单条显示 + 短队列，样式见 css/toast.css */
// @ts-check
'use strict'

App.toast = (function () {
  /** @type {HTMLElement | null} */
  let _el = null
  /** @type {Array<string | ToastActionItem>} */
  let _queue = []
  /** @type {number | null} */
  let _timer = null
  let _active = false

  /** @returns {HTMLElement} */
  function ensureEl() {
    if (_el) return _el
    _el = document.createElement('div')
    _el.className = 'toast'
    document.body.appendChild(_el)
    return _el
  }

  /** @returns {void} */
  function showNext() {
    if (_active) return
    let item = _queue.shift()
    if (item === undefined) {
      if (_el) _el.classList.remove('toast-visible')
      return
    }
    _active = true
    let el = ensureEl()
    el.textContent = ''
    el.classList.remove('toast-action')
    if (typeof item === 'string') {
      el.textContent = item
    } else if (item && item.type === 'action') {
      el.classList.add('toast-action')
      let span = document.createElement('span')
      span.className = 'toast-msg'
      span.textContent = item.msg
      let btn = document.createElement('button')
      btn.className = 'toast-action-btn'
      btn.textContent = item.actionText
      btn.addEventListener('click', function () {
        if (_timer) clearTimeout(_timer)
        _active = false
        if (typeof item.onAction === 'function') item.onAction()
        showNext()
      })
      el.appendChild(span)
      el.appendChild(btn)
    } else {
      el.textContent = String(item)
    }
    el.classList.add('toast-visible')
    if (_timer) clearTimeout(_timer)
    const timeout = (typeof item === 'object' && item && item.type === 'action') ? 3500 : 1800
    _timer = setTimeout(function () {
      _active = false
      showNext()
    }, timeout)
  }

  /** @param {string} msg @returns {void} */
  function show(msg) {
    _queue.push(String(msg == null ? '' : msg))
    showNext()
  }

  // 带操作按钮的吐司（snackbar 语义）：msg 左侧，action 右侧按钮。
  // 用户点击按钮后执行 onAction 并立即关闭；未点击则 3.5s 后自动关闭。
  // 与纯文本吐司共用单条队列，避免多条吐司堆叠打架。
  /** @param {string} msg @param {string} actionText @param {() => void} onAction @returns {void} */
  function showAction(msg, actionText, onAction) {
    _queue.push({ type: 'action', msg: String(msg == null ? '' : msg), actionText: actionText, onAction: onAction })
    showNext()
  }

  /** @type {Toast} */
  return {
    show: show,
    showAction: showAction,
    pending: function () { return _queue.length + (_active ? 1 : 0) }
  }
})()
