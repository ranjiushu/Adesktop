/* desktop-navigation.js：目录导航 + Home 空间锚点 + 相机平滑过渡（App.DesktopNavigation）。
 * 拆分自 desktop.js 的导航域：打开（openItem/enterFolder）、目录切换相机策略
 * （applyCameraForPath）、历史导航（goUp/goBack/goForward/canGo 系列/getCurPath）、
 * Home 空间锚点（captureHome/captureDefaultView/goHome）、相机平滑飞行
 * （cancelCameraAnim/animateCameraTo，van Wijk & Nuij flyTo 同款）。
 * 依赖注入：目录切换后刷新渲染（persist 域 refresh）由 desktop.js 组装时
 * setRefresh 注入；临时操作模式退出经 App.DesktopBrowseMode。
 * 依赖: namespace.js, desktop-core.js, desktop-render.js, desktop-camera.js,
 *       desktop-nav.js, home-store.js, file-opener.js, viewer.js, view-menu.js
 * 导出: App.DesktopNavigation
 */
'use strict'

App.DesktopNavigation = (function () {
  const C = App.DesktopCore
  const HOME_ANIM_MS = 400    // Home 平滑过渡时长（zoom 不变=easeInOutCubic 缓入缓出；zoom 变化=easeOut 弧长，见 desktop-camera.js）

  // 外部注入：目录切换后刷新渲染（persist 域 refresh）
  let _refresh = null
  function setRefresh(fn) { _refresh = fn }

  // ── 打开：文件夹进入 / 文件打开（FileOpener 分派内部查看器 / 外部应用 / 快捷方式）──
  function openItem(full) {
    if (!full) return
    const item = C.state.items.filter(function (it) {
      return C.fullPath(it.name) === full
    })[0]
    if (!item) return
    if (item.isDir) {
      App.DesktopRender.clearSelection()
      enterFolder(full)
    } else if (App.FileOpener && typeof App.FileOpener.open === 'function') {
      // Windows 式锁定：文件被 Viewer 打开 = 锁定（禁复制/剪切/移动/删除/重命名，
      // 拖动摆放仍可）；文件不进入选中集——Viewer 实体自身有独立选中态（脆弱/临时）。
      // 多实例：每个打开的 Viewer 各自锁定其文件。
      // FileOpener.open 返回实例 id（数字）→ 锁定；true（外部/快捷方式）→ 只清选中不锁定。
      const result = App.FileOpener.open({ name: item.name, path: full }, C.isFolderView() ? null : (C.positions[full] || null), C.camera, function onClose(path) {
        if (path) C._lockedPaths.delete(path)
        App.DesktopRender.updateLockedVisual()
      })
      if (typeof result === 'number') {
        C._lockedPaths.add(full)
        App.DesktopRender.clearSelection()
        App.DesktopRender.updateLockedVisual()
      } else if (result) {
        App.DesktopRender.clearSelection()
      }
    } else if (App.toast) {
      App.toast.show('打开文件（查看器未就绪）')
    }
  }

  // 进入子目录：压栈历史 + 切换视图（folder 容器相机重置到顶）
  function enterFolder(full) {
    App.DesktopBrowseMode.exitTempMode()   // 进入文件夹 → 退出临时操作模式
    if (!C.isFolderView()) C.rootCamera = C.camera   // 从根进入：快照根视角，返回时恢复
    C.nav = App.DesktopNav.enter(C.nav, full)
    C.state.curPath = full
    applyCameraForPath()
    if (_refresh) _refresh()
  }

  // 目录切换后的相机与手势策略：
  //   根 = 恢复根相机（无限画布）；folder = 重置 (0,0,1)（滚动到顶）
  function applyCameraForPath() {
    cancelCameraAnim()   // 目录切换即打断 Home 动画，避免动画覆盖新路径相机
    // 目录切换：先退出全屏态 Viewer（folder 打开的全屏预览），保留 canvas 态 Viewer（跨目录保留）
    const fs = App.InternalViewer && App.InternalViewer.fullscreenInstance ? App.InternalViewer.fullscreenInstance() : null
    if (fs) {
      fs.exitFullscreen()   // folder 打开的全屏：退出 = close（见 exitFullscreen 的 from='folder' 分支）
      if (fs.getPath && C._lockedPaths.has(fs.getPath())) C._lockedPaths.delete(fs.getPath())
    }
    if (C.isFolderView()) {
      // 进入 folder：隐藏 canvas 态 Viewer（保留状态，退回根目录恢复）
      if (App.InternalViewer && App.InternalViewer.suspendCanvas) App.InternalViewer.suspendCanvas()
      C.camera = App.DesktopCamera.create(0, 0, 1)
    } else {
      // 回到根目录：恢复 canvas 态 Viewer
      if (App.InternalViewer && App.InternalViewer.resumeCanvas) App.InternalViewer.resumeCanvas()
      C.camera = C.rootCamera || App.DesktopCamera.create()
    }
    if (App.DesktopGesture && typeof App.DesktopGesture.setCamera === 'function') {
      App.DesktopGesture.setCamera(C.camera)
    }
    if (App.ViewMenu && typeof App.ViewMenu.setEnabled === 'function') {
      App.ViewMenu.setEnabled(C.isFolderView())
    }
  }

  // 退回到上级目录（父目录，压栈导航——与历史后退区分；Windows「向上」语义）
  function goUp() {
    App.DesktopBrowseMode.exitTempMode()
    if (!C.isFolderView()) return false
    const target = App.DesktopNav.parent(C.state.curPath)
    C.nav = App.DesktopNav.enter(C.nav, target)
    C.state.curPath = target
    applyCameraForPath()
    if (_refresh) _refresh()
    return true
  }

  // 后退 / 前进（底栏按钮驱动）
  // 后退：临时操作模式下消费此次按键退出临时模式（不导航）
  function goBack() {
    if (C._tempNormalMode) { App.DesktopBrowseMode.exitTempMode(); return true }
    if (!App.DesktopNav.canBack(C.nav)) return false
    C.nav = App.DesktopNav.back(C.nav)
    C.state.curPath = App.DesktopNav.current(C.nav)
    applyCameraForPath()
    if (_refresh) _refresh()
    return true
  }

  function goForward() {
    App.DesktopBrowseMode.exitTempMode()
    if (!App.DesktopNav.canForward(C.nav)) return false
    C.nav = App.DesktopNav.forward(C.nav)
    C.state.curPath = App.DesktopNav.current(C.nav)
    applyCameraForPath()
    if (_refresh) _refresh()
    return true
  }

  function canGoBack() { return App.DesktopNav.canBack(C.nav) }
  function canGoForward() { return App.DesktopNav.canForward(C.nav) }
  function canGoUp() { return C.isFolderView() }
  function getCurPath() { return C.state.curPath }

  // ── Home：空间锚点（位置快照 + 默认视角）──
  // 长按底栏 Home = 记录当前相机为快照；点按 Home = 回快照（无则默认视角，再无则出厂 (0,0,1)）。
  // 默认视角 = 用户经 Drawer「设为默认视角」设置的兜底视角。仅桌面空间（根目录）有意义。
  function captureHome() {
    if (C.isFolderView()) return false
    const cam = { x: C.camera.x, y: C.camera.y, zoom: C.camera.zoom }
    if (!App.HomeStore.saveHome(cam, C.state.rootId)) {
      if (App.toast && typeof App.toast.show === 'function') App.toast.show('Home 视角保存失败')
      return false
    }
    if (App.bridge && typeof App.bridge.vibrate === 'function') App.bridge.vibrate(30)
    if (App.toast && typeof App.toast.show === 'function') App.toast.show('已记录 Home 视角')
    if (App.BottomBar && typeof App.BottomBar.updateHomeState === 'function') {
      App.BottomBar.updateHomeState()
    }
    return true
  }

  // 设为默认视角（Drawer 操作项）：Home 无快照时的兜底视角
  function captureDefaultView() {
    if (C.isFolderView()) return false
    const cam = { x: C.camera.x, y: C.camera.y, zoom: C.camera.zoom }
    if (!App.HomeStore.saveFallback(cam, C.state.rootId)) {
      if (App.toast && typeof App.toast.show === 'function') App.toast.show('默认视角保存失败')
      return false
    }
    if (App.bridge && typeof App.bridge.vibrate === 'function') App.bridge.vibrate(30)
    if (App.toast && typeof App.toast.show === 'function') App.toast.show('已设置默认视角（无快照时 Home 回此视角）')
    return true
  }

  // 回到 Home：快照优先，其次默认视角，最后出厂 (0,0,1)。
  // 仅桌面空间（子文件夹内 Home 按钮禁用，此处防御）。不覆盖 rootCamera——
  // 从文件夹返回仍恢复进文件夹前的视角，Home 只负责「现在」的空间锚点。
  function goHome() {
    if (C.isFolderView()) return
    let target = App.DesktopCamera.create()
    const data = App.HomeStore.load(C.state.rootId)
    if (data && data.home) {
      target = App.DesktopCamera.create(data.home.x, data.home.y, data.home.zoom)
    } else if (data && data.fallback) {
      target = App.DesktopCamera.create(data.fallback.x, data.fallback.y, data.fallback.zoom)
    }
    animateCameraTo(target)
  }

  // ── 相机平滑过渡（Home 复位用，可被手势/目录切换打断）──

  function cancelCameraAnim() {
    if (C._animRaf !== null) {
      C._caf(C._animRaf)
      C._animRaf = null
    }
  }

  // 从当前相机平滑飞行到 target（van Wijk & Nuij，Leaflet flyTo 同款）；动画中再次调用会从当前位置重新起播。
  // 手势开始（onGestureStart）与目录切换（applyCameraForPath）都会打断，
  // 保证「动画永不与手势抢相机」——用户一碰就归手势直控。
  // lerpCentered 契约：收真实时间比例 k（内部按分支缓动：zoom 不变=easeInOutCubic，
  // zoom 变化=flightPath 内部 easeOut 弧长参数化，Leaflet 同款手感；调用方一律不得预缓动）——
  // 曾因预缓动传入导致段边界错位（真机「震感」）。zoom 变化走单一连续飞行曲线
  // （无分段断续）；zoom 不变退化为与 lerp 一致（纯平移动画不受影响）。
  function animateCameraTo(target, durationMs) {
    cancelCameraAnim()
    const from = { x: C.camera.x, y: C.camera.y, zoom: C.camera.zoom, rotation: C.camera.rotation }
    const tgt = target || App.DesktopCamera.create()
    // 目标相机透传当前 rotation（Home 复位只动位置/缩放，画布旋转状态保留；
    // 否则动画中途 rotation 变 0，画布闪回正）
    if (typeof tgt.rotation !== 'number') tgt.rotation = C.camera.rotation
    const dur = (durationMs && durationMs > 0) ? durationMs : HOME_ANIM_MS
    const vw = C.viewportWidth()
    const vh = C.viewportHeight()
    // 视口尺寸动画中快照：中途旋转/尺寸变化只影响轨迹形状，落点精确
    // （终点公式中 w/h 项数学抵消，k=1 恒等于 target）
    const t0 = C._now()
    function frame() {
      const k = Math.min(1, (C._now() - t0) / dur)
      // lerpCentered 收真实时间比例 k（内部统一缓动 + 按 k 分段）——
      // 不得预缓动传入，否则段边界错位致平移段被压缩（真机「震感」）
      const c = App.DesktopCamera.lerpCentered(from, tgt, k, vw, vh)
      C.camera = c
      if (App.DesktopGesture && typeof App.DesktopGesture.setCamera === 'function') {
        App.DesktopGesture.setCamera(C.camera)
      }
      if (k >= 1) { C._animRaf = null; return }
      C._animRaf = C._raf(frame)
    }
    C._animRaf = C._raf(frame)
  }

  return {
    openItem: openItem,
    enterFolder: enterFolder,
    applyCameraForPath: applyCameraForPath,
    goUp: goUp,
    goBack: goBack,
    goForward: goForward,
    canGoBack: canGoBack,
    canGoForward: canGoForward,
    canGoUp: canGoUp,
    getCurPath: getCurPath,
    captureHome: captureHome,
    captureDefaultView: captureDefaultView,
    goHome: goHome,
    cancelCameraAnim: cancelCameraAnim,
    animateCameraTo: animateCameraTo,
    setRefresh: setRefresh
  }
})()
