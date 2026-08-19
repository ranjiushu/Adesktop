/* 底部工具栏：5 个按钮。
 * 左 1 = 后退（＜）驱动 Desktop.goBack，左 2 = 前进（＞）驱动 Desktop.goForward，
 * 中间加号弹新建对话框，右 1 = Home（空间锚点：点按回快照/默认视角，长按记录位置快照），
 * 右 2 = 上级目录（↑）驱动 Desktop.goUp。
 * 后退/前进禁用态：根目录不可后退、栈尾不可前进；上级与 Home 禁用态：子文件夹容器内禁用
 * （Home 只在桌面空间有意义，随 refresh 更新）。
 * 依赖: namespace.js, utils.js, create-dialog.js, desktop.js, home-store.js
 * 导出: App.BottomBar
 * 手势: 底栏区域右滑呼出 Drawer 由 drawer-swipe.js 负责（监听底栏 touch 事件）
 */
// @ts-check
'use strict'

App.BottomBar = (function () {
  /** @param {string} id @returns {HTMLElement | null} */
  function _getEl(id) { return document.getElementById(id) }

  // 更新后退/前进/上级/Home 禁用态（根目录可后退判定、栈尾不可前进、子文件夹容器内上级与 Home 禁用）
  /** @returns {void} */
  function updateNavButtons() {
    let back = _getEl('bb-btn-back')
    let fwd = _getEl('bb-btn-forward')
    let up = _getEl('bb-btn-up')
    let home = _getEl('bb-btn-home')
    if (!App.Desktop) return
    const canBack = typeof App.Desktop.canGoBack === 'function' && App.Desktop.canGoBack()
    const canFwd = typeof App.Desktop.canGoForward === 'function' && App.Desktop.canGoForward()
    const canUp = typeof App.Desktop.canGoUp === 'function' && App.Desktop.canGoUp()
    // Home 仅桌面空间可用（子文件夹容器相机是滚动态，快照无意义）
    const canHome = typeof App.Desktop.isFolderView === 'function' && !App.Desktop.isFolderView()
    if (back) _setEnabled(back, canBack)
    if (fwd) _setEnabled(fwd, canFwd)
    if (up) _setEnabled(up, canUp)
    if (home) _setEnabled(home, canHome)
    updateHomeState()
  }

  // 统一设置按钮禁用态（disabled + aria-disabled）
  /** @param {HTMLElement} btn @param {boolean} enabled @returns {void} */
  function _setEnabled(btn, enabled) {
    if (enabled) {
      btn.removeAttribute('disabled')
      btn.setAttribute('aria-disabled', 'false')
    } else {
      btn.setAttribute('disabled', '')
      btn.setAttribute('aria-disabled', 'true')
    }
  }

  // Home 快照视觉：已记录快照 → 图标强调色（用户可感知「快照存在」）。
  // 按当前画布方向（rotation）读对应槽位：竖屏/横屏各有独立快照标记。
  /** @returns {void} */
  function updateHomeState() {
    let home = _getEl('bb-btn-home')
    if (!home || !App.HomeStore) return
    const rootId = (App.Desktop && typeof App.Desktop.getRootId === 'function')
      ? App.Desktop.getRootId() : ''
    const rot = (App.Desktop && typeof App.Desktop.isRotated === 'function' && App.Desktop.isRotated())
      ? 90 : 0
    const data = App.HomeStore.load(rootId, rot)
    if (data && data.home) home.classList.add('home-has-snapshot')
    else home.classList.remove('home-has-snapshot')
  }

  /** @returns {void} */
  function init() {
    let add = _getEl('bb-btn-add')
    if (add) {
      App.utils.bindPress(add, function () {
        if (App.CreateDialog && typeof App.CreateDialog.open === 'function') {
          App.CreateDialog.open()
        }
      })
    }
    let back = _getEl('bb-btn-back')
    if (back) {
      App.utils.bindPress(back, function () {
        if (App.Desktop && typeof App.Desktop.goBack === 'function') {
          App.Desktop.goBack()
        }
      })
    }
    let fwd = _getEl('bb-btn-forward')
    if (fwd) {
      App.utils.bindPress(fwd, function () {
        if (App.Desktop && typeof App.Desktop.goForward === 'function') {
          App.Desktop.goForward()
        }
      })
    }
    // Home：单击 = 回空间锚点视角（快照优先，无则默认视角）；双击 = 一览全部文件
    // （fit-bounds：全部图标放进屏幕，见 DesktopFit）；长按 500ms = 记录当前位置快照
    let home = _getEl('bb-btn-home')
    if (home) {
      App.utils.bindPressSplit(home, {
        onTap: function () {
          if (App.Desktop && typeof App.Desktop.goHome === 'function') {
            App.Desktop.goHome()
          }
        },
        onDoubleTap: function () {
          if (App.Desktop && typeof App.Desktop.fitAllFiles === 'function') {
            App.Desktop.fitAllFiles()
          }
        },
        onLongPress: function () {
          if (App.Desktop && typeof App.Desktop.captureHome === 'function') {
            App.Desktop.captureHome()
          }
        }
      })
    }
    let up = _getEl('bb-btn-up')
    if (up) {
      App.utils.bindPress(up, function () {
        if (App.Desktop && typeof App.Desktop.goUp === 'function') {
          App.Desktop.goUp()
        }
      })
    }
  }

  /** @type {BottomBar} */
  return {
    init: init,
    updateNavButtons: updateNavButtons,
    updateHomeState: updateHomeState
  }
})()
