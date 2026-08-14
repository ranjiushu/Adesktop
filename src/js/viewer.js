/* InternalViewer：通用文件查看器组件（画布实体 + 全屏新页面双形态）。
 *   1. canvas 预览态（anchor 非 null，Desktop 空间）：Viewer 是放置在画布上的
 *      世界坐标实体——随画布 transform 平移/缩放，具备实体的基本性质：
 *      点击 = 选中（与文件选中态绑定）、长按/拖动 = 移动实体位置；
 *      桌面手势照常作用于画布，DOM 遮挡使其背后的文件点不到。
 *   2. fullscreen 全屏态（anchor null folder 容器 / FAB「全屏预览」）：
 *      Viewer 进入 #viewer-fs-page 独立新页面（fixed 全屏），退出（返回键 /
 *      页头返回按钮）回到原页面状态——桌面空间回画布实体，folder 容器关闭。
 * 顶栏：canvas 态只显示「全屏预览」按钮；全屏态显示返回按钮 + 文件名。
 * 关闭功能由 Morph FAB 选中态操作栏（全屏预览 / 关闭预览）与系统返回键完成。
 * 类型：text/markdown/json/html/svg/image/video/audio；媒体走 URI 流式。
 * HTML 安全：iframe srcdoc + sandbox="allow-scripts"（隔离 Java 桥）。
 * 依赖: namespace.js, file-api.js, markdown.js
 * 导出: App.InternalViewer（worldRect/cardSize/visibleRatio/jsonToNodes/shiftRect 纯函数可单测）
 */
'use strict'

