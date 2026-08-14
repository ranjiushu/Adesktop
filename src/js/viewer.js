/* InternalViewer：通用文件查看器组件。
 * 双形态（由宿主按上下文传入 anchor 决定）：
 *   1. canvas 预览态（anchor 非 null，Desktop 空间）：Viewer 是放置在画布上的
 *      世界坐标实体——随画布 transform 平移/缩放，桌面手势照常作用于其上
 *      （不拦截触摸，不创作独立交互模型），DOM 遮挡使其背后的文件点不到。
 *   2. fullscreen 全屏态（anchor null，folder 容器 / 预览态点「全屏预览」）：
 *      Viewer 占满内容区，拦截触摸，内容可滚动/媒体可控制。
 * 顶栏只有「全屏预览」按钮（canvas 态）；关闭功能由宿主（Morph FAB 选中态
 * 操作栏 / 系统返回键）完成，Viewer 自身不提供关闭入口。
 * 类型：text/markdown/json/html/svg/image/video/audio；媒体走 URI 流式
 *       （FileAPI.resolveUri → content:// 或 file://），不把大文件搬入 JS 内存。
 * HTML 安全：iframe srcdoc + sandbox="allow-scripts"（无 allow-same-origin → opaque
 *       origin，脚本无法触达 window.FileBridge）。
 * 依赖: namespace.js, file-api.js, markdown.js
 * 导出: App.InternalViewer（worldRect/cardSize/visibleRatio/jsonToNodes 纯函数可单测）
 */
'use strict'

