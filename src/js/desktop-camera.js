/* 桌面相机模块：世界坐标 + 相机（单层 transform）的数学核心，纯函数可单测。
 * 约定：camera = { x, y, zoom }，x/y = 视口左上角对应的世界点，zoom = 缩放因子。
 * 屏幕坐标 = 视口内像素（视口左上角为原点）。
 * 依赖: namespace.js
 * 导出: App.DesktopCamera
 */
'use strict'

App.DesktopCamera = (function () {
  const ZOOM_MIN = 0.4
  const ZOOM_MAX = 2.5

  function num(v, d) {
    return (typeof v === 'number' && isFinite(v)) ? v : d
  }

  function create(x, y, zoom) {
    return {
      x: num(x, 0),
      y: num(y, 0),
      zoom: clampZoom(zoom)
    }
  }

  // 缩放钳制：NaN/非数字回退 1；Infinity 自然压到 [ZOOM_MIN, ZOOM_MAX] 边界
  function clampZoom(z) {
    if (typeof z !== 'number' || Number.isNaN(z)) return 1
    return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z))
  }

  // 屏幕 → 世界
  function screenToWorld(sx, sy, camera) {
    const c = camera || create()
    return { x: c.x + sx / c.zoom, y: c.y + sy / c.zoom }
  }

  // 世界 → 屏幕
  function worldToScreen(wx, wy, camera) {
    const c = camera || create()
    return { x: (wx - c.x) * c.zoom, y: (wy - c.y) * c.zoom }
  }

  // 平移：屏幕位移 dx/dy（手指拖动的屏幕像素）→ 相机在世界中反向移动 dx/zoom
  function panBy(camera, dx, dy) {
    const c = camera || create()
    return { x: c.x - dx / c.zoom, y: c.y - dy / c.zoom, zoom: c.zoom }
  }

  // 捏合缩放：指距 prevDist → curDist，锚点屏幕坐标 (anchorSx, anchorSy) 处的世界点保持不动
  function pinchBy(camera, prevDist, curDist, anchorSx, anchorSy) {
    const c = camera || create()
    if (typeof prevDist !== 'number' || !isFinite(prevDist) || prevDist <= 0) {
      return { x: c.x, y: c.y, zoom: c.zoom }
    }
    const zoom = clampZoom(c.zoom * curDist / prevDist)
    const ax = num(anchorSx, 0)
    const ay = num(anchorSy, 0)
    const k = 1 / c.zoom - 1 / zoom
    return { x: c.x + ax * k, y: c.y + ay * k, zoom: zoom }
  }

  // canvas transform 参数（配合 transform-origin: 0 0）
  function transform(camera) {
    const c = camera || create()
    return { tx: -c.x * c.zoom, ty: -c.y * c.zoom, zoom: c.zoom }
  }

  // 应用 transform 到 DOM（合成层变换，GPU 加速，不触发布局）
  function applyTo(camera, el) {
    if (!el) return
    const t = transform(camera)
    el.style.transform = 'translate3d(' + t.tx + 'px,' + t.ty + 'px,0) scale(' + t.zoom + ')'
  }

  return {
    ZOOM_MIN: ZOOM_MIN,
    ZOOM_MAX: ZOOM_MAX,
    create: create,
    clampZoom: clampZoom,
    screenToWorld: screenToWorld,
    worldToScreen: worldToScreen,
    panBy: panBy,
    pinchBy: pinchBy,
    transform: transform,
    applyTo: applyTo
  }
})()
