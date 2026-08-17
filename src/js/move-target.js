/* 移动目标选择器：Morph FAB「移动」弹出，级联浏览文件夹，选目标后真移动。
 * 移植自 LexiCull「移到其它辞表」交互（暂存 → 选目标 → 执行），适配文件系统：
 *   LexiCull 目标 = 辞表列表（Drawer 天然承载）；Desktop 目标 = 文件夹（层级嵌套），
 *   故改为独立弹层 + 面包屑级联浏览（点文件夹进入 / 点面包屑返回上级）。
 * 依赖: namespace.js, utils.js, file-api.js, actions.js, toast.js, dialog.js, desktop.js
 * 导出: App.MoveTarget
 * 触发: fab-speed-dial.js selection 菜单「移动」（data-action="move"）
 * 执行: App.Actions.moveIntoFolder(entries, dirPath) —— 复用 _transfer 统一链
 *       （桥层真移动优先/降级 copy+del、字节级进度、取消、失败汇总、布局 key 迁移、
 *       清选中 + 刷新），与拖入文件夹/回收站删除同管道，行为一致。
 * 守卫:
 *   1) 目标 = 源所在目录 → 底部按钮禁用（「已在目标位置」）
 *   2) 目标 ∈ 源文件夹自身/后代 → 拦截（循环移动）
 *   3) 源含锁定文件（预览中）→ 拦截（与删除一致，_lockedEntry 同款）
 * 关闭（取消/返回键/点空白）= 清理暂存，选中保持（不自动清选中）。
 */
'use strict'

