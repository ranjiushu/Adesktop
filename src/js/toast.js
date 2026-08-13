/* 轻量吐司：单条显示 + 短队列，样式见 css/toast.css */
'use strict'

App.toast = (function () {
  var _el = null
  var _queue = []
  var _timer = null
  var _active = false

  function ensureEl() {
    if (_el) return _el
    _el = document.createElement('div')
    _el.className = 'toast'
    document.body.appendChild(_el)
    return _el
  }

  function showNext() {
    if (_active) return
    var msg = _queue.shift()
    if (msg === undefined) {
      if (_el) _el.classList.remove('toast-visible')
      return
    }
    _active = true
    var el = ensureEl()
    el.textContent = msg
    el.classList.add('toast-visible')
    if (_timer) clearTimeout(_timer)
    _timer = setTimeout(function () {
      _active = false
      showNext()
    }, 1800)
  }

  function show(msg) {
    _queue.push(String(msg == null ? '' : msg))
    showNext()
  }

  return {
    show: show,
    pending: function () { return _queue.length + (_active ? 1 : 0) }
  }
})()
