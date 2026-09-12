/* desktop-render.js：桌面渲染与选中同步（App.DesktopRender）。
 * 拆分自 desktop.js 的渲染域：自动排布（layout）+ 图标网格渲染（render）+
 * 选中态视觉同步（applySelection/syncFab/clearSelection/hasSelection）+
 * 选中查询（getSelectionNames/getSelectionEntries）。
 * 缩略图按需加载：render 只为视口内（含半屏外扩）条目派发缩略图请求，相机变化（拖动/
 * 惯性/滚动/Home 飞行）经 scheduleVisibleThumbs 节流补齐——大目录不再一次性排满整目录任务。
 * 「打开」态文件（Viewer 即文件）在 layout 阶段退出网格渲染，原格子释放为
 * 普通空格（desktop-viewer-link.isDesktopEntityPath 判定）。
 * 只读写 App.DesktopCore 状态，不持有业务编排；Viewer 联动模块经
 * App.DesktopRender.syncFab 复用本模块。
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
        iconEl.innerHTML = App.TypeIcons.kindSvg(kind)
      }
    }
    img.src = uri
    iconEl.innerHTML = ''
    iconEl.appendChild(img)
  }

  // 图标应用延迟到 DOM 提交后：render() 在把 card appendChild 进 grid **之前**就发起
  // request/requestShortcutIcon；而 Thumbnail 对缓存 ready 的条目会**同步**触发 onReady，
  // 此刻 icon.parentNode 还是 null，setThumbImg 的 if(icon.parentNode) 守卫会把它跳过 →
  // 图标停留在类型占位（首次渲染是异步读文件、读完后 DOM 已挂载所以能显示，此后重渲染
  // 命中 ready 缓存就回落类型图标——"显示不稳定"的根因）。延后一个宏任务再应用，DOM 已提交。
  function deferApplyIcon(iconEl, uri, kind) {
    setTimeout(function () {
      if (iconEl && iconEl.parentNode) setThumbImg(iconEl, uri, kind)
    }, 0)
  }

  // 自动排布：
  //   desktop 空间：世界坐标按网格铺开（已有位置优先，位置来自 LayoutStore 持久化）
  //   folder 容器：排序后固定排布（网格 4 列自适应 / 列表单列），不读持久化位置
  function layout(items) {
    // 布局数据文件不渲染（隐藏元数据，文件即真相的投影排除）
    items = items.filter(function (it) { return it.name !== C.LAYOUT_FILE })
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
    const out = []
    items.forEach(function (item, i) {
      // 虚拟回收站 key = trashName（'.trash'，相对桥层根）；其余 = 当前目录 + 名
      const isVirtualTrash = C.state.mode === 'all-files' && item.name === C.state.trashName
      const key = isVirtualTrash ? C.state.trashName : C.fullPath(item.name)
      // 文件「打开」态（Viewer 即文件）：图标退出网格，原格子释放为普通空格
      // （不预留、不占位——整理自然填掉，关闭时按 Viewer 窗口位置重新落位）
      if (App.DesktopViewerLink && typeof App.DesktopViewerLink.isDesktopEntityPath === 'function' &&
          App.DesktopViewerLink.isDesktopEntityPath(key)) return
      let pos = C.positions[key]
      if (!pos) {
        pos = App.DesktopGrid.cellToWorld(i % cols, Math.floor(i / cols))
      }
      out.push({ item: item, key: key, x: pos.x, y: pos.y })
    })
    return out
  }

  function render() {
    let gridEl = document.getElementById('desktop-grid')
    if (!gridEl) return
    gridEl.innerHTML = ''
    C.iconEls = {}
    C.bounds = {}   // 清空重建，防止已删/不可见文件（如隐藏文件）的旧 bounds 残留导致命中测试选中幽灵项
    // 缩略图候选/已派发集合随渲染重建：DOM 元素每次渲染都是新的，重建保证「等待中的缩略图落地时
    // 元素已被替换」这类情况能在下次渲染重新派发（Thumbnail 侧 pending 会合并 waiter 回调）
    _thumbCandidates = {}
    _thumbRequested = {}

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
          deferApplyIcon(icon, uri, kind)
        }, function () { /* 失败：保持类型图标 */ })
      } else if (App.Thumbnail && App.Thumbnail.canThumbnail(kind)) {
        // 先类型图标（fallback 基线）；缩略图**不在此处立即请求**——渲染末尾按视口可见性派发
        // （见 _dispatchVisibleThumbs：离屏条目不生成，省桥层解码与内存；平移/滚动到位再补）
        icon.innerHTML = App.TypeIcons ? App.TypeIcons.iconFor(p.item.name, p.item.isDir) : '📄'
        _thumbCandidates[p.key] = { name: p.item.name, kind: kind }
      } else {
        icon.innerHTML = App.TypeIcons ? App.TypeIcons.iconFor(p.item.name, p.item.isDir) : (p.item.isDir ? '📁' : '📄')
      }
      // 应用快捷方式（.desktop）：显示名剥离扩展名；回收站：显示「回收站」（真实名 .trash 隐藏）
      let displayName = p.item.name
      if (isTrashItem) {
        displayName = '回收站'
      } else if (!p.item.isDir && App.Shortcut && App.Shortcut.isShortcutName(p.item.name)) {
        displayName = p.item.name.slice(0, p.item.name.lastIndexOf('.'))
      }
      // 名字文本包一层 span：选中态标签芯片按行贴合（box-decoration-break: clone 生效前置条件，
      // 见 desktop.css「选中标签芯片」）——textContent 读取不受影响
      let name = C.el('div', 'desktop-icon-name')
      name.appendChild(C.el('span', 'desktop-icon-name-text', displayName))
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

    // 缩略图派发（渲染末尾：bounds 已校准，视口内先出图）
    _dispatchVisibleThumbs()
  }

  // ── 缩略图按需加载（视口优先）──
  // 只为**当前视口内**（含半屏外扩预取）的文件请求缩略图：大目录进目录不再一次性排满
  // 整目录的缩略图任务（离屏条目不生成 → 省桥层采样解码/首帧提取与 base64 内存），
  // 平移/滚动到位后再按需补齐（scheduleVisibleThumbs，节流 120ms）。
  /** @type {Record<string, {name: string, kind: string}>} 本轮渲染收集的候选（render 时重建） */
  let _thumbCandidates = {}
  /** @type {Record<string, boolean>} 已派发（render 时重建；相机变化补齐时避免重复派发） */
  let _thumbRequested = {}
  /** @type {any} 节流定时器 */
  let _thumbTimer = null
  const THUMB_REFILL_MS = 120   // 相机连续变化（拖动/惯性/滚动）时的补齐节流
  const THUMB_OVERSCAN = 0.5    // 视口外扩比例（预取半屏，滚动更顺）

  // 世界矩形是否与视口（外扩后）相交。相机/尺寸缺失 → 视为可见（宁可多请求，不丢图）。
  /** @param {string} path @returns {boolean} */
  function _thumbVisible(path) {
    const r = C.bounds[path]
    if (!r || !App.DesktopCamera || typeof App.DesktopCamera.worldToScreen !== 'function') return true
    const cam = C.camera || App.DesktopCamera.create()
    const vw = C.viewportWidth()
    const vh = C.viewportHeight()
    if (!(vw > 0) || !(vh > 0)) return true
    const p = App.DesktopCamera.worldToScreen(r.x, r.y, cam, vw, vh)
    const z = cam.zoom || 1
    const rot = cam.rotation === 90
    const w = (rot ? r.h : r.w) * z    // rotation=90 时世界宽/高在屏幕上互换
    const h = (rot ? r.w : r.h) * z
    const mx = vw * THUMB_OVERSCAN
    const my = vh * THUMB_OVERSCAN
    return !(p.x + w < -mx || p.x > vw + mx || p.y + h < -my || p.y > vh + my)
  }

  // 派发可见且未派发的候选缩略图（元素缺失则跳过——留着下次渲染派发）
  /** @returns {void} */
  function _dispatchVisibleThumbs() {
    if (!App.Thumbnail || typeof App.Thumbnail.request !== 'function') return
    Object.keys(_thumbCandidates).forEach(function (path) {
      if (_thumbRequested[path]) return
      if (!_thumbVisible(path)) return
      const card = C.iconEls[path]
      const iconEl = (card && typeof card.querySelector === 'function')
        ? card.querySelector('.desktop-icon-glyph') : null
      if (!iconEl) return
      const c = _thumbCandidates[path]
      _thumbRequested[path] = true
      App.Thumbnail.request(path, c.name, c.kind, function (uri) {
        deferApplyIcon(iconEl, uri, c.kind)
      }, function () { /* 失败：保持类型图标 */ })
    })
  }

  // 相机变化（拖动/惯性/滚轮滚动/Home 飞行）→ 节流补齐新进入视口的缩略图。
  // 连续变化期间每 THUMB_REFILL_MS 至多跑一次（只派发新增可见项，已派发的被 _thumbRequested 挡住）。
  /** @returns {void} */
  function scheduleVisibleThumbs() {
    if (_thumbTimer) return
    _thumbTimer = setTimeout(function () {
      _thumbTimer = null
      _dispatchVisibleThumbs()
    }, THUMB_REFILL_MS)
  }

  // ── 选中态同步：图标 class + Viewer 实体视觉 + FAB 操作栏路由 ──
  // 统一选中模型（2026-08-20 刀 2）：Viewer 路径并入 C.selection，选中视觉由
  // applySelection 统一驱动——文件图标 toggle .selected，Viewer 实例 toggle
  // .viewer-card-selected。取消 InternalViewer.selectOnly/deselectAll/anySelected
  // 并行状态，消除一类同步 bug。
  function applySelection() {
    Object.keys(C.iconEls).forEach(function (key) {
      if (C.selection.has(key)) C.iconEls[key].classList.add('selected')
      else C.iconEls[key].classList.remove('selected')
    })
    // 同步 Viewer 实体选中视觉（viewer-card-selected）：C.selection 包含 viewer 路径
    if (App.InternalViewer && typeof App.InternalViewer.list === 'function') {
      App.InternalViewer.list().forEach(function (inst) {
        inst.setSelected(C.selection.has(inst.getPath()))
      })
    }
    syncFab()
  }

  // FAB 展开条件 = C.selection 非空（文件或 Viewer 路径均可）
  function syncFab() {
    if (App.fabSpeedDial && typeof App.fabSpeedDial.setSelection === 'function') {
      App.fabSpeedDial.setSelection(C.selection.size > 0)
    }
  }

  // 取消全部选中（文件 + Viewer 实体统一：C.selection 清空 → applySelection 同步视觉）
  function clearSelection() {
    C.selection = new Set()
    applySelection()
  }

  // 是否有文件选中（返回键取消选中用）
  function hasSelection() { return C.selection.size > 0 }

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
    scheduleVisibleThumbs: scheduleVisibleThumbs,
    applySelection: applySelection,
    syncFab: syncFab,
    clearSelection: clearSelection,
    hasSelection: hasSelection,
    getSelectionNames: getSelectionNames,
    getSelectionEntries: getSelectionEntries
  }
})()
