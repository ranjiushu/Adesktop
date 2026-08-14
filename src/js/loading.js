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
  let PHASE_ID = 'loading-phase'
  let PHASE_LABEL_ID = 'loading-phase-label'
  let PHASE_BAR_ID = 'loading-phase-bar'
  let PHASE_COUNT_ID = 'loading-phase-count'
  let TOTAL_ID = 'loading-total'
  let TOTAL_LABEL_ID = 'loading-total-label'
  let TOTAL_BAR_ID = 'loading-total-bar'
  let TOTAL_COUNT_ID = 'loading-total-count'
  let TAG_ID = 'drop-tag'

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

  // ── 对话框：show({title, phaseLabel, phaseDone, phaseTotal,
  //                  totalLabel, totalDone, totalTotal})
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
