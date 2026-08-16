/* 左侧 Drawer 工具栏：汉堡呼出，含根目录路径与文件系统动作 */
'use strict'

App.Drawer = (function () {
  let DRAWER_ID = 'drawer'
  let OVERLAY_ID = 'drawer-overlay'
  let _open = false

  function _getEl(id) { return document.getElementById(id) }

  function open() {
    if (_open) return
    _open = true
    // 打开 Drawer → 退出临时操作模式（高级浏览模式打断条件）
    if (App.Desktop && typeof App.Desktop.exitTempMode === 'function') {
      App.Desktop.exitTempMode()
    }
    let d = _getEl(DRAWER_ID), o = _getEl(OVERLAY_ID)
    if (d) {
      d.classList.add('drawer-open')
      d.setAttribute('aria-hidden', 'false')
    }
    if (o) o.classList.add('drawer-overlay-visible')
    // 无震动反馈（用户指定移除开启/关闭震动）
  }

  function close() {
    if (!_open) return
    _open = false
    let d = _getEl(DRAWER_ID), o = _getEl(OVERLAY_ID)
    if (d) {
      d.classList.remove('drawer-open')
      d.setAttribute('aria-hidden', 'true')
    }
    if (o) o.classList.remove('drawer-overlay-visible')
  }

  function toggle() {
    if (_open) close(); else open()
  }

  function isOpen() { return _open }

  // 更新根目录路径显示（顶栏标题与 Drawer 头部同步）
  function updatePath(displayPath, rootName, mode) {
    let titleEl = document.getElementById('app-title')
    if (titleEl) {
      titleEl.textContent = displayPath || rootName || App.NAME
    }
    let pathEl = document.getElementById('drawer-root-path')
    if (pathEl) {
      pathEl.textContent = displayPath || '未知'
    }
    let modeEl = document.getElementById('drawer-root-mode')
    if (modeEl) {
      modeEl.textContent = mode === 'saf' ? '外部存储' : (mode === 'private' ? '应用私有目录' : '')
    }
  }

  function init() {
    let btn = document.getElementById('btn-drawer')
    if (btn) App.utils.bindPress(btn, toggle)
    let o = _getEl(OVERLAY_ID)
    if (o) App.utils.bindPress(o, close)
    let d = _getEl(DRAWER_ID)
    if (d) {
      // 动作项（与 FAB 共享 App.Actions）
      let items = d.querySelectorAll('.drawer-item[data-action]')
      for (let i = 0; i < items.length; i++) {
        App.utils.bindPress(items[i], function () {
          let action = this.getAttribute('data-action')
          if (!action) return
          close()
          if (action === 'switch-root') App.Actions.switchRoot()
          else if (action === 'installed-apps') App.AppList.open()
        })
      }
      // 头部关闭按钮
      let closeBtn = d.querySelector('.drawer-close')
      if (closeBtn) App.utils.bindPress(closeBtn, close)
    }
  }

  return {
    open: open,
    close: close,
    toggle: toggle,
    isOpen: isOpen,
    updatePath: updatePath,
    init: init
  }
})()
