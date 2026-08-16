/* 图标系统：统一 SVG 图标库，所有图标引用 index.html 中的 sprite。
 * 依赖: namespace.js（提供 App 命名空间）
 * 导出: App.icons
 * 设计规范: 24×24 viewBox, 2px 描边, currentColor, round caps/joins, Feather/Material Outlined 风格
 * 移植自 LexiCull（同构参考，命名/API 保持一致）；新增图标必须同步登记
 *   index.html sprite 的 symbol id（icon-{kebab}）+ 下方 _NAMES 清单，
 *   tests/test-icons.js 会校验两者一一对应。
 */
'use strict'

;(function (App) {

  // camelCase → kebab-case
  function kebab(str) {
    return str.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
  }

  const SVG_OPEN = '<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 24 24"'
  const SVG_CLOSE = '><use href="#icon-{name}"/></svg>'

  function escapeAttr(str) {
    return String(str || '').replace(/"/g, '&quot;')
  }

  // 通用取图标方法
  // opts: { width, height, className/class, style }
  function icon(name, opts) {
    opts = opts || {}
    const width = opts.width || 20
    const height = opts.height || 20
    const cls = opts.className || opts.class || ''
    const style = opts.style || ''
    let html = SVG_OPEN.replace('{w}', width).replace('{h}', height)
    if (cls) html += ' class="' + escapeAttr(cls) + '"'
    if (style) html += ' style="' + escapeAttr(style) + '"'
    html += SVG_CLOSE.replace('{name}', kebab(name))
    return html
  }

  // 所有图标名称清单（对应 index.html sprite 中的 symbol id，kebab 转换后 = icon-{name}）
  const _NAMES = [
    // ── 导航/通用 UI ──
    'arrowLeft', 'arrowRight', 'arrowUp', 'chevronDown', 'chevronUp', 'chevronRight', 'chevronLeft',
    'menu', 'moreVertical', 'close', 'plus', 'home', 'check', 'checkSmall', 'checkCircle', 'minusCircle',
    // ── 文件/文件夹 ──
    'folder', 'folderPlus', 'folderMove', 'file', 'fileText', 'trash', 'copy', 'archive', 'clipboardImport',
    // ── 操作/编辑 ──
    'edit', 'rename', 'refreshCw', 'maximize', 'scissors', 'dragHandle', 'selectInverse', 'externalLink',
    // ── 视图/排列 ──
    'grid', 'columns', 'layoutTop', 'image', 'sliders', 'filter', 'shuffle', 'swap', 'sortAlpha', 'sortLength', 'sortLines',
    // ── 信息/状态 ──
    'info', 'search', 'settings', 'download', 'eye', 'eyeOff', 'clock', 'history', 'activity', 'barChart',
    'pin', 'pinOff', 'similar', 'merge', 'target', 'smile', 'sun', 'moon', 'code',
    // ── 学习/媒体 ──
    'bookOpen', 'skipBack', 'play', 'pause', 'skipForward', 'music', 'backup'
  ]

  const icons = { get: icon }

  _NAMES.forEach(function (name) {
    // 默认 20×20 的命名访问
    icons[name] = icon(name, { width: 20, height: 20 })
  })

  // 供测试校验 sprite 与注册表一致性
  icons._NAMES = _NAMES

  App.icons = icons

})(App)
