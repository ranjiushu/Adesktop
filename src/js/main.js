/* 应用入口：初始化渲染与状态输出 */
'use strict'

App.boot = function boot() {
  let titleEl = document.getElementById('app-title')
  if (titleEl) {
    titleEl.textContent = App.NAME
  }
  // FAB：短按 = 展开/收起 Speed Dial（长按 800ms 取景器由 inspector.js 接管）
  if (App.fabSpeedDial && typeof App.fabSpeedDial.init === 'function') {
    App.fabSpeedDial.init()
    let fabEl = document.getElementById('mode-switch-fab')
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
  // 顶栏汉堡 + Drawer 工具栏
  if (App.Drawer && typeof App.Drawer.init === 'function') {
    App.Drawer.init()
  }
  // Drawer 手势：底栏右划拉出 + Drawer 上跟手关闭
  if (App.DrawerSwipe && typeof App.DrawerSwipe.init === 'function') {
    App.DrawerSwipe.init()
  }
  // 顶栏排列/视图菜单（子文件夹容器模式可用，根目录置灰）
  if (App.ViewMenu && typeof App.ViewMenu.init === 'function') {
    App.ViewMenu.init()
  }
  // 新建对话框（底栏加号弹出）
  if (App.CreateDialog && typeof App.CreateDialog.init === 'function') {
    App.CreateDialog.init()
  }
  // 重命名对话框（选中态操作栏弹出）
  if (App.RenameDialog && typeof App.RenameDialog.init === 'function') {
    App.RenameDialog.init()
  }
  // 底部工具栏（加号 → 新建对话框，其余占位）
  if (App.BottomBar && typeof App.BottomBar.init === 'function') {
    App.BottomBar.init()
  }
  // 提交与构建信息面板（Drawer 底部入口）
  if (App.BuildInfo && typeof App.BuildInfo.init === 'function') {
    App.BuildInfo.init()
  }
  // 桌面：启动无限画布手势（双指 pan/zoom）+ 以文件系统为数据源渲染
  if (App.Desktop) {
    if (typeof App.Desktop.initGesture === 'function') App.Desktop.initGesture()
    if (typeof App.Desktop.refresh === 'function') App.Desktop.refresh()
  }
  return true
}

// 根目录授权变更（SAF 授权完成后由原生桥调用）
App.onRootChanged = function onRootChanged() {
  if (App.Desktop) {
    App.Desktop.refresh()
  }
}

// 系统返回键（Android 壳 onKeyDown → evaluateJavascript 询问）：
// 依次消费 Drawer → 整页面板；均未打开返回 false（壳退出 App）。
// 不依赖 pushState 是否被 WebView 计入 canGoBack。
App.handleSystemBack = function handleSystemBack() {
  if (App.Drawer && typeof App.Drawer.isOpen === 'function' && App.Drawer.isOpen()) {
    App.Drawer.close()
    return true
  }
  if (App.ViewMenu && typeof App.ViewMenu.isOpen === 'function' && App.ViewMenu.isOpen()) {
    App.ViewMenu.close()
    return true
  }
  if (App.BuildInfo && typeof App.BuildInfo.isOpen === 'function' && App.BuildInfo.isOpen()) {
    App.BuildInfo.close()
    // 清掉 pushState 残留条目（popstate → _onPopState 幂等，安全）
    try {
      if (history.state && history.state._buildInfoOpen) history.back()
    } catch (e) { /* 忽略 */ }
    return true
  }
  return false
}

if (typeof document !== 'undefined' && document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', App.boot)
} else {
  App.boot()
}
