/* desktop-render.js：桌面渲染与选中同步（App.DesktopRender）。
 * 拆分自 desktop.js 的渲染域：自动排布（layout）+ 图标网格渲染（render）+
 * 选中态视觉同步（applySelection/syncFab/clearSelection/hasSelection）+
 * 锁定视觉（updateLockedVisual）+ 选中查询（getSelectionNames/getSelectionEntries）。
 * 只读写 App.DesktopCore 状态，不持有业务编排；Viewer 联动模块经
 * App.DesktopRender.syncFab/updateLockedVisual 复用本模块。
 * 依赖: namespace.js, desktop-core.js, desktop-grid.js, folder-sort.js,
 *       folder-layout.js, type-icons.js, thumbnail.js, shortcut.js, clipboard.js
 * 导出: App.DesktopRender
 */
'use strict'

App.DesktopRender = (function () {
  const C = App.DesktopCore
  const ICON_W = 84
  const ICON_H = 106  // 固定占位高度（Windows/macOS 式 cell）：padding 16 + 缩略图 48 + gap 4 + 名字 38

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

  // 自动排布：
  //   desktop 空间：世界坐标按网格铺开（已有位置优先，位置来自 LayoutStore 持久化）
  //   folder 容器：排序后固定排布（网格 4 列自适应 / 列表单列），不读持久化位置
  function layout(items) {
    if (C.isFolderView()) {
      const sorted = App.FolderSort.sort(items, C.state.sortBy, C.state.sortDir)
      const pts = C.state.viewStyle === 'list'
        ? App.FolderLayout.listPositions(sorted.length)
        : App.FolderLayout.gridPositions(sorted.length, C.viewportWidth())
      return sorted.map(function (item, i) {
        return { item: item, key: C.fullPath(item.name), x: pts[i].x, y: pts[i].y }
      })
    }
    // all-files 桌面空间：回收站（.trash）在桥层根（全盘根），不在桌面目录内——
    // 附加虚拟条目（key = trashName 固定串，isTrashPath/删除目标/位置持久化天然匹配）
    if (C.state.mode === 'all-files' && C.state.trashName) {
      let hasTrash = false
      for (let i = 0; i < items.length; i++) {
        if (items[i].name === C.state.trashName) { hasTrash = true; break }
      }
      if (!hasTrash) {
        items = items.concat([{ name: C.state.trashName, isDir: true }])
      }
    }
    let cols = Math.max(3, Math.min(8, Math.floor(C.viewportWidth() / App.DesktopGrid.GRID_W)))
    return items.map(function (item, i) {
      // 虚拟回收站 key = trashName（'.trash'，相对桥层根）；其余 = 当前目录 + 名
      const isVirtualTrash = C.state.mode === 'all-files' && item.name === C.state.trashName
      const key = isVirtualTrash ? C.state.trashName : C.fullPath(item.name)
      let pos = C.positions[key]
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
    C.iconEls = {}
    C.bounds = {}   // 清空重建，防止已删/不可见文件（如隐藏文件）的旧 bounds 残留导致命中测试选中幽灵项

    // folder 容器：画布尺寸 = 内容（滚动边界的基础；无卡片视觉）
    const canvasEl = document.getElementById('desktop-canvas')
    if (C.isFolderView()) {
      const size = App.FolderLayout.canvasSize(C.state.items.length, C.viewportWidth(), C.state.viewStyle)
      C.state.canvasH = size.h
      gridEl.style.width = size.w + 'px'
      gridEl.style.height = size.h + 'px'
      if (canvasEl) canvasEl.classList.add('folder-canvas')
    } else {
      C.state.canvasH = 0
      gridEl.style.width = ''
      gridEl.style.height = ''
      if (canvasEl) canvasEl.classList.remove('folder-canvas')
    }

    let placed = layout(C.state.items)
    placed.forEach(function (p) {
      C.positions[p.key] = { x: p.x, y: p.y }
      C.bounds[p.key] = { x: p.x, y: p.y, w: ICON_W, h: ICON_H }
      const isTrashItem = p.item.isDir && C.isTrashPath(p.key)
      let card = C.el('div', 'desktop-icon' + (p.item.isDir ? ' is-dir' : '') + (isTrashItem ? ' is-trash' : ''))
      if (C.isFolderView()) {
        if (C.state.viewStyle === 'list') {
          card.classList.add('desktop-list-row')
        } else {
          // 网格 4 列：图标宽自适应列宽（列间留 8px 空隙，不裁切）
          card.style.width = App.FolderLayout.iconWidth(C.viewportWidth()) + 'px'
        }
      }
      card.setAttribute('data-name', p.item.name)
      card.setAttribute('data-path', p.key)
      // 剪切源半透明标记（Windows 式视觉反馈，文件仍真实存在）
      if (App.Clipboard && App.Clipboard.isCut(p.key)) {
        card.classList.add('clip-cut')
      }
      let icon = C.el('div', 'desktop-icon-glyph')
      const kind = App.TypeIcons ? App.TypeIcons.kindFor(p.item.name, p.item.isDir) : 'unknown'
      if (isTrashItem) {
        icon.innerHTML = App.TypeIcons ? App.TypeIcons.svgFor('trash') : '🗑️'
      } else if (kind === 'shortcut' && App.Thumbnail && typeof App.Thumbnail.requestShortcutIcon === 'function') {
        // 应用快捷方式：类型图标兜底 → 读内嵌 base64 图标渐进替换（自包含，随文件迁移）
        icon.innerHTML = App.TypeIcons ? App.TypeIcons.svgFor('shortcut') : '📄'
        App.Thumbnail.requestShortcutIcon(p.key, function (uri) {
          if (icon.parentNode) setThumbImg(icon, uri, kind)
        }, function () { /* 失败：保持类型图标 */ })
      } else if (App.Thumbnail && App.Thumbnail.canThumbnail(kind)) {
        // 先类型图标（fallback 基线），异步请求缩略图，成功替换（渐进式：类型图标 → 真缩略图）
        icon.innerHTML = App.TypeIcons ? App.TypeIcons.svgFor(kind) : '📄'
        App.Thumbnail.request(p.key, p.item.name, kind, function (uri) {
          if (icon.parentNode) setThumbImg(icon, uri, kind)
        }, function () { /* 失败：保持类型图标 */ })
      } else {
        icon.innerHTML = App.TypeIcons ? App.TypeIcons.svgFor(kind) : (p.item.isDir ? '📁' : '📄')
      }
      // 应用快捷方式（.desktop）：显示名剥离扩展名；回收站：显示「回收站」（真实名 .trash 隐藏）
      let displayName = p.item.name
      if (isTrashItem) {
        displayName = '回收站'
      } else if (!p.item.isDir && App.Shortcut && App.Shortcut.isShortcutName(p.item.name)) {
        displayName = p.item.name.slice(0, p.item.name.lastIndexOf('.'))
      }
      let name = C.el('div', 'desktop-icon-name', displayName)
      card.appendChild(icon)
      card.appendChild(name)
      // 列表视图：右侧元信息（文件夹 / 文件大小）
      if (C.isFolderView() && C.state.viewStyle === 'list') {
        const meta = C.el('div', 'desktop-list-meta', p.item.isDir ? '文件夹' : C.fmtSize(p.item.size))
        card.appendChild(meta)
      }
      card.style.left = p.x + 'px'
      card.style.top = p.y + 'px'
      if (C.selection.has(p.key)) card.classList.add('selected')
      C.iconEls[p.key] = card
      gridEl.appendChild(card)
    })

    // 用实测高度校准命中边界（宽度 CSS 固定 84，高度由内容撑开）
    Object.keys(C.iconEls).forEach(function (key) {
      const node = C.iconEls[key]
      C.bounds[key].w = node.offsetWidth || ICON_W
      C.bounds[key].h = node.offsetHeight || ICON_H
    })
    // 渲染后恢复锁定视觉（网格重建会丢失 class）
    updateLockedVisual()
  }

  // ── 选中态同步：图标 class + FAB 操作栏路由 ──
  // FAB 展开条件 = 文件选中 或 Viewer 实体选中（二者其一，互斥出现）
  function applySelection() {
    Object.keys(C.iconEls).forEach(function (key) {
      if (C.selection.has(key)) C.iconEls[key].classList.add('selected')
      else C.iconEls[key].classList.remove('selected')
    })
    syncFab()
  }

  function syncFab() {
    if (App.fabSpeedDial && typeof App.fabSpeedDial.setSelection === 'function') {
      const viewerSel = App.InternalViewer && typeof App.InternalViewer.anySelected === 'function' &&
        App.InternalViewer.anySelected()
      App.fabSpeedDial.setSelection(C.selection.size > 0 || viewerSel)
    }
  }

  // 取消文件选中（Viewer 保持打开、文件保持锁定——选中与查看解绑）
  function clearSelection() {
    C.selection = new Set()
    applySelection()
  }

  // 是否有文件选中（返回键取消选中用）
  function hasSelection() { return C.selection.size > 0 }

  // 锁定视觉：被 Viewer 打开的文件图标加锁标记
  function updateLockedVisual() {
    Object.keys(C.iconEls).forEach(function (key) {
      const node = C.iconEls[key]
      if (!node) return
      if (C._lockedPaths.has(key)) node.classList.add('desktop-icon-locked')
      else node.classList.remove('desktop-icon-locked')
    })
  }

  // 当前选中完整路径列表（复制/剪切/重命名用）
  function getSelectionNames() {
    return Array.from(C.selection)
  }

  // 当前选中条目 [{path, isDir}]（剪贴板跨目录粘贴需要源类型）
  function getSelectionEntries() {
    return Array.from(C.selection).map(function (path) {
      let isDir = false
      C.state.items.forEach(function (it) {
        if (C.fullPath(it.name) === path) isDir = it.isDir
      })
      // 虚拟回收站（all-files 桌面空间）：items 不含 .trash 条目，特判为目录
      if (!isDir && C.isTrashPath(path)) isDir = true
      return { path: path, isDir: isDir }
    })
  }

  return {
    layout: layout,
    render: render,
    applySelection: applySelection,
    syncFab: syncFab,
    clearSelection: clearSelection,
    hasSelection: hasSelection,
    updateLockedVisual: updateLockedVisual,
    getSelectionNames: getSelectionNames,
    getSelectionEntries: getSelectionEntries
  }
})()
