/* desktop-core.js：桌面共享状态与纯工具（App.DesktopCore）。
 * 拆分自 desktop.js 的状态层：集中管理桌面运行时状态（相机/位置/选中/拖拽/锁定/
 * 双击/模式/导航栈）与纯工具函数（RAF 驱动/DOM 创建/视口/路径/回收站判定）。
 * 数据真相仍在文件系统（LayoutStore/HomeStore/ViewStore），此处的 positions/
 * selection 等仅为内存投影；desktop 空间外（folder 容器）不持久化布局。
 * 一致性约定：所有状态经 C.xxx 读写（含内部函数），重赋值（如 dragTargets = []）
 * 对 core 内部与外部调用方可见同一对象。
 * 依赖: namespace.js, desktop-nav.js（fullPath 用 join）
 * 导出: App.DesktopCore
 */
// @ts-check
'use strict'

App.DesktopCore = (function () {
  /** @type {DesktopCore} */
  const C = /** @type {any} */ ({})

  // RAF 驱动（无 RAF 环境兜底 setTimeout ~16ms）
  C._raf = function (cb) {
    if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(cb)
    return setTimeout(function () { cb() }, 16)
  }
  C._caf = function (id) {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id)
    else clearTimeout(id)
  }
  C._now = function () {
    return (typeof performance === 'object' && typeof performance.now === 'function')
      ? performance.now() : Date.now()
  }

  C.state = {
    rootName: '…',
    mode: 'unknown',
    items: [],
    curPath: '',          // 当前目录（相对根，'' = 根；all-files 模式桌面空间 = desktopRoot）
    trashName: '',        // 回收站文件夹名（rootInfo 返回，'' = 未知/未初始化）
    rootId: '',           // 根目录身份（rootInfo 返回：SAF = tree uri / 全盘 = 'all-files:<桌面根>' / 私有 = 'private'）
    desktopRoot: 'Desktop', // 桌面根（all-files 模式）：桌面空间渲染的相对目录，Drawer「桌面目录」可配置
    viewStyle: 'grid',    // folder 容器视图：grid（4 列）| list（单列）
    sortBy: 'name',       // folder 容器排序：name | mtime | type | size
    sortDir: 1,           // 1 升序 | -1 降序
    canvasH: 0            // folder 容器画布高（滚动下界钳制用）
  }

  // 布局数据文件名：桌面空间目录下的隐藏文件（文件即真相；渲染时过滤，见 desktop-render）
  C.LAYOUT_FILE = '.adesktop-layout.json'

  C.nav = null             // App.DesktopNav 历史栈
  C.camera = null
  C.rootCamera = null      // 根目录相机快照（进入子文件夹前保存，返回根时恢复）
  C.positions = {}   // fullPath → {x, y}（世界坐标，移动后保留；仅 desktop 空间）
  C.bounds = {}      // fullPath → {x, y, w, h}（世界坐标 AABB，命中测试用）
  C.selection = /** @type {Set<string>} */ (new Set())
  C.iconEls = {}     // fullPath → DOM 元素
  C.dragTargets = []        // 移动的图标 fullPath 列表（组移动）
  C.dragStartWorld = null   // 手指起始世界坐标
  C.dragStartPositions = {} // fullPath → 起始世界坐标（保持组内相对位置）
  // 文件「打开」态（Viewer 即文件）是派生态：InternalViewer 存在该路径实例即锁定
  // （禁复制/剪切/移动/删除/重命名），无独立集合可失步——见 desktop-viewer-link.js。
  // Viewer 选中态由 InternalViewer 实例管理（单选：最多一个选中，脆弱/临时）

  // 双击窗口状态
  C._tapState = null            // App.DoubleTap 状态
  C._pendingDeselect = null     // { name } 待反选（双击窗口确认）
  C._deselectTimer = null

  // 高级浏览模式 + 临时操作模式
  C._advancedBrowse = false     // 高级浏览模式开关（持久化）
  C._tempNormalMode = false     // 临时操作模式（双击空白进入，打断退出）
  C._emptyTapTime = 0           // 空白区域双击窗口计时

  // 相机平滑过渡 RAF id（Home 复位用）
  C._animRaf = null

  // refresh 代际守卫序号（快速连续导航时丢弃过期响应）
  C._refreshSeq = 0

  C.el = function (tag, className, text) {
    let node = document.createElement(tag)
    if (className) node.className = className
    if (text != null) node.textContent = text
    return node
  }

  C.viewportWidth = function () {
    let vp = document.getElementById('desktop-viewport')
    return (vp && vp.clientWidth) || 360
  }

  C.viewportHeight = function () {
    let vp = document.getElementById('desktop-viewport')
    return (vp && vp.clientHeight) || 640
  }

  // 视图模式：
  //   all-files 模式：桌面空间 = desktopRoot（Drawer 可配置），其余（含全盘根 ''）都是 Folder 容器
  //   SAF/私有模式：根目录 '' = 桌面空间（保持原语义）；子文件夹 = Folder 容器
  C.isFolderView = function () {
    if (C.state.mode === 'all-files') return C.state.curPath !== C.state.desktopRoot
    return !!C.state.curPath
  }
  C.viewMode = function () { return C.isFolderView() ? 'folder' : 'desktop' }

  // 文件大小人性化（列表视图 meta）
  C.fmtSize = function (size) {
    if (typeof size !== 'number' || size < 0) return ''
    if (size < 1024) return size + ' B'
    if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB'
    return (size / 1024 / 1024).toFixed(1) + ' MB'
  }

  // 完整路径（布局 key）：根目录下 = 短名，子目录 = curPath/name
  C.fullPath = function (name) {
    return App.DesktopNav.join(C.state.curPath, name)
  }

  // 回收站：根目录下固定名文件夹（桥层 rootInfo 返回 trashName），只锚定根目录。
  // 完整路径恒等于 trashName（无子目录前缀），供删除目标 / 守卫 / 渲染特判共用。
  C.isTrashPath = function (path) {
    return !!C.state.trashName && path === C.state.trashName
  }

  // 当前视图是否已进入回收站（folder 容器，curPath === trashName）
  C.inTrash = function () {
    return !!C.state.trashName && C.state.curPath === C.state.trashName
  }

  // 拖动组是否包含回收站（允许重定位，禁止移入其他文件夹）
  C.dragIncludesTrash = function () {
    return !!C.state.trashName && C.dragTargets.indexOf(C.state.trashName) >= 0
  }

  return C
})()
