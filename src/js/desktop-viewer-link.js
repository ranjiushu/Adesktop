/* desktop-viewer-link.js：Viewer 联动 + 布局 key 迁移（App.DesktopViewerLink）。
 * Viewer 语义（2026-08-20 重构）：Viewer = 文件的「打开」状态，不是独立窗口实体——
 *   打开：文件变成 Viewer（图标退出网格渲染，原格子当场释放为普通空格）；
 *   拖动 Viewer = 拖动文件本身（位置真相 = Viewer 世界矩形，无第二套坐标）；
 *   关闭：Viewer 变回图标——按窗口位置吸附最近网格格落位（被占则避让到最近空格）。
 * 旧「两个实体协调」机制随之整体删除：单向锚定 syncRectForPath、会话恢复贴窗对齐、
 * _lockedPaths 锁定集合、🔒 锁定角标。锁定改为派生态（isLockedPath = InternalViewer
 * 存在该路径的打开实例），无独立状态，天然不会失步。
 * Viewer 持久化（「Viewer 只能通过手动关闭」）：init() 注入 InternalViewer
 * 持久化监听（画布态打开/关闭/拖动/媒体自适应 → ViewerStore.save）；
 * 同一监听兼做桌面实体集合 diff——集合变化（打开/关闭/website 异步打开/会话恢复）
 * 触发网格重渲染（图标退场/重现），拖动/媒体自适应只改矩形不改集合，不重渲染。
 * restoreViewers() 在桌面空间 refresh 加载列表后调用，恢复上次会话打开的
 * Viewer（世界坐标原位置；文件已删除/不在当前目录 → 跳过，下次保存自然清理）。
 * 关闭落位（handleViewerClosed）：Viewer 矩形左上吸附网格 → resolvePlacement
 * 避让已占位图标 → positions 落盘；folder 容器无持久布局，跳过。
 * 目录切换时 Viewer 处理：全屏态走 exitFullscreen（close），canvas 态走
 * suspendCanvas/resumeCanvas（跨目录保留状态），均在 desktop-navigation.js
 * 的 applyCameraForPath 中完成，不经本模块。
 * 布局 key 迁移（applyRename/applyMoves）：positions/bounds/selection 以完整路径
 * 为 key，旧 key → 新 key，否则刷新后回退自动排布丢位置；迁移落盘经
 * App.DesktopPersist.saveLayout/refresh。
 * 依赖: namespace.js, desktop-core.js, desktop-grid.js, desktop-render.js,
 *       desktop-persist.js, viewer.js, viewer-store.js
 * 导出: App.DesktopViewerLink
 */
// @ts-check
'use strict'

