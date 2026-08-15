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
'use strict'

App.Desktop = (function () {
  const ICON_W = 84
  const ICON_H = 76
  const DOUBLE_TAP_MS = 300   // 双击窗口（interaction.md §7）
  const HOME_ANIM_MS = 400    // Home 平滑过渡时长（zoom 不变=easeInOutCubic 缓入缓出；zoom 变化=easeOut 弧长，见 desktop-camera.js）

  // RAF 驱动（无 RAF 环境兜底 setTimeout ~16ms）
  function _raf(cb) {
    if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(cb)
    return setTimeout(function () { cb() }, 16)
  }
  function _caf(id) {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id)
    else clearTimeout(id)
  }
  function _now() {
    return (typeof performance === 'object' && typeof performance.now === 'function')
      ? performance.now() : Date.now()
  }

  let state = {
    rootName: '…',
    mode: 'unknown',
    items: [],
    curPath: '',          // 当前目录（相对根，'' = 根）
    trashName: '',        // 回收站文件夹名（rootInfo 返回，'' = 未知/未初始化）
    viewStyle: 'grid',    // folder 容器视图：grid（4 列）| list（单列）
    sortBy: 'name',       // folder 容器排序：name | mtime | type | size
    sortDir: 1,           // 1 升序 | -1 降序
    canvasH: 0            // folder 容器画布高（滚动下界钳制用）
  }

  let nav = null             // App.DesktopNav 历史栈
  let camera = null
  let rootCamera = null      // 根目录相机快照（进入子文件夹前保存，返回根时恢复）
  let positions = {}   // fullPath → {x, y}（世界坐标，移动后保留；仅 desktop 空间）
  let bounds = {}      // fullPath → {x, y, w, h}（世界坐标 AABB，命中测试用）
  let selection = new Set()
  let iconEls = {}     // fullPath → DOM 元素
  let dragTargets = []        // 移动的图标 fullPath 列表（组移动）
  let dragStartWorld = null   // 手指起始世界坐标
  let dragStartPositions = {} // fullPath → 起始世界坐标（保持组内相对位置）
  // 文件锁定（Windows 式）：被 Viewer 打开的文件禁止复制/剪切/移动/删除/重命名，
  // 只允许拖动摆放（桌面空间布局）；关闭对应 Viewer 即解除。多实例：Set 存所有锁定路径
  let _lockedPaths = new Set()
  // Viewer 选中态由 InternalViewer 实例管理（单选：最多一个选中，脆弱/临时）

  // 双击窗口状态
  let _tapState = null            // App.DoubleTap 状态
  let _pendingDeselect = null     // { name } 待反选（双击窗口确认）
  let _deselectTimer = null

  function el(tag, className, text) {
    let node = document.createElement(tag)
    if (className) node.className = className
    if (text != null) node.textContent = text
    return node
  }

  // 缩略图渲染：ThumbnailService 已验证 URI（可解码）后回调，创建 <img> 展示；
  // onerror 双保险（极端情况下仍回退类型图标）。缩略图的「判定/缓存/生成」全在 App.Thumbnail。
  function setThumbImg(iconEl, uri, kind) {
    const img = document.createElement('img')
    img.className = 'desktop-icon-thumb'
    img.alt = ''
    img.decoding = 'async'
    img.onerror = function () {
      if (iconEl && iconEl.parentNode) {
        iconEl.innerHTML = App.TypeIcons.svgFor(kind)
      }
    }
    img.src = uri
    iconEl.innerHTML = ''
    iconEl.appendChild(img)
  }

  function viewportWidth() {
    let vp = document.getElementById('desktop-viewport')
    return (vp && vp.clientWidth) || 360
  }

  function viewportHeight() {
    let vp = document.getElementById('desktop-viewport')
    return (vp && vp.clientHeight) || 640
  }

  // 视图模式：根目录 = Desktop（空间，无限画布）；子文件夹 = Folder（容器，有限画布）
  function isFolderView() { return !!state.curPath }
  function viewMode() { return isFolderView() ? 'folder' : 'desktop' }

  // 文件大小人性化（列表视图 meta）
  function fmtSize(size) {
    if (typeof size !== 'number' || size < 0) return ''
    if (size < 1024) return size + ' B'
    if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB'
    return (size / 1024 / 1024).toFixed(1) + ' MB'
  }

  // 完整路径（布局 key）：根目录下 = 短名，子目录 = curPath/name
  function fullPath(name) {
    return App.DesktopNav.join(state.curPath, name)
  }

  // 回收站：根目录下固定名文件夹（桥层 rootInfo 返回 trashName），只锚定根目录。
  // 完整路径恒等于 trashName（无子目录前缀），供删除目标 / 守卫 / 渲染特判共用。
  function isTrashPath(path) {
    return !!state.trashName && path === state.trashName
  }

  // 当前视图是否已进入回收站（folder 容器，curPath === trashName）
  function inTrash() {
    return !!state.trashName && state.curPath === state.trashName
  }

  // 自动排布：
  //   desktop 空间：世界坐标按网格铺开（已有位置优先，位置来自 LayoutStore 持久化）
  //   folder 容器：排序后固定排布（网格 4 列自适应 / 列表单列），不读持久化位置
  function layout(items) {
    if (isFolderView()) {
      const sorted = App.FolderSort.sort(items, state.sortBy, state.sortDir)
      const pts = state.viewStyle === 'list'
        ? App.FolderLayout.listPositions(sorted.length)
        : App.FolderLayout.gridPositions(sorted.length, viewportWidth())
      return sorted.map(function (item, i) {
        return { item: item, key: fullPath(item.name), x: pts[i].x, y: pts[i].y }
      })
    }
    let cols = Math.max(3, Math.min(8, Math.floor(viewportWidth() / App.DesktopGrid.GRID_W)))
    return items.map(function (item, i) {
      const key = fullPath(item.name)
      let pos = positions[key]
      if (!pos) {
        pos = App.DesktopGrid.cellToWorld(i % cols, Math.floor(i / cols))
      }
      return { item: item, key: key, x: pos.x, y: pos.y }
    })
  }

  function render() {
    let gridEl = document.getElementById('desktop-grid')
    if (!gridEl) return
    gridEl.innerHTML = ''
    iconEls = {}
    bounds = {}   // 清空重建，防止已删/不可见文件（如隐藏文件）的旧 bounds 残留导致命中测试选中幽灵项

    // folder 容器：画布尺寸 = 内容（滚动边界的基础；无卡片视觉）
    const canvasEl = document.getElementById('desktop-canvas')
    if (isFolderView()) {
      const size = App.FolderLayout.canvasSize(state.items.length, viewportWidth(), state.viewStyle)
      state.canvasH = size.h
      gridEl.style.width = size.w + 'px'
      gridEl.style.height = size.h + 'px'
      if (canvasEl) canvasEl.classList.add('folder-canvas')
    } else {
      state.canvasH = 0
      gridEl.style.width = ''
      gridEl.style.height = ''
      if (canvasEl) canvasEl.classList.remove('folder-canvas')
    }

    let placed = layout(state.items)
    placed.forEach(function (p) {
      positions[p.key] = { x: p.x, y: p.y }
      bounds[p.key] = { x: p.x, y: p.y, w: ICON_W, h: ICON_H }
      const isTrashItem = p.item.isDir && isTrashPath(p.key)
      let card = el('div', 'desktop-icon' + (p.item.isDir ? ' is-dir' : '') + (isTrashItem ? ' is-trash' : ''))
      if (isFolderView()) {
        if (state.viewStyle === 'list') {
          card.classList.add('desktop-list-row')
        } else {
          // 网格 4 列：图标宽自适应列宽（列间留 8px 空隙，不裁切）
          card.style.width = App.FolderLayout.iconWidth(viewportWidth()) + 'px'
        }
      }
      card.setAttribute('data-name', p.item.name)
      card.setAttribute('data-path', p.key)
      // 剪切源半透明标记（Windows 式视觉反馈，文件仍真实存在）
      if (App.Clipboard && App.Clipboard.isCut(p.key)) {
        card.classList.add('clip-cut')
      }
      let icon = el('div', 'desktop-icon-glyph')
      const kind = App.TypeIcons ? App.TypeIcons.kindFor(p.item.name, p.item.isDir) : 'unknown'
      if (isTrashItem) {
        icon.innerHTML = App.TypeIcons ? App.TypeIcons.svgFor('trash') : '🗑️'
      } else if (App.Thumbnail && App.Thumbnail.canThumbnail(kind)) {
        // 先类型图标（fallback 基线），异步请求缩略图，成功替换（渐进式：类型图标 → 真缩略图）
        icon.innerHTML = App.TypeIcons ? App.TypeIcons.svgFor(kind) : '📄'
        App.Thumbnail.request(p.key, p.item.name, kind, function (uri) {
          if (icon.parentNode) setThumbImg(icon, uri, kind)
        }, function () { /* 失败：保持类型图标 */ })
      } else {
        icon.innerHTML = App.TypeIcons ? App.TypeIcons.svgFor(kind) : (p.item.isDir ? '📁' : '📄')
      }
      let name = el('div', 'desktop-icon-name', p.item.name)
      card.appendChild(icon)
      card.appendChild(name)
      // 列表视图：右侧元信息（文件夹 / 文件大小）
      if (isFolderView() && state.viewStyle === 'list') {
        const meta = el('div', 'desktop-list-meta', p.item.isDir ? '文件夹' : fmtSize(p.item.size))
        card.appendChild(meta)
      }
      card.style.left = p.x + 'px'
      card.style.top = p.y + 'px'
      if (selection.has(p.key)) card.classList.add('selected')
      iconEls[p.key] = card
      gridEl.appendChild(card)
    })

    // 用实测高度校准命中边界（宽度 CSS 固定 84，高度由内容撑开）
    Object.keys(iconEls).forEach(function (key) {
      const node = iconEls[key]
      bounds[key].w = node.offsetWidth || ICON_W
      bounds[key].h = node.offsetHeight || ICON_H
    })
    // 渲染后恢复锁定视觉（网格重建会丢失 class）
    updateLockedVisual()
  }

  // ── 选中态同步：图标 class + FAB 操作栏路由 ──
  // FAB 展开条件 = 文件选中 或 Viewer 实体选中（二者其一，互斥出现）
  function applySelection() {
    Object.keys(iconEls).forEach(function (key) {
      if (selection.has(key)) iconEls[key].classList.add('selected')
      else iconEls[key].classList.remove('selected')
    })
    syncFab()
  }

  function syncFab() {
    if (App.fabSpeedDial && typeof App.fabSpeedDial.setSelection === 'function') {
      const viewerSel = App.InternalViewer && typeof App.InternalViewer.anySelected === 'function' &&
        App.InternalViewer.anySelected()
      App.fabSpeedDial.setSelection(selection.size > 0 || viewerSel)
    }
  }

  // 取消文件选中（Viewer 保持打开、文件保持锁定——选中与查看解绑）
  function clearSelection() {
    selection = new Set()
    applySelection()
  }

  // 是否有文件选中（返回键取消选中用）
  function hasSelection() { return selection.size > 0 }

  // 关闭「选中的」Viewer + 解除其文件锁定（唯一出口：FAB 关闭预览）。目录切换走 closeAllViewers
  function closeViewer() {
    const inst = App.InternalViewer && typeof App.InternalViewer.selectedInstance === 'function'
      ? App.InternalViewer.selectedInstance() : null
    if (!inst) return
    const path = inst.getPath()
    App.InternalViewer.closeById(inst.id)
    if (path) _lockedPaths.delete(path)
    updateLockedVisual()
    syncFab()
  }

  // 关闭所有 Viewer + 解除全部锁定（目录切换：全屏态先退出）
  function closeAllViewers() {
    if (!App.InternalViewer) return
    const list = App.InternalViewer.list ? App.InternalViewer.list() : []
    App.InternalViewer.closeAll()
    list.forEach(function (inst) {
      const p = inst.getPath()
      if (p) _lockedPaths.delete(p)
    })
    updateLockedVisual()
    syncFab()
  }

  // 锁定视觉：被 Viewer 打开的文件图标加锁标记
  function updateLockedVisual() {
    Object.keys(iconEls).forEach(function (key) {
      const node = iconEls[key]
      if (!node) return
      if (_lockedPaths.has(key)) node.classList.add('desktop-icon-locked')
      else node.classList.remove('desktop-icon-locked')
    })
  }

  // 锁定判断（actions.js 用）：路径是否被任一 Viewer 锁定
  function isLockedPath(path) {
    return _lockedPaths.has(path)
  }

  function getLockedPaths() { return Array.from(_lockedPaths) }

  // 当前选中完整路径列表（复制/剪切/重命名用）
  function getSelectionNames() {
    return Array.from(selection)
  }

  // 当前选中条目 [{path, isDir}]（剪贴板跨目录粘贴需要源类型）
  function getSelectionEntries() {
    return Array.from(selection).map(function (path) {
      let isDir = false
      state.items.forEach(function (it) {
        if (fullPath(it.name) === path) isDir = it.isDir
      })
      return { path: path, isDir: isDir }
    })
  }

  // 重命名后布局 key 迁移：positions/bounds 以完整路径为 key，
  // 旧 key → 新 key，否则新名字刷新后回退自动排布丢位置。随后重绘。
  function applyRename(oldPath, newPath) {
    if (!oldPath || !newPath || oldPath === newPath) return
    if (positions[oldPath]) {
      positions[newPath] = positions[oldPath]
      delete positions[oldPath]
    }
    if (bounds[oldPath]) {
      bounds[newPath] = bounds[oldPath]
      delete bounds[oldPath]
    }
    if (selection.has(oldPath)) {
      selection.delete(oldPath)
      selection.add(newPath)
    }
    saveLayout()
    refresh()
  }

  // ── 打开：文件夹进入 / 文件打开（FileOpener 分派内部查看器或外部应用）──
  function openItem(full) {
    if (!full) return
    const item = state.items.filter(function (it) {
      return fullPath(it.name) === full
    })[0]
    if (!item) return
    if (item.isDir) {
      clearSelection()
      enterFolder(full)
    } else if (App.FileOpener && typeof App.FileOpener.open === 'function') {
      // Windows 式锁定：文件被 Viewer 打开 = 锁定（禁复制/剪切/移动/删除/重命名，
      // 拖动摆放仍可）；文件不进入选中集——Viewer 实体自身有独立选中态（脆弱/临时）。
      // 多实例：每个打开的 Viewer 各自锁定其文件。
      const id = App.FileOpener.open({ name: item.name, path: full }, isFolderView() ? null : (positions[full] || null), camera)
      if (id) {
        _lockedPaths.add(full)
        selection = new Set()
        updateLockedVisual()
        syncFab()
      }
    } else if (App.toast) {
      App.toast.show('打开文件（查看器未就绪）')
    }
  }

  // 进入子目录：压栈历史 + 切换视图（folder 容器相机重置到顶）
  function enterFolder(full) {
    if (!isFolderView()) rootCamera = camera   // 从根进入：快照根视角，返回时恢复
    nav = App.DesktopNav.enter(nav, full)
    state.curPath = full
    applyCameraForPath()
    refresh()
  }

  // 目录切换后的相机与手势策略：
  //   根 = 恢复根相机（无限画布）；folder = 重置 (0,0,1)（滚动到顶）
  function applyCameraForPath() {
    cancelCameraAnim()   // 目录切换即打断 Home 动画，避免动画覆盖新路径相机
    // 目录切换：先退出全屏态 Viewer（folder 打开的全屏预览），保留 canvas 态 Viewer（跨目录保留）
    const fs = App.InternalViewer && App.InternalViewer.fullscreenInstance ? App.InternalViewer.fullscreenInstance() : null
    if (fs) {
      fs.exitFullscreen()   // folder 打开的全屏：退出 = close（见 exitFullscreen 的 from='folder' 分支）
      if (fs.getPath && _lockedPaths.has(fs.getPath())) _lockedPaths.delete(fs.getPath())
    }
    if (isFolderView()) {
      // 进入 folder：隐藏 canvas 态 Viewer（保留状态，退回根目录恢复）
      if (App.InternalViewer && App.InternalViewer.suspendCanvas) App.InternalViewer.suspendCanvas()
      camera = App.DesktopCamera.create(0, 0, 1)
    } else {
      // 回到根目录：恢复 canvas 态 Viewer
      if (App.InternalViewer && App.InternalViewer.resumeCanvas) App.InternalViewer.resumeCanvas()
      camera = rootCamera || App.DesktopCamera.create()
    }
    if (App.DesktopGesture && typeof App.DesktopGesture.setCamera === 'function') {
      App.DesktopGesture.setCamera(camera)
    }
    if (App.ViewMenu && typeof App.ViewMenu.setEnabled === 'function') {
      App.ViewMenu.setEnabled(isFolderView())
    }
  }

  // 退回到上级目录（父目录，压栈导航——与历史后退区分；Windows「向上」语义）
  function goUp() {
    if (!isFolderView()) return false
    const target = App.DesktopNav.parent(state.curPath)
    nav = App.DesktopNav.enter(nav, target)
    state.curPath = target
    applyCameraForPath()
    refresh()
    return true
  }

  // 后退 / 前进（底栏按钮驱动）
  function goBack() {
    if (!App.DesktopNav.canBack(nav)) return false
    nav = App.DesktopNav.back(nav)
    state.curPath = App.DesktopNav.current(nav)
    applyCameraForPath()
    refresh()
    return true
  }

  function goForward() {
    if (!App.DesktopNav.canForward(nav)) return false
    nav = App.DesktopNav.forward(nav)
    state.curPath = App.DesktopNav.current(nav)
    applyCameraForPath()
    refresh()
    return true
  }

  function canGoBack() { return App.DesktopNav.canBack(nav) }
  function canGoForward() { return App.DesktopNav.canForward(nav) }
  function canGoUp() { return isFolderView() }
  function getCurPath() { return state.curPath }

  // ── Home：空间锚点（位置快照 + 默认视角）──
  // 长按底栏 Home = 记录当前相机为快照；点按 Home = 回快照（无则默认视角，再无则出厂 (0,0,1)）。
  // 默认视角 = 用户经 Drawer「设为默认视角」设置的兜底视角。仅桌面空间（根目录）有意义。
  function captureHome() {
    if (isFolderView()) return false
    const cam = { x: camera.x, y: camera.y, zoom: camera.zoom }
    if (!App.HomeStore.saveHome(cam)) {
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
    if (isFolderView()) return false
    const cam = { x: camera.x, y: camera.y, zoom: camera.zoom }
    if (!App.HomeStore.saveFallback(cam)) {
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
    if (isFolderView()) return
    let target = App.DesktopCamera.create()
    const data = App.HomeStore.load()
    if (data && data.home) {
      target = App.DesktopCamera.create(data.home.x, data.home.y, data.home.zoom)
    } else if (data && data.fallback) {
      target = App.DesktopCamera.create(data.fallback.x, data.fallback.y, data.fallback.zoom)
    }
    animateCameraTo(target)
  }

  // ── 相机平滑过渡（Home 复位用，可被手势/目录切换打断）──
  let _animRaf = null

  function cancelCameraAnim() {
    if (_animRaf !== null) {
      _caf(_animRaf)
      _animRaf = null
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
    const from = { x: camera.x, y: camera.y, zoom: camera.zoom }
    const dur = (durationMs && durationMs > 0) ? durationMs : HOME_ANIM_MS
    const vw = viewportWidth()
    const vh = viewportHeight()
    // 视口尺寸动画中快照：中途旋转/尺寸变化只影响轨迹形状，落点精确
    // （终点公式中 w/h 项数学抵消，k=1 恒等于 target）
    const t0 = _now()
    function frame() {
      const k = Math.min(1, (_now() - t0) / dur)
      // lerpCentered 收真实时间比例 k（内部统一缓动 + 按 k 分段）——
      // 不得预缓动传入，否则段边界错位致平移段被压缩（真机「震感」）
      const c = App.DesktopCamera.lerpCentered(from, target, k, vw, vh)
      camera = c
      if (App.DesktopGesture && typeof App.DesktopGesture.setCamera === 'function') {
        App.DesktopGesture.setCamera(camera)
      }
      if (k >= 1) { _animRaf = null; return }
      _animRaf = _raf(frame)
    }
    _animRaf = _raf(frame)
  }

  // ── 手势回调（世界坐标）──
  function handleTap(world) {
    // Viewer 画布实体：点击 = 单选选中该实例（脆弱/临时，点外部取消）
    const hitInst = App.InternalViewer && typeof App.InternalViewer.topmostAt === 'function'
      ? App.InternalViewer.topmostAt(world.x, world.y) : null
    if (hitInst) {
      if (hitInst.getMode() === 'canvas') {
        App.InternalViewer.selectOnly(hitInst.id)
        syncFab()
      }
      return
    }
    // 点击 Viewer 外部：取消 Viewer 选中（Viewer 保持打开、文件保持锁定）
    if (App.InternalViewer && App.InternalViewer.anySelected()) {
      App.InternalViewer.deselectAll()
      syncFab()
    }
    const name = App.DesktopSelection.pointHitTest(world.x, world.y, bounds)
    const now = Date.now()
    const r = App.DoubleTap.hit(_tapState, name, now, DOUBLE_TAP_MS)
    _tapState = r.state
    if (r.double) {
      // 双击：取消待反选，打开
      if (_deselectTimer) { clearTimeout(_deselectTimer); _deselectTimer = null }
      _pendingDeselect = null
      openItem(name)
      return
    }
    if (name) {
      if (!selection.has(name)) {
        // 未选中 → 立即选中（视觉即时）
        selection = App.DesktopSelection.selectOnly(name)
        applySelection()
      } else {
        // 已选中 → 反选延迟（双击窗口确认，防止双击时先反选再打开）
        _pendingDeselect = { name: name }
        if (_deselectTimer) clearTimeout(_deselectTimer)
        _deselectTimer = setTimeout(function () {
          _deselectTimer = null
          if (_pendingDeselect && selection.has(_pendingDeselect.name)) {
            selection = App.DesktopSelection.toggle(selection, _pendingDeselect.name)
            applySelection()
          }
          _pendingDeselect = null
        }, DOUBLE_TAP_MS)
      }
    } else {
      selection = App.DesktopSelection.clear()
      applySelection()
    }
  }

  function showMarquee(startWorld, currentWorld) {
    const mq = document.getElementById('desktop-marquee')
    if (!mq) return
    const a = App.DesktopCamera.worldToScreen(startWorld.x, startWorld.y, camera)
    const b = App.DesktopCamera.worldToScreen(currentWorld.x, currentWorld.y, camera)
    mq.style.left = Math.min(a.x, b.x) + 'px'
    mq.style.top = Math.min(a.y, b.y) + 'px'
    mq.style.width = Math.abs(b.x - a.x) + 'px'
    mq.style.height = Math.abs(b.y - a.y) + 'px'
    mq.style.display = 'block'
  }

  function hideMarquee() {
    const mq = document.getElementById('desktop-marquee')
    if (mq) mq.style.display = 'none'
  }

  function handleMarqueeStart(world) { showMarquee(world, world) }
  function handleMarqueeLive(start, cur) { showMarquee(start, cur) }

  function handleMarqueeEnd(start, cur) {
    hideMarquee()
    const rect = App.DesktopSelection.rectFromPoints(start.x, start.y, cur.x, cur.y)
    // 框选命中：被 Viewer 覆盖的文件图标不参与（Viewer 遮挡语义）
    const files = App.DesktopSelection.marqueeHitTest(rect, bounds).filter(function (name) {
      return !isCoveredByViewer(bounds[name])
    })
    selection = new Set(files)
    // 框选命中 Viewer → 单选选中它；未命中 → 取消 Viewer 选中（替换选择语义）
    const hitInst = App.InternalViewer && typeof App.InternalViewer.rectHit === 'function'
      ? App.InternalViewer.rectHit(rect) : null
    if (hitInst) {
      App.InternalViewer.selectOnly(hitInst.id)
    } else if (App.InternalViewer && App.InternalViewer.anySelected()) {
      App.InternalViewer.deselectAll()
    }
    applySelection()
  }

  // 文件图标是否被任一 canvas 态 Viewer 覆盖（遮挡，框选跳过）
  function isCoveredByViewer(rect) {
    if (!rect || !App.InternalViewer || typeof App.InternalViewer.rectHit !== 'function') return false
    return !!App.InternalViewer.rectHit(rect)
  }

  function setPickedUp(name, on) {
    const node = iconEls[name]
    if (node) {
      if (on) node.classList.add('picked-up')
      else node.classList.remove('picked-up')
    }
  }

  // 命中类型（desktop 空间）：selected=已选中（可直接拿起）/ icon=未选中图标 / empty=空白
  // viewer-selected = 命中的 Viewer 已被选中（可直接拿起移动实体）；viewer = 命中的 Viewer 未选中（长按/框选触发选中）
  // folder 容器：icon=图标（可框选，不拿起）/ empty=空白（滚动），永不 selected（禁止移动）
  function hitTest(world) {
    const hitInst = App.InternalViewer && typeof App.InternalViewer.topmostAt === 'function'
      ? App.InternalViewer.topmostAt(world.x, world.y) : null
    if (hitInst) {
      return hitInst.isSelected() ? 'viewer-selected' : 'viewer'
    }
    if (isFolderView()) {
      const name = App.DesktopSelection.pointHitTest(world.x, world.y, bounds)
      return name ? 'icon' : 'empty'
    }
    const name = App.DesktopSelection.pointHitTest(world.x, world.y, bounds)
    if (name) {
      return selection.has(name) ? 'selected' : 'icon'
    }
    if (selection.size > 0) {
      const rect = App.DesktopSelection.unionRect(bounds, Array.from(selection))
      if (App.DesktopSelection.pointInRect(world.x, world.y, rect)) {
        return 'selected'
      }
    }
    return 'empty'
  }

  // 拿起整个选中组并开始拖（组内相对位置不变）
  function startGroupDrag(world) {
    // 过滤掉 positions/bounds 缺失的幽灵项（文件已删/不可见），避免访问 undefined 中断拖动；
    // 回收站不可拖动（锚定根目录，排除出 dragTargets）
    dragTargets = Array.from(selection).filter(function (n) {
      return positions[n] && bounds[n] && !isTrashPath(n)
    })
    dragStartWorld = { x: world.x, y: world.y }
    dragStartPositions = {}
    dragTargets.forEach(function (n) {
      dragStartPositions[n] = { x: positions[n].x, y: positions[n].y }
      setPickedUp(n, true)
    })
    if (App.bridge && typeof App.bridge.vibrate === 'function') App.bridge.vibrate(30)
  }

  function handleLongPress(world) {
    // Viewer 画布实体：长按拿起——单选选中该实例再拿（与文件图标语义一致），已选中直接拿
    const hitInst = App.InternalViewer && typeof App.InternalViewer.topmostAt === 'function'
      ? App.InternalViewer.topmostAt(world.x, world.y) : null
    if (hitInst) {
      if (!hitInst.isSelected()) {
        App.InternalViewer.selectOnly(hitInst.id)
        syncFab()
      }
      if (hitInst.beginDrag(world)) {
        if (App.bridge && typeof App.bridge.vibrate === 'function') App.bridge.vibrate(30)
      }
      return
    }
    // folder 容器：长按 = 拿起选中（拖动移入文件夹语义），实时标签由 applyDrag 负责
    if (isFolderView()) {
      const name = App.DesktopSelection.pointHitTest(world.x, world.y, bounds)
      if (name) {
        if (!selection.has(name)) {
          selection = App.DesktopSelection.selectOnly(name)
          applySelection()
        }
        if (App.bridge && typeof App.bridge.vibrate === 'function') App.bridge.vibrate(30)
        startGroupDrag(world)
      }
      return
    }
    // 1. 多选组：拿取判定覆盖整个组合区域（union AABB，含组内空隙，一整块）
    if (selection.size > 1) {
      const rect = App.DesktopSelection.unionRect(bounds, Array.from(selection))
      if (App.DesktopSelection.pointInRect(world.x, world.y, rect)) {
        startGroupDrag(world)
        return
      }
    }
    // 2. 单个图标命中：未选中则先单选，再拿
    const name = App.DesktopSelection.pointHitTest(world.x, world.y, bounds)
    if (name) {
      if (!selection.has(name)) {
        selection = App.DesktopSelection.selectOnly(name)
        applySelection()
      }
      startGroupDrag(world)
    }
  }

  // 命中判定辅助：世界坐标 → 命中的文件夹完整路径（非 dragTargets 自身），无则 null。
  // 供拖入文件夹实时标签与 drop 移动共用。
  // 注意不能直接用 pointHitTest（重叠时后注册者优先）——拖动中图标 bounds 会
  // 移动到目标上方，后注册的拖拽项自身会把文件夹「盖掉」。这里遍历 bounds，
  // 命中判定**跳过拖拽项自身**，只认手指下的非拖拽文件夹。
  function folderHitAt(world) {
    let hit = null
    Object.keys(bounds).forEach(function (key) {
      const b = bounds[key]
      if (world.x >= b.x && world.x <= b.x + b.w &&
          world.y >= b.y && world.y <= b.y + b.h) {
        if (dragTargets.indexOf(key) < 0) hit = key
      }
    })
    if (!hit) return null
    let isDir = false
    state.items.forEach(function (it) {
      if (fullPath(it.name) === hit) isDir = it.isDir
    })
    return isDir ? hit : null
  }

  // 拖动过程：无极跟随（不吸附），放置时再吸附 + 避让。
  // 拖入文件夹：手指下命中文件夹 → 实时标签「文件将移入 XXX 文件夹」（顶栏靠下）
  function applyDrag(world) {
    const dx = world.x - dragStartWorld.x
    const dy = world.y - dragStartWorld.y
    dragTargets.forEach(function (n) {
      const x = dragStartPositions[n].x + dx
      const y = dragStartPositions[n].y + dy
      positions[n] = { x: x, y: y }
      bounds[n] = { x: x, y: y, w: bounds[n].w, h: bounds[n].h }
      const node = iconEls[n]
      if (node) {
        node.style.left = x + 'px'
        node.style.top = y + 'px'
      }
    })
    if (App.Loading && typeof App.Loading.showTag === 'function') {
      const hit = folderHitAt(world)
      if (hit) {
        if (isTrashPath(hit)) {
          App.Loading.showTag('将移入回收站')
        } else {
          App.Loading.showTag('文件将移入 ' + App.DesktopNav.basename(hit) + ' 文件夹')
        }
      } else {
        App.Loading.hideTag()
      }
    }
  }

  // 已选中组上直接拿起（拖动即拿取，不必长按）；folder 容器不拿起（防御，hitTest 已挡）。
  // hitType 由手势层 down 时确定：viewer-selected=已选中 Viewer 拿起移动实体；selected=已选中文件组拿起
  function handleDragStart(world, hitType) {
    if (hitType === 'viewer-selected') {
      const inst = App.InternalViewer && typeof App.InternalViewer.selectedInstance === 'function'
        ? App.InternalViewer.selectedInstance() : null
      if (inst) inst.beginDrag(world)
      return
    }
    if (isFolderView()) return
    if (selection.size > 0) startGroupDrag(world)
  }

  function handleDrag(world) {
    const dragInst = App.InternalViewer && typeof App.InternalViewer.draggingInstance === 'function'
      ? App.InternalViewer.draggingInstance() : null
    if (dragInst) {
      dragInst.moveBy(world)
      return
    }
    if (dragTargets.length) applyDrag(world)
  }

  function handleDrop(world, moved) {
    const dragInst = App.InternalViewer && typeof App.InternalViewer.draggingInstance === 'function'
      ? App.InternalViewer.draggingInstance() : null
    if (dragInst) {
      dragInst.endDrag()
      return
    }
    if (!dragTargets.length) return
    // Windows 式锁定：被 Viewer 打开的文件禁止移动（拖入文件夹），但拖动摆放（改布局位置）仍可
    function lockedMoveBlocked() {
      return dragTargets.some(function (n) { return _lockedPaths.has(n) })
    }
    // folder 容器：移入文件夹语义——命中文件夹 → moveIntoFolder；
    // 未命中 → 还原起始位（folder 位置自动排布，不吸附不落盘）
    if (isFolderView()) {
      if (moved) {
        const hit = folderHitAt(world)
        if (hit) {
          if (lockedMoveBlocked()) {
            dragTargets.forEach(function (n) { setPickedUp(n, false) })
            dragTargets = []
            dragStartWorld = null
            dragStartPositions = {}
            if (App.toast && typeof App.toast.show === 'function') {
              App.toast.show('文件正在预览（锁定），不可移动')
            }
            return
          }
          if (App.Loading && typeof App.Loading.hideTag === 'function') {
            App.Loading.hideTag()
          }
          const entries = dragTargets.map(function (n) {
            let isDir = false
            state.items.forEach(function (it) {
              if (fullPath(it.name) === n) isDir = it.isDir
            })
            return { path: n, isDir: isDir }
          })
          if (App.Actions && typeof App.Actions.moveIntoFolder === 'function') {
            App.Actions.moveIntoFolder(entries, hit)
          }
          clearSelection()
        } else {
          // 未命中：还原（取消语义）
          dragTargets.forEach(function (n) {
            const back = dragStartPositions[n]
            if (back) {
              positions[n] = { x: back.x, y: back.y }
              bounds[n] = { x: back.x, y: back.y, w: bounds[n].w, h: bounds[n].h }
              const node = iconEls[n]
              if (node) {
                node.style.left = back.x + 'px'
                node.style.top = back.y + 'px'
              }
            }
          })
        }
      }
      dragTargets.forEach(function (n) { setPickedUp(n, false) })
      dragTargets = []
      dragStartWorld = null
      dragStartPositions = {}
      return
    }
    // 拖入文件夹：手指下命中文件夹 → 移动文件到文件夹（移动语义，非吸附）
    if (moved && !isFolderView()) {
      const hit = folderHitAt(world)
      if (hit) {
        // 锁定文件（正在预览）禁止移动
        if (lockedMoveBlocked()) {
          dragTargets.forEach(function (n) { setPickedUp(n, false) })
          dragTargets = []
          dragStartWorld = null
          dragStartPositions = {}
          if (App.toast && typeof App.toast.show === 'function') {
            App.toast.show('文件正在预览（锁定），不可移动')
          }
          return
        }
        // 清标签 + 执行移动（copy+del 源，目标名自动加序号）
        if (App.Loading && typeof App.Loading.hideTag === 'function') {
          App.Loading.hideTag()
        }
        const entries = dragTargets.map(function (n) {
          let isDir = false
          state.items.forEach(function (it) {
            if (fullPath(it.name) === n) isDir = it.isDir
          })
          return { path: n, isDir: isDir }
        })
        const dirPath = hit
        if (App.Actions && typeof App.Actions.moveIntoFolder === 'function') {
          App.Actions.moveIntoFolder(entries, dirPath)
        }
        dragTargets.forEach(function (n) { setPickedUp(n, false) })
        dragTargets = []
        dragStartWorld = null
        dragStartPositions = {}
        // Windows 原则：选中态脆弱——移动完成即失效
        clearSelection()
        return
      }
    }
    if (moved) {
      // 1. 移动组期望位：snap 到网格
      const dx = world.x - dragStartWorld.x
      const dy = world.y - dragStartWorld.y
      const moving = dragTargets.map(function (n) {
        const raw = { x: dragStartPositions[n].x + dx, y: dragStartPositions[n].y + dy }
        const snapped = App.DesktopGrid.snapToGrid(raw.x, raw.y)
        return { name: n, x: snapped.x, y: snapped.y }
      })
      // 2. 静止图标（非移动组）
      const movingSet = new Set(dragTargets)
      const statics = Object.keys(positions).filter(function (n) {
        return !movingSet.has(n)
      }).map(function (n) {
        return { name: n, x: positions[n].x, y: positions[n].y }
      })
      // 3. 避让解析：移动组放期望位，冲突的静止图标让位到最近空位
      const resolved = App.DesktopGrid.resolvePlacement(moving, statics)
      Object.keys(resolved).forEach(function (n) {
        positions[n] = resolved[n]
        bounds[n] = { x: resolved[n].x, y: resolved[n].y, w: bounds[n].w, h: bounds[n].h }
        const node = iconEls[n]
        if (node) {
          node.style.left = resolved[n].x + 'px'
          node.style.top = resolved[n].y + 'px'
        }
      })
      // Windows 原则：选中态是临时/脆弱状态——移动完成即失效（清空选中 + 收起 FAB 操作栏）
      clearSelection()
    }
    dragTargets.forEach(function (n) { setPickedUp(n, false) })
    dragTargets = []
    dragStartWorld = null
    dragStartPositions = {}
    if (moved) saveLayout()
  }

  // 单指意图取消（1→2 指切换 / touchcancel，由手势层派发）：
  // 取消 = 什么都没发生——收起框选矩形、拖起图标还原起始位、清理拿起态；
  // 不落盘（saveLayout）、不清选中（Windows 拖拽取消语义）。
  // 实时标签同步回收（曾缺失：1→2 指取消后「文件将移入 XXX」标签滞留，真机偶发）。
  function handleSingleCancel() {
    hideMarquee()
    // Viewer 实体拖动取消：还原起始位置
    const dragInst = App.InternalViewer && typeof App.InternalViewer.draggingInstance === 'function'
      ? App.InternalViewer.draggingInstance() : null
    if (dragInst) dragInst.cancelDrag()
    if (App.Loading && typeof App.Loading.hideTag === 'function') {
      App.Loading.hideTag()
    }
    if (!dragTargets.length) return
    dragTargets.forEach(function (n) {
      const back = dragStartPositions[n]
      if (back) {
        positions[n] = { x: back.x, y: back.y }
        bounds[n] = { x: back.x, y: back.y, w: bounds[n].w, h: bounds[n].h }
        const node = iconEls[n]
        if (node) {
          node.style.left = back.x + 'px'
          node.style.top = back.y + 'px'
        }
      }
      setPickedUp(n, false)
    })
    dragTargets = []
    dragStartWorld = null
    dragStartPositions = {}
  }

  // refresh 代际守卫：异步链完成时若期间又发起了新 refresh（快速连续导航），
  // 旧路径的 list 结果必须丢弃——否则旧 items 渲染到新视图（先切视图再变目录）
  // + 用旧 items 做 valid 清空根级 positions（布局像初次启动，真机 Bug A）。
  // 视图模式（isFolderView）由 curPath 同步切换，但 items 异步加载——
  // 间隙经 App.Loading 显示不确定进度条（条纹滑动），加载完成隐藏，
  // 避免「先切视图再变目录」的空白/错位感。
  let _refreshSeq = 0

  function refresh() {
    const seq = ++_refreshSeq
    const path = state.curPath   // 快照：发起时的目标路径（list 用快照，不用动态 curPath）
    if (App.Loading && typeof App.Loading.show === 'function') {
      App.Loading.show({ title: '加载中' })   // 不确定进度：无 total → 条纹滑动
    }
    return App.FileAPI.rootInfo()
      .then(function (info) {
        if (seq !== _refreshSeq) return null   // 过期响应：丢弃，不写状态
        state.rootName = info.rootName
        state.mode = info.mode
        state.trashName = info.trashName || ''
        if (App.Drawer && typeof App.Drawer.updatePath === 'function') {
          const base = info.displayPath || info.rootName
          App.Drawer.updatePath(state.curPath ? base + '/' + state.curPath : base,
            info.rootName, info.mode)
        }
      })
      .catch(function () {
        if (seq !== _refreshSeq) return
        state.rootName = '无法读取'
        if (App.Drawer && typeof App.Drawer.updatePath === 'function') {
          App.Drawer.updatePath(App.NAME, App.NAME, '')
        }
      })
      .then(function () {
        if (seq !== _refreshSeq) return null
        return App.FileAPI.list(path)
      })
      .then(function (items) {
        if (seq !== _refreshSeq) return null
        state.items = items
        // 清理失效布局条目（仅 desktop 空间；folder 容器位置是自动的，不存 positions）
        if (!isFolderView()) {
          const valid = {}
          items.forEach(function (it) { valid[fullPath(it.name)] = true })
          Object.keys(positions).forEach(function (key) {
            const inCur = key.indexOf('/') < 0
            if (inCur && !valid[key]) delete positions[key]
          })
        }
        render()
        // 后退/前进按钮禁用态随目录切换更新
        if (App.BottomBar && typeof App.BottomBar.updateNavButtons === 'function') {
          App.BottomBar.updateNavButtons()
        }
        // 目录加载完成：隐藏对话框
        if (App.Loading && typeof App.Loading.hide === 'function') {
          App.Loading.hide()
        }
      })
      .catch(function (err) {
        if (seq !== _refreshSeq) return
        if (App.Loading && typeof App.Loading.hide === 'function') {
          App.Loading.hide()
        }
        if (App.toast && typeof App.toast.show === 'function') {
          App.toast.show('读取失败: ' + err.message)
        }
      })
  }

  // 加载布局（位置 + 相机视角）+ 视图偏好，无数据/损坏回退默认
  // 图标位置恢复无条件执行（与相机优先级无关）：自由摆放位置来自 LayoutStore，
  // Home 快照只决定启动相机，绝不决定图标位置——否则设置快照后重启会丢摆放
  function initLayout() {
    const saved = App.LayoutStore.load()
    if (saved && saved.icons) {
      Object.keys(saved.icons).forEach(function (key) {
        positions[key] = saved.icons[key]
      })
    }
    // 启动相机：Home 快照 > 默认视角 > 上次布局视角 > 出厂 (0,0,1)。
    // Home = Camera 的默认起点（空间锚点）：设置过快照后，每次进入桌面空间都落在快照位
    let cam = null
    if (App.HomeStore) {
      const home = App.HomeStore.load()
      if (home && home.home) {
        cam = App.DesktopCamera.create(home.home.x, home.home.y, home.home.zoom)
      } else if (home && home.fallback) {
        cam = App.DesktopCamera.create(home.fallback.x, home.fallback.y, home.fallback.zoom)
      }
    }
    if (!cam && saved && saved.camera) {
      cam = App.DesktopCamera.create(saved.camera.x, saved.camera.y, saved.camera.zoom)
    }
    camera = cam || App.DesktopCamera.create()
    const prefs = App.ViewStore.load()
    state.viewStyle = prefs.viewStyle
    state.sortBy = prefs.sortBy
    state.sortDir = prefs.sortDir
  }

  // 视图/排序偏好变更（顶栏菜单驱动）：保存 + 重渲染
  function applyViewPrefs(prefs) {
    if (!prefs) return
    state.viewStyle = prefs.viewStyle
    state.sortBy = prefs.sortBy
    state.sortDir = prefs.sortDir
    if (!App.ViewStore.save(prefs)) {
      if (App.toast && typeof App.toast.show === 'function') App.toast.show('视图偏好保存失败')
    }
    refresh()
  }

  // 当前视图偏好（ViewMenu 渲染选中态用）
  function getViewPrefs() {
    return { viewStyle: state.viewStyle, sortBy: state.sortBy, sortDir: state.sortDir }
  }

  // 保存布局（位置 + 相机），失败告警（铁律：写入路径失败必须告警）
  // folder 容器：布局自动排布，不持久化（位置/相机均不写）
  function saveLayout() {
    if (isFolderView()) return
    const data = {
      version: 1,
      icons: positions,
      camera: { x: camera.x, y: camera.y, zoom: camera.zoom }
    }
    if (!App.LayoutStore.save(data)) {
      if (App.toast && typeof App.toast.show === 'function') App.toast.show('布局保存失败')
    }
  }

  // 启动相机 + 手势（pan/zoom + tap/marquee/longpress/drag）
  function initGesture() {
    nav = App.DesktopNav.create()
    initLayout()
    // 根目录相机基准 = 启动视角（Home 快照 > 默认视角 > 上次布局 > 出厂），
    // 否则 applyCameraForPath 根目录分支 rootCamera=null 会强制回出厂
    rootCamera = camera
    App.DesktopGesture.init({
      viewport: document.getElementById('desktop-viewport'),
      canvas: document.getElementById('desktop-canvas'),
      camera: camera,
      // folder 容器：双指 pan 每帧钳制——zoom 锁 1、x 锁 0、y 限画布内
      // （只能上下滚动且有上下边界；钳制在 gesture 层保证 transform 同步）
      onClamp: function (c) {
        if (!isFolderView()) return c
        return App.DesktopCamera.clampToBounds(
          { x: 0, y: c.y, zoom: 1 },
          viewportWidth(), state.canvasH, viewportWidth(), viewportHeight())
      },
      onUpdate: function (c) {
        camera = c
      },
      // 手势开始 → 打断进行中的 Home 平滑过渡（手势直控优先）
      onGestureStart: cancelCameraAnim,
      onHitTest: hitTest,
      onTap: handleTap,
      onMarqueeStart: handleMarqueeStart,
      onMarqueeLive: handleMarqueeLive,
      onMarqueeEnd: handleMarqueeEnd,
      onLongPress: handleLongPress,
      onDragStart: handleDragStart,
      onDrag: handleDrag,
      onDrop: handleDrop,
      onSingleCancel: handleSingleCancel
    })
    // 同步手势层相机 + 模式标志 + 菜单可用态（根目录初始 = desktop 空间）
    applyCameraForPath()
  }

  return {
    refresh: refresh,
    render: render,
    initGesture: initGesture,
    clearSelection: clearSelection,
    hasSelection: hasSelection,
    getSelectionNames: getSelectionNames,
    getSelectionEntries: getSelectionEntries,
    applyRename: applyRename,
    openItem: openItem,
    enterFolder: enterFolder,
    goBack: goBack,
    goForward: goForward,
    goUp: goUp,
    canGoBack: canGoBack,
    canGoForward: canGoForward,
    canGoUp: canGoUp,
    getCurPath: getCurPath,
    getLockedPaths: getLockedPaths,
    isLockedPath: isLockedPath,
    closeViewer: closeViewer,
    isTrashPath: isTrashPath,
    inTrash: inTrash,
    getTrashName: function () { return state.trashName },
    viewMode: viewMode,
    isFolderView: isFolderView,
    applyViewPrefs: applyViewPrefs,
    getViewPrefs: getViewPrefs,
    captureHome: captureHome,
    captureDefaultView: captureDefaultView,
    goHome: goHome
  }
})()
