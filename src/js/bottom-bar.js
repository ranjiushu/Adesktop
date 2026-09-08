/* 底部工具栏：5 个按钮。
 * 左 1 = 后退（＜）驱动 Desktop.goBack，左 2 = 前进（＞）驱动 Desktop.goForward，
 * 中间 = Home（空间锚点：点按回 Home 锚点、长按记录新的 Home、双击一览全部文件），
 * 右 1 = 快照（相机图标：点按呼出快照列表、长按记录新的快照），右 2 = 上级目录（↑）驱动 Desktop.goUp。
 * 新建（加号）已由 Morph FAB 承担，底栏不再设新建按钮。
 * 后退/前进禁用态：根目录不可后退、栈尾不可前进；上级与 Home 禁用态：子文件夹容器内禁用
 * （Home 只在桌面空间有意义，随 refresh 更新）。
 * 循环演示：无「演示模式」开关——桌面空间存在快照时，前进/后退直接循环翻页
 * （恒可用，无边界），目录历史导航仅在没有快照/文件夹视图时接管。
 * 依赖: namespace.js, utils.js, create-dialog.js, desktop.js, home-store.js
 * 导出: App.BottomBar
 * 手势: 底栏区域右滑呼出 Drawer 由 drawer-swipe.js 负责（监听底栏 touch 事件）
 */
// @ts-check
'use strict'

App.BottomBar = (function () {
  /** @param {string} id @returns {HTMLElement | null} */
  function _getEl(id) { return document.getElementById(id) }

  /** @returns {boolean} 桌面空间 + 存在快照 → 前进/后退为循环演示（恒可用） */
  function _inLoopMode() {
    if (!App.Desktop || typeof App.Desktop.isFolderView !== 'function' || App.Desktop.isFolderView()) return false
    if (!App.SnapshotStore || typeof App.SnapshotStore.hasAny !== 'function') return false
    const rootId = (typeof App.Desktop.getRootId === 'function') ? App.Desktop.getRootId() : ''
    return App.SnapshotStore.hasAny(rootId)
  }

  // 更新后退/前进/上级/Home 禁用态（根目录可后退判定、栈尾不可前进、子文件夹容器内上级与 Home 禁用）
  /** @returns {void} */
  function updateNavButtons() {
    let back = _getEl('bb-btn-back')
    let fwd = _getEl('bb-btn-forward')
    let up = _getEl('bb-btn-up')
    let home = _getEl('bb-btn-home')
    let snap = _getEl('bb-btn-snapshot')
    if (!App.Desktop) return
    if (_inLoopMode()) {
      // 循环演示：前进/后退恒可用（无边界），上级/Home/快照按空间语义
      if (back) _setEnabled(back, true)
      if (fwd) _setEnabled(fwd, true)
      if (up) _setEnabled(up, typeof App.Desktop.canGoUp === 'function' && App.Desktop.canGoUp())
      if (home) _setEnabled(home, true)
      if (snap) _setEnabled(snap, true)
      updateHomeState()
      return
    }
    const canBack = typeof App.Desktop.canGoBack === 'function' && App.Desktop.canGoBack()
    const canFwd = typeof App.Desktop.canGoForward === 'function' && App.Desktop.canGoForward()
    const canUp = typeof App.Desktop.canGoUp === 'function' && App.Desktop.canGoUp()
    // Home/快照 仅桌面空间可用（子文件夹容器相机是滚动态，锚点/快照无意义）
    const canHome = typeof App.Desktop.isFolderView === 'function' && !App.Desktop.isFolderView()
    if (back) _setEnabled(back, canBack)
    if (fwd) _setEnabled(fwd, canFwd)
    if (up) _setEnabled(up, canUp)
    if (home) _setEnabled(home, canHome)
    if (snap) _setEnabled(snap, canHome)
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

  // Home 锚点视觉：HomeStore 存在 home/fallback（独立锚点）→ 图标强调色。
  // 快照列表与 Home 彻底分离，不影响此状态。
  /** @returns {void} */
  function updateHomeState() {
    let home = _getEl('bb-btn-home')
    if (!home) return
    const rootId = (App.Desktop && typeof App.Desktop.getRootId === 'function')
      ? App.Desktop.getRootId() : ''
    let hasAnchor = false
    if (App.HomeStore) {
      const rot = (App.Desktop && typeof App.Desktop.isRotated === 'function' && App.Desktop.isRotated())
        ? 90 : 0
      const data = App.HomeStore.load(rootId, rot)
      hasAnchor = !!(data && (data.home || data.fallback))
    }
    if (hasAnchor) home.classList.add('home-has-snapshot')
    else home.classList.remove('home-has-snapshot')
  }

  /** @returns {void} */
  function init() {
    // 新建（加号）已由 Morph FAB 承担，底栏不再设新建按钮。
    let back = _getEl('bb-btn-back')
    if (back) {
      App.utils.bindPress(back, function () {
        // 循环演示：桌面空间存在快照时前进/后退翻页（无演示模式概念）
        if (App.SnapshotSheet && typeof App.SnapshotSheet.goPrev === 'function' && App.SnapshotSheet.goPrev()) {
          return
        }
        if (App.Desktop && typeof App.Desktop.goBack === 'function') {
          App.Desktop.goBack()
        }
      })
    }
    let fwd = _getEl('bb-btn-forward')
    if (fwd) {
      App.utils.bindPress(fwd, function () {
        // 循环演示：桌面空间存在快照时前进/后退翻页（无演示模式概念）
        if (App.SnapshotSheet && typeof App.SnapshotSheet.goNext === 'function' && App.SnapshotSheet.goNext()) {
          return
        }
        if (App.Desktop && typeof App.Desktop.goForward === 'function') {
          App.Desktop.goForward()
        }
      })
    }
    // Home（空间锚点，独立于快照列表）：单击 = 回 Home 锚点；双击 = 一览全部文件
    // （fit-bounds，见 DesktopFit）；长按 500ms = 记录新的 Home 锚点（HomeStore）。
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
          if (App.Desktop && typeof App.Desktop.setHome === 'function') {
            App.Desktop.setHome()
          }
        }
      })
    }
    // 快照（相机图标）：单击 = 呼出快照列表；长按 500ms = 记录新的快照（SnapshotStore）。
    let snap = _getEl('bb-btn-snapshot')
    if (snap) {
      App.utils.bindPressSplit(snap, {
        onTap: function () {
          if (App.SnapshotSheet && typeof App.SnapshotSheet.open === 'function') {
            App.SnapshotSheet.open()
          }
        },
        onLongPress: function () {
          if (App.Desktop && typeof App.Desktop.captureSnapshot === 'function') {
            App.Desktop.captureSnapshot()
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
