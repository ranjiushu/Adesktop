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
  const DOUBLE_TAP_MS = 300   // 双击窗口（interaction.md §7）

  // 共享状态与纯工具集中管理（拆分自 desktop.js 原闭包，见 desktop-core.js）
  const C = App.DesktopCore
  const R = App.DesktopRender
  const N = App.DesktopNavigation
  const B = App.DesktopBrowseMode
  const P = App.DesktopPersist

  // 缩略图渲染：ThumbnailService 已验证 URI（可解码）后回调，创建 <img> 展示；
  // onerror 双保险（极端情况下仍回退类型图标）。缩略图的「判定/缓存/生成」全在 App.Thumbnail。
  function closeViewer() {
    const inst = App.InternalViewer && typeof App.InternalViewer.selectedInstance === 'function'
      ? App.InternalViewer.selectedInstance() : null
    if (!inst) return
    const path = inst.getPath()
    App.InternalViewer.closeById(inst.id)
    if (path) C._lockedPaths.delete(path)
    R.updateLockedVisual()
    R.syncFab()
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
    R.updateLockedVisual()
    R.syncFab()
  }

  // 锁定视觉：被 Viewer 打开的文件图标加锁标记
  function isLockedPath(path) {
    return C._lockedPaths.has(path)
  }

  function getLockedPaths() { return Array.from(C._lockedPaths) }

  // 当前选中完整路径列表（复制/剪切/重命名用）
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
    P.saveLayout()
    P.refresh()
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
    if (changed) P.saveLayout()
  }

  // ── 打开：文件夹进入 / 文件打开（FileOpener 分派内部查看器 / 外部应用 / 快捷方式）──
  function handleTap(world) {
    // Viewer 画布实体：点击 = 单选选中该实例（脆弱/临时，点外部取消）；
    // 拖动手柄也视为点击卡片本体（手柄是辅助拖动区，点击语义与卡片一致：仅选中）
    const handleInst = App.InternalViewer && typeof App.InternalViewer.handleAt === 'function'
      ? App.InternalViewer.handleAt(world.x, world.y, C.camera) : null
    const hitInst = handleInst || (App.InternalViewer && typeof App.InternalViewer.topmostAt === 'function'
      ? App.InternalViewer.topmostAt(world.x, world.y) : null)
    if (hitInst) {
      if (hitInst.getMode() === 'canvas') {
        App.InternalViewer.selectOnly(hitInst.id)
        R.syncFab()
      }
      return
    }
    // 点击 Viewer 外部：取消 Viewer 选中（Viewer 保持打开、文件保持锁定）
    if (App.InternalViewer && App.InternalViewer.anySelected()) {
      App.InternalViewer.deselectAll()
      R.syncFab()
    }
    const name = App.DesktopSelection.pointHitTest(world.x, world.y, C.bounds)
    const now = Date.now()

    // 双击空白区域：高级浏览模式下切换临时操作模式（进入/退出）
    if (!name && C._advancedBrowse) {
      if (now - C._emptyTapTime <= DOUBLE_TAP_MS) {
        C._emptyTapTime = 0
        if (C._tempNormalMode) {
          B.exitTempMode()
        } else {
          C._tempNormalMode = true
          B.syncBrowseMode()
          if (App.bridge && typeof App.bridge.vibrate === 'function') App.bridge.vibrate(30)
          if (App.toast && typeof App.toast.show === 'function') App.toast.show('临时操作模式')
        }
        return
      }
      C._emptyTapTime = now
    }

    const r = App.DoubleTap.hit(C._tapState, name, now, DOUBLE_TAP_MS)
    C._tapState = r.state
    if (r.double) {
      // 双击：取消待反选，打开
      if (C._deselectTimer) { clearTimeout(C._deselectTimer); C._deselectTimer = null }
      C._pendingDeselect = null
      N.openItem(name)
      return
    }
    if (name) {
      if (!C.selection.has(name)) {
        // 未选中 → 立即选中（视觉即时）
        C.selection = App.DesktopSelection.selectOnly(name)
        R.applySelection()
      } else {
        // 已选中 → 反选延迟（双击窗口确认，防止双击时先反选再打开）
        C._pendingDeselect = { name: name }
        if (C._deselectTimer) clearTimeout(C._deselectTimer)
        C._deselectTimer = setTimeout(function () {
          C._deselectTimer = null
          if (C._pendingDeselect && C.selection.has(C._pendingDeselect.name)) {
            C.selection = App.DesktopSelection.toggle(C.selection, C._pendingDeselect.name)
            R.applySelection()
          }
          C._pendingDeselect = null
        }, DOUBLE_TAP_MS)
      }
    } else {
      C.selection = App.DesktopSelection.clear()
      R.applySelection()
    }
  }

  function showMarquee(startWorld, currentWorld) {
    const mq = document.getElementById('desktop-marquee')
    if (!mq) return
    const a = App.DesktopCamera.worldToScreen(startWorld.x, startWorld.y, C.camera)
    const b = App.DesktopCamera.worldToScreen(currentWorld.x, currentWorld.y, C.camera)
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
    const files = App.DesktopSelection.marqueeHitTest(rect, C.bounds).filter(function (name) {
      return !isCoveredByViewer(C.bounds[name])
    })
    C.selection = new Set(files)
    // 框选命中 Viewer → 单选选中它；未命中 → 取消 Viewer 选中（替换选择语义）
    const hitInst = App.InternalViewer && typeof App.InternalViewer.rectHit === 'function'
      ? App.InternalViewer.rectHit(rect) : null
    if (hitInst) {
      App.InternalViewer.selectOnly(hitInst.id)
    } else if (App.InternalViewer && App.InternalViewer.anySelected()) {
      App.InternalViewer.deselectAll()
    }
    R.applySelection()
  }

  // 文件图标是否被任一 canvas 态 Viewer 覆盖（遮挡，框选跳过）
  function isCoveredByViewer(rect) {
    if (!rect || !App.InternalViewer || typeof App.InternalViewer.rectHit !== 'function') return false
    return !!App.InternalViewer.rectHit(rect)
  }

  function setPickedUp(name, on) {
    const node = C.iconEls[name]
    if (node) {
      if (on) node.classList.add('picked-up')
      else node.classList.remove('picked-up')
    }
  }

  // 命中类型（desktop 空间）：selected=已选中（可直接拿起）/ icon=未选中图标 / empty=空白
  // viewer-selected = 命中的 Viewer 已被选中（可直接拿起移动实体）；viewer = 命中的 Viewer 未选中（长按/框选触发选中）
  // viewer-handle = 命中 Viewer 的拖动手柄（辅助拖动入口：未选中也直接拿起，按住即选中+拖动）
  // folder 容器：icon=图标（可框选，不拿起）/ empty=空白（滚动），永不 selected（禁止移动）
  function hitTest(world) {
    // 手柄优先于卡片本身命中（辅助拖动区，不受选中态限制）
    const handleInst = App.InternalViewer && typeof App.InternalViewer.handleAt === 'function'
      ? App.InternalViewer.handleAt(world.x, world.y, C.camera) : null
    if (handleInst) {
      return 'viewer-handle'
    }
    const hitInst = App.InternalViewer && typeof App.InternalViewer.topmostAt === 'function'
      ? App.InternalViewer.topmostAt(world.x, world.y) : null
    if (hitInst) {
      return hitInst.isSelected() ? 'viewer-selected' : 'viewer'
    }
    if (C.isFolderView()) {
      const name = App.DesktopSelection.pointHitTest(world.x, world.y, C.bounds)
      return name ? 'icon' : 'empty'
    }
    const name = App.DesktopSelection.pointHitTest(world.x, world.y, C.bounds)
    if (name) {
      return C.selection.has(name) ? 'selected' : 'icon'
    }
    if (C.selection.size > 0) {
      const rect = App.DesktopSelection.unionRect(C.bounds, Array.from(C.selection))
      if (App.DesktopSelection.pointInRect(world.x, world.y, rect)) {
        return 'selected'
      }
    }
    return 'empty'
  }

  // 拿起整个选中组并开始拖（组内相对位置不变）
  function startGroupDrag(world) {
    // 过滤掉 positions/bounds 缺失的幽灵项（文件已删/不可见），避免访问 undefined 中断拖动；
    // 回收站可重定位（拖到空白处改布局位置），但不可移入其他文件夹（handleDrop 守卫）
    C.dragTargets = Array.from(C.selection).filter(function (n) {
      return C.positions[n] && C.bounds[n]
    })
    C.dragStartWorld = { x: world.x, y: world.y }
    C.dragStartPositions = {}
    C.dragTargets.forEach(function (n) {
      C.dragStartPositions[n] = { x: C.positions[n].x, y: C.positions[n].y }
      setPickedUp(n, true)
    })
    if (App.bridge && typeof App.bridge.vibrate === 'function') App.bridge.vibrate(30)
  }

  function handleLongPress(world) {
    // Viewer 画布实体：长按拿起——单选选中该实例再拿（与文件图标语义一致），已选中直接拿；
    // 拖动手柄命中优先：长按手柄 = 同卡片长按（选中 + 拿起）
    const handleInst = App.InternalViewer && typeof App.InternalViewer.handleAt === 'function'
      ? App.InternalViewer.handleAt(world.x, world.y, C.camera) : null
    const hitInst = handleInst || (App.InternalViewer && typeof App.InternalViewer.topmostAt === 'function'
      ? App.InternalViewer.topmostAt(world.x, world.y) : null)
    if (hitInst) {
      if (!hitInst.isSelected()) {
        App.InternalViewer.selectOnly(hitInst.id)
        R.syncFab()
      }
      if (hitInst.beginDrag(world)) {
        if (App.bridge && typeof App.bridge.vibrate === 'function') App.bridge.vibrate(30)
      }
      return
    }
    // folder 容器：长按 = 拿起选中（拖动移入文件夹语义），实时标签由 applyDrag 负责
    if (C.isFolderView()) {
      const name = App.DesktopSelection.pointHitTest(world.x, world.y, C.bounds)
      if (name) {
        if (!C.selection.has(name)) {
          C.selection = App.DesktopSelection.selectOnly(name)
          R.applySelection()
        }
        if (App.bridge && typeof App.bridge.vibrate === 'function') App.bridge.vibrate(30)
        startGroupDrag(world)
      }
      return
    }
    // 1. 多选组：拿取判定覆盖整个组合区域（union AABB，含组内空隙，一整块）
    if (C.selection.size > 1) {
      const rect = App.DesktopSelection.unionRect(C.bounds, Array.from(C.selection))
      if (App.DesktopSelection.pointInRect(world.x, world.y, rect)) {
        startGroupDrag(world)
        return
      }
    }
    // 2. 单个图标命中：未选中则先单选，再拿
    const name = App.DesktopSelection.pointHitTest(world.x, world.y, C.bounds)
    if (name) {
      if (!C.selection.has(name)) {
        C.selection = App.DesktopSelection.selectOnly(name)
        R.applySelection()
      }
      startGroupDrag(world)
    }
  }

  // 命中判定：世界坐标 → 命中的 website 类型 Viewer 实例（拖到网页 = 设为待上传），无则 null。
  function websiteHitAt(world) {
    const inst = App.InternalViewer && typeof App.InternalViewer.topmostAt === 'function'
      ? App.InternalViewer.topmostAt(world.x, world.y) : null
    if (inst && typeof inst.getKind === 'function' && inst.getKind() === 'website') return inst
    return null
  }

  // 命中判定辅助：世界坐标 → 命中的文件夹完整路径（非 dragTargets 自身），无则 null。
  // 供拖入文件夹实时标签与 drop 移动共用。
  // 注意不能直接用 pointHitTest（重叠时后注册者优先）——拖动中图标 bounds 会
  // 移动到目标上方，后注册的拖拽项自身会把文件夹「盖掉」。这里遍历 bounds，
  // 命中判定**跳过拖拽项自身**，只认手指下的非拖拽文件夹。
  function folderHitAt(world) {
    let hit = null
    Object.keys(C.bounds).forEach(function (key) {
      const b = C.bounds[key]
      if (world.x >= b.x && world.x <= b.x + b.w &&
          world.y >= b.y && world.y <= b.y + b.h) {
        if (C.dragTargets.indexOf(key) < 0) hit = key
      }
    })
    if (!hit) return null
    let isDir = false
    C.state.items.forEach(function (it) {
      if (C.fullPath(it.name) === hit) isDir = it.isDir
    })
    return isDir ? hit : null
  }

  // 拖动过程：无极跟随（不吸附），放置时再吸附 + 避让。
  // 拖入文件夹：手指下命中文件夹 → 实时标签「文件将移入 XXX 文件夹」（顶栏靠下）
  function applyDrag(world) {
    const dx = world.x - C.dragStartWorld.x
    const dy = world.y - C.dragStartWorld.y
    C.dragTargets.forEach(function (n) {
      const x = C.dragStartPositions[n].x + dx
      const y = C.dragStartPositions[n].y + dy
      C.positions[n] = { x: x, y: y }
      C.bounds[n] = { x: x, y: y, w: C.bounds[n].w, h: C.bounds[n].h }
      const node = C.iconEls[n]
      if (node) {
        node.style.left = x + 'px'
        node.style.top = y + 'px'
      }
    })
    if (App.Loading && typeof App.Loading.showTag === 'function') {
      const hitWebsite = websiteHitAt(world)
      const hit = hitWebsite ? null : folderHitAt(world)
      if (hitWebsite) {
        App.Loading.showTag('松手将 ' + C.dragTargets.length + ' 个文件设为待上传')
      } else if (hit && !C.dragIncludesTrash()) {
        if (C.isTrashPath(hit)) {
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
    // 拖动手柄：按住 = 自动选中 + 直接拿起（不受选中态限制的辅助拖动入口）
    if (hitType === 'viewer-handle') {
      const inst = App.InternalViewer && typeof App.InternalViewer.handleAt === 'function'
        ? App.InternalViewer.handleAt(world.x, world.y, C.camera) : null
      if (inst) {
        App.InternalViewer.selectOnly(inst.id)
        R.syncFab()
        inst.beginDrag(world)
      }
      return
    }
    if (C.isFolderView()) return
    if (C.selection.size > 0) startGroupDrag(world)
  }

  function handleDrag(world) {
    const dragInst = App.InternalViewer && typeof App.InternalViewer.draggingInstance === 'function'
      ? App.InternalViewer.draggingInstance() : null
    if (dragInst) {
      dragInst.moveBy(world)
      return
    }
    if (C.dragTargets.length) applyDrag(world)
  }

  // 还原拖拽组到起始位置（拖到网站设待上传 / folder 未命中取消时共用）
  function restoreDragTargets() {
    C.dragTargets.forEach(function (n) {
      const back = C.dragStartPositions[n]
      if (back) {
        C.positions[n] = { x: back.x, y: back.y }
        C.bounds[n] = { x: back.x, y: back.y, w: C.bounds[n].w, h: C.bounds[n].h }
        const node = C.iconEls[n]
        if (node) {
          node.style.left = back.x + 'px'
          node.style.top = back.y + 'px'
        }
      }
    })
  }

  function handleDrop(world, moved) {
    const dragInst = App.InternalViewer && typeof App.InternalViewer.draggingInstance === 'function'
      ? App.InternalViewer.draggingInstance() : null
    if (dragInst) {
      dragInst.endDrag()
      return
    }
    if (!C.dragTargets.length) return
    // Windows 式锁定：被 Viewer 打开的文件禁止移动（拖入文件夹），但拖动摆放（改布局位置）仍可
    function lockedMoveBlocked() {
      return C.dragTargets.some(function (n) { return C._lockedPaths.has(n) })
    }
    // folder 容器：移入文件夹语义——命中文件夹 → moveIntoFolder；
    // 未命中 → 还原起始位（folder 位置自动排布，不吸附不落盘）
    if (C.isFolderView()) {
      if (moved) {
        const hit = folderHitAt(world)
        if (hit) {
          if (lockedMoveBlocked()) {
            C.dragTargets.forEach(function (n) { setPickedUp(n, false) })
            C.dragTargets = []
            C.dragStartWorld = null
            C.dragStartPositions = {}
            if (App.toast && typeof App.toast.show === 'function') {
              App.toast.show('文件正在预览（锁定），不可移动')
            }
            return
          }
          if (App.Loading && typeof App.Loading.hideTag === 'function') {
            App.Loading.hideTag()
          }
          const entries = C.dragTargets.map(function (n) {
            let isDir = false
            C.state.items.forEach(function (it) {
              if (C.fullPath(it.name) === n) isDir = it.isDir
            })
            return { path: n, isDir: isDir }
          })
          if (App.Actions && typeof App.Actions.moveIntoFolder === 'function') {
            App.Actions.moveIntoFolder(entries, hit)
          }
          R.clearSelection()
        } else {
          // 未命中：还原（取消语义）
          C.dragTargets.forEach(function (n) {
            const back = C.dragStartPositions[n]
            if (back) {
              C.positions[n] = { x: back.x, y: back.y }
              C.bounds[n] = { x: back.x, y: back.y, w: C.bounds[n].w, h: C.bounds[n].h }
              const node = C.iconEls[n]
              if (node) {
                node.style.left = back.x + 'px'
                node.style.top = back.y + 'px'
              }
            }
          })
        }
      }
      C.dragTargets.forEach(function (n) { setPickedUp(n, false) })
      C.dragTargets = []
      C.dragStartWorld = null
      C.dragStartPositions = {}
      return
    }
    // 拖入文件夹：手指下命中文件夹 → 移动文件到文件夹（移动语义，非吸附）
    if (moved && !C.isFolderView()) {
      const hitWebsite = websiteHitAt(world)
      if (hitWebsite) {
        // 拖到网站：设为待上传（文件不移动，还原起始位）+ toast 提示
        restoreDragTargets()
        const paths = C.dragTargets.slice()
        if (App.WebUpload && typeof App.WebUpload.setPending === 'function') {
          App.WebUpload.setPending(paths)
        }
        if (App.Loading && typeof App.Loading.hideTag === 'function') {
          App.Loading.hideTag()
        }
        if (App.toast && typeof App.toast.show === 'function') {
          App.toast.show('已复制 ' + paths.length + ' 个文件，请点网页里的上传按钮')
        }
        C.dragTargets.forEach(function (n) { setPickedUp(n, false) })
        C.dragTargets = []
        C.dragStartWorld = null
        C.dragStartPositions = {}
        R.clearSelection()
        return
      }
      const hit = folderHitAt(world)
      // 回收站不可移入其他文件夹（锚定根目录）；命中文件夹时仍按重定位处理（不 moveIntoFolder）
      if (hit && !C.dragIncludesTrash()) {
        // 锁定文件（正在预览）禁止移动
        if (lockedMoveBlocked()) {
          C.dragTargets.forEach(function (n) { setPickedUp(n, false) })
          C.dragTargets = []
          C.dragStartWorld = null
          C.dragStartPositions = {}
          if (App.toast && typeof App.toast.show === 'function') {
            App.toast.show('文件正在预览（锁定），不可移动')
          }
          return
        }
        // 清标签 + 执行移动（copy+del 源，目标名自动加序号）
        if (App.Loading && typeof App.Loading.hideTag === 'function') {
          App.Loading.hideTag()
        }
        const entries = C.dragTargets.map(function (n) {
          let isDir = false
          C.state.items.forEach(function (it) {
            if (C.fullPath(it.name) === n) isDir = it.isDir
          })
          return { path: n, isDir: isDir }
        })
        const dirPath = hit
        if (App.Actions && typeof App.Actions.moveIntoFolder === 'function') {
          App.Actions.moveIntoFolder(entries, dirPath)
        }
        C.dragTargets.forEach(function (n) { setPickedUp(n, false) })
        C.dragTargets = []
        C.dragStartWorld = null
        C.dragStartPositions = {}
        // Windows 原则：选中态脆弱——移动完成即失效
        R.clearSelection()
        return
      }
    }
    if (moved) {
      // 1. 移动组期望位：snap 到网格
      const dx = world.x - C.dragStartWorld.x
      const dy = world.y - C.dragStartWorld.y
      const moving = C.dragTargets.map(function (n) {
        const raw = { x: C.dragStartPositions[n].x + dx, y: C.dragStartPositions[n].y + dy }
        const snapped = App.DesktopGrid.snapToGrid(raw.x, raw.y)
        return { name: n, x: snapped.x, y: snapped.y }
      })
      // 2. 静止图标（非移动组）
      const movingSet = new Set(C.dragTargets)
      // 静止图标仅取当前视图内的（bounds 是权威）；positions 可能残留子文件夹 key，
      // 过滤掉 bounds 未命中项，避免 resolvePlacement 结果里出现无 bounds 的幽灵条目
      const statics = Object.keys(C.positions).filter(function (n) {
        return !movingSet.has(n) && C.bounds[n]
      }).map(function (n) {
        return { name: n, x: C.positions[n].x, y: C.positions[n].y }
      })
      // 3. 避让解析：移动组放期望位，冲突的静止图标让位到最近空位
      const resolved = App.DesktopGrid.resolvePlacement(moving, statics)
      Object.keys(resolved).forEach(function (n) {
        C.positions[n] = resolved[n]
        C.bounds[n] = { x: resolved[n].x, y: resolved[n].y, w: C.bounds[n].w, h: C.bounds[n].h }
        const node = C.iconEls[n]
        if (node) {
          node.style.left = resolved[n].x + 'px'
          node.style.top = resolved[n].y + 'px'
        }
      })
      // Windows 原则：选中态是临时/脆弱状态——移动完成即失效（清空选中 + 收起 FAB 操作栏）
      R.clearSelection()
    }
    C.dragTargets.forEach(function (n) { setPickedUp(n, false) })
    C.dragTargets = []
    C.dragStartWorld = null
    C.dragStartPositions = {}
    if (moved) P.saveLayout()
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
    if (!C.dragTargets.length) return
    C.dragTargets.forEach(function (n) {
      const back = C.dragStartPositions[n]
      if (back) {
        C.positions[n] = { x: back.x, y: back.y }
        C.bounds[n] = { x: back.x, y: back.y, w: C.bounds[n].w, h: C.bounds[n].h }
        const node = C.iconEls[n]
        if (node) {
          node.style.left = back.x + 'px'
          node.style.top = back.y + 'px'
        }
      }
      setPickedUp(n, false)
    })
    C.dragTargets = []
    C.dragStartWorld = null
    C.dragStartPositions = {}
  }

  // refresh 代际守卫：异步链完成时若期间又发起了新 refresh（快速连续导航），
  // 旧路径的 list 结果必须丢弃——否则旧 items 渲染到新视图（先切视图再变目录）
  // + 用旧 items 做 valid 清空根级 positions（布局像初次启动，真机 Bug A）。
  // 视图模式（isFolderView）由 curPath 同步切换，但 items 异步加载——
  // 间隙经 App.Loading 显示不确定进度条（条纹滑动），加载完成隐藏，
  // 避免「先切视图再变目录」的空白/错位感。

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
      onClamp: function (c) {
        if (!C.isFolderView()) return c
        return App.DesktopCamera.clampToBounds(
          { x: 0, y: c.y, zoom: 1 },
          C.viewportWidth(), C.state.canvasH, C.viewportWidth(), C.viewportHeight())
      },
      onUpdate: function (c) {
        C.camera = c
        // 相机变化 → 同步 Viewer 拖动手柄屏幕位置（平移/缩放/Home 动画每帧）
        if (App.InternalViewer && typeof App.InternalViewer.syncHandles === 'function') {
          App.InternalViewer.syncHandles(c)
        }
      },
      // 手势开始 → 打断进行中的 Home 平滑过渡（手势直控优先）
      onGestureStart: N.cancelCameraAnim,
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
    N.applyCameraForPath()
    // 同步 Viewer 拖动手柄（相机初始化后手柄屏幕位置才可计算）
    if (App.InternalViewer && typeof App.InternalViewer.syncHandles === 'function') {
      App.InternalViewer.syncHandles(C.camera)
    }
    // 同步高级浏览模式到手势层（initLayout 已从 ViewStore 加载偏好）
    B.syncBrowseMode()
  }

  // 导航模块依赖注入：目录切换后刷新渲染（persist 域 refresh）
  N.setRefresh(P.refresh)

  return {
    refresh: P.refresh,
    render: R.render,
    initGesture: initGesture,
    clearSelection: R.clearSelection,
    hasSelection: R.hasSelection,
    getSelectionNames: R.getSelectionNames,
    getSelectionEntries: R.getSelectionEntries,
    applyRename: applyRename,
    applyMoves: applyMoves,
    openItem: N.openItem,
    enterFolder: N.enterFolder,
    goBack: N.goBack,
    goForward: N.goForward,
    goUp: N.goUp,
    canGoBack: N.canGoBack,
    canGoForward: N.canGoForward,
    canGoUp: N.canGoUp,
    getCurPath: N.getCurPath,
    getLockedPaths: getLockedPaths,
    isLockedPath: isLockedPath,
    closeViewer: closeViewer,
    isTrashPath: C.isTrashPath,
    inTrash: C.inTrash,
    getTrashName: function () { return C.state.trashName },
    viewMode: C.viewMode,
    isFolderView: C.isFolderView,
    applyViewPrefs: P.applyViewPrefs,
    getViewPrefs: P.getViewPrefs,
    captureHome: N.captureHome,
    captureDefaultView: N.captureDefaultView,
    goHome: N.goHome,
    setAdvancedBrowse: B.setAdvancedBrowse,
    isAdvancedBrowse: B.isAdvancedBrowse,
    exitTempMode: B.exitTempMode
  }
})()
