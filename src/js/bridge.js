/* 原生桥最小封装：震动 + 根目录授权请求。
 * 真机 WebView 经 addJavascriptInterface 注入 FileBridge（见 MainActivity），
 * 这里统一走 window.FileBridge（曾误用 Android.* 导致真机全部失效）；
 * 浏览器环境自动降级 navigator.vibrate / 空操作。
 */
'use strict'

App.bridge = (function () {
  // 震动：FileBridge.vibrate 优先（需 VIBRATE 权限），浏览器预览兜底 navigator.vibrate
  function vibrate(ms, amplitude) {
    let duration = typeof ms === 'number' ? ms : 15
    try {
      if (window.FileBridge && typeof window.FileBridge.vibrate === 'function') {
        window.FileBridge.vibrate(duration)
        return
      }
    } catch (e) { console.warn('[bridge] vibrate 调用异常:', e && e.message) }
    try {
      if (navigator.vibrate) navigator.vibrate(duration)
    } catch (e) { /* 忽略 */ }
  }

  // 请求重新授权根目录（原生弹 SAF 目录选择器），返回是否已交棒原生
  function requestRootAccess() {
    try {
      if (window.FileBridge && typeof window.FileBridge.requestRootAccess === 'function') {
        window.FileBridge.requestRootAccess()
        return true
      }
    } catch (e) { console.warn('[bridge] requestRootAccess 异常:', e && e.message) }
    return false
  }

  return {
    vibrate: vibrate,
    requestRootAccess: requestRootAccess
  }
})()
