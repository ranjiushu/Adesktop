/* 桌面手势模块：viewport 上的 touch 三件套 → 手势识别。
 * 阶段 A：双指 panzoom（平移 + 缩放并行，不做二选一）。
 * 单指 tap/框选/长按拿起留待阶段 B 扩展（状态机已预留 single/dead 路径）。
 * 关键：指数突变处理——1→2 取消单指意图；2→1 剩指进 dead 直到抬起，
 *       绝不误触发 tap/框选（这是触摸手势最易出 bug 的地方）。
 * 依赖: namespace.js, desktop-camera.js
 * 导出: App.DesktopGesture（纯函数供单元测试）
 */
'use strict'

App.DesktopGesture = (function () {
  const CAM = App.DesktopCamera

  // ── 纯函数：两指距离 ──
  function distance(a, b) {
    const dx = a.x - b.x
    const dy = a.y - b.y
    return Math.sqrt(dx * dx + dy * dy)
  }

  // ── 纯函数：触点质心（空集返回 null）──
  function centroid(contacts) {
    let n = 0
    let sx = 0
    let sy = 0
    contacts.forEach(function (c) { n++; sx += c.x; sy += c.y })
    return n ? { x: sx / n, y: sy / n } : null
  }

  // ── 纯函数：触点数量 → 手势模式（指数突变的唯一权威）──
  function modeAfter(count, prevMode) {
    if (prevMode === 'dead') return count === 0 ? 'idle' : 'dead'
    if (count >= 2) return 'double'
    if (count === 1) return prevMode === 'double' ? 'dead' : 'single'
    return 'idle'
  }

  // ── 纯函数：双指一帧的相机更新（先平移质心位移，再按指距缩放，锚点=当前质心）──
  function panZoomStep(camera, prevCentroid, curCentroid, prevDist, curDist) {
    let cam = CAM.panBy(camera, curCentroid.x - prevCentroid.x, curCentroid.y - prevCentroid.y)
    cam = CAM.pinchBy(cam, prevDist, curDist, curCentroid.x, curCentroid.y)
    return cam
  }

  // ══ 单指手势状态机（阶段 B）：pending → tap / marquee / pickedup → dragmove ══
  // 判定规则（先到先得）：位移先超阈值 → 框选；停留先超长按时长 → 拿起；快速抬起 → tap。
  const TAP_THRESHOLD = 6      // px，tap/拖拽判定阈值
  const LONGPRESS_MS = 500     // ms，长按拿起触发时长

  function createSingle() {
    return { phase: 'idle', startX: 0, startY: 0, startT: 0, lastX: 0, lastY: 0 }
  }

  function _threshold(opts) {
    return (opts && typeof opts.tapThreshold === 'number') ? opts.tapThreshold : TAP_THRESHOLD
  }

  // down：进入 pending，记录起点
  function singleDown(x, y, t) {
    return { phase: 'pending', startX: x, startY: y, startT: t, lastX: x, lastY: y }
  }

  // move：按 phase 与位移分派（返回新状态 + 语义效果）
  function singleMove(sg, x, y, opts) {
    const th = _threshold(opts)
    const next = { phase: sg.phase, startX: sg.startX, startY: sg.startY, startT: sg.startT, lastX: x, lastY: y }
    if (sg.phase === 'pending') {
      const d = distance({ x: sg.startX, y: sg.startY }, { x: x, y: y })
      if (d > th) {
        return { sg: Object.assign({}, next, { phase: 'marquee' }), effect: { type: 'marquee-start', x: sg.startX, y: sg.startY } }
      }
      return { sg: next, effect: { type: 'none' } }
    }
    if (sg.phase === 'marquee') {
      return { sg: next, effect: { type: 'marquee-live', startX: sg.startX, startY: sg.startY, x: x, y: y } }
    }
    if (sg.phase === 'pickedup' || sg.phase === 'dragmove') {
      return { sg: Object.assign({}, next, { phase: 'dragmove' }), effect: { type: 'drag', x: x, y: y } }
    }
    return { sg: sg, effect: { type: 'none' } }
  }

  // 长按触发（DOM 层 setTimeout 调用）：仅 pending 且位移未超阈值时进入拿起
  function singleLongPress(sg, opts) {
    const th = _threshold(opts)
    if (sg.phase !== 'pending') return { sg: sg, effect: { type: 'none' } }
    const d = distance({ x: sg.startX, y: sg.startY }, { x: sg.lastX, y: sg.lastY })
    if (d > th) return { sg: sg, effect: { type: 'none' } }
    return { sg: Object.assign({}, sg, { phase: 'pickedup' }), effect: { type: 'longpress', x: sg.startX, y: sg.startY } }
  }

  // up：按 phase 收尾（tap / 框选结束 / 放下）
  function singleUp(sg, x, y, opts) {
    const th = _threshold(opts)
    if (sg.phase === 'pending') {
      const d = distance({ x: sg.startX, y: sg.startY }, { x: x, y: y })
      if (d <= th) {
        return { sg: createSingle(), effect: { type: 'tap', x: x, y: y } }
      }
      return { sg: createSingle(), effect: { type: 'marquee-end', startX: sg.startX, startY: sg.startY, x: x, y: y } }
    }
    if (sg.phase === 'marquee') {
      return { sg: createSingle(), effect: { type: 'marquee-end', startX: sg.startX, startY: sg.startY, x: x, y: y } }
    }
    if (sg.phase === 'pickedup') {
      return { sg: createSingle(), effect: { type: 'drop', x: x, y: y, moved: false } }
    }
    if (sg.phase === 'dragmove') {
      return { sg: createSingle(), effect: { type: 'drop', x: x, y: y, moved: true } }
    }
    return { sg: createSingle(), effect: { type: 'none' } }
  }

  // ── DOM 绑定层 ──
  let _viewport = null
  let _canvas = null
  let _camera = null
  let _onUpdate = null
  let _contacts = null   // Map<id, {x,y,t}>（viewport 局部坐标）
  let _mode = 'idle'
  let _prevCentroid = null
  let _prevDist = 0
  let _rect = null       // 缓存的 viewport 边界（缩放平移中 viewport 本身不动）
  let _single = null     // 单指手势状态（createSingle）
  let _longPressTimer = null
  let _cb = null         // 语义事件回调集合
  let _opts = null       // 阈值配置 {tapThreshold, longPressMs}

  function toLocal(t) {
    if (!_rect) _rect = _viewport.getBoundingClientRect()
    return { x: t.clientX - _rect.left, y: t.clientY - _rect.top, t: Date.now() }
  }

  function toWorld(x, y) {
    return CAM.screenToWorld(x, y, _camera)
  }

  function firstTwo() {
    const arr = []
    _contacts.forEach(function (c) { arr.push(c) })
    return arr.slice(0, 2)
  }

  function firstContact() {
    let c = null
    _contacts.forEach(function (v) { if (!c) c = v })
    return c
  }

  function commit() {
    CAM.applyTo(_camera, _canvas)
    if (_onUpdate) _onUpdate(_camera)
  }

  function syncMode() {
    _mode = modeAfter(_contacts.size, _mode)
    if (_mode === 'double') {
      const two = firstTwo()
      _prevDist = distance(two[0], two[1])
      _prevCentroid = centroid(_contacts)
    }
  }

  // ── 语义事件分发：屏幕局部坐标 → 世界坐标 → 回调 ──
  function handleEffect(effect) {
    if (!effect || effect.type === 'none' || !_cb) return
    switch (effect.type) {
      case 'tap':
        if (_cb.onTap) _cb.onTap(toWorld(effect.x, effect.y))
        break
      case 'marquee-start':
        if (_cb.onMarqueeStart) _cb.onMarqueeStart(toWorld(effect.x, effect.y))
        break
      case 'marquee-live':
        if (_cb.onMarqueeLive) _cb.onMarqueeLive(toWorld(effect.startX, effect.startY), toWorld(effect.x, effect.y))
        break
      case 'marquee-end':
        if (_cb.onMarqueeEnd) _cb.onMarqueeEnd(toWorld(effect.startX, effect.startY), toWorld(effect.x, effect.y))
        break
      case 'longpress':
        if (_cb.onLongPress) _cb.onLongPress(toWorld(effect.x, effect.y))
        break
      case 'drag':
        if (_cb.onDrag) _cb.onDrag(toWorld(effect.x, effect.y))
        break
      case 'drop':
        if (_cb.onDrop) _cb.onDrop(toWorld(effect.x, effect.y), !!effect.moved)
        break
    }
  }

  function startLongPressTimer() {
    cancelLongPressTimer()
    const ms = (_opts && typeof _opts.longPressMs === 'number') ? _opts.longPressMs : LONGPRESS_MS
    _longPressTimer = setTimeout(function () {
      _longPressTimer = null
      if (_mode !== 'single') return
      const r = singleLongPress(_single, _opts)
      _single = r.sg
      handleEffect(r.effect)
    }, ms)
  }

  function cancelLongPressTimer() {
    if (_longPressTimer) {
      clearTimeout(_longPressTimer)
      _longPressTimer = null
    }
  }

  function onStart(e) {
    if (!_rect) _rect = _viewport.getBoundingClientRect()
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i]
      _contacts.set(t.identifier, toLocal(t))
    }
    syncMode()
    if (_mode === 'single') {
      const c = firstContact()
      _single = singleDown(c.x, c.y, c.t)
      startLongPressTimer()
    } else if (_mode === 'double') {
      cancelLongPressTimer()
      _single = createSingle()
    }
  }

  function onMove(e) {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i]
      if (_contacts.has(t.identifier)) {
        _contacts.set(t.identifier, toLocal(t))
      }
    }
    if (_mode === 'double') {
      e.preventDefault()
      const two = firstTwo()
      if (two.length < 2) return
      const curCentroid = centroid(_contacts)
      const curDist = distance(two[0], two[1])
      _camera = panZoomStep(_camera, _prevCentroid, curCentroid, _prevDist, curDist)
      _prevCentroid = curCentroid
      _prevDist = curDist
      commit()
      return
    }
    if (_mode === 'single') {
      e.preventDefault()
      const c = firstContact()
      if (!c) return
      const r = singleMove(_single, c.x, c.y, _opts)
      _single = r.sg
      if (r.effect.type === 'marquee-start') cancelLongPressTimer()
      handleEffect(r.effect)
    }
  }

  function onEnd(e) {
    const prevMode = _mode
    let endLocal = null
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i]
      if (i === 0) endLocal = toLocal(t)
      _contacts.delete(t.identifier)
    }
    if (prevMode === 'single' && _contacts.size === 0 && endLocal) {
      cancelLongPressTimer()
      const r = singleUp(_single, endLocal.x, endLocal.y, _opts)
      _single = r.sg
      handleEffect(r.effect)
    }
    syncMode()
  }

  function onCancel(e) {
    cancelLongPressTimer()
    _single = createSingle()
    for (let i = 0; i < e.changedTouches.length; i++) {
      _contacts.delete(e.changedTouches[i].identifier)
    }
    syncMode()
  }

  function init(opts) {
    opts = opts || {}
    _viewport = opts.viewport || document.getElementById('desktop-viewport')
    _canvas = opts.canvas || document.getElementById('desktop-canvas')
    _camera = opts.camera || CAM.create()
    _onUpdate = opts.onUpdate || null
    _opts = opts
    _cb = {
      onTap: opts.onTap || null,
      onMarqueeStart: opts.onMarqueeStart || null,
      onMarqueeLive: opts.onMarqueeLive || null,
      onMarqueeEnd: opts.onMarqueeEnd || null,
      onLongPress: opts.onLongPress || null,
      onDrag: opts.onDrag || null,
      onDrop: opts.onDrop || null
    }
    _contacts = new Map()
    _mode = 'idle'
    _single = createSingle()
    _prevCentroid = null
    _prevDist = 0
    _rect = null
    _longPressTimer = null
    if (!_viewport) return false
    _viewport.addEventListener('touchstart', onStart, { passive: false })
    _viewport.addEventListener('touchmove', onMove, { passive: false })
    _viewport.addEventListener('touchend', onEnd, { passive: false })
    _viewport.addEventListener('touchcancel', onCancel, { passive: false })
    commit()
    return true
  }

  return {
    init: init,
    distance: distance,
    centroid: centroid,
    modeAfter: modeAfter,
    panZoomStep: panZoomStep,
    createSingle: createSingle,
    singleDown: singleDown,
    singleMove: singleMove,
    singleLongPress: singleLongPress,
    singleUp: singleUp
  }
})()
