/* desktop-viewer-link.js：Viewer 联动 + 布局 key 迁移（App.DesktopViewerLink）。
 * 拆分自 desktop.js 的联动域：Viewer 关闭与锁定管理（closeViewer/
 * isLockedPath/getLockedPaths，Windows 式锁定：被 Viewer 打开的文件禁止
 * 复制/剪切/移动/删除/重命名，只允许拖动摆放）、布局 key 迁移
 * （applyRename/applyMoves：positions/bounds/selection 以完整路径为 key，
 * 旧 key → 新 key，否则刷新后回退自动排布丢位置）。
 * Viewer 持久化（「Viewer 只能通过手动关闭」）：init() 注入 InternalViewer
 * 持久化监听（画布态打开/关闭/拖动/媒体自适应 → ViewerStore.save）；
 * restoreViewers() 在桌面空间 refresh 加载列表后调用，恢复上次会话打开的
 * Viewer（世界坐标原位置；文件已删除/不在当前目录 → 跳过，下次保存自然清理）。
 * 目录切换时 Viewer 处理：全屏态走 exitFullscreen（close），canvas 态走
 * suspendCanvas/resumeCanvas（跨目录保留状态），均在 desktop-navigation.js
 * 的 applyCameraForPath 中完成，不经本模块。
 * 锁定视觉同步经 App.DesktopRender.updateLockedVisual/syncFab；
 * 迁移落盘经 App.DesktopPersist.saveLayout/refresh。
 * 依赖: namespace.js, desktop-core.js, desktop-render.js, desktop-persist.js,
 *       viewer.js, viewer-store.js
 * 导出: App.DesktopViewerLink
 */
// @ts-check
'use strict'

App.DesktopViewerLink = (function () {
  const C = App.DesktopCore

  // 注入 InternalViewer 持久化监听：画布态变化（打开/关闭/拖动结束/媒体自适应）
  // → ViewerStore.save（localStorage + 隐藏文件，文件即真相）。rootId 未就绪跳过。
  // Viewer 拖动/自适应会同步锁定文件图标位置（moveListener），这里一并落盘布局
  // ——否则图标位置只存在内存投影，刷新后回退错位。
  /** @returns {void} */
  function init() {
    if (App.InternalViewer && typeof App.InternalViewer.setPersistListener === 'function') {
      App.InternalViewer.setPersistListener(function (/** @type {Array<ViewerRecord>} */ viewers) {
        if (!C.state.rootId || !App.ViewerStore) return
        App.ViewerStore.save(viewers, C.state.rootId)
        if (App.DesktopPersist && typeof App.DesktopPersist.saveLayout === 'function') {
          App.DesktopPersist.saveLayout()
        }
      })
    }
    // Viewer 位置/尺寸变化（拖动/媒体自适应）→ 锁定文件图标跟随（双向锚定防分家）：
    // 图标 positions/bounds 与 Viewer rect 保持左上对齐，刷新/整理/恢复时不再错位。
    // onMove 回调入参 = 实例自身（getPath/getRect），契约见 ViewerInstance
    if (App.InternalViewer && typeof App.InternalViewer.setMoveListener === 'function') {
      App.InternalViewer.setMoveListener(function (/** @type {ViewerInstance} */ inst) {
        const path = inst && typeof inst.getPath === 'function' ? inst.getPath() : null
        const rect = inst && typeof inst.getRect === 'function' ? inst.getRect() : null
        if (!path || !rect) return
        C.positions[path] = { x: rect.x, y: rect.y }
        if (C.bounds[path]) {
          C.bounds[path] = { x: rect.x, y: rect.y, w: C.bounds[path].w, h: C.bounds[path].h }
        }
        const node = C.iconEls[path]
        if (node) {
          node.style.left = rect.x + 'px'
          node.style.top = rect.y + 'px'
        }
      })
    }
  }

  // 恢复上次会话的画布态 Viewer（仅桌面空间；由 desktop-persist refresh 列表加载后调用）。
  // 幂等：已在内存的路径跳过（refresh 重复调用/目录往返不重复开）；文件不存在跳过。
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
        onClose: function (/** @type {string} */ path) {
          if (path) C._lockedPaths.delete(path)
          App.DesktopRender.updateLockedVisual()
        }
      })
      C._lockedPaths.add(rec.path)
      // 双向锚定：恢复的 Viewer 窗口左上 = 图标位置（图标可能在会话间被整理/拖动过，
      // 以 Viewer rect 为窗口真相、图标贴窗对齐——修复历史数据分家/重叠）
      C.positions[rec.path] = { x: rect.x, y: rect.y }
      if (C.bounds[rec.path]) {
        C.bounds[rec.path] = { x: rect.x, y: rect.y, w: C.bounds[rec.path].w, h: C.bounds[rec.path].h }
      }
      const node = C.iconEls[rec.path]
      if (node) {
        node.style.left = rect.x + 'px'
        node.style.top = rect.y + 'px'
      }
      App.DesktopRender.updateLockedVisual()
    })
  }

  // 关闭「选中的」Viewer + 解除其文件锁定（唯一出口：FAB 关闭预览）。
  // 目录切换走 applyCameraForPath → suspendCanvas/resumeCanvas（跨目录保留），不经此处。
  function closeViewer() {
    const inst = App.InternalViewer && typeof App.InternalViewer.selectedInstance === 'function'
      ? App.InternalViewer.selectedInstance() : null
    if (!inst) return
    const path = inst.getPath()
    App.InternalViewer.closeById(inst.id)
    if (path) C._lockedPaths.delete(path)
    App.DesktopRender.updateLockedVisual()
    App.DesktopRender.syncFab()
  }

  // 锁定判断（actions.js 用）：路径是否被任一 Viewer 锁定
  /** @param {string} path @returns {boolean} */
  function isLockedPath(path) {
    return C._lockedPaths.has(path)
  }

  /** @returns {Array<string>} */
  function getLockedPaths() { return Array.from(C._lockedPaths) }

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
    isLockedPath: isLockedPath,
    getLockedPaths: getLockedPaths,
    applyRename: applyRename,
    applyMoves: applyMoves
  }
})()
