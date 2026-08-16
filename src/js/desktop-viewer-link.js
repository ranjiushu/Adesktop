/* desktop-viewer-link.js：Viewer 联动 + 布局 key 迁移（App.DesktopViewerLink）。
 * 拆分自 desktop.js 的联动域：Viewer 关闭与锁定管理（closeViewer/closeAllViewers/
 * isLockedPath/getLockedPaths，Windows 式锁定：被 Viewer 打开的文件禁止
 * 复制/剪切/移动/删除/重命名，只允许拖动摆放）、布局 key 迁移
 * （applyRename/applyMoves：positions/bounds/selection 以完整路径为 key，
 * 旧 key → 新 key，否则刷新后回退自动排布丢位置）。
 * 锁定视觉同步经 App.DesktopRender.updateLockedVisual/syncFab；
 * 迁移落盘经 App.DesktopPersist.saveLayout/refresh。
 * 依赖: namespace.js, desktop-core.js, desktop-render.js, desktop-persist.js,
 *       viewer.js
 * 导出: App.DesktopViewerLink
 */
'use strict'

App.DesktopViewerLink = (function () {
  const C = App.DesktopCore

  // 关闭「选中的」Viewer + 解除其文件锁定（唯一出口：FAB 关闭预览）。目录切换走 closeAllViewers
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

  // 关闭所有 Viewer + 解除全部锁定（目录切换：全屏态先退出）
  function closeAllViewers() {
    if (!App.InternalViewer) return
    const list = App.InternalViewer.list ? App.InternalViewer.list() : []
    App.InternalViewer.closeAll()
    list.forEach(function (inst) {
      const p = inst.getPath()
      if (p) C._lockedPaths.delete(p)
    })
    App.DesktopRender.updateLockedVisual()
    App.DesktopRender.syncFab()
  }

  // 锁定判断（actions.js 用）：路径是否被任一 Viewer 锁定
  function isLockedPath(path) {
    return C._lockedPaths.has(path)
  }

  function getLockedPaths() { return Array.from(C._lockedPaths) }

  // 重命名后布局 key 迁移：positions/bounds 以完整路径为 key，
  // 旧 key → 新 key，否则新名字刷新后回退自动排布丢位置。随后重绘。
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

  return {
    closeViewer: closeViewer,
    closeAllViewers: closeAllViewers,
    isLockedPath: isLockedPath,
    getLockedPaths: getLockedPaths,
    applyRename: applyRename,
    applyMoves: applyMoves
  }
})()