App.InternalViewer = (function () {
  const VIEWPORT_EDGE = 16   // 世界尺寸：宽 = 视口宽 - 2×EDGE（zoom=1 时接近屏幕）
  const TOP_GAP = 96         // 世界尺寸：高 = 视口高 - TOP_GAP（让位顶栏/底栏）
  const MIN_W = 200
  const MIN_H = 160
  const MIN_VISIBLE = 0.3    // 打开瞬间锚点可见性阈值（低于则移到视口中心）

  // ── 纯函数：世界矩形（卡片中心对齐锚点世界坐标；anchor = {x, y}，与 Desktop positions 一致）──
  function worldRect(anchor, w, h) {
    return { x: anchor.x - w / 2, y: anchor.y - h / 2, w: w, h: h }
  }

  // ── 纯函数：世界尺寸（接近屏幕尺度，不随当前 zoom 调整；zoom 由画布 transform 决定）──
  function cardSize(vw, vh) {
    return {
      w: Math.max(MIN_W, vw - VIEWPORT_EDGE * 2),
      h: Math.max(MIN_H, vh - TOP_GAP)
    }
  }

  // 矩形与视口交集面积占比（0~1）
  function visibleRatio(rect, vw, vh) {
    const ix = Math.max(0, Math.min(rect.x + rect.w, vw) - Math.max(rect.x, 0))
    const iy = Math.max(0, Math.min(rect.y + rect.h, vh) - Math.max(rect.y, 0))
    return (ix * iy) / (rect.w * rect.h)
  }

  // ── 纯函数：JSON → 树节点（对象/数组 → children；标量 → preview）──
  // 节点: { key, type: 'object'|'array'|'string'|'number'|'boolean'|'null', value, children, preview }
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
  let _layer = null          // #viewer-layer（fullscreen 宿主，触摸拦截挂载点）
  let _canvas = null         // #desktop-canvas（canvas 预览宿主）
  let _card = null
  let _title = null
  let _body = null
  let _fsBtn = null          // 顶栏「全屏预览」按钮
  let _state = { open: false, mode: null, path: '', name: '', kind: '', anchor: null, camera: null, onFallback: null, uri: null, rect: null }

  function ensureInit() {
    if (_card) return
    _layer = document.getElementById('viewer-layer')
    _canvas = document.getElementById('desktop-canvas')
    // 触摸拦截只挂在 layer：fullscreen 态 card 在 layer 内才命中（canvas 态不受影响），
    // capture 阶段阻断冒泡到桌面手势层；内部滚动/控件正常。
    if (_layer) {
      ;['touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach(function (type) {
        _layer.addEventListener(type, function (e) { e.stopPropagation() }, true)
      })
    }
    _card = document.createElement('div')
    _card.className = 'viewer-card'
    _card.innerHTML =
      '<header class="viewer-header">' +
      '<span class="viewer-title"></span>' +
      '<button class="viewer-fs-btn" aria-label="全屏预览">' +
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>' +
      '</button>' +
      '</header>' +
      '<div class="viewer-body"></div>'
    _title = _card.querySelector('.viewer-title')
    _body = _card.querySelector('.viewer-body')
    _fsBtn = _card.querySelector('.viewer-fs-btn')
    _fsBtn.addEventListener('click', toFullscreen)
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

  // 定位并挂载到宿主
  function mount() {
    const vw = _layer.clientWidth
    const vh = _layer.clientHeight
    if (_state.mode === 'canvas') {
      // 世界坐标实体：中心对齐锚点；锚点不可见时移到视口中心世界点（保证首屏可见）
      const size = cardSize(vw, vh)
      let rect = worldRect(_state.anchor, size.w, size.h)
      if (visibleRatio(rect, vw, vh) < MIN_VISIBLE && _state.camera) {
        const cw = _state.camera.x + vw / (2 * _state.camera.zoom)
        const ch = _state.camera.y + vh / (2 * _state.camera.zoom)
        rect = worldRect({ x: cw, y: ch }, size.w, size.h)
      }
      _state.rect = rect
      _card.style.left = rect.x + 'px'
      _card.style.top = rect.y + 'px'
      _card.style.width = rect.w + 'px'
      _card.style.height = rect.h + 'px'
      _card.className = 'viewer-card viewer-card-canvas'
      _fsBtn.style.display = ''
      if (_canvas) _canvas.appendChild(_card)
    } else {
      // 全屏态：占满内容区
      _state.rect = { x: 0, y: 0, w: vw, h: vh }
      _card.className = 'viewer-card viewer-card-fullscreen'
      _fsBtn.style.display = 'none'
      if (_layer) _layer.appendChild(_card)
    }
  }

  // 顶栏「全屏预览」：canvas 实体 → 全屏覆盖（内容保留，不重新渲染）
  function toFullscreen() {
    if (!_state.open || _state.mode !== 'canvas' || !_layer) return
    _state.mode = 'fullscreen'
    _state.rect = { x: 0, y: 0, w: _layer.clientWidth, h: _layer.clientHeight }
    if (_card.parentNode) _card.parentNode.removeChild(_card)
    // 清掉画布实体留下的 inline 定位（让 .viewer-card-fullscreen 的 100% 生效）
    _card.style.left = ''
    _card.style.top = ''
    _card.style.width = ''
    _card.style.height = ''
    _card.className = 'viewer-card viewer-card-fullscreen'
    _fsBtn.style.display = 'none'
    _layer.appendChild(_card)
    _layer.classList.add('viewer-layer-open')
    _layer.setAttribute('aria-hidden', 'false')
  }

  // 画布实体命中测试：世界坐标点是否落在 Viewer 矩形内（宿主 tap 不反选用）
  function hitTestWorld(wx, wy) {
    if (!_state.open || _state.mode !== 'canvas' || !_state.rect) return false
    const r = _state.rect
    return wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.y + r.h
  }

  // ── 渲染（与形态无关，内容渲染一次，切全屏时保留）──
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
          iframe.setAttribute('sandbox', 'allow-scripts')   // 隔离 Java 桥（opaque origin）
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

  // 媒体类：URI 流式挂载（img/video/audio），不读入内存
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

  // file:// URI → 所在目录的 base href（供 HTML 相对资源加载）；
  // content:// 无法可靠推导目录，不注入（本阶段接受相对资源缺失）
  function dirHref(uri, name) {
    if (!uri || !name || uri.indexOf('file:') !== 0) return ''
    const i = uri.lastIndexOf('/')
    if (i <= 0) return ''
    return uri.slice(0, i + 1)
  }

  // JSON 树 DOM 构建（textContent 构建，天然防注入）
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
      // 暂停媒体 + 清空 iframe，释放资源
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
    _state = { open: false, mode: null, path: '', name: '', kind: '', anchor: null, camera: null, onFallback: null, uri: null, rect: null }
    if (_layer) {
      _layer.classList.remove('viewer-layer-open')
      _layer.setAttribute('aria-hidden', 'true')
    }
  }

  function open(opts) {
    opts = opts || {}
    ensureInit()
    if (!_layer || !_card) return false
    if (_state.open) close()
    _state = {
      open: false,
      mode: opts.anchor ? 'canvas' : 'fullscreen',   // anchor = 画布实体；无锚点（folder） = 全屏
      path: opts.path || '',
      name: opts.name || '',
      kind: opts.kind || 'text',
      anchor: opts.anchor || null,
      camera: opts.camera || null,   // 打开瞬间相机快照（canvas 态锚点不可见时居中用）
      onFallback: typeof opts.onFallback === 'function' ? opts.onFallback : null,
      uri: null,
      rect: null
    }
    if (!_state.path) return false
    _title.textContent = _state.name
    mount()
    _state.open = true
    if (_state.mode === 'fullscreen') {
      _layer.classList.add('viewer-layer-open')
      _layer.setAttribute('aria-hidden', 'false')
    }
    renderContent()
    return true
  }

  return {
    open: open,
    close: close,
    isOpen: isOpen,
    getMode: getMode,
    toFullscreen: toFullscreen,
    hitTestWorld: hitTestWorld,
    worldRect: worldRect,
    cardSize: cardSize,
    visibleRatio: visibleRatio,
    jsonToNodes: jsonToNodes
  }
})()
