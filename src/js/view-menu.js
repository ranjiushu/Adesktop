/* 顶栏排列/视图菜单：header 右上弹出。
 * 根目录（Desktop 空间）下菜单项置灰（仅提示）；子文件夹（Folder 容器）下可选。
 * 排列方式：名称/修改日期/类型/大小，点击当前项切换升降序；
 * 视图：网格 / 列表。偏好经 App.ViewStore 持久化（全局，应用于所有子文件夹）。
 * 高级浏览模式：始终可用（不受 setEnabled 置灰控制），勾选切换单指平移行为。
 * 依赖: namespace.js, utils.js, view-store.js, folder-sort.js, desktop.js
 * 导出: App.ViewMenu
 */
// @ts-check
'use strict'

App.ViewMenu = (function () {
  let _enabled = false
  let _open = false

  /** @param {string} id @returns {HTMLElement | null} */
  function _getEl(id) { return document.getElementById(id) }

  /** @param {HTMLElement | null} menu @returns {NodeListOf<Element>} */
  function _queryItems(menu) {
    return menu ? menu.querySelectorAll('.view-menu-item') : document.querySelectorAll('.view-menu-item-none')
  }

  // 渲染当前选中态：排序项高亮 + 方向箭头，视图项高亮 + 勾，浏览模式勾选，旋转画布勾选
  /** @returns {void} */
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
    // 高级浏览模式勾选态
    const browseItem = menu.querySelector('[data-browse="advanced"]')
    if (browseItem) {
      if (typeof App.Desktop.isAdvancedBrowse === 'function' && App.Desktop.isAdvancedBrowse()) {
        browseItem.classList.add('active')
      } else {
        browseItem.classList.remove('active')
      }
    }
    // 旋转画布勾选态（独立于 setEnabled 置灰，仿高级浏览模式）
    const rotateItem = menu.querySelector('[data-rotate="toggle"]')
    if (rotateItem) {
      if (typeof App.Desktop.isRotated === 'function' && App.Desktop.isRotated()) {
        rotateItem.classList.add('active')
      } else {
        rotateItem.classList.remove('active')
      }
    }
  }

  /** @returns {void} */
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

  /** @returns {void} */
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

  /** @returns {void} */
  function toggle() {
    if (_open) close(); else open()
  }

  /** @returns {boolean} */
  function isOpen() { return _open }
  /** @returns {boolean} */
  function isEnabled() { return _enabled }

  // 目录切换时由 Desktop 调用：根目录置灰（仅提示），子文件夹可选。
  // 高级浏览模式项（.view-menu-browse）始终可用；
  // 旋转画布项（.view-menu-rotate）与其他项相反——根目录可用，folder 禁用
  // （旋转只对无限画布有意义，folder 容器是有限画布）；
  // 排列/视图 section 只在子文件夹显示（Desktop 无限画布无排序/视图语义，直接隐藏）。
  /** @param {boolean} on @returns {void} */
  function setEnabled(on) {
    _enabled = !!on
    const menu = _getEl('view-menu')
    if (menu) menu.classList.toggle('view-menu-folder', _enabled)
    const items = _queryItems(menu)
    for (let i = 0; i < items.length; i++) {
      if (items[i].classList.contains('view-menu-browse')) continue
      if (items[i].classList.contains('view-menu-rotate')) {
        // 根目录（on=false）可用，folder（on=true）禁用
        if (_enabled) items[i].setAttribute('disabled', '')
        else items[i].removeAttribute('disabled')
        continue
      }
      if (_enabled) items[i].removeAttribute('disabled')
      else items[i].setAttribute('disabled', '')
    }
  }

  // 菜单项点击：排序（当前项翻转方向 / 新项用默认方向）或视图切换
  /** @this {HTMLElement} @returns {void} */
  function _onItemClick() {
    if (!_enabled || this.hasAttribute('disabled')) return
    if (!App.Desktop || typeof App.Desktop.getViewPrefs !== 'function' ||
        typeof App.Desktop.applyViewPrefs !== 'function') return
    const prefs = App.Desktop.getViewPrefs()
    const sort = this.getAttribute('data-sort')
    const view = this.getAttribute('data-view')
    if (sort) {
      if (sort === prefs.sortBy) {
        prefs.sortDir = prefs.sortDir === 1 ? -1 : 1
      } else {
        prefs.sortBy = /** @type {ViewPrefs['sortBy']} */ (sort)
        prefs.sortDir = App.FolderSort.defaultDir(sort)
      }
    } else if (view) {
      prefs.viewStyle = /** @type {ViewPrefs['viewStyle']} */ (view)
    } else {
      return
    }
    App.Desktop.applyViewPrefs(prefs)
    close()
  }

  // 高级浏览模式切换：始终可用（不受 _enabled 限制）
  /** @returns {void} */
  function _onBrowseToggle() {
    if (!App.Desktop || typeof App.Desktop.setAdvancedBrowse !== 'function') return
    const next = !(typeof App.Desktop.isAdvancedBrowse === 'function' && App.Desktop.isAdvancedBrowse())
    App.Desktop.setAdvancedBrowse(next)
    renderState()
    close()
  }

  // 旋转画布切换：始终可用（不受 _enabled 限制，folder 容器内由 Desktop 守卫忽略）
  /** @returns {void} */
  function _onRotateToggle() {
    if (!App.Desktop || typeof App.Desktop.toggleRotate !== 'function') return
    App.Desktop.toggleRotate()
    renderState()
    close()
  }

  // 设为 Home：只在桌面空间可用（folder 容器内由 Desktop.setHome 守卫忽略）
  /** @returns {void} */
  function _onSetHome() {
    if (!App.Desktop || typeof App.Desktop.setHome !== 'function') return
    App.Desktop.setHome()
    close()
  }

  /** @returns {void} */
  function init() {
    const btn = _getEl('btn-view-menu')
    if (btn) App.utils.bindPress(btn, toggle)
    const overlay = _getEl('view-menu-overlay')
    if (overlay) App.utils.bindPress(overlay, close)
    const menu = _getEl('view-menu')
    const items = _queryItems(menu)
    for (let i = 0; i < items.length; i++) {
      // 高级浏览模式 / 旋转画布 / 设为 Home 项走独立处理器（不受 _enabled 限制，
      // 各自守卫：browse 始终可用；rotate/home 根目录可用 folder 内守卫忽略）
      if (items[i].classList.contains('view-menu-browse')) {
        App.utils.bindPress(/** @type {HTMLElement} */ (items[i]), _onBrowseToggle)
      } else if (items[i].classList.contains('view-menu-rotate')) {
        App.utils.bindPress(/** @type {HTMLElement} */ (items[i]), _onRotateToggle)
      } else if (items[i].classList.contains('view-menu-sethome')) {
        App.utils.bindPress(/** @type {HTMLElement} */ (items[i]), _onSetHome)
      } else {
        App.utils.bindPress(/** @type {HTMLElement} */ (items[i]), _onItemClick)
      }
    }
    setEnabled(false)   // 初始根目录：置灰（旋转/浏览模式/设为 Home 项不受影响）
  }

  /** @type {ViewMenu} */
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
