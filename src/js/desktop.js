/* 桌面模块：以真实文件系统为数据源，渲染图标网格。
 * 根目录 = SAF 授权目录 或 私有目录兜底（由桥决定）。
 */
'use strict'

App.Desktop = (function () {
  var state = {
    rootName: '…',
    mode: 'unknown',
    items: []
  }

  function el(tag, className, text) {
    var node = document.createElement(tag)
    if (className) node.className = className
    if (text != null) node.textContent = text
    return node
  }

  function render() {
    var statusEl = document.getElementById('status-text')
    var gridEl = document.getElementById('desktop-grid')
    if (!gridEl) return
    gridEl.innerHTML = ''

    if (statusEl) {
      statusEl.textContent = '根目录: ' + state.rootName +
        (state.mode === 'private' ? '（应用私有目录，可在设置中授权外部存储）' : '')
    }

    state.items.forEach(function (item) {
      var card = el('div', 'desktop-icon' + (item.isDir ? ' is-dir' : ''))
      var icon = el('div', 'desktop-icon-glyph', item.isDir ? '📁' : '📄')
      var name = el('div', 'desktop-icon-name', item.name)
      card.appendChild(icon)
      card.appendChild(name)
      gridEl.appendChild(card)
    })
  }

  function refresh() {
    return App.FileAPI.rootInfo()
      .then(function (info) {
        state.rootName = info.rootName
        state.mode = info.mode
        // 顶栏标题 + Drawer 头部显示授权路径
        if (App.Drawer && typeof App.Drawer.updatePath === 'function') {
          App.Drawer.updatePath(info.displayPath || info.rootName, info.rootName, info.mode)
        }
      })
      .catch(function () {
        state.rootName = '无法读取'
        if (App.Drawer && typeof App.Drawer.updatePath === 'function') {
          App.Drawer.updatePath(App.NAME, App.NAME, '')
        }
      })
      .then(function () { return App.FileAPI.list('') })
      .then(function (items) {
        state.items = items
        render()
      })
      .catch(function (err) {
        var statusEl = document.getElementById('status-text')
        if (statusEl) statusEl.textContent = '读取失败: ' + err.message
      })
  }

  return {
    refresh: refresh,
    render: render
  }
})()
