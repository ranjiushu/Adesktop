/* 轻量吐司：单条显示 + 短队列，样式见 css/toast.css */
// @ts-check
'use strict'

App.toast = (function () {
  /** @type {HTMLElement | null} */
  let _el = null
  /** @type {Array<string>} */
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
    let msg = _queue.shift()
    if (msg === undefined) {
      if (_el) _el.classList.remove('toast-visible')
      return
    }
    _active = true
    let el = ensureEl()
    el.textContent = msg
    el.classList.add('toast-visible')
    if (_timer) clearTimeout(_timer)
    _timer = setTimeout(function () {
      _active = false
      showNext()
    }, 1800)
  }

  /** @param {string} msg @returns {void} */
  function show(msg) {
    _queue.push(String(msg == null ? '' : msg))
    showNext()
  }

  /** @type {Toast} */
  return {
    show: show,
    pending: function () { return _queue.length + (_active ? 1 : 0) }
  }
})()
