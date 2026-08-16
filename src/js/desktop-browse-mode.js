/* desktop-browse-mode.js：高级浏览模式 + 临时操作模式（App.DesktopBrowseMode）。
 * 拆分自 desktop.js 的模式域：高级浏览模式开关（持久化到 ViewStore）与
 * 临时操作模式（双击空白进入，打断退出）。手势层模式同步经
 * App.DesktopGesture.setBrowseMode 生效；模式状态在 App.DesktopCore。
 * 依赖: namespace.js, desktop-core.js, desktop-gesture.js, view-store.js
 * 导出: App.DesktopBrowseMode
 */
'use strict'

App.DesktopBrowseMode = (function () {
  const C = App.DesktopCore

  // 同步浏览模式到手势层：effective = 高级浏览 ON 且非临时操作模式
  function syncBrowseMode() {
    const effective = C._advancedBrowse && !C._tempNormalMode
    if (App.DesktopGesture && typeof App.DesktopGesture.setBrowseMode === 'function') {
      App.DesktopGesture.setBrowseMode(effective)
    }
  }

  // 退出临时操作模式（打断条件：返回/Drawer/目录导航/再次双击空白）
  function exitTempMode() {
    if (!C._tempNormalMode) return
    C._tempNormalMode = false
    syncBrowseMode()
    if (App.bridge && typeof App.bridge.vibrate === 'function') App.bridge.vibrate(30)
    if (App.toast && typeof App.toast.show === 'function') App.toast.show('已退出临时操作模式')
  }

  // 设置高级浏览模式（ViewMenu 切换驱动）
  function setAdvancedBrowse(on) {
    C._advancedBrowse = !!on
    C._tempNormalMode = false   // 切换模式时清空临时态
    syncBrowseMode()
    // 持久化：合并到 ViewStore 现有偏好
    const prefs = App.ViewStore.load()
    prefs.advancedBrowse = C._advancedBrowse
    if (!App.ViewStore.save(prefs)) {
      if (App.toast && typeof App.toast.show === 'function') App.toast.show('浏览模式保存失败')
    }
  }

  function isAdvancedBrowse() { return C._advancedBrowse }

  return {
    syncBrowseMode: syncBrowseMode,
    exitTempMode: exitTempMode,
    setAdvancedBrowse: setAdvancedBrowse,
    isAdvancedBrowse: isAdvancedBrowse
  }
})()
