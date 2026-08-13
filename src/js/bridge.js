/* 原生桥最小封装：震动 + 根目录授权请求。
 * 真机 WebView 经 addJavascriptInterface 注入 Android 对象（见 MainActivity），
 * 浏览器环境自动降级 navigator.vibrate / 空操作。
 */
'use strict'

App.bridge = (function () {
  function hasAndroid() {
    return typeof Android !== 'undefined' && Android !== null
  }

  function vibrate(ms, amplitude) {
    try {
      if (hasAndroid() && typeof Android.vibrate === 'function') {
        if (amplitude) Android.vibrate(ms, amplitude)
        else Android.vibrate(ms)
        return
      }
    } catch (e) { console.warn('[bridge] vibrate 调用异常:', e && e.message) }
    try {
      if (navigator.vibrate) navigator.vibrate(typeof ms === 'number' ? ms : 15)
    } catch (e) { /* 忽略 */ }
  }

  // 请求重新授权根目录（原生弹 SAF 目录选择器）
  function requestRootAccess() {
    try {
      if (hasAndroid() && typeof Android.requestRootAccess === 'function') {
        Android.requestRootAccess()
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
