/* 职责: Morph FAB Speed Dial——点击 FAB 展开/收起多按钮菜单（移植自 LexiCull，动作适配文件系统）
 * 依赖: namespace.js, utils.js, bridge.js, toast.js, file-api.js, desktop.js
 * 导出: App.fabSpeedDial
 * 副作用: 管理子按钮事件、遮罩、展开/收起动画与 FAB 图标状态
 * 触发: 短按 FAB = 展开菜单；长按 800ms = 取景器（inspector.js 接管）
 *
 * 生命周期（单一状态机，LexiCull 收敛思路）：
 *   _state ∈ 'collapsed' | 'desktop' | 'selection'
 *   所有变更统一走 _apply()（唯一出口：class / data-mode / backdrop / 按钮显隐 / 槽位重排），
 *   避免 expand/setSelection 各自写状态导致漂移。
 * 语义收敛（用户决策）：FAB 展开 ⇔ 选中态一致——
 *   selection 态下关闭 Morph FAB（原位点击/动作完成后收起）= 取消选中；
 *   「取消」= FAB 原位 morph 为 × 后点击，不设独立「取消/取消选择」按钮。
 * 上下文感知：
 *   按钮显隐集中在 _syncContext()（粘贴按钮仅 desktop 态、selection 按钮集按
 *   viewerSel/回收站/inTrash 守卫），每次 _apply 都重算——不依赖展开时机。
 * 槽位布局（对齐 LexiCull 组内固定编号、泛化为可见顺序）：
 *   CSS 位移用 slot-1..8 类而非 :nth-child(n)——display:none 的元素仍占 nth-child
 *   序号，按条件隐藏按钮会产生空洞；_applySlots() 按可见顺序重排槽位，可见按钮
 *   自动紧凑顶位，第 8 个按钮也不会因缺位移规则而叠在 FAB 上。
 */
'use strict'

