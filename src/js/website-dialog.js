/* 新建网站快捷方式对话框：Drawer「新建网站」弹出。输入网址 + 可选名称，
 * 点「创建」在当前目录写入 <名称>.desktop（type=website），双击即在画布内 iframe 打开。
 * 网址自动补协议（normalizeUrl）；名称缺省时用主机名兜底；重名自动加序号。
 * 依赖: namespace.js, utils.js, dialog.js, shortcut.js, file-api.js, toast.js, desktop.js
 * 导出: App.WebsiteDialog
 */
'use strict'

App.WebsiteDialog = (function () {
  const OVERLAY_ID = 'website-dialog-overlay'
  const URL_ID = 'website-url'
  const LABEL_ID = 'website-label'
  let _open = false

  function _getEl(id) { return document.getElementById(id) }

  // 当前目录完整相对路径（'' = 根）
  function _curPath() {
    return (App.Desktop && typeof App.Desktop.getCurPath === 'function')
      ? App.Desktop.getCurPath() : ''
  }
  function _join(name) {
    const base = _curPath()
    return base ? base + '/' + name : name
  }

  function open() {
    if (_open) return
    _open = App.Dialog.open(OVERLAY_ID, close)
    const url = _getEl(URL_ID)
    const label = _getEl(LABEL_ID)
    if (url) {
      url.value = ''
      url.focus()
      setTimeout(function () {
        if (document.activeElement !== url) url.focus()
      }, 120)
    }
    if (label) label.value = ''
    const trusted = _getEl('website-trusted')
    if (trusted) trusted.checked = false
  }

  function close() {
    if (!_open) return
    _open = false
    App.Dialog.close(OVERLAY_ID)
    const url = _getEl(URL_ID)
    if (url && document.activeElement === url) url.blur()
    const label = _getEl(LABEL_ID)
    if (label && document.activeElement === label) label.blur()
  }

  function isOpen() { return _open }

  // 提交：规范化网址 → 写 .desktop（type=website），重名自动加序号。
  function _submit() {
    const urlEl = _getEl(URL_ID)
    const labelEl = _getEl(LABEL_ID)
    const raw = urlEl ? urlEl.value : ''
    const url = App.Shortcut.normalizeUrl(raw)
    if (!url) {
      App.toast.show('请输入网址')
      return
    }
    const label = labelEl ? labelEl.value.trim() : ''
    const trustedEl = _getEl('website-trusted')
    const trusted = !!(trustedEl && trustedEl.checked)
    const dir = _curPath()
    close()
    const stem = App.Shortcut.sanitizeFileName(label || App.Shortcut.hostOf(url), url)
    const ext = App.Shortcut.EXT
    App.FileAPI.list(dir).then(function (items) {
      let name = stem + '.' + ext
      let seq = 2
      const exists = function (n) {
        for (let i = 0; i < items.length; i++) {
          if (items[i].name === n && !items[i].isDir) return true
        }
        return false
      }
      while (exists(name)) {
        name = stem + ' ' + seq + '.' + ext
        seq++
      }
      return App.FileAPI.write(_join(name), App.Shortcut.buildWebsiteShortcut({
        url: url,
        label: label || url,
        trusted: trusted
      })).then(function () { return name })
    }).then(function (name) {
      App.toast.show('已创建网站快捷方式: ' + name)
      if (App.Desktop && typeof App.Desktop.refresh === 'function') App.Desktop.refresh()
    }).catch(function (err) {
      App.toast.show('创建失败: ' + (err && err.message || '未知错误'))
    })
  }

  function init() {
    const createBtn = _getEl('website-create')
    if (createBtn) App.utils.bindPress(createBtn, _submit)
    const overlay = _getEl(OVERLAY_ID)
    if (overlay) App.utils.bindPress(overlay, function (e) {
      if (e.target === overlay) close()
    })
    // 网址输入框 Enter → 跳到名称输入框
    const urlEl = _getEl(URL_ID)
    if (urlEl) {
      urlEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.keyCode === 13) {
          e.preventDefault()
          const labelEl = _getEl(LABEL_ID)
          if (labelEl) labelEl.focus()
        }
      })
    }
    // 名称输入框 Enter → 提交
    const labelEl = _getEl(LABEL_ID)
    if (labelEl) {
      labelEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.keyCode === 13) {
          e.preventDefault()
          _submit()
        }
      })
    }
  }

  return {
    open: open,
    close: close,
    isOpen: isOpen,
    init: init
  }
})()
