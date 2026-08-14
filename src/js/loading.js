/* Loading Feedback 组件：进度条 + 实时标签。
 * 场景：
 *   1. 粘贴/移动多文件：顶部细进度条 + 文案「正在移动 2/5 项」（串行 copy 推进）
 *   2. 拖入文件夹：顶栏靠下实时标签「文件将移入 XXX 文件夹」（拖动实时判定）
 * 零框架零依赖，纯 DOM class 操作，可 vm 单测。
 * 依赖: namespace.js
 * 导出: App.Loading
 */
'use strict'

App.Loading = (function () {
  let PROGRESS_ID = 'loading-progress'
  let PROGRESS_BAR_ID = 'loading-progress-bar'
  let PROGRESS_LABEL_ID = 'loading-progress-label'
  let TAG_ID = 'drop-tag'

  function _el(id) { return document.getElementById(id) }

  // ── 进度条：label + done/total。total<=0 = 不确定进度（目录切换/刷新，无总量）──
  function progress(label, done, total) {
    let box = _el(PROGRESS_ID)
    if (!box) return
    if (total > 0) {
      let n = Math.max(0, Math.min(done, total))
      let pct = Math.round(n / total * 100)
      let bar = _el(PROGRESS_BAR_ID)
      if (bar) {
        bar.classList.remove('loading-indeterminate')
        bar.style.width = pct + '%'
      }
      let lab = _el(PROGRESS_LABEL_ID)
      if (lab) lab.textContent = label + ' ' + n + '/' + total
      box.classList.add('loading-visible')
      box.setAttribute('aria-hidden', 'false')
      if (done >= total) hideProgress()
    } else {
      // 不确定进度：条纹滑动（目录切换/刷新时覆盖「先切视图再变目录」的间隙）
      let bar = _el(PROGRESS_BAR_ID)
      if (bar) {
        bar.classList.add('loading-indeterminate')
        bar.style.width = '100%'
      }
      let lab = _el(PROGRESS_LABEL_ID)
      if (lab) lab.textContent = label || ''
      box.classList.add('loading-visible')
      box.setAttribute('aria-hidden', 'false')
    }
  }

  function hideProgress() {
    let box = _el(PROGRESS_ID)
    if (!box) return
    box.classList.remove('loading-visible')
    box.setAttribute('aria-hidden', 'true')
    let bar = _el(PROGRESS_BAR_ID)
    if (bar) {
      bar.classList.remove('loading-indeterminate')
      bar.style.width = '0%'
    }
    let lab = _el(PROGRESS_LABEL_ID)
    if (lab) lab.textContent = ''
  }

  // ── 实时标签（拖入文件夹提示）──
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
    progress: progress,
    hideProgress: hideProgress,
    showTag: showTag,
    hideTag: hideTag
  }
})()
