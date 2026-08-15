/* InternalViewer：通用文件查看器组件（三模块 × 两状态，多实例）。
 *   三模块（按文件语义分组，策略对象驱动，见 MODULES）：
 *     - text   纯文本（txt/log/csv…）：Viewer 态 3:4 竖版卡片 + 视觉中心展开；
 *              完整预览态 = reader（字号缩放 + 自动换行）。
 *     - parsed 文本解析渲染（md/json/html）：Viewer 态同 text（3:4 + 视觉中心）；
 *              完整预览态 = doc（成熟滚动渲染：md 排版 / json 折叠树 / html iframe）。
 *     - media  Web 友好媒体（图/视频/音频/svg）：Viewer 态图/视频/svg 按原始比例、
 *              音频 3:4 封面卡片；完整预览态 = 黑底 contain 全屏。
 *   两状态：
 *     1. Viewer 态（canvas，anchor 非 null，Desktop 空间）：画布实体——随画布
 *        transform 平移/缩放；点击选中（脆弱/临时）、拖动移动；手势照常作用于画布。
 *     2. 完整预览态（fullscreen，#viewer-fs-page 独立新页面）：相册式体验，
 *        返回键/页头返回退出回到原状态。
 *   多实例：open() 每次创建独立实例（各自 DOM/状态/拖动），互不干扰；
 *     同一时刻最多一个实例处于 fullscreen 态（#viewer-fs-page 为单例容器）。
 *     级联错位：视觉中心锚点类（text/parsed）每次打开右下偏移，自然错开。
 * 顶栏文件名 + 全屏态返回按钮；全屏入口在 Morph FAB（Viewer 选中时）。
 * 类型：text/markdown/json/html/svg/image/video/audio；媒体走 URI 流式。
 * HTML 安全：iframe srcdoc + sandbox="allow-scripts"（隔离 Java 桥）。
 * 依赖: namespace.js, file-api.js, markdown.js
 * 导出: App.InternalViewer（管理器 + 纯函数）
 */
'use strict'

