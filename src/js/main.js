/* 应用入口：初始化渲染与状态输出 */
'use strict'

App.boot = function boot() {
  var titleEl = document.getElementById('app-title')
  if (titleEl) {
    titleEl.textContent = App.NAME
  }
  // FAB：短按 = 展开/收起 Speed Dial（长按 800ms 取景器由 inspector.js 接管）
  if (App.fabSpeedDial && typeof App.fabSpeedDial.init === 'function') {
    App.fabSpeedDial.init()
    var fabEl = document.getElementById('mode-switch-fab')
    if (fabEl && App.utils && typeof App.utils.bindPress === 'function') {
      App.utils.bindPress(fabEl, function () {
        App.bridge.vibrate()
        if (App.fabSpeedDial.isExpanded()) {
          App.fabSpeedDial.collapse()
        } else {
          App.fabSpeedDial.expand('desktop')
        }
      })
    }
  }
  // 桌面：以文件系统为数据源渲染
  if (App.Desktop && typeof App.Desktop.refresh === 'function') {
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
