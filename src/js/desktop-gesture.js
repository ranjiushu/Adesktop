/* 桌面手势模块：viewport 上的 touch 三件套 → 手势识别。
 * 阶段 A：双指 panzoom（平移 + 缩放并行，不做二选一）。
 * 单指 tap/框选/长按拿起留待阶段 B 扩展（状态机已预留 single/dead 路径）。
 * 阶段 E：高级浏览模式——单指拖动（任意位置）→ 平移画布（桌面）/ 滚动目录（文件夹），
 *         由 _browseMode 标志控制；空位命中进入 pan 相位而非 marquee。
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
    return { phase: 'idle', hitType: 'empty', startX: 0, startY: 0, startT: 0, lastX: 0, lastY: 0 }
  }

  function _threshold(opts) {
    return (opts && typeof opts.tapThreshold === 'number') ? opts.tapThreshold : TAP_THRESHOLD
  }

  // down：进入 pending，记录起点与命中类型（selected=已选中可直接拿起 / icon=未选中 / empty=空白）
  function singleDown(x, y, t, hitType) {
    return { phase: 'pending', hitType: hitType || 'empty', startX: x, startY: y, startT: t, lastX: x, lastY: y }
  }

  // move：按 phase 与位移分派（返回新状态 + 语义效果）
  function singleMove(sg, x, y, opts) {
    const th = _threshold(opts)
    const browse = opts && opts.browseMode
    const next = { phase: sg.phase, hitType: sg.hitType, startX: sg.startX, startY: sg.startY, startT: sg.startT, lastX: x, lastY: y }
    if (sg.phase === 'pending') {
      const d = distance({ x: sg.startX, y: sg.startY }, { x: x, y: y })
      if (d > th) {
        // 高级浏览模式：empty/icon 命中 → 平移画布（pan），而非框选
        if (browse && (sg.hitType === 'empty' || sg.hitType === 'icon')) {
          return { sg: Object.assign({}, next, { phase: 'pan' }), effect: { type: 'pan-start' } }
        }
        // 已选中（文件 selected / Viewer viewer-selected）或命中拖动手柄（viewer-handle）
        // → 直接拿起移动（不必长按）；其余（未选中图标 icon / 未选中 Viewer viewer / 空白 empty）
        // → 框选（划过触发选中）
        if (sg.hitType === 'selected' || sg.hitType === 'viewer-selected' || sg.hitType === 'viewer-handle') {
          return { sg: Object.assign({}, next, { phase: 'dragmove' }), effect: { type: 'drag-start', x: x, y: y, hitType: sg.hitType } }
        }
        return { sg: Object.assign({}, next, { phase: 'marquee' }), effect: { type: 'marquee-start', x: sg.startX, y: sg.startY } }
      }
      return { sg: next, effect: { type: 'none' } }
    }
    if (sg.phase === 'pan') {
      return { sg: next, effect: { type: 'pan', dx: x - sg.lastX, dy: y - sg.lastY } }
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

  // 单指意图取消（1→2 指切换 / touchcancel，状态机强制终结路径）：
  // 有未完成意图（框选/拿起/拖动/平移）→ 派发 single-cancel 语义事件并复位状态；
  // 否则原样返回（无意图可取消）。保证拖动生命周期必有收尾——否则 picked-up
  // 视觉（放大+阴影）与框选矩形会滞留成「悬浮残影」。
  function singleCancel(sg) {
    if (sg.phase === 'marquee' || sg.phase === 'pickedup' || sg.phase === 'dragmove' || sg.phase === 'pan') {
      return { sg: createSingle(), effect: { type: 'single-cancel' } }
    }
    return { sg: sg, effect: { type: 'none' } }
  }

  // up：按 phase 收尾（tap / 框选结束 / 放下 / 平移结束）
  function singleUp(sg, x, y, opts) {
    const th = _threshold(opts)
    if (sg.phase === 'pending') {
      const d = distance({ x: sg.startX, y: sg.startY }, { x: x, y: y })
      if (d <= th) {
        return { sg: createSingle(), effect: { type: 'tap', x: x, y: y } }
      }
      return { sg: createSingle(), effect: { type: 'marquee-end', startX: sg.startX, startY: sg.startY, x: x, y: y } }
    }
    if (sg.phase === 'pan') {
      return { sg: createSingle(), effect: { type: 'pan-end' } }
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
  let _browseMode = false  // 高级浏览模式标志（Desktop.setBrowseMode 驱动）

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

  // 相机钳制（folder 容器边界）：Desktop 提供 onClamp 回调，pan/zoom 每帧先钳制再应用，
  // 保证 canvas transform 与 Desktop.camera 始终一致（防止内容拖出画布边界）
  function _applyClamp(c) {
    return (_cb && typeof _cb.onClamp === 'function') ? _cb.onClamp(c) : c
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
      case 'drag-start':
        if (_cb.onDragStart) _cb.onDragStart(toWorld(effect.x, effect.y), effect.hitType)
        break
      case 'drag':
        if (_cb.onDrag) _cb.onDrag(toWorld(effect.x, effect.y))
        break
      case 'drop':
        if (_cb.onDrop) _cb.onDrop(toWorld(effect.x, effect.y), !!effect.moved)
        break
      case 'single-cancel':
        if (_cb.onSingleCancel) _cb.onSingleCancel()
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
    // 任何真实手势开始（单指/双指）都先通知上层：打断进行中的相机动画，
    // 手势直控优先（如 Home 平滑过渡中途用户开始拖动/捏合，立即接管）
    if (_mode !== 'idle' && _cb && typeof _cb.onGestureStart === 'function') {
      _cb.onGestureStart()
    }
    if (_mode === 'single') {
      const c = firstContact()
      let hitType = 'empty'
      if (_cb && typeof _cb.onHitTest === 'function') {
        hitType = _cb.onHitTest(toWorld(c.x, c.y)) || 'empty'
      }
      _single = singleDown(c.x, c.y, c.t, hitType)
      startLongPressTimer()
    } else if (_mode === 'double') {
      // 1→2 指：取消当前单指意图（interaction.md §3——框选/长按拿起均取消）。
      // 必须派发 single-cancel 让上层回收拿起态/框选矩形，否则残留悬浮阴影。
      cancelLongPressTimer()
      const cancelled = singleCancel(_single)
      if (cancelled.effect.type !== 'none') handleEffect(cancelled.effect)
      _single = cancelled.sg
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
      _camera = _applyClamp(panZoomStep(_camera, _prevCentroid, curCentroid, _prevDist, curDist))
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
      // 单指平移（高级浏览模式）：相机直接更新，与双指 pan 共用钳制+提交路径
      if (r.effect.type === 'pan') {
        _camera = _applyClamp(CAM.panBy(_camera, r.effect.dx, r.effect.dy))
        commit()
      }
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
    // touchcancel（系统接管，如来电/通知/手势导航）可能发生在拿起/拖动中：
    // 派发 single-cancel 保证 picked-up 视觉与框选矩形被回收（生命周期终结路径）。
    const cancelled = singleCancel(_single)
    if (cancelled.effect.type !== 'none') handleEffect(cancelled.effect)
    _single = cancelled.sg
    for (let i = 0; i < e.changedTouches.length; i++) {
      _contacts.delete(e.changedTouches[i].identifier)
    }
    syncMode()
  }

  // 目录切换后同步相机（Desktop 改了 camera 引用，手势层必须拿到同一份；folder 边界同样钳制）
  function setCamera(c) {
    if (!c) return
    _camera = _applyClamp(c)
    commit()
  }

  // 高级浏览模式开关：Desktop 调用，同步到手势层内部标志 + opts（singleMove 读取）
  function setBrowseMode(on) {
    _browseMode = !!on
    if (_opts) _opts.browseMode = _browseMode
  }

  function init(opts) {
    opts = opts || {}
    _viewport = opts.viewport || document.getElementById('desktop-viewport')
    _canvas = opts.canvas || document.getElementById('desktop-canvas')
    _camera = opts.camera || CAM.create()
    _onUpdate = opts.onUpdate || null
    _opts = opts
    _cb = {
      onGestureStart: opts.onGestureStart || null,
      onHitTest: opts.onHitTest || null,
      onTap: opts.onTap || null,
      onMarqueeStart: opts.onMarqueeStart || null,
      onMarqueeLive: opts.onMarqueeLive || null,
      onMarqueeEnd: opts.onMarqueeEnd || null,
      onLongPress: opts.onLongPress || null,
      onDragStart: opts.onDragStart || null,
      onDrag: opts.onDrag || null,
      onDrop: opts.onDrop || null,
      onSingleCancel: opts.onSingleCancel || null,
      onClamp: opts.onClamp || null
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
    setCamera: setCamera,
    setBrowseMode: setBrowseMode,
    distance: distance,
    centroid: centroid,
    modeAfter: modeAfter,
    panZoomStep: panZoomStep,
    createSingle: createSingle,
    singleDown: singleDown,
    singleMove: singleMove,
    singleLongPress: singleLongPress,
    singleCancel: singleCancel,
    singleUp: singleUp
  }
})()
