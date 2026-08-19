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
  const HANDLE_W = 36       // 拖动手柄屏幕宽度（px，固定屏幕尺寸不随画布缩放）
  const HANDLE_H = 6        // 拖动手柄屏幕高度（px）
  const HANDLE_GAP = 14     // 手柄距卡片底部间距（px，屏幕坐标）

  // 世界坐标 → 屏幕坐标的纯函数（固定屏幕尺寸手柄用：卡片底部中心下方悬浮）
  // 输入卡片世界 rect 与相机，返回手柄屏幕矩形（x/y = 屏幕 px，w/h = 屏幕 px）
  // rotation=90（画布顺时针转）时卡片视觉底部 = 原右边缘中心；vw/vh = 视口尺寸（旋转中心）
  function handleScreenRect(cardRect, camera, vw, vh) {
    if (!cardRect) return null
    const c = camera || create()
    const rot = c.rotation === 90
    // 旋转后卡片视觉底部中心 = 原右边缘中心（顺时针 90°：右→下）
    const cx = rot ? cardRect.x + cardRect.w : cardRect.x + cardRect.w / 2
    const bottom = rot ? cardRect.y + cardRect.h / 2 : cardRect.y + cardRect.h
    const sx0 = (cx - c.x) * c.zoom
    const sy0 = (bottom - c.y) * c.zoom
    let sx = sx0
    let sy = sy0
    if (rot && vw > 0 && vh > 0) {
      // 绕视口中心顺时针 90°：(x,y) → (-y, x)
      const ccx = vw / 2
      const ccy = vh / 2
      sx = -(sy0 - ccy) + ccx
      sy = (sx0 - ccx) + ccy
    }
    return { x: sx - HANDLE_W / 2, y: sy + HANDLE_GAP, w: HANDLE_W, h: HANDLE_H }
  }

  // 手柄世界矩形（命中测试用）：固定屏幕尺寸反算世界尺寸（/zoom），
  // 中心 = 卡片底部中心世界点，间距 = HANDLE_GAP/zoom（屏幕 14px 恒定）。
  // 命中测试走世界坐标（手势层 toWorld 后回调），与 handleScreenRect 是同一矩形
  // 的两种表示（worldToScreen 互逆），纯函数可单测。
  // rotation=90 时需要 vw/vh 计算旋转中心：先算屏幕矩形，再逆旋转回世界坐标；
  // 无 vw/vh 时退化为旧逻辑（rotation=0 或调用方未传视口尺寸的防御路径）。
  function handleWorldRect(cardRect, camera, vw, vh) {
    if (!cardRect) return null
    const c = camera || create()
    const z = c.zoom || 1
    const rot = c.rotation === 90
    if (rot && vw > 0 && vh > 0) {
      // 旋转态：先算屏幕矩形（含旋转），再逆变换回世界坐标
      const sr = handleScreenRect(cardRect, camera, vw, vh)
      if (!sr) return null
      const scx = sr.x + sr.w / 2
      const scy = sr.y + sr.h / 2
      const ccx = vw / 2, ccy = vh / 2
      // screenToWorld 逆旋转：lx = (sy-cy)+cx, ly = -(sx-cx)+cy
      const lx = (scy - ccy) + ccx
      const ly = -(scx - ccx) + ccy
      const wcx = c.x + lx / z
      const wcy = c.y + ly / z
      // 屏幕 36×6 → 世界 6/z × 36/z（逆旋转后宽高互换）
      return { x: wcx - HANDLE_H / (2 * z), y: wcy - HANDLE_W / (2 * z), w: HANDLE_H / z, h: HANDLE_W / z }
    }
    // rotation=0：原逻辑（无需视口尺寸）
    const gap = HANDLE_GAP / z
    const w = HANDLE_W / z
    const h = HANDLE_H / z
    const cx = cardRect.x + cardRect.w / 2
    const top = cardRect.y + cardRect.h + gap
    return { x: cx - w / 2, y: top, w: w, h: h }
  }

  // ── 三模块映射（kind → 模块语义）──
  const MODULE_OF = {
    text: 'text',
    markdown: 'parsed', json: 'parsed', html: 'parsed', website: 'parsed',
    image: 'media', video: 'media', audio: 'media', svg: 'media'
  }
  // Viewer 态用 3:4 竖版卡片的 kind（text/parsed 全部 + media 的音频）
  const PORTRAIT_KINDS = { text: true, markdown: true, json: true, html: true, audio: true }
  // Viewer 态锚点 = 视觉中心（相机中心世界坐标）的 kind（text/parsed；媒体保持文件位置）
  // website 不在 PORTRAIT_KINDS（用接近全屏的宽卡片 cardSize），但锚点取视觉中心（级联错位）
  const CENTER_KINDS = { text: true, markdown: true, json: true, html: true, website: true }

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
  let _lastCamera = null   // 最近一次同步手柄的相机（卡片移动/媒体自适应时复用）

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
  /** @type {((viewers: Array<ViewerRecord>) => void) | null} 持久化监听（Desktop 层注入，画布态变化时回调） */
  let _persistListener = null
  /** @type {((inst: any) => void) | null} 位置变化监听（Desktop 层注入：Viewer 拖动/自适应 → 同步锁定文件图标） */
  let _moveListener = null

  // ── 实例工厂：每个 Viewer 独立 DOM + 状态 + 拖动 ──
  function createInstance(opts) {
    const id = _nextId++
    const card = document.createElement('div')
    card.className = 'viewer-card'
    card.innerHTML =
      '<header class="viewer-header">' +
      '<button class="viewer-back-btn" aria-label="退出全屏">' +
      App.icons.get('chevronLeft', { width: 20, height: 20 }) +
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
    let handleEl = null    // 拖动手柄（屏幕层固定尺寸，随相机/卡片位置同步）
    let onMove = null      // 位置变化回调（Desktop 注入：Viewer 拖动/自适应 → 同步锁定文件图标）
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
      removeHandle()   // 关闭：移除拖动手柄（全屏/目录切换另有隐藏逻辑）
      if (_fullscreenId === id) {
        _fullscreenId = null
        _fsPage.classList.remove('viewer-fs-page-open', 'viewer-fs-media', 'viewer-fs-doc')
        _fsPage.setAttribute('aria-hidden', 'true')
        setFabHidden(false)
      }
      drag = null
      reader = { scale: 1, wrap: true }
      state = { open: false, mode: null, fsFrom: null, selected: false, path: '', name: '', kind: '', anchor: null, camera: null, onFallback: null, onClose: null, uri: null, rect: null, canvasRect: null, url: '', trusted: false }
      // 从管理器实例集合移除自己（exitFullscreen 的 from='folder' 分支也走这里，保证 isAnyOpen 正确）
      const i = indexOf(id)
      if (i >= 0) _instances.splice(i, 1)
      // 通知调用方：文件已关闭（用于桌面层解除锁定）
      if (typeof savedOnClose === 'function') savedOnClose(savedPath)
      _notifyPersist()
    }

    function detachCard() {
      if (card.parentNode) card.parentNode.removeChild(card)
    }

    // ── 拖动手柄（屏幕层固定尺寸，canvas 态显示、全屏/关闭移除）──
    function createHandle() {
      if (handleEl) return
      if (!_layer) return
      handleEl = document.createElement('div')
      handleEl.className = 'viewer-drag-handle'
      handleEl.setAttribute('aria-hidden', 'true')
      _layer.appendChild(handleEl)
    }

    function removeHandle() {
      if (handleEl) {
        if (handleEl.parentNode) handleEl.parentNode.removeChild(handleEl)
        handleEl = null
      }
    }

    // 同步手柄屏幕位置：卡片世界 rect 底部中心 → 屏幕坐标 + 固定间距。
    // 手柄固定屏幕尺寸（HANDLE_W/H），不随画布 zoom 缩放；相机变化由
    // 管理器 syncHandles(camera) 统一驱动（gesture onUpdate 每帧调用）。
    // vw/vh = viewer-layer 视口尺寸（rotation=90 时手柄屏幕位置需绕中心旋转）
    function syncHandle(camera) {
      if (!handleEl || state.mode !== 'canvas' || !state.rect) return
      const r = handleScreenRect(state.rect, camera, _layer.clientWidth, _layer.clientHeight)
      if (!r) return
      handleEl.style.left = r.x + 'px'
      handleEl.style.top = r.y + 'px'
      handleEl.style.width = r.w + 'px'
      handleEl.style.height = r.h + 'px'
      handleEl.classList.toggle('viewer-drag-handle-active', state.selected)
    }

    // 命中判定：世界点 (wx, wy) 是否落在本实例手柄矩形内（手柄优先于卡片本身命中）
    // vw/vh 透传：rotation=90 时 handleWorldRect 需要视口尺寸计算旋转中心
    function handleHitTest(wx, wy, camera) {
      if (!handleEl || state.mode !== 'canvas' || !state.rect) return false
      const r = handleWorldRect(state.rect, camera, _layer.clientWidth, _layer.clientHeight)
      if (!r) return false
      return wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.y + r.h
    }

    function isOpen() { return !!state.open }
    function getMode() { return state.mode }
    function isSelected() { return state.selected }
    function getPath() { return state.path }
    function getName() { return state.name }
    function getKind() { return state.kind }
    /** @returns {{x: number, y: number, w: number, h: number} | null} 世界坐标矩形（画布态持久化用） */
    function getRect() {
      return state.rect ? { x: state.rect.x, y: state.rect.y, w: state.rect.w, h: state.rect.h } : null
    }

    // 选中态更新：手柄高亮同步（选中时手柄 accent 色提示可拖）
    function setSelected(on) {
      state.selected = !!on
      if (on) card.classList.add('viewer-card-selected')
      else card.classList.remove('viewer-card-selected')
      if (handleEl) handleEl.classList.toggle('viewer-drag-handle-active', !!on)
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
        // 恢复场景：state.rect 已在 open() 预置，直接应用持久化矩形
        let rect = state.rect ? { x: state.rect.x, y: state.rect.y, w: state.rect.w, h: state.rect.h } : null
        if (!rect) {
          let anchor = state.anchor
          if (anchorIsCenter(state.kind)) {
            anchor = visualCenter(state.camera, vw, vh) || anchor
            if (anchor) anchor = { x: anchor.x + _cascade * CASCADE_STEP, y: anchor.y + _cascade * CASCADE_STEP }
          }
          rect = worldRect(anchor, size.w, size.h)
          if (!anchorIsCenter(state.kind) && visibleRatio(rect, vw, vh) < MIN_VISIBLE && state.camera) {
            const c = visualCenter(state.camera, vw, vh)
            if (c) rect = worldRect(c, size.w, size.h)
          }
        }
        applyCanvasRect(rect)
        backBtn.style.display = 'none'
        updateTools()
        card.className = canvasCardClass()
        if (_canvas) _canvas.appendChild(card)
        createHandle()   // canvas 态：显示拖动手柄（屏幕层固定尺寸）
        syncHandle(_lastCamera)
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
      syncHandleAfterMove()
    }

    // 卡片位置/尺寸变化后同步手柄（相机不变时也用最近一次相机）
    function syncHandleAfterMove() {
      if (handleEl && _lastCamera) syncHandle(_lastCamera)
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
        if (rect) {
          applyCanvasRect(rect)
          if (onMove) onMove(state.rect)   // 媒体自适应：图标锚定新窗口左上（双向锚定防分家）
          _notifyPersist()   // 媒体自适应改变尺寸：持久化最终矩形
        }
      }
      if (media.tagName === 'VIDEO') {
        media.addEventListener('loadedmetadata', onReady)
      } else {
        media.addEventListener('load', onReady)
      }
    }

    // canvas 态卡片 class：media 类（image/video/svg，按固有比例自适应）额外标记
    // viewer-card-media → CSS 中文件名栏 absolute 覆盖底部，不占位不改变媒体缩放比例
    function canvasCardClass() {
      let cls = 'viewer-card viewer-card-canvas'
      if (state.kind && MEDIA_KINDS[state.kind] && state.kind !== 'audio') cls += ' viewer-card-media'
      return cls
    }

    // ── 全屏相册式新页面 ──
    function enterFullscreenPage() {
      state.mode = 'fullscreen'
      state.rect = { x: 0, y: 0, w: _layer.clientWidth, h: _layer.clientHeight }
      detachCard()
      removeHandle()   // 全屏态：移除拖动手柄（返回 canvas 态时重建）
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
        card.className = canvasCardClass()
        backBtn.style.display = 'none'
        reader = { scale: 1, wrap: true }
        resetReaderStyle()
        updateTools()
        if (_canvas) _canvas.appendChild(card)
        applyCanvasRect(state.canvasRect || state.rect)
        createHandle()   // 回到 canvas 态：重建拖动手柄
        syncHandle(_lastCamera)
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
      if (onMove) onMove(state.rect)
    }

    function endDrag() {
      if (!drag) return
      drag = null
      card.classList.remove('viewer-card-dragging')
      _notifyPersist()   // 拖动结束：位置已变，持久化
    }

    function cancelDrag() {
      if (!drag) return
      applyCanvasRect(drag.startRect)
      syncHandleAfterMove()
      drag = null
      card.classList.remove('viewer-card-dragging')
      if (onMove) onMove(state.rect)
    }

    function isDragging() { return !!drag }

    // 图标拖动同步：Viewer 卡片左上角贴图标位置（锁定文件的图标是位置真相锚点）。
    // 不触发 onMove——图标 → Viewer 方向同步由调用方（手势层图标拖动）驱动，
    // 避免 图标→Viewer→图标 循环同步。
    /** @param {number} x @param {number} y @returns {boolean} */
    function setRectFromIcon(x, y) {
      if (!state.open || state.mode !== 'canvas' || !state.rect) return false
      applyCanvasRect({ x: x, y: y, w: state.rect.w, h: state.rect.h })
      return true
    }

    /** @param {((rect: {x: number, y: number, w: number, h: number}) => void) | null} fn */
    function _setOnMove(fn) {
      onMove = typeof fn === 'function' ? fn : null
    }

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
        case 'website':
          // 远程网址：iframe src 直连（非 srcdoc）。sandbox 分两档：
          //   - 未信任（默认）：sandbox 无 allow-same-origin（opaque origin，隔离顶层 Java 桥）
          //     但 localStorage/cookie 被拒 → 复杂 SPA 白屏/不可交互；file input 也被阻断
          //   - 信任（用户显式勾选）：完全移除 sandbox → iframe 恢复完整浏览器环境
          //     （localStorage/cookie/file chooser 均正常）。安全：第三方 https iframe 与
          //     顶层 file:// 跨域，同源策略天然隔离 Java 桥 FileBridge。
          // referrerpolicy 防 file:// 路径泄露。
          body.innerHTML = ''
          {
            const wframe = document.createElement('iframe')
            wframe.className = 'viewer-frame viewer-frame-web'
            if (state.trusted) {
              // 信任：移除 sandbox（file chooser 才能触发 onShowFileChooser）
            } else {
              wframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups allow-downloads allow-modals')
            }
            wframe.setAttribute('referrerpolicy', 'no-referrer')
            wframe.src = state.url
            // 仅捕获网络层失败（X-Frame-Options 拒绝会渲染错误页，不触发 error，需用户自行「用浏览器打开」）
            wframe.addEventListener('error', function () {
              showError('网页加载失败（网络错误或该网站禁止被嵌入）')
            })
            body.appendChild(wframe)
          }
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
            App.icons.get('music', { width: 56, height: 56, className: 'viewer-audio-icon' }) +
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
        url: opts.url || '',
        trusted: !!opts.trusted,
        anchor: opts.anchor || null,
        camera: opts.camera || null,
        onFallback: typeof opts.onFallback === 'function' ? opts.onFallback : null,
        onClose: typeof opts.onClose === 'function' ? opts.onClose : null,
        uri: null,
        rect: null,
        canvasRect: null
      }
      if (!state.path) return false
      // 恢复场景：直接使用持久化的世界矩形（跳过锚点推导/级联错位）
      if (state.mode === 'canvas' && opts.rect &&
          typeof opts.rect.x === 'number' && isFinite(opts.rect.x) &&
          typeof opts.rect.y === 'number' && isFinite(opts.rect.y) &&
          typeof opts.rect.w === 'number' && opts.rect.w > 0 &&
          typeof opts.rect.h === 'number' && opts.rect.h > 0) {
        state.rect = { x: opts.rect.x, y: opts.rect.y, w: opts.rect.w, h: opts.rect.h }
        state.canvasRect = { x: state.rect.x, y: state.rect.y, w: state.rect.w, h: state.rect.h }
      } else if (state.mode === 'canvas' && anchorIsCenter(state.kind)) {
        _cascade++
      }
      title.textContent = state.name
      card.className = canvasCardClass()
      mount()
      state.open = true
      renderContent()
      return true
    }

    // 手柄显示/隐藏（目录切换用；隐藏保留 DOM，显示恢复）
    function _hideHandle() {
      if (handleEl) handleEl.style.display = 'none'
    }
    function _showHandle() {
      if (handleEl) handleEl.style.display = ''
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
      setRectFromIcon: setRectFromIcon,
      _setOnMove: _setOnMove,
      getRect: getRect,
      hitTestWorld: hitTestWorld,
      rectHitWorld: rectHitWorld,
      handleHitTest: handleHitTest,
      syncHandle: syncHandle,
      handleScreenRect: handleScreenRect,
      handleWorldRect: handleWorldRect,
      _hideHandle: _hideHandle,
      _showHandle: _showHandle
    }
  }

  // ── 管理器 API ──
  // 打开新实例（不关闭已有），返回实例 id；失败返回 null
  function open(opts) {
    if (!opts || !opts.path) return null
    if (!ensureHosts()) return null
    const inst = createInstance(opts)
    if (_moveListener) inst._setOnMove(_moveListener)
    const ok = inst.open()
    if (!ok) return null
    _instances.push(inst)
    _notifyPersist()
    return inst.id
  }

  // 持久化：收集画布态实例（path/name/kind/世界矩形）回调监听器（Desktop 层注入 ViewerStore）
  /** @returns {void} */
  function _notifyPersist() {
    if (typeof _persistListener !== 'function') return
    /** @type {Array<ViewerRecord>} */
    const list = []
    _instances.forEach(function (inst) {
      if (!inst.isOpen() || inst.getMode() !== 'canvas') return
      const rect = inst.getRect()
      if (!rect) return
      list.push({ path: inst.getPath(), name: inst.getName(), kind: inst.getKind(), rect: rect })
    })
    _persistListener(list)
  }

  /** @param {((viewers: Array<ViewerRecord>) => void) | null} fn */
  function setPersistListener(fn) {
    _persistListener = typeof fn === 'function' ? fn : null
  }

  /** 位置变化监听（Desktop 层注入：Viewer 拖动/媒体自适应 → 同步锁定文件图标到窗口左上）。
   *  @param {((inst: any) => void) | null} fn */
  function setMoveListener(fn) {
    _moveListener = typeof fn === 'function' ? fn : null
  }

  // 图标拖动同步：把 path 对应 Viewer 卡片左上角贴到 (x, y)（图标位置 → 预览窗口位置）。
  // 命中 canvas 态实例且移动成功返回 true；无对应实例/非 canvas 态返回 false。
  /** @param {string} path @param {number} x @param {number} y @returns {boolean} */
  function syncRectForPath(path, x, y) {
    if (!path) return false
    for (let i = 0; i < _instances.length; i++) {
      const inst = _instances[i]
      if (inst.getPath && inst.getPath() === path) {
        if (inst.setRectFromIcon(x, y)) return true
      }
    }
    return false
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

  // 拖动手柄命中：世界坐标点 → 命中最上层手柄的实例；无命中返回 null
  // 手柄在屏幕层（不随画布 transform），命中用世界坐标（gesture onHitTest 回调世界点，
  // 手柄世界矩形由 handleWorldRect 按相机反算——与屏幕渲染是同一矩形两种表示）
  function handleAt(wx, wy, camera) {
    for (let i = _instances.length - 1; i >= 0; i--) {
      if (_instances[i].handleHitTest && _instances[i].handleHitTest(wx, wy, camera || _lastCamera)) return _instances[i]
    }
    return null
  }

  // 同步所有 canvas 态实例的拖动手柄（相机变化时由 gesture onUpdate 驱动）
  function syncHandles(camera) {
    _lastCamera = camera || _lastCamera
    _instances.forEach(function (inst) {
      if (inst.syncHandle) inst.syncHandle(_lastCamera)
    })
  }

  // 显示/隐藏所有手柄（目录切换 suspend/resume 配套）
  function showHandles() {
    _instances.forEach(function (inst) { if (inst._showHandle) inst._showHandle() })
    if (_lastCamera) syncHandles(_lastCamera)
  }
  function hideHandles() {
    _instances.forEach(function (inst) { if (inst._hideHandle) inst._hideHandle() })
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
        inst._hideHandle && inst._hideHandle()
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
        inst._showHandle && inst._showHandle()
        if (_lastCamera) inst.syncHandle(_lastCamera)
      }
    })
  }

  return {
    open: open,
    setPersistListener: setPersistListener,
    setMoveListener: setMoveListener,
    syncRectForPath: syncRectForPath,
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
    handleAt: handleAt,
    syncHandles: syncHandles,
    showHandles: showHandles,
    hideHandles: hideHandles,
    handleScreenRect: handleScreenRect,
    handleWorldRect: handleWorldRect,
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