App.InternalViewer = (function () {
  const VIEWPORT_EDGE = 16
  const TOP_GAP = 96
  const MIN_W = 200
  const MIN_H = 160
  const MIN_VISIBLE = 0.3
  const CASCADE_STEP = 24   // 级联错位步进（世界坐标，右下）

  // ── 三模块映射（kind → 模块语义）──
  const MODULE_OF = {
    text: 'text',
    markdown: 'parsed', json: 'parsed', html: 'parsed',
    image: 'media', video: 'media', audio: 'media', svg: 'media'
  }
  // Viewer 态用 3:4 竖版卡片的 kind（text/parsed 全部 + media 的音频）
  const PORTRAIT_KINDS = { text: true, markdown: true, json: true, html: true, audio: true }
  // Viewer 态锚点 = 视觉中心（相机中心世界坐标）的 kind（text/parsed；媒体保持文件位置）
  const CENTER_KINDS = { text: true, markdown: true, json: true, html: true }

  function moduleFor(kind) { return MODULE_OF[kind] || null }
  function cardIsPortrait(kind) { return !!PORTRAIT_KINDS[kind] }
  function anchorIsCenter(kind) { return !!CENTER_KINDS[kind] }

  // ── 纯函数 ──
  function worldRect(anchor, w, h) {
    return { x: anchor.x - w / 2, y: anchor.y - h / 2, w: w, h: h }
  }
  function cardSize(vw, vh) {
    return { w: Math.max(MIN_W, vw - VIEWPORT_EDGE * 2), h: Math.max(MIN_H, vh - TOP_GAP) }
  }
  // 3:4 竖版卡片尺寸（宽:高 = 3:4，约束在视口内，尽量大）
  function cardSize34(vw, vh) {
    const maxW = Math.max(MIN_W, vw - VIEWPORT_EDGE * 2)
    const maxH = Math.max(MIN_H, vh - TOP_GAP)
    const scale = Math.min(maxW / 3, maxH / 4)
    return { w: Math.max(MIN_W, Math.round(3 * scale)), h: Math.max(MIN_H, Math.round(4 * scale)) }
  }
  // 相机视觉中心（屏幕中心）对应的世界坐标；相机缺失 → null
  function visualCenter(camera, vw, vh) {
    if (!camera || !camera.zoom) return null
    return { x: camera.x + vw / (2 * camera.zoom), y: camera.y + vh / (2 * camera.zoom) }
  }
  function visibleRatio(rect, vw, vh) {
    const ix = Math.max(0, Math.min(rect.x + rect.w, vw) - Math.max(rect.x, 0))
    const iy = Math.max(0, Math.min(rect.y + rect.h, vh) - Math.max(rect.y, 0))
    return (ix * iy) / (rect.w * rect.h)
  }
  function shiftRect(rect, dx, dy) {
    return { x: rect.x + dx, y: rect.y + dy, w: rect.w, h: rect.h }
  }
  // 按固有宽高比计算实体矩形（约束在视口内，保持中心点不变；输入固有尺寸无效时返回 null）
  function fitAspectRect(rect, natW, natH, vw, vh) {
    if (!(natW > 0) || !(natH > 0) || !rect) return null
    const maxW = Math.max(MIN_W, vw - VIEWPORT_EDGE * 2)
    const maxH = Math.max(MIN_H, vh - TOP_GAP)
    const scale = Math.min(1, maxW / natW, maxH / natH)
    const w = Math.max(MIN_W, Math.round(natW * scale))
    const h = Math.max(MIN_H, Math.round(natH * scale))
    return {
      x: rect.x + (rect.w - w) / 2,
      y: rect.y + (rect.h - h) / 2,
      w: w,
      h: h
    }
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

  // 媒体类 kind（自适应比例）
  const MEDIA_KINDS = { image: true, video: true, audio: true, svg: true }

  // ── 共享宿主 DOM（所有实例共用，懒初始化一次）──
  let _layer = null
  let _fsPage = null
  let _canvas = null
  let _hostsReady = false

  function ensureHosts() {
    if (_hostsReady) return true
    _layer = document.getElementById('viewer-layer')
    _fsPage = document.getElementById('viewer-fs-page')
    _canvas = document.getElementById('desktop-canvas')
    ;[_layer, _fsPage].forEach(function (host) {
      if (!host) return
      ;['touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach(function (type) {
        host.addEventListener(type, function (e) { e.stopPropagation() }, true)
      })
    })
    _hostsReady = true
    return !!_layer && !!_fsPage && !!_canvas
  }

  function setFabHidden(hidden) {
    const fab = document.getElementById('mode-switch-fab')
    if (!fab) return
    if (hidden) fab.classList.add('fab-hidden')
    else fab.classList.remove('fab-hidden')
  }

  // ── 实例集合 ──
  const _instances = []   // 实例对象（打开顺序）
  let _nextId = 1
  let _cascade = 0        // 级联错位计数（视觉中心锚点类）
  let _fullscreenId = null  // 当前全屏实例 id（同时最多一个）

  // ── 实例工厂：每个 Viewer 独立 DOM + 状态 + 拖动 ──
  function createInstance(opts) {
    const id = _nextId++
    const card = document.createElement('div')
    card.className = 'viewer-card'
    card.innerHTML =
      '<header class="viewer-header">' +
      '<button class="viewer-back-btn" aria-label="退出全屏">' +
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>' +
      '</button>' +
      '<span class="viewer-title"></span>' +
      '<div class="viewer-tools"></div>' +
      '</header>' +
      '<div class="viewer-body"></div>'
    const title = card.querySelector('.viewer-title')
    const body = card.querySelector('.viewer-body')
    const backBtn = card.querySelector('.viewer-back-btn')
    const tools = card.querySelector('.viewer-tools')

    let drag = null
    let reader = { scale: 1, wrap: true }   // 文本完整预览态：字号缩放 + 自动换行
    let state = {
      open: false, mode: null, fsFrom: null, selected: false,
      path: '', name: '', kind: '', anchor: null, camera: null, onFallback: null, onClose: null,
      uri: null, rect: null, canvasRect: null
    }

    // ── 关闭本实例（不触碰其他实例）──
    function close() {
      if (!state.open) { detachCard(); return }
      const savedPath = state.path
      const savedOnClose = state.onClose
      const v = card.querySelector('video')
      if (v) { try { v.pause() } catch (e) { /* 忽略 */ } }
      const a = card.querySelector('audio')
      if (a) { try { a.pause() } catch (e) { /* 忽略 */ } }
      const frame = card.querySelector('iframe')
      if (frame) {
        try { frame.removeAttribute('srcdoc'); frame.removeAttribute('src') } catch (e) { /* 忽略 */ }
      }
      body.innerHTML = ''
      detachCard()
      if (_fullscreenId === id) {
        _fullscreenId = null
        _fsPage.classList.remove('viewer-fs-page-open', 'viewer-fs-media', 'viewer-fs-doc')
        _fsPage.setAttribute('aria-hidden', 'true')
        setFabHidden(false)
      }
      drag = null
      reader = { scale: 1, wrap: true }
      state = { open: false, mode: null, fsFrom: null, selected: false, path: '', name: '', kind: '', anchor: null, camera: null, onFallback: null, onClose: null, uri: null, rect: null, canvasRect: null }
      // 从管理器实例集合移除自己（exitFullscreen 的 from='folder' 分支也走这里，保证 isAnyOpen 正确）
      const i = indexOf(id)
      if (i >= 0) _instances.splice(i, 1)
      // 通知调用方：文件已关闭（用于桌面层解除锁定）
      if (typeof savedOnClose === 'function') savedOnClose(savedPath)
    }

    function detachCard() {
      if (card.parentNode) card.parentNode.removeChild(card)
    }

    function isOpen() { return !!state.open }
    function getMode() { return state.mode }
    function isSelected() { return state.selected }
    function getPath() { return state.path }
    function getName() { return state.name }
    function getKind() { return state.kind }

    function setSelected(on) {
      state.selected = !!on
      if (on) card.classList.add('viewer-card-selected')
      else card.classList.remove('viewer-card-selected')
    }

    function setLoading() {
      body.innerHTML = '<div class="viewer-loading">加载中…</div>'
    }

    function showError(msg) {
      let html = '<div class="viewer-error">' + App.Markdown.escapeHtml(msg || '无法预览该文件') + '</div>'
      if (typeof state.onFallback === 'function') {
        html += '<div class="viewer-error-actions"><button class="viewer-fallback-btn">用其他应用打开</button></div>'
      }
      body.innerHTML = html
      const btn = body.querySelector('.viewer-fallback-btn')
      if (btn) btn.addEventListener('click', function () { state.onFallback() })
    }

    // ── 挂载 ──
    function mount() {
      const vw = _layer.clientWidth
      const vh = _layer.clientHeight
      if (state.mode === 'canvas') {
        const size = cardIsPortrait(state.kind) ? cardSize34(vw, vh) : cardSize(vw, vh)
        let anchor = state.anchor
        if (anchorIsCenter(state.kind)) {
          anchor = visualCenter(state.camera, vw, vh) || anchor
          if (anchor) anchor = { x: anchor.x + _cascade * CASCADE_STEP, y: anchor.y + _cascade * CASCADE_STEP }
        }
        let rect = worldRect(anchor, size.w, size.h)
        if (!anchorIsCenter(state.kind) && visibleRatio(rect, vw, vh) < MIN_VISIBLE && state.camera) {
          const c = visualCenter(state.camera, vw, vh)
          if (c) rect = worldRect(c, size.w, size.h)
        }
        applyCanvasRect(rect)
        backBtn.style.display = 'none'
        updateTools()
        card.className = 'viewer-card viewer-card-canvas'
        if (_canvas) _canvas.appendChild(card)
        // 打开不选中：选中态由点击/框选触发（与文件图标一致的脆弱选中），打开动作不触发选中
      } else {
        enterFullscreenPage()
      }
    }

    function applyCanvasRect(rect) {
      state.rect = rect
      state.canvasRect = { x: rect.x, y: rect.y, w: rect.w, h: rect.h }
      card.style.left = rect.x + 'px'
      card.style.top = rect.y + 'px'
      card.style.width = rect.w + 'px'
      card.style.height = rect.h + 'px'
    }

    // 媒体自适应：按固有宽高比调整实体尺寸（中心点不变）
    function fitCanvasToMedia() {
      if (state.mode !== 'canvas') return
      const media = body.querySelector('img, video')
      if (!media) return
      const onReady = function () {
        if (state.mode !== 'canvas') return
        const natW = media.naturalWidth || media.videoWidth || 0
        const natH = media.naturalHeight || media.videoHeight || 0
        if (!(natW > 0) || !(natH > 0)) return
        const rect = fitAspectRect(state.rect, natW, natH, _layer.clientWidth, _layer.clientHeight)
        if (rect) applyCanvasRect(rect)
      }
      if (media.tagName === 'VIDEO') {
        media.addEventListener('loadedmetadata', onReady)
      } else {
        media.addEventListener('load', onReady)
      }
    }

    // ── 全屏相册式新页面 ──
    function enterFullscreenPage() {
      state.mode = 'fullscreen'
      state.rect = { x: 0, y: 0, w: _layer.clientWidth, h: _layer.clientHeight }
      detachCard()
      card.style.left = ''
      card.style.top = ''
      card.style.width = ''
      card.style.height = ''
      card.className = 'viewer-card viewer-card-fullscreen'
      setSelected(false)
      backBtn.style.display = ''
      updateTools()
      _fullscreenId = id
      _fsPage.classList.remove('viewer-fs-media', 'viewer-fs-doc')
      _fsPage.classList.add(MEDIA_KINDS[state.kind] ? 'viewer-fs-media' : 'viewer-fs-doc')
      _fsPage.appendChild(card)
      _fsPage.classList.add('viewer-fs-page-open')
      _fsPage.setAttribute('aria-hidden', 'false')
      setFabHidden(true)
      try { history.pushState({ _viewerFs: true }, '') } catch (e) { /* 降级 */ }
    }

    function exitFullscreen() {
      if (!state.open || state.mode !== 'fullscreen') return false
      const from = state.fsFrom
      detachCard()
      setFabHidden(false)
      _fullscreenId = null
      _fsPage.classList.remove('viewer-fs-page-open')
      _fsPage.setAttribute('aria-hidden', 'true')
      if (from === 'canvas') {
        state.mode = 'canvas'
        card.className = 'viewer-card viewer-card-canvas'
        backBtn.style.display = 'none'
        reader = { scale: 1, wrap: true }
        resetReaderStyle()
        updateTools()
        if (_canvas) _canvas.appendChild(card)
        applyCanvasRect(state.canvasRect || state.rect)
        setSelected(state.selected)
      } else {
        close()
      }
      return true
    }

    // 顶栏「全屏预览」入口已收纳至 Morph FAB；此 API 供 FAB 调用
    function toFullscreen() {
      if (!state.open || state.mode !== 'canvas' || !_fsPage) return false
      state.fsFrom = 'canvas'
      enterFullscreenPage()
      return true
    }

    // ── 画布实体拖动 ──
    function beginDrag(world) {
      if (!state.open || state.mode !== 'canvas' || !state.rect) return false
      drag = {
        startWorld: { x: world.x, y: world.y },
        startRect: { x: state.rect.x, y: state.rect.y, w: state.rect.w, h: state.rect.h }
      }
      card.classList.add('viewer-card-dragging')
      return true
    }

    function moveBy(world) {
      if (!drag) return
      const dx = world.x - drag.startWorld.x
      const dy = world.y - drag.startWorld.y
      applyCanvasRect(shiftRect(drag.startRect, dx, dy))
    }

    function endDrag() {
      if (!drag) return
      drag = null
      card.classList.remove('viewer-card-dragging')
    }

    function cancelDrag() {
      if (!drag) return
      applyCanvasRect(drag.startRect)
      drag = null
      card.classList.remove('viewer-card-dragging')
    }

    function isDragging() { return !!drag }

    function hitTestWorld(wx, wy) {
      if (!state.open || state.mode !== 'canvas' || !state.rect) return false
      const r = state.rect
      return wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.y + r.h
    }

    // 矩形命中（AABB 相交，含边缘相切）：框选结束判断是否选中 Viewer 用
    function rectHitWorld(rect) {
      if (!state.open || state.mode !== 'canvas' || !state.rect || !rect) return false
      const r = state.rect
      return !(r.x + r.w < rect.x || rect.x + rect.w < r.x || r.y + r.h < rect.y || rect.y + rect.h < r.y)
    }

    // ── 文本 reader 工具条（完整预览态：字号缩放 + 自动换行）──
    function renderReaderTools() {
      if (state.kind !== 'text' || state.mode !== 'fullscreen') {
        tools.innerHTML = ''
        return
      }
      tools.innerHTML =
        '<button class="viewer-tool" data-act="zoom-out" aria-label="缩小字号">A−</button>' +
        '<button class="viewer-tool" data-act="zoom-in" aria-label="放大字号">A+</button>' +
        '<button class="viewer-tool viewer-tool-wrap" data-act="wrap" aria-label="自动换行">换行</button>'
      const btns = tools.querySelectorAll('.viewer-tool')
      for (let i = 0; i < btns.length; i++) {
        btns[i].addEventListener('click', function () {
          const act = this.getAttribute('data-act')
          if (act === 'zoom-out') reader.scale = Math.max(0.8, reader.scale - 0.2)
          else if (act === 'zoom-in') reader.scale = Math.min(2.0, reader.scale + 0.2)
          else if (act === 'wrap') reader.wrap = !reader.wrap
          applyReaderStyle()
        })
      }
    }

    function applyReaderStyle() {
      const pre = body.querySelector('.viewer-pre')
      if (!pre) return
      pre.style.fontSize = Math.round(13 * reader.scale) + 'px'
      pre.style.whiteSpace = reader.wrap ? 'pre-wrap' : 'pre'
      const wrapBtn = tools.querySelector('.viewer-tool-wrap')
      if (wrapBtn) wrapBtn.classList.toggle('viewer-tool-on', reader.wrap)
    }

    function resetReaderStyle() {
      const pre = body.querySelector('.viewer-pre')
      if (pre) { pre.style.fontSize = ''; pre.style.whiteSpace = '' }
    }

    function updateTools() {
      if (state.kind === 'text' && state.mode === 'fullscreen') renderReaderTools()
      else tools.innerHTML = ''
    }

    // ── 渲染 ──
    function renderContent() {
      setLoading()
      const p = state.path
      switch (state.kind) {
        case 'text':
          App.FileAPI.read(p).then(function (content) {
            body.innerHTML = '<pre class="viewer-pre">' + App.Markdown.escapeHtml(content) + '</pre>'
            if (state.mode === 'fullscreen') applyReaderStyle()
          }).catch(function (err) { showError(err && err.message || '读取失败') })
          break
        case 'markdown':
          App.FileAPI.read(p).then(function (content) {
            body.innerHTML = '<div class="viewer-md">' + App.Markdown.render(content) + '</div>'
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
            body.innerHTML = ''
            buildTreeDom(root, body)
          }).catch(function (err) { showError(err && err.message || '读取失败') })
          break
        case 'html':
          Promise.all([
            App.FileAPI.read(p),
            App.FileAPI.resolveUri(p).catch(function () { return '' })
          ]).then(function (r) {
            const content = r[0]
            const uri = r[1]
            const baseHref = dirHref(uri, state.name)
            body.innerHTML = ''
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
            body.appendChild(iframe)
          }).catch(function (err) { showError(err && err.message || '读取失败') })
          break
        case 'svg':
          App.FileAPI.read(p).then(function (content) {
            body.innerHTML = ''
            const img = document.createElement('img')
            img.className = 'viewer-media-img'
            img.alt = state.name
            img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(content)
            img.addEventListener('error', function () { showError('SVG 渲染失败') })
            body.appendChild(img)
            fitCanvasToMedia()
          }).catch(function (err) { showError(err && err.message || '读取失败') })
          break
        case 'image':
          mountMedia('img', 'viewer-media-img')
          break
        case 'video':
          mountMedia('video', 'viewer-media-video')
          break
        case 'audio':
          mountAudio()
          break
        default:
          showError('不支持的查看类型: ' + state.kind)
      }
    }

    function mountMedia(tag, cls) {
      App.FileAPI.resolveUri(state.path).then(function (uri) {
        state.uri = uri
        body.innerHTML = ''
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
        body.appendChild(el)
        fitCanvasToMedia()
      }).catch(function (err) {
        showError(err && err.message || '无法解析文件 URI')
      })
    }

    // 音频：3:4 封面卡片（占位封面 + 原生播放控制，进度由 <audio controls> 自带）
    function mountAudio() {
      App.FileAPI.resolveUri(state.path).then(function (uri) {
        state.uri = uri
        body.innerHTML = ''
        const wrap = document.createElement('div')
        wrap.className = 'viewer-audio'
        wrap.innerHTML =
          '<div class="viewer-audio-cover">' +
            '<svg class="viewer-audio-icon" width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
              '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>' +
            '</svg>' +
            '<div class="viewer-audio-name">' + App.Markdown.escapeHtml(state.name) + '</div>' +
          '</div>'
        const audio = document.createElement('audio')
        audio.className = 'viewer-audio-controls'
        audio.controls = true
        audio.preload = 'metadata'
        audio.src = uri
        audio.addEventListener('error', function () {
          showError('无法加载媒体（当前内核可能不支持该格式）')
        })
        wrap.appendChild(audio)
        body.appendChild(wrap)
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

    // ── 打开本实例 ──
    function open() {
      const hasAnchor = !!opts.anchor
      state = {
        open: false,
        mode: hasAnchor ? 'canvas' : 'fullscreen',
        fsFrom: hasAnchor ? null : 'folder',
        selected: false,
        path: opts.path || '',
        name: opts.name || '',
        kind: opts.kind || 'text',
        anchor: opts.anchor || null,
        camera: opts.camera || null,
        onFallback: typeof opts.onFallback === 'function' ? opts.onFallback : null,
        onClose: typeof opts.onClose === 'function' ? opts.onClose : null,
        uri: null,
        rect: null,
        canvasRect: null
      }
      if (!state.path) return false
      if (state.mode === 'canvas' && anchorIsCenter(state.kind)) _cascade++
      title.textContent = state.name
      card.className = 'viewer-card viewer-card-canvas'
      mount()
      state.open = true
      renderContent()
      return true
    }

    return {
      id: id,
      _card: card,
      open: open,
      close: close,
      isOpen: isOpen,
      getMode: getMode,
      getPath: getPath,
      getName: getName,
      getKind: getKind,
      isSelected: isSelected,
      setSelected: setSelected,
      toFullscreen: toFullscreen,
      exitFullscreen: exitFullscreen,
      beginDrag: beginDrag,
      moveBy: moveBy,
      endDrag: endDrag,
      cancelDrag: cancelDrag,
      isDragging: isDragging,
      hitTestWorld: hitTestWorld,
      rectHitWorld: rectHitWorld
    }
  }

  // ── 管理器 API ──
  // 打开新实例（不关闭已有），返回实例 id；失败返回 null
  function open(opts) {
    if (!opts || !opts.path) return null
    if (!ensureHosts()) return null
    const inst = createInstance(opts)
    const ok = inst.open()
    if (!ok) return null
    _instances.push(inst)
    return inst.id
  }

  // 关闭指定实例（实例 close 内部会从集合移除自己）
  function closeById(id) {
    const i = indexOf(id)
    if (i < 0) return false
    _instances[i].close()
    return true
  }

  function closeAll() {
    _instances.slice().forEach(function (inst) { inst.close() })
    _instances.length = 0
    _fullscreenId = null
    if (_fsPage) {
      _fsPage.classList.remove('viewer-fs-page-open', 'viewer-fs-media', 'viewer-fs-doc')
      _fsPage.setAttribute('aria-hidden', 'true')
    }
    setFabHidden(false)
  }

  function indexOf(id) {
    for (let i = 0; i < _instances.length; i++) {
      if (_instances[i].id === id) return i
    }
    return -1
  }

  function getById(id) {
    const i = indexOf(id)
    return i >= 0 ? _instances[i] : null
  }

  function list() { return _instances.slice() }
  function count() { return _instances.length }
  function isAnyOpen() { return _instances.length > 0 }
  function hasFullscreen() { return _fullscreenId !== null }
  function fullscreenInstance() { return _fullscreenId !== null ? getById(_fullscreenId) : null }

  // 命中最上层 canvas 态实例（后打开的在 DOM 上层，逆序遍历）；无命中返回 null
  function topmostAt(wx, wy) {
    for (let i = _instances.length - 1; i >= 0; i--) {
      if (_instances[i].hitTestWorld(wx, wy)) return _instances[i]
    }
    return null
  }

  // 框选命中最上层 canvas 态实例；无命中返回 null
  function rectHit(rect) {
    for (let i = _instances.length - 1; i >= 0; i--) {
      if (_instances[i].rectHitWorld(rect)) return _instances[i]
    }
    return null
  }

  // 任一实例选中（供 FAB / 返回键判断）
  function anySelected() {
    for (let i = 0; i < _instances.length; i++) {
      if (_instances[i].isSelected()) return true
    }
    return false
  }

  // 选中的实例（单选语义：最多一个；返回 null 若无）
  function selectedInstance() {
    for (let i = 0; i < _instances.length; i++) {
      if (_instances[i].isSelected()) return _instances[i]
    }
    return null
  }

  // 正在拖动的实例（同时最多一个）；无则 null
  function draggingInstance() {
    for (let i = 0; i < _instances.length; i++) {
      if (_instances[i].isDragging()) return _instances[i]
    }
    return null
  }

  // 单选：选中指定实例，其余取消
  function selectOnly(id) {
    _instances.forEach(function (inst) {
      inst.setSelected(inst.id === id)
    })
  }

  // 取消所有实例选中
  function deselectAll() {
    _instances.forEach(function (inst) { inst.setSelected(false) })
  }

  // 目录切换时：隐藏所有 canvas 态实例（保留状态，退回根目录恢复）；全屏态不处理（由调用方先退出）
  function suspendCanvas() {
    _instances.forEach(function (inst) {
      if (inst.isOpen() && inst.getMode() === 'canvas') {
        const c = inst._card
        if (c && c.parentNode) c.parentNode.removeChild(c)
      }
    })
  }

  // 恢复所有 canvas 态实例到画布（目录切回根目录时）
  function resumeCanvas() {
    if (!_canvas) return
    _instances.forEach(function (inst) {
      if (inst.isOpen() && inst.getMode() === 'canvas') {
        const c = inst._card
        if (c && !c.parentNode) _canvas.appendChild(c)
      }
    })
  }

  return {
    open: open,
    closeById: closeById,
    closeAll: closeAll,
    getById: getById,
    list: list,
    count: count,
    isAnyOpen: isAnyOpen,
    hasFullscreen: hasFullscreen,
    fullscreenInstance: fullscreenInstance,
    topmostAt: topmostAt,
    rectHit: rectHit,
    anySelected: anySelected,
    selectedInstance: selectedInstance,
    draggingInstance: draggingInstance,
    selectOnly: selectOnly,
    deselectAll: deselectAll,
    suspendCanvas: suspendCanvas,
    resumeCanvas: resumeCanvas,
    worldRect: worldRect,
    cardSize: cardSize,
    cardSize34: cardSize34,
    visualCenter: visualCenter,
    moduleFor: moduleFor,
    cardIsPortrait: cardIsPortrait,
    anchorIsCenter: anchorIsCenter,
    visibleRatio: visibleRatio,
    shiftRect: shiftRect,
    fitAspectRect: fitAspectRect,
    jsonToNodes: jsonToNodes
  }
})()