App.DesktopViewerLink = (function () {
  const C = App.DesktopCore

  // 最近一次 diff 的桌面实体路径集（_syncEntityRender 用）
  /** @type {Record<string, boolean>} */
  let _lastEntityPaths = {}
  // 待播放的关闭落位动画（handleViewerClosed 记录 → 渲染后播放）
  /** @type {{path: string, x: number, y: number} | null} */
  let _pendingLand = null

  // 注入 InternalViewer 持久化监听：画布态变化（打开/关闭/拖动结束/媒体自适应）
  // → ViewerStore.save（localStorage + 隐藏文件，文件即真相）。rootId 未就绪跳过落盘。
  // 同一监听驱动桌面实体集合 diff：集合变化 → 重渲染网格（图标随文件「打开」态
  // 退场/「关闭」态落位后重现）。Viewer 位置真相 = Viewer 矩形（ViewerStore），
  // 桌面层不订阅逐帧 onMove——拖动 Viewer 即拖动文件，无需回写第二套坐标。
  /** @returns {void} */
  function init() {
    if (App.InternalViewer && typeof App.InternalViewer.setPersistListener === 'function') {
      App.InternalViewer.setPersistListener(function (/** @type {Array<ViewerRecord>} */ viewers) {
        if (C.state.rootId && App.ViewerStore) {
          App.ViewerStore.save(viewers, C.state.rootId)
          if (App.DesktopPersist && typeof App.DesktopPersist.saveLayout === 'function') {
            App.DesktopPersist.saveLayout()
          }
        }
        _syncEntityRender()
      })
    }
  }

  // 桌面实体集合 diff：与上次集合比较，变化则重渲染网格。
  // 集合来源 = InternalViewer.desktopEntityPaths()（含 canvas 转全屏的实例），
  // 不用 persist 回调的 viewers 列表（它只含 canvas 态——转全屏时会被误判为关闭）。
  /** @returns {void} */
  function _syncEntityRender() {
    const paths = (App.InternalViewer && typeof App.InternalViewer.desktopEntityPaths === 'function')
      ? App.InternalViewer.desktopEntityPaths() : []
    /** @type {Record<string, boolean>} */
    const next = {}
    paths.forEach(function (/** @type {string} */ p) { if (p) next[p] = true })
    const prevKeys = Object.keys(_lastEntityPaths)
    const nextKeys = Object.keys(next)
    let changed = prevKeys.length !== nextKeys.length
    if (!changed) {
      for (let i = 0; i < nextKeys.length; i++) {
        if (!_lastEntityPaths[nextKeys[i]]) { changed = true; break }
      }
    }
    _lastEntityPaths = next
    if (changed && App.DesktopRender && typeof App.DesktopRender.render === 'function') {
      App.DesktopRender.render()
      _animateLanding()
    }
  }

  // 关闭吸附动画：图标以「Viewer 关闭时的位置」为起点、网格格位为终点，
  // 经 CSS transition 平滑飞入（260ms）。render 已把图标画在格位——
  // 立即施加 translate(起点-终点) 使视觉上从 Viewer 位置开始，下一帧清除
  // transform → 过渡到 0 即飞入格位。原位关闭（位移 < 1px）跳过。
  /** @returns {void} */
  function _animateLanding() {
    const land = _pendingLand
    _pendingLand = null
    if (!land) return
    const node = C.iconEls[land.path]
    const p = C.positions[land.path]
    if (!node || !p) return
    const dx = land.x - p.x
    const dy = land.y - p.y
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return
    node.classList.add('desktop-icon-landing')
    node.style.transform = 'translate(' + dx + 'px,' + dy + 'px)'
    // 下一帧清除 transform → transition 飞入格位；动画结束后清理 class（防
    // 残留 transition 拖慢后续 picked-up 缩放）
    C._raf(function () {
      node.style.transform = ''
    })
    setTimeout(function () {
      node.classList.remove('desktop-icon-landing')
    }, 320)
  }

  // 恢复上次会话的画布态 Viewer（仅桌面空间；由 desktop-persist refresh 列表加载后调用）。
  // 幂等：已在内存的路径跳过（refresh 重复调用/目录往返不重复开）；文件不存在跳过。
  // 位置真相 = 持久化的 Viewer 矩形（ViewerStore）；图标不渲染（打开态），
  // positions 中的残留网格位置关闭时被落位覆盖——无贴窗对齐（历史「两个实体」协调代码）。
  /** @returns {void} */
  function restoreViewers() {
    if (C.isFolderView()) return
    const rootId = C.state.rootId
    if (!rootId || !App.ViewerStore || !App.InternalViewer) return
    const records = App.ViewerStore.load(rootId).viewers || []
    if (!records.length) return
    const items = C.state.items || []
    /** @type {Record<string, boolean>} */
    const existing = {}
    items.forEach(function (it) { existing[C.fullPath(it.name)] = true })
    /** @type {Record<string, boolean>} */
    const openPaths = {}
    App.InternalViewer.list().forEach(function (/** @type {any} */ inst) {
      if (inst.getMode && inst.getMode() === 'canvas' && inst.getPath()) openPaths[inst.getPath()] = true
    })
    records.forEach(function (rec) {
      if (openPaths[rec.path]) return
      if (!existing[rec.path]) return
      const rect = rec.rect
      App.InternalViewer.open({
        path: rec.path,
        name: rec.name,
        kind: rec.kind,
        anchor: { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 },
        camera: C.camera,
        rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
        onFallback: function () {
          App.FileAPI.openExternal(rec.path).catch(function () {})
        },
        onClose: handleViewerClosed
      })
    })
  }

  // Viewer 关闭（文件「打开」态结束）：Viewer 变回图标——窗口矩形左上吸附最近
  // 网格格，被占则避让到最近空格（BFS，落位文件让位——不顶开桌上已有图标）。
  // 图标重现由 persist 监听的实体集合 diff 触发（close → _notifyPersist）。
  // folder 容器（全屏预览随退出关闭）无持久布局，跳过落位。
  /** @param {string} path @param {{x: number, y: number, w: number, h: number} | null} [rect] @returns {void} */
  function handleViewerClosed(path, rect) {
    if (!path || C.isFolderView() || !rect) return
    if (!App.DesktopGrid) return
    // 被占格子 = 当前在网格渲染的图标（bounds 权威）；打开态文件不在其中，不挡落位
    /** @type {Set<string>} */
    const taken = new Set()
    Object.keys(C.bounds).forEach(function (k) {
      if (k === path) return
      const c = App.DesktopGrid.worldToCell(C.bounds[k].x, C.bounds[k].y)
      taken.add(c.cx + ',' + c.cy)
    })
    const snapped = App.DesktopGrid.snapToGrid(rect.x, rect.y)
    const sc = App.DesktopGrid.worldToCell(snapped.x, snapped.y)
    const free = App.DesktopGrid.findFreeCell(sc.cx, sc.cy, taken)
    C.positions[path] = App.DesktopGrid.cellToWorld(free.cx, free.cy)
    // 记录落位动画起点（Viewer 关闭时的窗口位置）；渲染后由 _animateLanding 播放
    _pendingLand = { path: path, x: rect.x, y: rect.y }
    if (App.DesktopPersist && typeof App.DesktopPersist.saveLayout === 'function') {
      App.DesktopPersist.saveLayout()
    }
  }

  // 关闭「选中的」Viewer（唯一出口：FAB 关闭预览）。关闭链：inst.close →
  // onClose(handleViewerClosed 落位) → persist 监听集合 diff → 网格重渲染。
  // 目录切换走 applyCameraForPath → suspendCanvas/resumeCanvas（跨目录保留），不经此处。
  /** @returns {void} */
  function closeViewer() {
    const inst = App.InternalViewer && typeof App.InternalViewer.selectedInstance === 'function'
      ? App.InternalViewer.selectedInstance() : null
    if (!inst) return
    App.InternalViewer.closeById(inst.id)
    App.DesktopRender.syncFab()
  }

  // 文件「打开」态判定（actions/move-target 的禁改检查用）：
  // 派生态——InternalViewer 存在该路径的打开实例（任意模式，含 folder 全屏预览）。
  /** @param {string} path @returns {boolean} */
  function isLockedPath(path) {
    return !!(App.InternalViewer && typeof App.InternalViewer.hasPath === 'function' &&
      App.InternalViewer.hasPath(path))
  }

  /** @returns {Array<string>} */
  function getLockedPaths() {
    if (!App.InternalViewer || typeof App.InternalViewer.list !== 'function') return []
    return App.InternalViewer.list()
      .filter(function (/** @type {any} */ inst) { return inst.isOpen() })
      .map(function (/** @type {any} */ inst) { return inst.getPath() })
  }

  // 文件是否为桌面实体态（canvas / canvas 转全屏）：渲染/整理据此让文件退出网格
  /** @param {string} path @returns {boolean} */
  function isDesktopEntityPath(path) {
    return !!(App.InternalViewer && typeof App.InternalViewer.isDesktopEntityPath === 'function' &&
      App.InternalViewer.isDesktopEntityPath(path))
  }

  // 重命名后布局 key 迁移：positions/bounds 以完整路径为 key，
  // 旧 key → 新 key，否则新名字刷新后回退自动排布丢位置。随后重绘。
  /** @param {string} oldPath @param {string} newPath */
  function applyRename(oldPath, newPath) {
    if (!oldPath || !newPath || oldPath === newPath) return
    if (C.positions[oldPath]) {
      C.positions[newPath] = C.positions[oldPath]
      delete C.positions[oldPath]
    }
    if (C.bounds[oldPath]) {
      C.bounds[newPath] = C.bounds[oldPath]
      delete C.bounds[oldPath]
    }
    if (C.selection.has(oldPath)) {
      C.selection.delete(oldPath)
      C.selection.add(newPath)
    }
    App.DesktopPersist.saveLayout()
    App.DesktopPersist.refresh()
  }

  // 批量布局 key 迁移（移动后）：moves = [{src, dst}]（src = 完整相对路径）。
  // 与 applyRename 同构但不 refresh/saveLayout 逐项执行——由调用方（Actions 移动管道）
  // 一次 saveLayout + 统一 refresh，避免多文件移动反复重绘。
  /** @param {Array<{src: string, dst: string}> | null} moves */
  function applyMoves(moves) {
    if (!moves || !moves.length) return
    let changed = false
    moves.forEach(function (m) {
      if (!m || !m.src || !m.dst || m.src === m.dst) return
      if (C.positions[m.src]) {
        C.positions[m.dst] = C.positions[m.src]
        delete C.positions[m.src]
        changed = true
      }
      if (C.bounds[m.src]) {
        C.bounds[m.dst] = C.bounds[m.src]
        delete C.bounds[m.src]
        changed = true
      }
      if (C.selection.has(m.src)) {
        C.selection.delete(m.src)
        C.selection.add(m.dst)
        changed = true
      }
    })
    if (changed) App.DesktopPersist.saveLayout()
  }

  /** @type {DesktopViewerLink} */
  return {
    init: init,
    restoreViewers: restoreViewers,
    closeViewer: closeViewer,
    handleViewerClosed: handleViewerClosed,
    isLockedPath: isLockedPath,
    getLockedPaths: getLockedPaths,
    isDesktopEntityPath: isDesktopEntityPath,
    applyRename: applyRename,
    applyMoves: applyMoves
  }
})()
