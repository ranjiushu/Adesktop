/* InternalViewer：通用文件查看器（Overlay Layer 组件，不绑定 Desktop 布局）。
 * 形态：默认以锚点（世界坐标）定位的浮动卡片，画布平移时随锚点移动（syncCamera）；
 *       immersive=true 时占满宿主内容区（folder 容器沉浸式查看）。
 * 类型：text/markdown/json/html/svg/image/video/audio；媒体一律走 URI 流式
 *       （FileAPI.resolveUri → content:// 或 file://），不把大文件搬入 JS 内存。
 * HTML 安全：iframe srcdoc + sandbox="allow-scripts"（无 allow-same-origin → opaque
 *       origin，脚本无法触达 window.FileBridge，隔离 Java 桥权限）。
 * 交互：Viewer 自身拦截触摸（capture 阶段 stopPropagation，阻断桌面手势层）；
 *       关闭后清理媒体/iframe，文件与画布状态完全恢复。
 * 依赖: namespace.js, file-api.js, markdown.js
 * 导出: App.InternalViewer（calcCardRect/jsonToNodes 纯函数可单测）
 */
'use strict'

App.InternalViewer = (function () {
  const EDGE = 16          // 视口边距（卡片宽 = 视口宽 - 2×EDGE）
  const TOP_GAP = 64       // 卡片高让出顶栏/底栏空间
  const MIN_W = 200
  const MIN_H = 160
  const MIN_VISIBLE = 0.3  // 打开瞬间锚点可见性阈值（低于则居中定位）

  // ── 纯函数：锚点卡片矩形（世界坐标 → 屏幕坐标，不随 zoom 缩放，严格跟随锚点）──
  function calcCardRect(anchor, camera, vw, vh) {
    const w = Math.max(MIN_W, vw - EDGE * 2)
    const h = Math.max(MIN_H, vh - TOP_GAP)
    const zoom = (camera && camera.zoom) || 1
    const sx = (anchor.wx - camera.x) * zoom - w / 2
    const sy = (anchor.wy - camera.y) * zoom - h / 2
    return { x: sx, y: sy, w: w, h: h }
  }

  // 沉浸式：占满宿主内容区
  function immersiveRect(vw, vh) {
    return { x: 0, y: 0, w: vw, h: vh }
  }

  // 卡片与视口交集面积占比（0~1）
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
  let _layer = null
  let _card = null
  let _title = null
  let _body = null
  let _state = { open: false, path: '', name: '', kind: '', anchor: null, immersive: false, onFallback: null, camera: null, uri: null }

  function ensureInit() {
    if (_layer) return
    _layer = document.getElementById('viewer-layer')
    if (!_layer) return
    // 触摸拦截：Viewer 自身消费交互（capture 阶段阻断冒泡到桌面手势层）。
    // layer 默认 pointer-events:none，仅打开时命中；内部滚动/控件不受影响。
    ;['touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach(function (type) {
      _layer.addEventListener(type, function (e) { e.stopPropagation() }, true)
    })
    _card = document.createElement('div')
    _card.className = 'viewer-card'
    _card.innerHTML =
      '<header class="viewer-header">' +
      '<span class="viewer-title"></span>' +
      '<button class="viewer-close" aria-label="关闭">' +
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
      '</button>' +
      '</header>' +
      '<div class="viewer-body"></div>'
    _title = _card.querySelector('.viewer-title')
    _body = _card.querySelector('.viewer-body')
    _card.querySelector('.viewer-close').addEventListener('click', close)
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
    _layer.appendChild(_card)
  }

  function isOpen() { return !!_state.open }

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

  // 定位 + 显示（打开瞬间：锚点不可见则居中，保证首屏可见；之后 syncCamera 严格跟随）
  function positionCard() {
    const vw = _layer.clientWidth
    const vh = _layer.clientHeight
    let rect
    if (_state.immersive) {
      rect = immersiveRect(vw, vh)
    } else {
      const cam = _state.camera || { x: 0, y: 0, zoom: 1 }
      rect = calcCardRect(_state.anchor, cam, vw, vh)
      if (visibleRatio(rect, vw, vh) < MIN_VISIBLE) {
        rect = { x: Math.max(EDGE, (vw - rect.w) / 2), y: Math.max(EDGE, (vh - rect.h) / 2), w: rect.w, h: rect.h }
      }
    }
    _card.style.left = rect.x + 'px'
    _card.style.top = rect.y + 'px'
    _card.style.width = rect.w + 'px'
    _card.style.height = rect.h + 'px'
  }

  // ── 渲染 ──
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

  // 画布平移/缩放时同步卡片位置（严格跟随锚点；沉浸式不动）
  function syncCamera(camera) {
    if (!_state.open || _state.immersive || !camera) return
    const vw = _layer.clientWidth
    const vh = _layer.clientHeight
    const rect = calcCardRect(_state.anchor, camera, vw, vh)
    _card.style.left = rect.x + 'px'
    _card.style.top = rect.y + 'px'
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
    }
    _state = { open: false, path: '', name: '', kind: '', anchor: null, immersive: false, onFallback: null, camera: null, uri: null }
    if (_layer) {
      _layer.classList.remove('viewer-layer-open')
      _layer.setAttribute('aria-hidden', 'true')
    }
  }

  function open(opts) {
    opts = opts || {}
    ensureInit()
    if (!_layer) return false
    if (_state.open) close()
    _state = {
      open: false,
      path: opts.path || '',
      name: opts.name || '',
      kind: opts.kind || 'text',
      anchor: opts.anchor || null,
      immersive: !!opts.immersive,
      onFallback: typeof opts.onFallback === 'function' ? opts.onFallback : null,
      camera: opts.camera || null,   // 打开瞬间的相机快照（之后由宿主 syncCamera 驱动）
      uri: null
    }
    if (!_state.path) return false
    _title.textContent = _state.name
    positionCard()
    _state.open = true
    _layer.classList.add('viewer-layer-open')
    _layer.setAttribute('aria-hidden', 'false')
    renderContent()
    return true
  }

  return {
    open: open,
    close: close,
    isOpen: isOpen,
    syncCamera: syncCamera,
    calcCardRect: calcCardRect,
    immersiveRect: immersiveRect,
    visibleRatio: visibleRatio,
    jsonToNodes: jsonToNodes
  }
})()
