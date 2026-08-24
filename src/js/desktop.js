/* 桌面模块：以真实文件系统为数据源，渲染图标（世界坐标绝对定位）。
 * 阶段 B：选择系统——单击选中/反选、框选、长按拿起整组拖移（网格吸附）、FAB 自动展开操作栏、
 *        localStorage 布局持久化（位置 + 相机视角）。
 * 阶段 C：目录导航——当前目录（curPath）+ 历史栈（后退/前进）+ 双击打开（文件夹进入）。
 * 阶段 D：视图模式——根目录 = Desktop（空间，无限画布 + 自由摆放 + 平移缩放）；
 *        子文件夹 = Folder（容器，排序 + 网格/列表视图 + 只能上下滚动有边界，
 *        长按拖动语义 = 移动文件到文件夹，功能开发中吐司占位）。
 * 布局 key = 完整相对路径（join(curPath, name)），跨目录不冲突。
 * 根目录 = SAF 授权目录 或 私有目录兜底（由桥决定）。
 */
// @ts-check
'use strict'

App.Desktop = (function () {

  // 共享状态与纯工具集中管理（拆分自 desktop.js 原闭包，见 desktop-core.js）
  const C = App.DesktopCore
  const R = App.DesktopRender
  const N = App.DesktopNavigation
  const B = App.DesktopBrowseMode
  const P = App.DesktopPersist
  const V = App.DesktopViewerLink
  const H = App.DesktopGestureHandlers

  /** @returns {void} */
  function initGesture() {
    C.nav = App.DesktopNav.create()
    P.initLayout()
    // 根目录相机基准 = 启动视角（Home 快照 > 默认视角 > 上次布局 > 出厂），
    // 否则 applyCameraForPath 根目录分支 rootCamera=null 会强制回出厂
    C.rootCamera = C.camera
    App.DesktopGesture.init({
      viewport: document.getElementById('desktop-viewport'),
      canvas: document.getElementById('desktop-canvas'),
      camera: C.camera,
      // folder 容器：双指 pan 每帧钳制——zoom 锁 1、x 锁 0、y 限画布内
      // （只能上下滚动且有上下边界；钳制在 gesture 层保证 transform 同步）
      /** @param {DesktopCameraState} c @returns {DesktopCameraState} */
      onClamp: function (c) {
        if (!C.isFolderView()) return c
        return App.DesktopCamera.clampToBounds(
          { x: 0, y: c.y, zoom: 1, rotation: 0 },
          C.viewportWidth(), C.state.canvasH, C.viewportWidth(), C.viewportHeight())
      },
      /** @param {DesktopCameraState} c @returns {void} */
      onUpdate: function (c) {
        C.camera = c
      },
      // 手势开始 → 打断进行中的 Home 平滑过渡（手势直控优先）
      onGestureStart: N.cancelCameraAnim,
      onHitTest: H.hitTest,
      onTap: H.handleTap,
      onMarqueeStart: H.handleMarqueeStart,
      onMarqueeLive: H.handleMarqueeLive,
      onMarqueeEnd: H.handleMarqueeEnd,
      onLongPress: H.handleLongPress,
      onDragStart: H.handleDragStart,
      onDrag: H.handleDrag,
      onDrop: H.handleDrop,
      onSingleCancel: H.handleSingleCancel
    })
    // 同步手势层相机 + 模式标志 + 菜单可用态（根目录初始 = desktop 空间）
    N.applyCameraForPath()
    // 同步高级浏览模式到手势层（initLayout 已从 ViewStore 加载偏好）
    B.syncBrowseMode()
  }

  // 导航模块依赖注入：目录切换后刷新渲染（persist 域 refresh）
  N.setRefresh(P.refresh)

  // 旋转画布 toggle（view-menu 驱动）：桌面空间 0↔90 toggle；folder 容器无意义，忽略。
  // 旋转是瞬时两态（无过渡动画）。**纯保中心旋转**（2026-08-19）：只改 rotation，
  // x/y/zoom 不动——旋转前后屏幕中心世界点相同（screenToWorld 在 rotation=90 时
  // 屏幕中心对应世界点与竖屏相同：均为 (c.x + w/2z, c.y + h/2z)），整理/自由摆放的
  // 图标世界坐标不变，旋转后仍围绕同一中心（曾「跳目标方向 Home 槽位」：目标方向
  // 槽位是历史残留位置，与整理区域脱节 → 旋转后视野整体漂移，用户找不到文件）。
  // Home 键（goHome）才按当前方向读槽位——整理锚已写入两方向槽位（同一中心），
  // 旋转后点 Home 恒回到整理区域。
  // 旋转后同步手势层/Home 高亮。
  /** @returns {boolean} */
  function toggleRotate() {
    if (C.isFolderView()) return false
    const cam = C.camera
    if (!cam) return false
    // 旋转前打断在跑的相机动画（fit/goHome RAF 循环）——否则残留帧会把
    // rotation 拉回起点或继续漂移相机位置（旋转被动画覆盖）
    if (N && typeof N.cancelCameraAnim === 'function') N.cancelCameraAnim()
    const next = cam.rotation === 90 ? 0 : 90
    C.camera = App.DesktopCamera.create(cam.x, cam.y, cam.zoom, next)
    if (App.DesktopGesture && typeof App.DesktopGesture.setCamera === 'function') {
      App.DesktopGesture.setCamera(C.camera)
    }
    if (App.BottomBar && typeof App.BottomBar.updateHomeState === 'function') {
      App.BottomBar.updateHomeState()
    }
    return true
  }

  /** @returns {boolean} */
  function isRotated() {
    return !!(C.camera && C.camera.rotation === 90)
  }

  /** @type {Desktop} */
  return {
    refresh: P.refresh,
    render: R.render,
    initGesture: initGesture,
    renderFromCache: P.renderFromCache,
    clearSelection: R.clearSelection,
    hasSelection: R.hasSelection,
    getSelectionNames: R.getSelectionNames,
    getSelectionEntries: R.getSelectionEntries,
    applyRename: V.applyRename,
    applyMoves: V.applyMoves,
    openItem: N.openItem,
    enterFolder: N.enterFolder,
    goBack: N.goBack,
    goForward: N.goForward,
    goUp: N.goUp,
    canGoBack: N.canGoBack,
    canGoForward: N.canGoForward,
    canGoUp: N.canGoUp,
    getCurPath: N.getCurPath,
    getLockedPaths: V.getLockedPaths,
    isLockedPath: V.isLockedPath,
    closeViewer: V.closeViewer,
    isTrashPath: C.isTrashPath,
    inTrash: C.inTrash,
    getTrashName: function () { return C.state.trashName },
    getRootId: function () { return C.state.rootId },
    getDesktopRoot: function () { return C.state.desktopRoot },
    saveDesktopRoot: P.saveDesktopRoot,
    viewMode: C.viewMode,
    isFolderView: C.isFolderView,
    applyViewPrefs: P.applyViewPrefs,
    getViewPrefs: P.getViewPrefs,
    captureHome: N.captureHome,
    captureDefaultView: N.captureDefaultView,
    setHome: N.setHome,
    goHome: N.goHome,
    fitAllFiles: N.fitAllFiles,
    setAdvancedBrowse: B.setAdvancedBrowse,
    isAdvancedBrowse: B.isAdvancedBrowse,
    exitTempMode: B.exitTempMode,
    toggleRotate: toggleRotate,
    isRotated: isRotated
  }
})()
