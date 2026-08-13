/* 应用入口：初始化渲染与状态输出 */
'use strict'

App.boot = function boot() {
  var titleEl = document.getElementById('app-title')
  if (titleEl) {
    titleEl.textContent = App.NAME
  }
  // 桌面：以文件系统为数据源渲染
  if (window.App && App.Desktop && typeof document !== 'undefined') {
    App.Desktop.refresh()
  }
  return true
}

// 根目录授权变更（SAF 授权完成后由原生桥调用）
App.onRootChanged = function onRootChanged() {
  if (App.Desktop) {
    App.Desktop.refresh()
  }
}

if (typeof document !== 'undefined' && document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', App.boot)
} else {
  App.boot()
}
