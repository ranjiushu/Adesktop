/* UI 工具：剪贴板复制（execCommand 优先，Clipboard API 兜底） */
// @ts-check
'use strict'

App.ui = (function () {
  /** @param {string} text @param {string} [msg] @returns {boolean} */
  function copyText(text, msg) {
    // 优先 execCommand（WebView 兼容性最好，不依赖用户手势令牌）
    let ta = document.createElement('textarea')
    ta.value = text
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none'
    document.body.appendChild(ta)
    ta.select()
    try {
      let ok = document.execCommand('copy')
      if (ok) {
        if (msg) App.toast.show(msg)
        document.body.removeChild(ta)
        return true
      }
    } catch (e) { /* 继续兜底 */ }
    document.body.removeChild(ta)
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          function () { if (msg) App.toast.show(msg) },
          function () { if (msg) App.toast.show('复制失败') }
        )
        return true
      }
    } catch (e) { /* 继续 */ }
    if (msg) App.toast.show('复制失败')
    return false
  }

  /** @type {AppUi} */
  return {
    copyText: copyText
  }
})()
