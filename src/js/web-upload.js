/* WebUpload：网页文件上传桥（拖拽到网站 iframe → 待上传 → 网页请求文件时回传）。
 * 链路：拖拽文件到 website iframe 松手（desktop.js 调 setPending + toast 提示）
 *   → 用户点网页上传按钮 → 原生 onShowFileChooser → evaluateJavascript 调
 *   App.WebUpload.onFileRequested() → 有待上传则弹确认，无则让原生弹系统选择器。
 * 确认「用待上传文件」→ FileAPI.completeUpload(paths)；「重新选择」→ chooseUploadFromSystem；
 * 取消 → cancelUpload（回传 null 防网页卡住）。
 * 依赖: namespace.js, dialog.js, file-api.js, toast.js, utils.js
 * 导出: App.WebUpload
 */
// @ts-check
'use strict'

App.WebUpload = (function () {
  const CONFIRM_OVERLAY_ID = 'web-upload-confirm-overlay'
  const CONFIRM_DESC_ID = 'web-upload-confirm-desc'
  /** @type {{ paths: Array<string>, at: number } | null} */
  let _pending = null   // { paths: [], at: number }

  /** @param {string} id @returns {HTMLElement | null} */
  function _getEl(id) { return document.getElementById(id) }

  // 设定待上传文件（拖拽 drop 到 website iframe 时调用）
  /** @param {Array<string> | null} paths */
  function setPending(paths) {
    if (!paths || !paths.length) { _pending = null; return }
    _pending = { paths: paths.slice(), at: Date.now() }
  }
  function hasPending() { return !!_pending && _pending.paths.length > 0 }
  function getPending() { return _pending ? _pending.paths.slice() : [] }
  function clearPending() { _pending = null }

  // 原生 onShowFileChooser 通知：网页请求文件上传
  function onFileRequested() {
    if (hasPending()) showConfirm()
    else chooseSystem()
  }

  function showConfirm() {
    const desc = _getEl(CONFIRM_DESC_ID)
    if (desc) {
      const n = getPending().length
      desc.textContent = '用画布待上传的 ' + n + ' 个文件上传，还是重新选择？'
    }
    App.Dialog.open(CONFIRM_OVERLAY_ID, cancel)
  }

  // 用待上传文件 → 回传 paths 给原生（原生 resolveUri 后回传网页）
  function confirmUse() {
    const paths = getPending()
    App.Dialog.close(CONFIRM_OVERLAY_ID)
    if (App.FileAPI && typeof App.FileAPI.completeUpload === 'function') {
      App.FileAPI.completeUpload(paths).catch(function (err) {
        App.toast.show('上传失败: ' + (err && err.message || '未知错误'))
      })
    }
    clearPending()
  }

  // 重新选择 → 原生弹系统文件选择器
  function chooseSystem() {
    App.Dialog.close(CONFIRM_OVERLAY_ID)
    if (App.FileAPI && typeof App.FileAPI.chooseUploadFromSystem === 'function') {
      App.FileAPI.chooseUploadFromSystem().catch(function (err) {
        App.toast.show('选择文件失败: ' + (err && err.message || '未知错误'))
      })
    }
    clearPending()
  }

  // 取消 → 回传 null 给原生（网页侧 file input 视为用户取消）
  function cancel() {
    App.Dialog.close(CONFIRM_OVERLAY_ID)
    if (App.FileAPI && typeof App.FileAPI.cancelUpload === 'function') {
      App.FileAPI.cancelUpload().catch(function () {})
    }
    clearPending()
  }

  function init() {
    const useBtn = _getEl('web-upload-confirm-use')
    if (useBtn) App.utils.bindPress(useBtn, confirmUse)
    const sysBtn = _getEl('web-upload-confirm-system')
    if (sysBtn) App.utils.bindPress(sysBtn, chooseSystem)
    const overlay = _getEl(CONFIRM_OVERLAY_ID)
    if (overlay) App.utils.bindPress(overlay, function (e) {
      if (e.target === overlay) cancel()
    })
  }

  /** @type {WebUpload} */
  return {
    setPending: setPending,
    hasPending: hasPending,
    getPending: getPending,
    clearPending: clearPending,
    onFileRequested: onFileRequested,
    init: init
  }
})()