App.InternalViewer = (function () {
  const VIEWPORT_EDGE = 16
  const TOP_GAP = 96
  const MIN_W = 200
  const MIN_H = 160
  const MIN_VISIBLE = 0.3

  // ── 纯函数 ──
  // 世界矩形（卡片中心对齐锚点世界坐标；anchor = {x, y}，与 Desktop positions 一致）
  function worldRect(anchor, w, h) {
    return { x: anchor.x - w / 2, y: anchor.y - h / 2, w: w, h: h }
  }
  // 世界尺寸（zoom=1 时接近屏幕）
  function cardSize(vw, vh) {
    return { w: Math.max(MIN_W, vw - VIEWPORT_EDGE * 2), h: Math.max(MIN_H, vh - TOP_GAP) }
  }
  // 矩形与视口交集面积占比（0~1）
  function visibleRatio(rect, vw, vh) {
    const ix = Math.max(0, Math.min(rect.x + rect.w, vw) - Math.max(rect.x, 0))
    const iy = Math.max(0, Math.min(rect.y + rect.h, vh) - Math.max(rect.y, 0))
    return (ix * iy) / (rect.w * rect.h)
  }
  // 矩形平移（拖动用）
  function shiftRect(rect, dx, dy) {
    return { x: rect.x + dx, y: rect.y + dy, w: rect.w, h: rect.h }
  }
  // JSON → 树节点
  function jsonToNodes(value, key) {
    const k = key == null ? '' : String(key)
    if (value === null) return { key: k, type: 'null', value: null, children: [], preview: 'null' }
    const t = typeof value
    if (t === 'object') {
      const isArr = Array.isArray(value)
      const keys = isArr ? value.map(function (_, i) { return i }) : Object.keys(value)
      const children = keys.map(function (childKey) {
        return jsonToNodes(value[childKey], isArr ? String(childKey) : childKey)
      })
      return {
        key: k,
        type: isArr ? 'array' : 'object',
        value: value,
        children: children,
        preview: isArr ? 'Array[' + children.length + ']' : 'Object{' + children.length + '}'
      }
    }
    if (t === 'string') {
      const s = value.length > 80 ? value.slice(0, 80) + '…' : value
      return { key: k, type: 'string', value: value, children: [], preview: JSON.stringify(s) }
    }
    return { key: k, type: t, value: value, children: [], preview: String(value) }
  }

  // ── DOM 状态 ──
  let _layer = null        // #viewer-layer（fullscreen 触摸拦截宿主；folder 全屏）
  let _fsPage = null       // #viewer-fs-page（全屏新页面宿主）
  let _canvas = null       // #desktop-canvas（画布实体宿主）
  let _card = null
  let _title = null
  let _body = null
  let _backBtn = null
  let _fsBtn = null
  let _drag = null         // { startWorld, startRect } 拖动状态
  let _state = { open: false, mode: null, fsFrom: null, path: '', name: '', kind: '', anchor: null, camera: null, onFallback: null, uri: null, rect: null, canvasRect: null }

  function ensureInit() {
    if (_card) return
    _layer = document.getElementById('viewer-layer')
    _fsPage = document.getElementById('viewer-fs-page')
    _canvas = document.getElementById('desktop-canvas')
    // 触摸拦截：layer 与 fs-page 均 capture 阶段阻断冒泡到桌面手势层
    // （canvas 态实体不经过二者 → 桌面手指依旧有效）
    ;[_layer, _fsPage].forEach(function (host) {
      if (!host) return
      ;['touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach(function (type) {
        host.addEventListener(type, function (e) { e.stopPropagation() }, true)
      })
    })
    _card = document.createElement('div')
    _card.className = 'viewer-card'
    _card.innerHTML =
      '<header class="viewer-header">' +
      '<button class="viewer-back-btn" aria-label="退出全屏">' +
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>' +
      '</button>' +
      '<span class="viewer-title"></span>' +
      '<button class="viewer-fs-btn" aria-label="全屏预览">' +
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>' +
      '</button>' +
      '</header>' +
      '<div class="viewer-body"></div>'
    _title = _card.querySelector('.viewer-title')
    _body = _card.querySelector('.viewer-body')
    _backBtn = _card.querySelector('.viewer-back-btn')
    _fsBtn = _card.querySelector('.viewer-fs-btn')
    _fsBtn.addEventListener('click', toFullscreen)
    _backBtn.addEventListener('click', function () {
      // 页面返回按钮：退出全屏 + 清理历史栈（popstate 触发 exitFullscreen 幂等）
      exitFullscreen()
      try {
        if (history.state && history.state._viewerFs) history.back()
      } catch (e) { /* 忽略 */ }
    })
    // 内容区链接点击：不跳转（避免 file:// 页面被顶掉），toast 提示
    _body.addEventListener('click', function (e) {
      const a = e.target && e.target.closest ? e.target.closest('a') : null
      if (a) {
        e.preventDefault()
        if (App.toast && typeof App.toast.show === 'function') {
          App.toast.show('链接跳转暂不支持（内部查看器）')
        }
      }
    })
    // 全屏返回键：popstate（系统返回键 → webView.goBack → popstate；file:// 存疑时走 handleSystemBack 兜底）
    window.addEventListener('popstate', function () {
      if (_state.open && _state.mode === 'fullscreen') exitFullscreen()
    })
  }

  function isOpen() { return !!_state.open }
  function getMode() { return _state.mode }

  function setLoading() {
    _body.innerHTML = '<div class="viewer-loading">加载中…</div>'
  }

  function showError(msg) {
    let html = '<div class="viewer-error">' + App.Markdown.escapeHtml(msg || '无法预览该文件') + '</div>'
    if (typeof _state.onFallback === 'function') {
      html += '<div class="viewer-error-actions"><button class="viewer-fallback-btn">用其他应用打开</button></div>'
    }
    _body.innerHTML = html
    const btn = _body.querySelector('.viewer-fallback-btn')
    if (btn) btn.addEventListener('click', function () { _state.onFallback() })
  }

  // 全屏时隐藏 FAB（简洁新页面；退出恢复）
  function setFabHidden(hidden) {
    const fab = document.getElementById('mode-switch-fab')
    if (!fab) return
    if (hidden) fab.classList.add('fab-hidden')
    else fab.classList.remove('fab-hidden')
  }

  // ── 挂载 ──
  function mount() {
    const vw = _layer.clientWidth
    const vh = _layer.clientHeight
    if (_state.mode === 'canvas') {
      const size = cardSize(vw, vh)
      let rect = worldRect(_state.anchor, size.w, size.h)
      if (visibleRatio(rect, vw, vh) < MIN_VISIBLE && _state.camera) {
        const cw = _state.camera.x + vw / (2 * _state.camera.zoom)
        const ch = _state.camera.y + vh / (2 * _state.camera.zoom)
        rect = worldRect({ x: cw, y: ch }, size.w, size.h)
      }
      applyCanvasRect(rect)
      _card.classList.add('viewer-card-selected')   // 选中视觉（与文件选中态绑定）
      _fsBtn.style.display = ''
      _backBtn.style.display = 'none'
      if (_canvas) _canvas.appendChild(_card)
    } else {
      // folder 全屏：进入新页面
      enterFullscreenPage()
    }
  }

  // 画布实体矩形应用（世界坐标）
  function applyCanvasRect(rect) {
    _state.rect = rect
    _state.canvasRect = { x: rect.x, y: rect.y, w: rect.w, h: rect.h }
    _card.style.left = rect.x + 'px'
    _card.style.top = rect.y + 'px'
    _card.style.width = rect.w + 'px'
    _card.style.height = rect.h + 'px'
  }

  // ── 全屏新页面 ──
  function enterFullscreenPage() {
    _state.mode = 'fullscreen'
    _state.rect = { x: 0, y: 0, w: _layer.clientWidth, h: _layer.clientHeight }
    if (_card.parentNode) _card.parentNode.removeChild(_card)
    // 清掉画布实体 inline 定位（fixed 全屏由 CSS 控制）
    _card.style.left = ''
    _card.style.top = ''
    _card.style.width = ''
    _card.style.height = ''
    _card.className = 'viewer-card viewer-card-fullscreen'
    _card.classList.remove('viewer-card-selected')
    _fsBtn.style.display = 'none'
    _backBtn.style.display = ''
    if (_fsPage) {
      _fsPage.appendChild(_card)
      _fsPage.classList.add('viewer-fs-page-open')
      _fsPage.setAttribute('aria-hidden', 'false')
    }
    setFabHidden(true)
    // 系统返回键：pushState 使 webView.canGoBack() 可回退（buildinfo 同款模式）
    try { history.pushState({ _viewerFs: true }, '') } catch (e) { /* 降级：handleSystemBack 兜底 */ }
  }

  // 退出全屏：桌面空间 → 回画布实体；folder → 关闭。
  // 不主动调 history.back()：系统返回键路径（canGoBack→popstate / handleSystemBack）
  // 与页面返回按钮（backBtn 显式 back）已覆盖；避免 file:// 下 back 触发整页导航。
  function exitFullscreen() {
    if (!_state.open || _state.mode !== 'fullscreen') return
    const from = _state.fsFrom
    if (_fsPage) {
      _fsPage.classList.remove('viewer-fs-page-open')
      _fsPage.setAttribute('aria-hidden', 'true')
    }
    if (_card.parentNode) _card.parentNode.removeChild(_card)
    setFabHidden(false)
    if (from === 'canvas') {
      // 回到画布实体（保留内容与位置）
      _state.mode = 'canvas'
      _card.className = 'viewer-card viewer-card-canvas viewer-card-selected'
      _fsBtn.style.display = ''
      _backBtn.style.display = 'none'
      if (_canvas) _canvas.appendChild(_card)
      applyCanvasRect(_state.canvasRect || _state.rect)
    } else {
      close()
    }
  }

  // 顶栏「全屏预览」（canvas 态）
  function toFullscreen() {
    if (!_state.open || _state.mode !== 'canvas' || !_fsPage) return
    _state.fsFrom = 'canvas'
    enterFullscreenPage()
  }

  // ── 画布实体拖动（实体基本性质：长按/拖动 = 移动实体位置） ──
  function beginDrag(world) {
    if (!_state.open || _state.mode !== 'canvas' || !_state.rect) return false
    _drag = {
      startWorld: { x: world.x, y: world.y },
      startRect: { x: _state.rect.x, y: _state.rect.y, w: _state.rect.w, h: _state.rect.h }
    }
    _card.classList.add('viewer-card-dragging')
    return true
  }

  function moveBy(world) {
    if (!_drag) return
    const dx = world.x - _drag.startWorld.x
    const dy = world.y - _drag.startWorld.y
    applyCanvasRect(shiftRect(_drag.startRect, dx, dy))
  }

  function endDrag() {
    if (!_drag) return
    _drag = null
    _card.classList.remove('viewer-card-dragging')
  }

  function cancelDrag() {
    if (!_drag) return
    applyCanvasRect(_drag.startRect)
    _drag = null
    _card.classList.remove('viewer-card-dragging')
  }

  function isDragging() { return !!_drag }

  // 画布实体命中测试：世界坐标点是否落在 Viewer 矩形内（宿主 tap 选中 / 反选判定）
  function hitTestWorld(wx, wy) {
    if (!_state.open || _state.mode !== 'canvas' || !_state.rect) return false
    const r = _state.rect
    return wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.y + r.h
  }

  // ── 渲染（与形态无关；切全屏时内容保留）──
  function renderContent() {
    setLoading()
    const p = _state.path
    switch (_state.kind) {
      case 'text':
        App.FileAPI.read(p).then(function (content) {
          _body.innerHTML = '<pre class="viewer-pre">' + App.Markdown.escapeHtml(content) + '</pre>'
        }).catch(function (err) { showError(err && err.message || '读取失败') })
        break
      case 'markdown':
        App.FileAPI.read(p).then(function (content) {
          _body.innerHTML = '<div class="viewer-md">' + App.Markdown.render(content) + '</div>'
        }).catch(function (err) { showError(err && err.message || '读取失败') })
        break
      case 'json':
        App.FileAPI.read(p).then(function (content) {
          let value
          try {
            value = JSON.parse(content)
          } catch (e) {
            throw new Error('JSON 解析失败: ' + e.message)
          }
          const root = jsonToNodes(value, '')
          _body.innerHTML = ''
          buildTreeDom(root, _body)
        }).catch(function (err) { showError(err && err.message || '读取失败') })
        break
      case 'html':
        Promise.all([
          App.FileAPI.read(p),
          App.FileAPI.resolveUri(p).catch(function () { return '' })
        ]).then(function (r) {
          const content = r[0]
          const uri = r[1]
          const baseHref = dirHref(uri, _state.name)
          const iframe = document.createElement('iframe')
          iframe.className = 'viewer-frame'
          iframe.setAttribute('sandbox', 'allow-scripts')
          if (baseHref) {
            iframe.srcdoc = content.replace(/<head([^>]*)>/i, function (m, attrs) {
              return '<head' + attrs + '><base href="' + baseHref + '">'
            })
          } else {
            iframe.srcdoc = content
          }
          _body.appendChild(iframe)
        }).catch(function (err) { showError(err && err.message || '读取失败') })
        break
      case 'svg':
        App.FileAPI.read(p).then(function (content) {
          const img = document.createElement('img')
          img.className = 'viewer-media-img'
          img.alt = _state.name
          img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(content)
          img.addEventListener('error', function () { showError('SVG 渲染失败') })
          _body.appendChild(img)
        }).catch(function (err) { showError(err && err.message || '读取失败') })
        break
      case 'image':
        mountMedia('img', 'viewer-media-img')
        break
      case 'video':
        mountMedia('video', 'viewer-media-video')
        break
      case 'audio':
        mountMedia('audio', 'viewer-media-audio')
        break
      default:
        showError('不支持的查看类型: ' + _state.kind)
    }
  }

  function mountMedia(tag, cls) {
    App.FileAPI.resolveUri(_state.path).then(function (uri) {
      _state.uri = uri
      const el = document.createElement(tag)
      el.className = cls
      if (tag === 'video' || tag === 'audio') {
        el.controls = true
        el.preload = 'metadata'
      }
      el.src = uri
      el.addEventListener('error', function () {
        showError('无法加载媒体（当前内核可能不支持该格式）')
      })
      _body.appendChild(el)
    }).catch(function (err) {
      showError(err && err.message || '无法解析文件 URI')
    })
  }

  function dirHref(uri, name) {
    if (!uri || !name || uri.indexOf('file:') !== 0) return ''
    const i = uri.lastIndexOf('/')
    if (i <= 0) return ''
    return uri.slice(0, i + 1)
  }

  function buildTreeDom(node, container) {
    const ul = document.createElement('ul')
    ul.className = 'viewer-json'
    const li = document.createElement('li')
    if (node.type === 'object' || node.type === 'array') {
      const details = document.createElement('details')
      if (!node.key) details.open = true
      const summary = document.createElement('summary')
      summary.textContent = node.key
        ? node.key + ' : ' + node.preview
        : node.preview
      details.appendChild(summary)
      const childUl = document.createElement('ul')
      node.children.forEach(function (c) { buildTreeDom(c, childUl) })
      details.appendChild(childUl)
      li.appendChild(details)
    } else {
      const keySpan = document.createElement('span')
      keySpan.className = 'viewer-json-key'
      keySpan.textContent = node.key ? node.key + ': ' : ''
      const valSpan = document.createElement('span')
      valSpan.className = 'viewer-json-' + node.type
      valSpan.textContent = node.preview
      li.appendChild(keySpan)
      li.appendChild(valSpan)
    }
    ul.appendChild(li)
    container.appendChild(ul)
  }

  function close() {
    if (!_state.open && !_card) return
    if (_card) {
      const v = _card.querySelector('video')
      if (v) { try { v.pause() } catch (e) { /* 忽略 */ } }
      const a = _card.querySelector('audio')
      if (a) { try { a.pause() } catch (e) { /* 忽略 */ } }
      const frame = _card.querySelector('iframe')
      if (frame) {
        try { frame.removeAttribute('srcdoc'); frame.removeAttribute('src') } catch (e) { /* 忽略 */ }
      }
      _body.innerHTML = ''
      if (_card.parentNode) _card.parentNode.removeChild(_card)
    }
    if (_fsPage) {
      _fsPage.classList.remove('viewer-fs-page-open')
      _fsPage.setAttribute('aria-hidden', 'true')
    }
    if (_layer) {
      _layer.classList.remove('viewer-layer-open')
      _layer.setAttribute('aria-hidden', 'true')
    }
    setFabHidden(false)
    _drag = null
    _state = { open: false, mode: null, fsFrom: null, path: '', name: '', kind: '', anchor: null, camera: null, onFallback: null, uri: null, rect: null, canvasRect: null }
  }

  function open(opts) {
    opts = opts || {}
    ensureInit()
    if (!_layer || !_card) return false
    if (_state.open) close()
    const hasAnchor = !!opts.anchor
    _state = {
      open: false,
      mode: hasAnchor ? 'canvas' : 'fullscreen',
      fsFrom: hasAnchor ? null : 'folder',   // folder 容器打开 = 直接全屏，退出 = 关闭
      path: opts.path || '',
      name: opts.name || '',
      kind: opts.kind || 'text',
      anchor: opts.anchor || null,
      camera: opts.camera || null,
      onFallback: typeof opts.onFallback === 'function' ? opts.onFallback : null,
      uri: null,
      rect: null
    }
    if (!_state.path) return false
    _title.textContent = _state.name
    _card.className = 'viewer-card viewer-card-canvas'
    mount()
    _state.open = true
    renderContent()
    return true
  }

  return {
    open: open,
    close: close,
    isOpen: isOpen,
    getMode: getMode,
    toFullscreen: toFullscreen,
    exitFullscreen: exitFullscreen,
    beginDrag: beginDrag,
    moveBy: moveBy,
    endDrag: endDrag,
    cancelDrag: cancelDrag,
    isDragging: isDragging,
    hitTestWorld: hitTestWorld,
    worldRect: worldRect,
    cardSize: cardSize,
    visibleRatio: visibleRatio,
    shiftRect: shiftRect,
    jsonToNodes: jsonToNodes
  }
})()
