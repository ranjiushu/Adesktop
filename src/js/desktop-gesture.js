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

  function toLocal(t) {
    if (!_rect) _rect = _viewport.getBoundingClientRect()
    return { x: t.clientX - _rect.left, y: t.clientY - _rect.top, t: Date.now() }
  }

  function firstTwo() {
    const arr = []
    _contacts.forEach(function (c) { arr.push(c) })
    return arr.slice(0, 2)
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

  function onStart(e) {
    if (!_rect) _rect = _viewport.getBoundingClientRect()
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i]
      _contacts.set(t.identifier, toLocal(t))
    }
    syncMode()
  }

  function onMove(e) {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i]
      if (_contacts.has(t.identifier)) {
        _contacts.set(t.identifier, toLocal(t))
      }
    }
    if (_mode !== 'double') return
    e.preventDefault()
    const two = firstTwo()
    if (two.length < 2) return
    const curCentroid = centroid(_contacts)
    const curDist = distance(two[0], two[1])
    _camera = panZoomStep(_camera, _prevCentroid, curCentroid, _prevDist, curDist)
    _prevCentroid = curCentroid
    _prevDist = curDist
    commit()
  }

  function onEnd(e) {
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
    _contacts = new Map()
    _mode = 'idle'
    _prevCentroid = null
    _prevDist = 0
    _rect = null
    if (!_viewport) return false
    _viewport.addEventListener('touchstart', onStart, { passive: false })
    _viewport.addEventListener('touchmove', onMove, { passive: false })
    _viewport.addEventListener('touchend', onEnd, { passive: false })
    _viewport.addEventListener('touchcancel', onEnd, { passive: false })
    commit()
    return true
  }

  return {
    init: init,
    distance: distance,
    centroid: centroid,
    modeAfter: modeAfter,
    panZoomStep: panZoomStep
  }
})()
