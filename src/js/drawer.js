/* 左侧 Drawer 工具栏：汉堡呼出，含根目录路径与文件系统动作。
 * 额外职责：全盘授权引导对话框（首次启动未授权时自动弹出 + Drawer「授权手机存储」）
 * 与桌面目录对话框（Drawer「桌面目录」：设置 all-files 模式桌面渲染的根目录）。 */
// @ts-check
'use strict'

App.Drawer = (function () {
  let DRAWER_ID = 'drawer'
  let OVERLAY_ID = 'drawer-overlay'
  let _open = false

  // ── 全盘授权引导（首次启动 / Drawer「授权手机存储」）──
  const PROMPT_KEY = 'all-files-prompted'
  // 常见桌面目录（相对手机存储根）：第一项 = 全盘根（桌面直接渲染整个手机存储）
  const COMMON_DIRS = ['', 'Desktop', 'Download', 'Documents', 'Pictures', 'DCIM', 'Music', 'Movies']
  /** @type {Record<string, string>} */
  const COMMON_DIRS_LABEL = { '': '手机存储根', Desktop: 'Desktop', Download: '下载', Documents: '文档', Pictures: '图片', DCIM: '相机', Music: '音乐', Movies: '电影' }

  /** @param {string} id @returns {HTMLElement | null} */
  function _getEl(id) { return document.getElementById(id) }

  /** @returns {void} */
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

  /** @returns {void} */
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

  /** @returns {void} */
  function toggle() {
    if (_open) close(); else open()
  }

  /** @returns {boolean} */
  function isOpen() { return _open }

  // ── 全盘授权引导 ──

  /** 首次启动未授权时自动弹出（desktop-persist refresh 拿到 rootInfo 后调用）；
   *  弹过即置 localStorage 标记（拒绝后不再自动弹，Drawer 按钮可再进）。
   *  守卫：浏览器预览无桥不弹；mode 必须是合法未授权枚举（saf/private）才弹——
   *  E2E 内存桩 mode='mock' 非合法枚举，不弹（否则全屏遮罩挡后续触摸序列）。 */
  /** @returns {void} */
  function maybePromptAllFiles() {
    if (!window.FileBridge) return
    const mode = App.DesktopCore && App.DesktopCore.state.mode
    if (mode === 'all-files') return
    if (mode !== 'saf' && mode !== 'private') return
    try {
      if (localStorage.getItem(PROMPT_KEY)) return
      localStorage.setItem(PROMPT_KEY, '1')
    } catch (e) { /* 忽略 */ }
    openAllFilesDialog()
  }

  /** @returns {void} */
  function openAllFilesDialog() {
    App.Dialog.open('all-files-dialog-overlay', closeAllFilesDialog)
  }

  /** @returns {void} */
  function closeAllFilesDialog() {
    App.Dialog.close('all-files-dialog-overlay')
  }

  /** 去授权：交原生跳系统「所有文件访问」设置页（Android 10 及以下弹运行时权限框） */
  /** @returns {void} */
  function grantAllFiles() {
    closeAllFilesDialog()
    if (App.bridge && typeof App.bridge.requestRootAccess === 'function') {
      App.bridge.requestRootAccess()
    }
  }

  // ── 桌面目录（all-files 模式桌面渲染的根目录）──

  /** 打开桌面目录选择对话框：渲染常见目录选项（当前值高亮）+ 预填自定义输入 */
  /** @returns {void} */
  function openDesktopDirDialog() {
    let optionsEl = document.getElementById('desktop-dir-options')
    if (!optionsEl) return
    optionsEl.innerHTML = ''
    const current = (App.Desktop && typeof App.Desktop.getDesktopRoot === 'function')
      ? App.Desktop.getDesktopRoot() : 'Desktop'
    COMMON_DIRS.forEach(function (dir) {
      let btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'desktop-dir-option' + (dir === current ? ' selected' : '')
      btn.textContent = COMMON_DIRS_LABEL[dir] !== undefined ? COMMON_DIRS_LABEL[dir] : dir
      btn.setAttribute('data-dir', dir)
      btn.addEventListener('click', function () { selectDesktopDir(dir) })
      optionsEl.appendChild(btn)
    })
    let inputEl = /** @type {HTMLInputElement | null} */ (document.getElementById('desktop-dir-input'))
    if (inputEl) inputEl.value = current
    App.Dialog.open('desktop-dir-dialog-overlay', closeDesktopDirDialog)
  }

  /** @returns {void} */
  function closeDesktopDirDialog() {
    App.Dialog.close('desktop-dir-dialog-overlay')
  }

  /** 保存并切换桌面根：校验 + 交给 DesktopPersist（失败 toast 原因） */
  /** @param {string} dir @returns {void} */
  function selectDesktopDir(dir) {
    if (!App.Desktop || typeof App.Desktop.saveDesktopRoot !== 'function') return
    const ok = App.Desktop.saveDesktopRoot(dir)
    if (ok) {
      closeDesktopDirDialog()
      App.toast.show('桌面目录已切换: ' + (dir || '手机存储根'))
    }
  }

  // 更新根目录路径显示（顶栏标题与 Drawer 头部同步）
  /** @param {string} displayPath @param {string} rootName @param {string} mode @returns {void} */
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
      modeEl.textContent = mode === 'saf' ? '外部存储'
        : (mode === 'all-files' ? '手机存储' : (mode === 'private' ? '应用私有目录' : ''))
    }
  }

  /** @returns {void} */
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
        App.utils.bindPress(/** @type {HTMLElement} */ (items[i]), /** @this {HTMLElement} */ function () {
          let action = this.getAttribute('data-action')
          if (!action) return
          close()
          if (action === 'switch-root') {
            // 已全盘授权 → 提示；未授权 → 弹引导对话框（说明后再跳系统设置页，不裸跳）
            if (App.DesktopCore && App.DesktopCore.state.mode === 'all-files') {
              App.toast.show('已授权手机存储')
            } else {
              openAllFilesDialog()
            }
          } else if (action === 'desktop-dir') {
            openDesktopDirDialog()
          } else if (action === 'installed-apps') App.AppList.open()
          else if (action === 'new-website') App.WebsiteDialog.open()
        })
      }
      // 头部关闭按钮
      let closeBtn = /** @type {HTMLElement | null} */ (d.querySelector('.drawer-close'))
      if (closeBtn) App.utils.bindPress(closeBtn, close)
    }
    // 全盘授权引导对话框按钮
    let grantBtn = document.getElementById('all-files-grant')
    if (grantBtn) App.utils.bindPress(grantBtn, grantAllFiles)
    let laterBtn = document.getElementById('all-files-later')
    if (laterBtn) App.utils.bindPress(laterBtn, closeAllFilesDialog)
    // 桌面目录对话框按钮
    let dirSaveBtn = document.getElementById('desktop-dir-save')
    if (dirSaveBtn) {
      App.utils.bindPress(dirSaveBtn, function () {
        let inputEl = /** @type {HTMLInputElement | null} */ (document.getElementById('desktop-dir-input'))
        if (!inputEl) return
        selectDesktopDir(inputEl.value.trim())
      })
    }
    let dirCancelBtn = document.getElementById('desktop-dir-cancel')
    if (dirCancelBtn) App.utils.bindPress(dirCancelBtn, closeDesktopDirDialog)
  }

  /** @type {Drawer} */
  return {
    open: open,
    close: close,
    toggle: toggle,
    isOpen: isOpen,
    updatePath: updatePath,
    init: init,
    maybePromptAllFiles: maybePromptAllFiles
  }
})()
