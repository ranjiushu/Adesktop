/* Loading Feedback 组件：居中对话框（进度条）+ 实时标签。
 * 场景：
 *   1. 目录切换/刷新：对话框 + 不确定进度（条纹滑动），弱化「先切视图
 *      再变目录」的中间态突兀感，同时传递「进行中」信号
 *   2. 粘贴/移动多文件：对话框 + 阶段进度条（复制/删除）+ 总进度条（分阶段）
 *   3. 拖入文件夹：顶栏靠下实时标签（跟手提示，不弹对话框——拖动中
 *      弹窗会遮挡手势，标签是唯一合适的即时反馈）
 * 显隐复用 App.Dialog（通用弹窗模块），本模块只负责进度条内容。
 * 零框架零依赖，纯 DOM class 操作，可 vm 单测。
 * 依赖: namespace.js, dialog.js
 * 导出: App.Loading
 */
'use strict'

App.Loading = (function () {
  let DIALOG_ID = 'loading-dialog'
  let TITLE_ID = 'loading-dialog-title'
  let CURRENT_ID = 'loading-current'
  let CURRENT_LABEL_ID = 'loading-current-label'
  let CURRENT_COUNT_ID = 'loading-current-count'
  let PHASE_ID = 'loading-phase'
  let PHASE_LABEL_ID = 'loading-phase-label'
  let PHASE_BAR_ID = 'loading-phase-bar'
  let PHASE_COUNT_ID = 'loading-phase-count'
  let TOTAL_ID = 'loading-total'
  let TOTAL_LABEL_ID = 'loading-total-label'
  let TOTAL_BAR_ID = 'loading-total-bar'
  let TOTAL_COUNT_ID = 'loading-total-count'
  let ACTIONS_ID = 'loading-actions'
  let CANCEL_ID = 'loading-cancel'
  let TAG_ID = 'drop-tag'

  let _onCancel = null   // 当前对话框的取消回调（Actions 注入）
  let _cancelBound = false

  function _el(id) { return document.getElementById(id) }

  // classList.toggle(className, force) 兼容：桩（vm 测试）可能只有 add/remove
  function _toggleClass(el, cls, on) {
    if (!el || !el.classList) return
    if (typeof el.classList.toggle === 'function') {
      el.classList.toggle(cls, !!on)
    } else if (on) {
      el.classList.add(cls)
    } else {
      el.classList.remove(cls)
    }
  }

  function _pct(done, total) {
    if (!total || total <= 0) return 0
    return Math.max(0, Math.min(100, Math.round(done / total * 100)))
  }

  function _label(text, done, total) {
    return total > 0 ? (text + ' ' + done + '/' + total) : (text || '')
  }

  // 字节人性化：1234567 → '1.2 MB'；不足 1 KB 显示 B
  function _bytes(done, total) {
    function fmt(n) {
      if (n < 1024) return Math.round(n) + ' B'
      if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
      return (n / 1024 / 1024).toFixed(1) + ' MB'
    }
    return fmt(done) + ' / ' + fmt(total)
  }

  // ── 对话框：show({title, phaseLabel, phaseDone, phaseTotal,
  //                  totalLabel, totalDone, totalTotal,
  //                  current: {name, done, total}, cancellable, onCancel})
  //   current  → 当前文件字节级进度行（正在复制 xxx 12/250 MB）
  //   cancellable+onCancel → 传输中显示取消按钮（点按 = 请求桥层取消）
  //   phaseTotal>0 → 显示阶段进度条（移动 = 复制阶段/删除阶段）
  //   totalTotal>0 → 显示总进度条（分阶段整体）
  //   两者都无 → 不确定进度（条纹滑动，目录切换/刷新）
  // 显隐复用 App.Dialog（统一弹窗显隐 + aria），本模块只维护进度条内容。
  function show(opts) {
    opts = opts || {}
    let dlg = _el(DIALOG_ID)
    if (!dlg) return
    App.Dialog.open(DIALOG_ID)
    let title = _el(TITLE_ID)
    if (title) title.textContent = opts.title || '处理中'
    // 当前文件行（字节级进度）
    let cur = _el(CURRENT_ID)
    let hasCurrent = !!(opts.current && opts.current.name)
    if (cur) {
      _toggleClass(cur, 'loading-visible', hasCurrent)
      if (hasCurrent) {
        let clab = _el(CURRENT_LABEL_ID)
        if (clab) clab.textContent = opts.current.name
        let ccnt = _el(CURRENT_COUNT_ID)
        if (ccnt) ccnt.textContent = _bytes(opts.current.done || 0, opts.current.total || 0)
      }
    }
    // 取消按钮（传输中）
    _onCancel = opts.cancellable ? opts.onCancel : null
    let acts = _el(ACTIONS_ID)
    if (acts) _toggleClass(acts, 'loading-visible', !!_onCancel)
    // 阶段进度条
    let phase = _el(PHASE_ID)
    let hasPhase = opts.phaseTotal > 0
    if (phase) {
      _toggleClass(phase, 'loading-visible', hasPhase)
      if (hasPhase) {
        let bar = _el(PHASE_BAR_ID)
        if (bar) {
          bar.classList.remove('loading-indeterminate')
          bar.style.width = _pct(opts.phaseDone, opts.phaseTotal) + '%'
        }
        let lab = _el(PHASE_LABEL_ID)
        if (lab) lab.textContent = _label(opts.phaseLabel || '', opts.phaseDone, opts.phaseTotal)
        let cnt = _el(PHASE_COUNT_ID)
        if (cnt) cnt.textContent = opts.phaseDone + '/' + opts.phaseTotal
      }
    }
    // 总进度条
    let total = _el(TOTAL_ID)
    let hasTotal = opts.totalTotal > 0
    if (total) {
      _toggleClass(total, 'loading-visible', hasTotal)
      if (hasTotal) {
        let bar = _el(TOTAL_BAR_ID)
        if (bar) {
          bar.classList.remove('loading-indeterminate')
          bar.style.width = _pct(opts.totalDone, opts.totalTotal) + '%'
        }
        let lab = _el(TOTAL_LABEL_ID)
        if (lab) lab.textContent = _label(opts.totalLabel || '总进度', opts.totalDone, opts.totalTotal)
        let cnt = _el(TOTAL_COUNT_ID)
        if (cnt) cnt.textContent = opts.totalDone + '/' + opts.totalTotal
      }
    }
    // 不确定进度（两进度条都无）：阶段条转条纹动画
    if (!hasPhase && !hasTotal) {
      let bar = _el(PHASE_BAR_ID)
      if (bar) {
        bar.classList.add('loading-indeterminate')
        bar.style.width = '100%'
      }
      let lab = _el(PHASE_LABEL_ID)
      if (lab) lab.textContent = opts.title || ''
      if (phase) phase.classList.add('loading-visible')
    }
    App.Dialog.open(DIALOG_ID)
  }

  function hide() {
    let dlg = _el(DIALOG_ID)
    if (!dlg) return
    App.Dialog.close(DIALOG_ID)
    _onCancel = null
    let cur = _el(CURRENT_ID)
    if (cur) cur.classList.remove('loading-visible')
    let clab = _el(CURRENT_LABEL_ID)
    if (clab) clab.textContent = ''
    let ccnt = _el(CURRENT_COUNT_ID)
    if (ccnt) ccnt.textContent = ''
    let acts = _el(ACTIONS_ID)
    if (acts) acts.classList.remove('loading-visible')
    let bar = _el(PHASE_BAR_ID)
    if (bar) {
      bar.classList.remove('loading-indeterminate')
      bar.style.width = '0%'
    }
    let tbar = _el(TOTAL_BAR_ID)
    if (tbar) tbar.style.width = '0%'
    let cnt = _el(PHASE_COUNT_ID)
    if (cnt) cnt.textContent = ''
    let tcnt = _el(TOTAL_COUNT_ID)
    if (tcnt) tcnt.textContent = ''
  }

  // 取消按钮：全局绑定一次（模块加载时），回调取当前注册的 onCancel
  function _initCancel() {
    let btn = _el(CANCEL_ID)
    if (!btn || _cancelBound) return
    _cancelBound = true
    App.utils.bindPress(btn, function () {
      if (typeof _onCancel === 'function') _onCancel()
    })
  }

  // 模块加载即绑定（按钮在静态 HTML 中常驻）
  _initCancel()

  // ── 实时标签（拖入文件夹提示）：跟手提示，不弹对话框 ──
  function showTag(text) {
    let tag = _el(TAG_ID)
    if (!tag) return
    if (!text) { hideTag(); return }
    tag.textContent = text
    tag.classList.add('loading-visible')
    tag.setAttribute('aria-hidden', 'false')
  }

  function hideTag() {
    let tag = _el(TAG_ID)
    if (!tag) return
    tag.classList.remove('loading-visible')
    tag.setAttribute('aria-hidden', 'true')
    tag.textContent = ''
  }

  return {
    show: show,
    hide: hide,
    showTag: showTag,
    hideTag: hideTag
  }
})()
