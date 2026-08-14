/* 顶栏排列/视图菜单：header 右上弹出。
 * 根目录（Desktop 空间）下菜单项置灰（仅提示）；子文件夹（Folder 容器）下可选。
 * 排列方式：名称/修改日期/类型/大小，点击当前项切换升降序；
 * 视图：网格 / 列表。偏好经 App.ViewStore 持久化（全局，应用于所有子文件夹）。
 * 依赖: namespace.js, utils.js, view-store.js, folder-sort.js, desktop.js
 * 导出: App.ViewMenu
 */
'use strict'

App.ViewMenu = (function () {
  let _enabled = false
  let _open = false

  function _getEl(id) { return document.getElementById(id) }

  function _queryItems(menu) {
    return menu ? menu.querySelectorAll('.view-menu-item') : []
  }

  // 渲染当前选中态：排序项高亮 + 方向箭头，视图项高亮 + 勾
  function renderState() {
    const menu = _getEl('view-menu')
    if (!menu || !App.Desktop || typeof App.Desktop.getViewPrefs !== 'function') return
    const prefs = App.Desktop.getViewPrefs()
    const items = _queryItems(menu)
    for (let i = 0; i < items.length; i++) {
      items[i].classList.remove('active')
    }
    const sortItem = menu.querySelector('[data-sort="' + prefs.sortBy + '"]')
    if (sortItem) {
      sortItem.classList.add('active')
      const dir = sortItem.querySelector('.view-menu-dir')
      if (dir) dir.textContent = prefs.sortDir === 1 ? '▲' : '▼'
    }
    const viewItem = menu.querySelector('[data-view="' + prefs.viewStyle + '"]')
    if (viewItem) viewItem.classList.add('active')
  }

  function open() {
    if (_open) return
    _open = true
    renderState()
    const menu = _getEl('view-menu')
    const overlay = _getEl('view-menu-overlay')
    const btn = _getEl('btn-view-menu')
    if (menu) {
      menu.classList.add('view-menu-open')
      menu.setAttribute('aria-hidden', 'false')
    }
    if (overlay) {
      overlay.classList.add('view-menu-overlay-visible')
      overlay.setAttribute('aria-hidden', 'false')
    }
    if (btn) btn.setAttribute('aria-expanded', 'true')
  }

  function close() {
    if (!_open) return
    _open = false
    const menu = _getEl('view-menu')
    const overlay = _getEl('view-menu-overlay')
    const btn = _getEl('btn-view-menu')
    if (menu) {
      menu.classList.remove('view-menu-open')
      menu.setAttribute('aria-hidden', 'true')
    }
    if (overlay) {
      overlay.classList.remove('view-menu-overlay-visible')
      overlay.setAttribute('aria-hidden', 'true')
    }
    if (btn) btn.setAttribute('aria-expanded', 'false')
  }

  function toggle() {
    if (_open) close(); else open()
  }

  function isOpen() { return _open }
  function isEnabled() { return _enabled }

  // 目录切换时由 Desktop 调用：根目录置灰（仅提示），子文件夹可选
  function setEnabled(on) {
    _enabled = !!on
    const menu = _getEl('view-menu')
    const items = _queryItems(menu)
    for (let i = 0; i < items.length; i++) {
      if (_enabled) items[i].removeAttribute('disabled')
      else items[i].setAttribute('disabled', '')
    }
  }

  // 菜单项点击：排序（当前项翻转方向 / 新项用默认方向）或视图切换
  function _onItemClick() {
    if (!_enabled || this.disabled) return
    if (!App.Desktop || typeof App.Desktop.getViewPrefs !== 'function' ||
        typeof App.Desktop.applyViewPrefs !== 'function') return
    const prefs = App.Desktop.getViewPrefs()
    const sort = this.getAttribute('data-sort')
    const view = this.getAttribute('data-view')
    if (sort) {
      if (sort === prefs.sortBy) {
        prefs.sortDir = prefs.sortDir === 1 ? -1 : 1
      } else {
        prefs.sortBy = sort
        prefs.sortDir = App.FolderSort.defaultDir(sort)
      }
    } else if (view) {
      prefs.viewStyle = view
    } else {
      return
    }
    App.Desktop.applyViewPrefs(prefs)
    close()
  }

  function init() {
    const btn = _getEl('btn-view-menu')
    if (btn) App.utils.bindPress(btn, toggle)
    const overlay = _getEl('view-menu-overlay')
    if (overlay) App.utils.bindPress(overlay, close)
    const menu = _getEl('view-menu')
    const items = _queryItems(menu)
    for (let i = 0; i < items.length; i++) {
      App.utils.bindPress(items[i], _onItemClick)
    }
    setEnabled(false)   // 初始根目录：置灰
  }

  return {
    init: init,
    open: open,
    close: close,
    toggle: toggle,
    isOpen: isOpen,
    isEnabled: isEnabled,
    setEnabled: setEnabled
  }
})()
