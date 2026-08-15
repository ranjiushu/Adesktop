/* 已安装应用工具：Drawer 入口 → 全屏面板，搜索 + 点按确认生成 Application Shortcut。
 * 数据源：FileBridge.listApps（PackageManager launcher 查询，第三方 + 系统应用）。
 * 产物：Desktop 根目录写入 <应用名>.desktop JSON 文件（文件即真相，可复制/移动/删除）。
 * 依赖: namespace.js, shortcut.js, file-api.js, toast.js, dialog.js, utils.js, desktop.js, drawer.js
 * 导出: App.AppList（filterApps 纯函数可单测）
 */
'use strict'

App.AppList = (function () {
  let PANEL_ID = 'app-list'
  let BODY_ID = 'app-list-body'
  let SEARCH_ID = 'app-list-search-input'
  let CONFIRM_OVERLAY_ID = 'app-list-confirm-overlay'
  let CONFIRM_DESC_ID = 'app-list-confirm-desc'

  let _open = false
  let _apps = null          // 缓存 [{package, label, isSystem}]
  let _query = ''
  let _pending = null       // 待确认添加的 app

  function _getEl(id) { return document.getElementById(id) }

  // ── 纯函数：搜索过滤（大小写不敏感，命中 label 或 package）──
  function filterApps(apps, query) {
    const q = (query || '').trim().toLowerCase()
    const list = apps || []
    if (!q) return list.slice()
    return list.filter(function (a) {
      const label = (a.label || '').toLowerCase()
      const pkg = (a.package || '').toLowerCase()
      return label.indexOf(q) >= 0 || pkg.indexOf(q) >= 0
    })
  }

  function _escape(s) {
    return (App.utils && App.utils.escapeHtml) ? App.utils.escapeHtml(String(s)) : String(s)
  }

  function _splitApps(apps) {
    const third = [], system = []
    apps.forEach(function (a) {
      (a.isSystem ? system : third).push(a)
    })
    const byLabel = function (x, y) {
      return (x.label || x.package || '').localeCompare(y.label || y.package || '')
    }
    third.sort(byLabel)
    system.sort(byLabel)
    return { third: third, system: system }
  }

  function _rowsHtml(apps) {
    let html = ''
    apps.forEach(function (a) {
      const label = a.label || a.package
      html += '<div class="app-list-row" data-package="' + _escape(a.package) +
        '" data-label="' + _escape(label) + '" data-system="' + (a.isSystem ? '1' : '0') + '">'
      html += '<div class="app-list-avatar">' + _escape(label.charAt(0).toUpperCase()) + '</div>'
      html += '<div class="app-list-meta">' +
        '<div class="app-list-name">' + _escape(label) + '</div>' +
        '<div class="app-list-pkg">' + _escape(a.package) + '</div></div>'
      if (a.isSystem) html += '<span class="app-list-badge">系统</span>'
      html += '</div>'
    })
    return html
  }

  function render() {
    const body = _getEl(BODY_ID)
    if (!body) return
    if (!_apps) {
      body.innerHTML = '<div class="app-list-empty">正在加载应用列表…</div>'
      return
    }
    const filtered = filterApps(_apps, _query)
    if (!filtered.length) {
      body.innerHTML = '<div class="app-list-empty">无匹配应用</div>'
      return
    }
    const groups = _splitApps(filtered)
    let html = ''
    if (groups.third.length) {
      html += '<div class="app-list-section-title">第三方应用</div>' + _rowsHtml(groups.third)
    }
    if (groups.system.length) {
      html += '<div class="app-list-section-title">系统应用</div>' + _rowsHtml(groups.system)
    }
    body.innerHTML = html
    const rows = body.querySelectorAll('.app-list-row')
    for (let i = 0; i < rows.length; i++) {
      App.utils.bindPress(rows[i], function () {
        _askConfirm({
          package: this.getAttribute('data-package'),
          label: this.getAttribute('data-label'),
          isSystem: this.getAttribute('data-system') === '1'
        })
      })
    }
  }

  // ── 确认框 ──
  function _askConfirm(app) {
    if (!app || !app.package) return
    _pending = app
    const desc = _getEl(CONFIRM_DESC_ID)
    if (desc) desc.textContent = '在桌面创建快捷方式：' + (app.label || app.package)
    App.Dialog.open(CONFIRM_OVERLAY_ID)
  }

  function _confirmAdd() {
    const app = _pending
    _pending = null
    App.Dialog.close(CONFIRM_OVERLAY_ID)
    if (!app) return
    _addShortcut(app)
  }

  function _cancelConfirm() {
    _pending = null
    App.Dialog.close(CONFIRM_OVERLAY_ID)
  }

  function isConfirmOpen() {
    return App.Dialog.isOpen(CONFIRM_OVERLAY_ID)
  }

  // ── 写快捷方式文件（根目录，重名自动加序号）──
  function _addShortcut(app) {
    App.FileAPI.list('').then(function (items) {
      const stem = App.Shortcut.sanitizeFileName(app.label, app.package)
      const ext = App.Shortcut.EXT
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
      return App.FileAPI.write(name, App.Shortcut.buildAppShortcut(app)).then(function () { return name })
    }).then(function (name) {
      App.toast.show('已添加快捷方式: ' + name)
      if (App.Desktop && typeof App.Desktop.refresh === 'function') App.Desktop.refresh()
    }).catch(function (err) {
      App.toast.show('添加失败: ' + (err && err.message || '未知错误'))
    })
  }

  // ── 面板开关 ──
  function open() {
    if (_open) return
    _open = true
    const p = _getEl(PANEL_ID)
    if (p) {
      p.classList.add('app-list-open')
      p.setAttribute('aria-hidden', 'false')
    }
    if (App.Drawer && typeof App.Drawer.close === 'function') App.Drawer.close()
    App.bridge.vibrate()
    if (_apps) render()
    else _loadApps()
    // 系统返回键支持：MainActivity 返回键 → webView.goBack() → popstate → close()
    try { history.pushState({ _appListOpen: true }, '') } catch (e) { /* 降级：返回按钮仍可用 */ }
  }

  function close() {
    if (!_open) return
    _open = false
    const p = _getEl(PANEL_ID)
    if (p) {
      p.classList.remove('app-list-open')
      p.setAttribute('aria-hidden', 'true')
    }
  }

  function _onPopState() {
    // 确认框优先关闭（dialog-overlay 1300 > 面板 1200）：面板 pushState 被 goBack 弹出时，
    // 若确认框仍开则先收确认框、面板保持打开，二次返回再关面板。
    if (isConfirmOpen()) {
      _cancelConfirm()
      return
    }
    if (_open) close()
  }

  function isOpen() { return _open }

  function _loadApps() {
    render()
    App.FileAPI.listApps().then(function (apps) {
      _apps = apps || []
      if (_open) render()
    }).catch(function (err) {
      _apps = []
      if (_open) {
        const body = _getEl(BODY_ID)
        if (body) {
          body.innerHTML = '<div class="app-list-empty">加载失败: ' +
            _escape((err && err.message) || '未知错误') + '</div>'
        }
      }
    })
  }

  function init() {
    const backBtn = _getEl('app-list-back')
    if (backBtn) {
      App.utils.bindPress(backBtn, function () {
        try {
          if (history.state && history.state._appListOpen) history.back()
          else close()
        } catch (e) { close() }
      })
    }
    const search = _getEl(SEARCH_ID)
    if (search) {
      search.addEventListener('input', function () {
        _query = search.value
        render()
      })
    }
    const okBtn = _getEl('app-list-confirm-ok')
    if (okBtn) App.utils.bindPress(okBtn, _confirmAdd)
    const cancelBtn = _getEl('app-list-confirm-cancel')
    if (cancelBtn) App.utils.bindPress(cancelBtn, _cancelConfirm)
    const overlay = _getEl(CONFIRM_OVERLAY_ID)
    if (overlay) App.utils.bindPress(overlay, function (e) {
      if (e.target === overlay) _cancelConfirm()
    })
    window.addEventListener('popstate', _onPopState)
  }

  return {
    open: open,
    close: close,
    isOpen: isOpen,
    isConfirmOpen: isConfirmOpen,
    closeConfirm: _cancelConfirm,
    init: init,
    filterApps: filterApps
  }
})()
