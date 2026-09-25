/* 创建压缩文件对话框：选中态操作栏「压缩」弹出（布局参考 MT 管理器的创建压缩文件）。
 * 字段：文件名 / 格式（现阶段仅 zip）/ 压缩级别（仅存储·最快·标准·最好）/
 * 单独压缩每个文件/文件夹 / 压缩后删除源文件（移入回收站，可恢复）。
 * v1 不做密码与分卷：java.util.zip 无加密能力（手写 ZipCrypto 是过时弱加密）、
 * 分卷归档兼容性差，砍掉的字段与理由见 docs/operation-contract.md 2.8。
 * 本模块只收集参数；命名规划与执行在 App.Actions.compressSelection（Windows 原则）。
 * 依赖: namespace.js, utils.js, dialog.js, actions.js, desktop.js
 * 导出: App.CompressDialog
 * 触发: fab-speed-dial.js 路由 compress 动作
 */
// @ts-check
'use strict'

App.CompressDialog = (function () {
  const OVERLAY_ID = 'compress-dialog-overlay'
  const NAME_ID = 'compress-name'
  const LEVEL_ID = 'compress-level'
  const SEPARATE_ID = 'compress-separate'
  const DELETE_AFTER_ID = 'compress-delete-after'
  let _open = false
  /** @type {Array<ClipboardEntry> | null} */
  let _entries = null   // 打开时捕获的选中项（collapse 会清空选中，需自留快照）

  /** @param {string} id @returns {HTMLElement | null} */
  function _getEl(id) { return document.getElementById(id) }

  /** @returns {string} */
  function _curPath() {
    return (App.Desktop && typeof App.Desktop.getCurPath === 'function')
      ? App.Desktop.getCurPath() : ''
  }

  // 默认文件名（仅展示；最终命名由 Actions.uniqueName 规划）：
  // 单选 = 该项主名.zip（'报告.txt' → '报告.zip'，目录原名）；
  // 多选 = 当前目录名.zip（根目录回退「压缩包.zip」）。
  /** @param {Array<ClipboardEntry>} entries @returns {string} */
  function _defaultName(entries) {
    if (entries.length === 1) {
      const leaf = entries[0].path.indexOf('/') >= 0
        ? entries[0].path.slice(entries[0].path.lastIndexOf('/') + 1) : entries[0].path
      const dot = leaf.lastIndexOf('.')
      const base = dot > 0 ? leaf.slice(0, dot) : leaf
      return (base || '压缩包') + '.zip'
    }
    const cur = _curPath()
    const base = cur.indexOf('/') >= 0 ? cur.slice(cur.lastIndexOf('/') + 1) : cur
    return (base || '压缩包') + '.zip'
  }

  /** @param {Array<ClipboardEntry>} entries @returns {void} */
  function open(entries) {
    if (_open || !entries || !entries.length) return
    _open = true
    _entries = entries.slice()
    App.Dialog.open(OVERLAY_ID, close)
    const name = _defaultName(_entries)
    const input = /** @type {HTMLInputElement | null} */ (_getEl(NAME_ID))
    if (input) {
      input.value = name
      input.disabled = false
      // 同步聚焦 + 选中主名（.zip 前半段），直接输入即可覆盖（MT 同款交互）
      input.focus()
      input.setSelectionRange(0, name.length - 4)
      setTimeout(function () {
        if (document.activeElement !== input) {
          input.focus()
          input.setSelectionRange(0, name.length - 4)
        }
      }, 120)
    }
    const level = /** @type {HTMLSelectElement | null} */ (_getEl(LEVEL_ID))
    if (level) level.value = 'normal'
    const separate = /** @type {HTMLInputElement | null} */ (_getEl(SEPARATE_ID))
    if (separate) separate.checked = false
    const deleteAfter = /** @type {HTMLInputElement | null} */ (_getEl(DELETE_AFTER_ID))
    if (deleteAfter) deleteAfter.checked = false
  }

  /** @returns {void} */
  function close() {
    if (!_open) return
    _open = false
    _entries = null
    App.Dialog.close(OVERLAY_ID)
    const input = /** @type {HTMLInputElement | null} */ (_getEl(NAME_ID))
    if (input && document.activeElement === input) input.blur()
  }

  /** @returns {boolean} */
  function isOpen() { return _open }

  /** @returns {void} */
  function _submit() {
    const entries = _entries
    const input = /** @type {HTMLInputElement | null} */ (_getEl(NAME_ID))
    const levelEl = /** @type {HTMLSelectElement | null} */ (_getEl(LEVEL_ID))
    const separateEl = /** @type {HTMLInputElement | null} */ (_getEl(SEPARATE_ID))
    const deleteAfterEl = /** @type {HTMLInputElement | null} */ (_getEl(DELETE_AFTER_ID))
    const name = input ? input.value : ''
    const level = levelEl ? levelEl.value : 'normal'
    const separate = !!(separateEl && separateEl.checked)
    const deleteAfter = !!(deleteAfterEl && deleteAfterEl.checked)
    close()
    if (!entries || !entries.length) return
    App.Actions.compressSelection(entries, {
      name: name,
      level: level,
      separate: separate,
      deleteAfter: deleteAfter
    })
  }

  // 单独压缩模式下文件名无意义（每项用自身主名）：输入框禁用，避免「输了没生效」的困惑
  /** @returns {void} */
  function _syncSeparate() {
    const separateEl = /** @type {HTMLInputElement | null} */ (_getEl(SEPARATE_ID))
    const input = /** @type {HTMLInputElement | null} */ (_getEl(NAME_ID))
    if (!separateEl || !input) return
    input.disabled = !!separateEl.checked
  }

  /** @returns {void} */
  function init() {
    const confirmBtn = document.getElementById('compress-confirm')
    if (confirmBtn) App.utils.bindPress(confirmBtn, _submit)
    const cancelBtn = document.getElementById('compress-cancel')
    if (cancelBtn) App.utils.bindPress(cancelBtn, close)
    const overlay = _getEl(OVERLAY_ID)
    if (overlay) App.utils.bindPress(overlay, function (e) {
      if (e.target === overlay) close()
    })
    const input = /** @type {HTMLInputElement | null} */ (_getEl(NAME_ID))
    if (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.keyCode === 13) {
          e.preventDefault()
          _submit()
        }
      })
    }
    _bindCheckRow(SEPARATE_ID)
    _bindCheckRow(DELETE_AFTER_ID)
    const separateEl = /** @type {HTMLInputElement | null} */ (_getEl(SEPARATE_ID))
    if (separateEl) separateEl.addEventListener('change', _syncSeparate)
  }

  // 勾选行整行可点：遮罩 bindPress 对非可编辑目标 preventDefault 会压掉 label 的原生激活
  // （点行内文字不切换复选框，真机同样），故行内手动切换 + 派发 change；
  // 直点复选框自身走原生切换（可编辑目标未被 preventDefault），此处跳过防重复切。
  /** @param {string} inputId @returns {void} */
  function _bindCheckRow(inputId) {
    const input = /** @type {HTMLInputElement | null} */ (_getEl(inputId))
    const row = input ? input.parentElement : null
    if (!input || !row) return
    App.utils.bindPress(row, function (e) {
      if (e.target === input) return
      input.checked = !input.checked
      input.dispatchEvent(new Event('change'))
    })
  }

  /** @type {CompressDialog} */
  return {
    open: open,
    close: close,
    isOpen: isOpen,
    init: init
  }
})()