App.MoveTarget = (function () {
  let OVERLAY_ID = 'move-target-overlay'
  let LIST_ID = 'move-target-list'
  let CRUMB_ID = 'move-target-crumb'
  let CONFIRM_ID = 'move-target-confirm'

  let _open = false
  let _entries = []   // [{path, isDir}] 待移动项（FAB 选中快照）
  let _cur = ''       // 当前浏览目录（完整相对路径，'' = 根）
  let _items = []     // 当前目录 FileAPI.list 结果（守卫 + 渲染用）
  let _navSeq = 0     // 导航竞态守卫：丢弃过期响应

  function _getEl(id) { return document.getElementById(id) }

  // 取父目录：'docs/a.txt' → 'docs'；'a.txt' → ''
  function _parentDir(p) {
    if (!p) return ''
    const i = p.lastIndexOf('/')
    return i < 0 ? '' : p.slice(0, i)
  }

  function _join(base, name) { return base ? base + '/' + name : name }

  // 目标目录是否在源文件夹自身或后代内（循环移动）
  function _inside(srcDir, dstDir) {
    if (!srcDir) return false
    return dstDir === srcDir || dstDir.indexOf(srcDir + '/') === 0
  }

  // 守卫：返回错误消息（非 null 表示不可移动）
  function _guard(dirPath) {
    for (let i = 0; i < _entries.length; i++) {
      const e = _entries[i]
      if (_parentDir(e.path) === dirPath) return '已在目标位置'
      if (e.isDir && _inside(e.path, dirPath)) return '不能移动到自身或子文件夹'
    }
    return null
  }

  function _lockedEntries() {
    const locked = App.Desktop && typeof App.Desktop.getLockedPaths === 'function'
      ? App.Desktop.getLockedPaths() : []
    return _entries.filter(function (e) { return locked.indexOf(e.path) >= 0 })
  }

  // ── 面包屑：根目录 / 一级 / 二级…（点段返回上级） ──
  function _renderCrumb() {
    const el = _getEl(CRUMB_ID)
    if (!el) return
    let html = '<button class="move-crumb" data-path="">根目录</button>'
    if (_cur) {
      const parts = _cur.split('/')
      let acc = ''
      for (let i = 0; i < parts.length; i++) {
        acc = acc ? acc + '/' + parts[i] : parts[i]
        html += '<span class="move-crumb-sep">/</span>' +
          '<button class="move-crumb" data-path="' + App.utils.escapeHtml(acc) + '">' +
          App.utils.escapeHtml(parts[i]) + '</button>'
      }
    }
    el.innerHTML = html
    const btns = el.querySelectorAll('.move-crumb')
    for (let i = 0; i < btns.length; i++) {
      App.utils.bindPress(btns[i], (function (btn) {
        return function () { _navigate(btn.getAttribute('data-path')) }
      })(btns[i]))
    }
  }

  // ── 文件夹列表（仅文件夹可作目标） ──
  function _renderList() {
    const list = _getEl(LIST_ID)
    if (!list) return
    list.innerHTML = ''
    const dirs = _items.filter(function (it) { return it.isDir })
    if (!dirs.length) {
      list.innerHTML = '<div class="move-empty">此目录下没有文件夹</div>'
      return
    }
    for (let i = 0; i < dirs.length; i++) {
      const it = dirs[i]
      const row = document.createElement('button')
      row.type = 'button'
      row.className = 'move-dir-row'
      row.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><use href="#icon-folder"/></svg>' +
        '<span>' + App.utils.escapeHtml(it.name) + '</span>'
      App.utils.bindPress(row, (function (name) {
        return function () { _navigate(_join(_cur, name)) }
      })(it.name))
      list.appendChild(row)
    }
  }

  // ── 底部确认按钮：文字固定「确认」；目标不可移动时置灰（aria-disabled，样式
  // 见 dialog.css .dialog-btn[aria-disabled="true"]），点击由 _confirm 拦截并吐司原因 ──
  function _updateConfirm() {
    const btn = _getEl(CONFIRM_ID)
    if (!btn) return
    const err = _guard(_cur)
    btn.textContent = '确认'
    btn.setAttribute('aria-disabled', err ? 'true' : 'false')
    btn._moveInvalidMsg = err || ''
  }

  // ── 执行移动：复用 move 管道（进度/取消/失败汇总/清选中/刷新已在管道内） ──
  function _confirm() {
    const err = _guard(_cur)
    if (err) { App.toast.show(err); return }
    if (_lockedEntries().length) {
      App.toast.show('文件正在预览（锁定），不可移动')
      return
    }
    // 先取快照再 close()：close 会清空 _entries/_cur，直接传引用会变成空数组
    const entries = _entries.slice()
    const dir = _cur
    close()
    App.Actions.moveIntoFolder(entries, dir)
  }

  // ── 导航（竞态守卫：仅最新请求的响应生效） ──
  function _navigate(path) {
    _cur = path || ''
    const seq = ++_navSeq
    App.FileAPI.list(_cur).then(function (items) {
      if (seq !== _navSeq) return
      _items = items || []
      _renderCrumb()
      _renderList()
      _updateConfirm()
    }).catch(function (err) {
      if (seq !== _navSeq) return
      App.toast.show('无法读取目录: ' + ((err && err.message) || err))
    })
  }

  // ── 打开：暂存选中快照，初始 = 当前浏览目录 ──
  function open(entries) {
    if (_open) return
    if (!entries || !entries.length) return
    _entries = entries
    _open = App.Dialog.open(OVERLAY_ID, close)
    const start = App.Desktop && typeof App.Desktop.getCurPath === 'function'
      ? App.Desktop.getCurPath() : ''
    // 同步先落定按钮初始态（HTML 初始文字已是「确认」）：_navigate 是异步的，
    // 若等导航完成才刷按钮，打开瞬间会闪现旧态（文字/守卫色错位）
    _cur = start
    _updateConfirm()
    _navigate(start)
  }

  function close() {
    if (!_open) return
    _open = false
    _entries = []
    _cur = ''
    _items = []
    _navSeq++ // 使未完成导航响应作废
    App.Dialog.close(OVERLAY_ID)
  }

  function isOpen() { return _open }

  // ── 初始化：遮罩点空白关闭 + 按钮绑定（Dialog 栈返回键已由 dialog.js 接管） ──
  function init() {
    const overlay = _getEl(OVERLAY_ID)
    if (!overlay) return
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close()
    })
    const cancel = _getEl('move-target-cancel')
    if (cancel) App.utils.bindPress(cancel, close)
    const confirm = _getEl(CONFIRM_ID)
    if (confirm) App.utils.bindPress(confirm, _confirm)
  }

  return {
    open: open,
    close: close,
    isOpen: isOpen,
    init: init
  }
})()