App.fabSpeedDial = (function () {
  let SPEED_DIAL_ID = 'fab-speed-dial'
  let BACKDROP_ID = 'fab-backdrop'
  let FAB_ID = 'mode-switch-fab'

  let _state = 'collapsed' // 'collapsed' | 'desktop' | 'selection' | 'snapshot-operation'

  function _getEl(id) { return document.getElementById(id) }

  // ── 动作路由（共享 App.Actions，与 Drawer 同源） ──
  function _onChildClick(e) {
    let action = this.getAttribute('data-action')
    if (!action) return
    // 快照操作模式按钮：路由给 SnapshotSheet（不收起，操作后由 SnapshotSheet 决定）
    if (action === 'snapshot-delete' || action === 'snapshot-move') {
      if (App.SnapshotSheet && typeof App.SnapshotSheet.onFabAction === 'function') {
        App.SnapshotSheet.onFabAction(action)
      }
      return
    }
    switch (action) {
      case 'new-folder':
        App.Actions.createFolder()
        break
      case 'new-file':
        App.Actions.createFile()
        break
      case 'refresh':
        App.Actions.refresh()
        break
      case 'organize':
        // 整理桌面：按名称/类型排序到可见网格（仅桌面空间）
        if (App.Actions && typeof App.Actions.organizeDesktop === 'function') {
          App.Actions.organizeDesktop()
        }
        break
      case 'close-preview':
        // 关闭预览：批量关闭 C.selection 中的 Viewer（Desktop 统一管理）
        if (App.Desktop && typeof App.Desktop.closeViewer === 'function') {
          App.Desktop.closeViewer()
        }
        collapse()
        return
      case 'fullscreen-preview':
        // 全屏预览：从 C.selection 中找到唯一的 Viewer 路径，进入完整预览
        {
          const names = App.Desktop && typeof App.Desktop.getSelectionNames === 'function'
            ? App.Desktop.getSelectionNames() : []
          const viewerPath = names.find(function (p) {
            return App.InternalViewer && typeof App.InternalViewer.hasPath === 'function' && App.InternalViewer.hasPath(p)
          })
          if (viewerPath && App.InternalViewer) {
            const inst = App.InternalViewer.getByPath(viewerPath)
            if (inst && typeof inst.toFullscreen === 'function') inst.toFullscreen()
          }
        }
        collapse()
        return
      case 'copy':
      case 'cut':
        // 复制/剪切：只写剪贴板（内存态），文件不动；需 {path,isDir} 供跨目录粘贴
        if (App.Desktop && typeof App.Desktop.getSelectionEntries === 'function') {
          const entries = App.Desktop.getSelectionEntries()
          if (action === 'copy') App.Actions.copySelection(entries)
          else App.Actions.cutSelection(entries)
        }
        collapse()
        return
      case 'move':
        // 移动：暂存选中 → 目标文件夹选择器（MoveTarget）→ 真移动管道
        // （移植自 LexiCull「移到其它辞表」，适配文件系统：级联浏览文件夹选目标）
        if (App.MoveTarget && typeof App.MoveTarget.open === 'function') {
          if (App.Desktop && typeof App.Desktop.getSelectionEntries === 'function') {
            const entries = App.Desktop.getSelectionEntries()
            if (entries && entries.length) App.MoveTarget.open(entries)
          }
        }
        collapse()
        return
      case 'paste':
        App.Actions.paste()
        collapse()
        return
      case 'rename':
        // 重命名：单选才可用（多选提示）
        if (App.Desktop && typeof App.Desktop.getSelectionNames === 'function') {
          const names = App.Desktop.getSelectionNames()
          if (names.length === 1) {
            collapse()
            if (App.RenameDialog && typeof App.RenameDialog.open === 'function') {
              App.RenameDialog.open(names[0])
            }
            return
          } else if (names.length > 1) {
            if (App.toast) App.toast.show('重命名仅支持单选')
          }
        }
        collapse()
        return
      case 'open':
        // 打开：文件夹 → 进入；文件 → 打开（单选才可用）
        if (App.Desktop && typeof App.Desktop.getSelectionNames === 'function') {
          const names = App.Desktop.getSelectionNames()
          if (names.length === 1) {
            collapse()
            if (typeof App.Desktop.openItem === 'function') {
              App.Desktop.openItem(names[0])
            }
            return
          }
          if (names.length > 1) {
            if (App.toast) App.toast.show('打开仅支持单选')
          }
        }
        collapse()
        return
      case 'delete':
        // 删除 = 移入回收站（安全删除，不做彻底删除）。单选直接删，多选批量删。
        // 回收站自身/锁定文件由 App.Actions.deleteSelection 内部守卫。
        if (App.Desktop && typeof App.Desktop.getSelectionEntries === 'function') {
          const entries = App.Desktop.getSelectionEntries()
          if (entries && entries.length && App.Actions && typeof App.Actions.deleteSelection === 'function') {
            App.Actions.deleteSelection(entries)
          }
        }
        collapse()
        return
      case 'properties':
        // 属性面板尚未实现（占位）
        if (App.toast) App.toast.show('操作「属性」待实现')
        collapse()
        return
    }
    collapse()
  }

  // ── 遮罩点击（desktop 态模态；selection/快照操作态无遮罩，保持面板可交互） ──
  function _onBackdropClick(e) {
    e.preventDefault()
    e.stopPropagation()
    collapse()
  }

  // ── 上下文感知：按当前状态集中计算按钮显隐（每次 _apply 都重算） ──
  function _syncContext() {
    const sd = _getEl(SPEED_DIAL_ID)
    if (!sd) return
    if (_state === 'snapshot-operation') {
      // 快照操作按钮始终显示（可见性由 SnapshotSheet 选中数控制？——保持全部可见，空选中时按钮无操作）
      return
    }
    if (_state === 'desktop') {
      // 粘贴按钮：仅剪贴板非空时显示
      const pasteBtn = sd.querySelector('[data-action="paste"]')
      const hasClip = App.Clipboard && typeof App.Clipboard.has === 'function' && App.Clipboard.has()
      if (pasteBtn) pasteBtn.style.display = hasClip ? '' : 'none'
    } else if (_state === 'selection') {
      // 统一选中模型：C.selection 同时包含文件路径和 Viewer 路径，需分别解析
      const selArr = App.Desktop && typeof App.Desktop.getSelectionNames === 'function'
        ? App.Desktop.getSelectionNames() : []
      const hasViewerPath = App.InternalViewer && typeof App.InternalViewer.hasPath === 'function'
        ? selArr.some(function (p) { return App.InternalViewer.hasPath(p) }) : false
      const hasFilePath = selArr.some(function (p) {
        return !(App.InternalViewer && App.InternalViewer.hasPath(p))
      })
      // 恰好只选中 1 个 Viewer（无文件选中）→ 显示全屏预览 + 关闭预览
      const singleViewer = hasViewerPath && !hasFilePath && selArr.length === 1
      // 回收站守卫：选中含回收站（根目录）→ 隐藏文件操作，只留「打开」；
      // 进入回收站视图（inTrash）→ 禁用 删除/剪切/重命名（只读，防二次删除嵌套）。
      const selHasTrash = selArr.some(function (n) {
        return App.Desktop && typeof App.Desktop.isTrashPath === 'function' && App.Desktop.isTrashPath(n)
      })
      const inTrash = App.Desktop && typeof App.Desktop.inTrash === 'function' && App.Desktop.inTrash()
      const fileOps = hasFilePath && !selHasTrash
      _setBtnVisible(sd, 'open', hasFilePath && !hasViewerPath)
      _setBtnVisible(sd, 'fullscreen-preview', singleViewer)
      _setBtnVisible(sd, 'close-preview', hasViewerPath)
      _setBtnVisible(sd, 'copy', fileOps)
      _setBtnVisible(sd, 'cut', fileOps && !inTrash)
      _setBtnVisible(sd, 'move', fileOps && !inTrash)
      _setBtnVisible(sd, 'rename', fileOps && !inTrash)
      _setBtnVisible(sd, 'delete', fileOps && !inTrash)
    }
  }

  function _setBtnVisible(sd, action, visible) {
    const btn = sd.querySelector('[data-action="' + action + '"]')
    if (btn) btn.style.display = visible ? '' : 'none'
  }

  // ── 槽位重排：可见按钮（渲染树可见，offsetParent 非 null）按 DOM 序分配 slot-1..n ──
  // 注意不能用 getComputedStyle().display !== 'none' 判断：Chrome 对 display:none 祖先的
  // 后代返回其自身计算值（flex）而非 none，会把整组隐藏的按钮误判为可见抢占槽位。
  // 收起态不清理：slot 规则带 .fab-speed-dial-expanded 前缀，收起后自然失效。
  const SLOT_CLASSES = ['slot-1', 'slot-2', 'slot-3', 'slot-4', 'slot-5', 'slot-6', 'slot-7', 'slot-8']
  function _applySlots() {
    const sd = _getEl(SPEED_DIAL_ID)
    if (!sd) return
    const btns = sd.querySelectorAll('.fab-child')
    let n = 0
    for (let i = 0; i < btns.length; i++) {
      const b = btns[i]
      b.classList.remove.apply(b.classList, SLOT_CLASSES)
      if (b.offsetParent !== null) {
        n++
        if (n <= SLOT_CLASSES.length) b.classList.add(SLOT_CLASSES[n - 1])
      }
    }
  }

  // ── 状态机唯一出口：class / data-mode / backdrop 全在这里落定 ──
  function _apply() {
    const fab = _getEl(FAB_ID), sd = _getEl(SPEED_DIAL_ID), bd = _getEl(BACKDROP_ID)
    if (!fab || !sd) { _state = 'collapsed'; return } // 元素缺失兜底，不留幽灵展开态
    _syncContext()
    if (_state === 'collapsed') {
      if (bd) bd.classList.remove('fab-backdrop-visible')
      fab.classList.remove('fab-speed-dial-active')
      sd.classList.remove('fab-speed-dial-expanded')
      sd.removeAttribute('data-mode')
    } else {
      sd.setAttribute('data-mode', _state)
      // 遮罩仅 desktop 态显示（模态）；selection/快照操作态非模态（面板保持可交互）
      if (bd) bd.classList.toggle('fab-backdrop-visible', _state === 'desktop')
      sd.classList.add('fab-speed-dial-expanded')
      fab.classList.add('fab-speed-dial-active')
    }
    _applySlots()
  }

  // ── 展开（短按 FAB） ──
  function expand(mode) {
    if (_state !== 'collapsed') return
    _state = mode || 'desktop'
    App.bridge.vibrate()
    _apply()
  }

  // ── 收起（语义收敛：关闭 Morph FAB = 取消选中 / 退出操作模式） ──
  // selection 态收起时先取消选中（Viewer 实体 + 文件），保证「FAB 展开 ⇔ 选中态」一致：
  // 先置 _state='collapsed' 再清选中——clearSelection → syncFab → setSelection(false)
  // 重入 collapse() 时直接 return，无递归风险。
  function collapse() {
    if (_state === 'collapsed') return
    const wasSelection = _state === 'selection'
    const wasOpMode = _state === 'snapshot-operation'
    _state = 'collapsed'
    if (wasSelection) {
      // 统一选中模型：clearSelection 同时清 C.selection（含 Viewer 路径）+ applySelection 同步视觉
      if (App.Desktop && typeof App.Desktop.clearSelection === 'function') {
        App.Desktop.clearSelection()
      }
    }
    if (wasOpMode) {
      // FAB ✕ = 退出快照操作模式（SnapshotSheet 内部防重入）
      if (App.SnapshotSheet && typeof App.SnapshotSheet.exitOpMode === 'function') {
        App.SnapshotSheet.exitOpMode()
      }
    }
    _apply()
  }

  function isExpanded() { return _state !== 'collapsed' }
  function getMode() { return _state === 'collapsed' ? null : _state }
  function getState() { return { expanded: isExpanded(), mode: getMode() } }

  // 选中态驱动：非空 → 进入 selection 态（自动显隐按钮集）；空 → 收起
  // 选中态操作栏是「非模态」的：不加全屏遮罩，桌面保持可交互（长按拖拽/框选/点空白清空）
  // Viewer 实体选中时只显示 全屏预览 + 关闭预览（预览焦点模式）；文件选中时显示文件操作。
  function setSelection(hasSelection) {
    if (hasSelection) {
      if (_state === 'selection') { _apply(); return } // 幂等：仍重算上下文（选中内容可能已变）
      _state = 'selection'
      _apply()
    } else {
      collapse()
    }
  }

  function isSelectionActive() { return _state === 'selection' }

  // ── 初始化 ──
  function init() {
    let bd = _getEl(BACKDROP_ID)
    if (bd) App.utils.bindPress(bd, _onBackdropClick)
    let sd = _getEl(SPEED_DIAL_ID)
    if (sd) {
      let children = sd.querySelectorAll('.fab-child')
      for (let i = 0; i < children.length; i++) {
        App.utils.bindPress(children[i], _onChildClick)
      }
    }
    let fab = _getEl(FAB_ID)
    if (fab) fab.classList.add('fab-speed-dial-ready')
  }

  return {
    expand: expand,
    collapse: collapse,
    isExpanded: isExpanded,
    getMode: getMode,
    getState: getState,
    setSelection: setSelection,
    isSelectionActive: isSelectionActive,
    init: init
  }
})()
