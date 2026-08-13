/* 应用入口：初始化渲染与状态输出 */
'use strict'

App.boot = function boot() {
  var titleEl = document.getElementById('app-title')
  var statusEl = document.getElementById('status-text')
  if (titleEl) {
    titleEl.textContent = App.NAME
  }
  if (statusEl) {
    statusEl.textContent =
      App.NAME + ' v' + App.VERSION +
      ' · build ' + App.BUILD +
      (App.BUILD_TIME ? ' · ' + App.BUILD_TIME : '') +
      ' · 骨架初始化完成'
  }
  return true
}

if (typeof document !== 'undefined' && document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', App.boot)
} else {
  App.boot()
}
