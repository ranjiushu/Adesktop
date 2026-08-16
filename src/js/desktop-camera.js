/* 桌面相机模块：世界坐标 + 相机（单层 transform）的数学核心，纯函数可单测。
 * 约定：camera = { x, y, zoom }，x/y = 视口左上角对应的世界点，zoom = 缩放因子。
 * 屏幕坐标 = 视口内像素（视口左上角为原点）。
 * 依赖: namespace.js
 * 导出: App.DesktopCamera
 */
'use strict'

App.DesktopCamera = (function () {
  const ZOOM_MIN = 0.3
  const ZOOM_MAX = 3

  function num(v, d) {
    return (typeof v === 'number' && isFinite(v)) ? v : d
  }

  function clamp01(v) {
    return Math.min(Math.max(v, 0), 1)
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

  // 缓入缓出三次曲线：k∈[0,1] → [0,1]，起步/收尾斜率 0，中段最快（可单测）。
  // 仅 zoom 不变分支使用（Home 纯平移动画）；zoom 变化分支刻意走 flightPath 的
  // easeOut 弧长参数化（Leaflet flyTo 同款手感：起步轻快、收尾平滑，见 flightPath）。
  // 曾用缓出曲线（easeOutCubic）起步即全速（k=0 斜率最大）→ 视觉「弹射/甩」，
  // 前 100ms 走完 58% 路程，且 RAF 首帧延迟会被放大。缓入缓出无起步突跳，对称 f(0.5)=0.5。
  function easeInOutCubic(k) {
    const t = Math.min(Math.max(k, 0), 1)
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
  }

  // 相机线性插值：from/to 各字段（x/y/zoom）按 k∈[0,1] 过渡，k 越界钳制。
  // from 缺失时用默认相机起步（防御）。zoom 端点已 clamp，中间值必在端点之间。
  function lerp(from, to, k) {
    const f = from || create()
    const t = to || create()
    const ck = Math.min(Math.max(k, 0), 1)
    return {
      x: f.x + (t.x - f.x) * ck,
      y: f.y + (t.y - f.y) * ck,
      zoom: f.zoom + (t.zoom - f.zoom) * ck
    }
  }

  // 锚定屏幕中心的相机插值（相机飞行标准做法：插值屏幕中心世界点，而非相机左上角）。
  // 原理：屏幕中心世界点 = (c.x + vw/(2·zoom), c.y + vh/(2·zoom))。先让该点按 k 走，
  // 再由 zoom 反解相机位置——zoom 变化时内容绕屏幕中心缩放，轨迹不弯曲。
  // zoom 不变时退化为普通 lerp（数学上严格一致），是 lerp 的超集。
  // 视口尺寸非法（0/NaN）时退化为 lerp（防御）。
  //
  // 契约：k = 真实时间比例 [0,1]，内部按分支缓动，调用方一律不得预缓动——
  //   zoom 不变 → easeInOutCubic（缓入缓出）；
  //   zoom 变化 → flightPath 内部 easeOut 弧长参数化（Leaflet 同款）。
  // 曾因调用方预缓动 + 段边界比较缓动值 ck，段2 平移被压缩到 18% 时间（72ms 内急冲
  // 65% 路程后骤停）——真机感知「震感」；且单测直传进度与生产契约不一致，防震测试失效。
  //
  // 平滑飞行（van Wijk & Nuij，Leaflet flyTo 同款数学，防甩/防震/防断续）：
  // 同进度插值（zoom 与屏幕中心点共用同一缓动）时，图标屏幕位置 = (P-W)·z 是 k 的
  // 二次函数——中途出现比起终点更大的极值，屏幕边缘图标被推出视口再拉回（扫描复现：
  // zoom 0.5→2 + 平移 400 世界单位出界 120px；2→0.5 对称案例 30px）。zoom 变化时
  // 改为单一连续飞行曲线：center 沿 tanh 曲线（远距离放大时先 zoom-out 让路再 zoom-in，
  // 近距离放大/缩放下 zoom 单调），zoom 沿 cosh 曲线同步协调——无分段（不断续）、无骤停
  // （不震）、数学上图标中心点不出界（全量扫描 0px）。zoom 不变时走 easeInOutCubic 原逻辑（退化一致）。
  // 双曲函数：sinh/cosh/tanh（叶利夫/Mapbox flyTo 同源）。
  function _sinh(n) { return (Math.exp(n) - Math.exp(-n)) / 2 }
  function _cosh(n) { return (Math.exp(n) + Math.exp(-n)) / 2 }
  function _tanh(n) { return _sinh(n) / _cosh(n) }

  // 飞行路径解算（Leaflet _flyTo 同款）：返回 k∈[0,1] → {x, y, zoom}
  // 世界坐标 + 连续 zoom；w0/w1 = 屏幕基准尺寸（w 大 = zoom 小 = 视野大）
  function flightPath(f, t, w, h) {
    const W0x = f.x + w / (2 * f.zoom)
    const W0y = f.y + h / (2 * f.zoom)
    const W1x = t.x + w / (2 * t.zoom)
    const W1y = t.y + h / (2 * t.zoom)
    const w0 = Math.max(w, h)
    const w1 = w0 * (f.zoom / t.zoom)
    // u1 = 两端屏幕中心世界点的像素距离（from zoom 尺度）。同心缩放（W0==W1 但 zoom 不同）
    // 时 u1=0，原公式发散（Leaflet 此处直接 NaN 链）；兜底 1 使 zoom 曲线走近似形状，
    // 位置项 (W1x-W0x)·fu=0 仍精确锚定中心。仅影响 zoom 缓动形状，视觉可接受。
    const u1 = Math.hypot(W1x - W0x, W1y - W0y) * f.zoom || 1
    const rho = 1.42
    const rho2 = rho * rho
    function r(i) {
      const s1 = i ? -1 : 1
      const s2 = i ? w1 : w0
      const t1 = w1 * w1 - w0 * w0 + s1 * rho2 * rho2 * u1 * u1
      const b1 = 2 * s2 * rho2 * u1
      const b = t1 / b1
      const sq = Math.sqrt(b * b + 1) - b
      return sq < 1e-15 ? -18 : Math.log(sq)  // 浮点精度兜底（Leaflet 1e-15 同款；阈值若过大，r0/r1 同截断 → S=0 飞行静默不动）
    }
    const r0 = r(0)
    function wf(s) { return w0 * (_cosh(r0) / _cosh(r0 + rho * s)) }
    function uf(s) { return w0 * (_cosh(r0) * _tanh(r0 + rho * s) - _sinh(r0)) / rho2 }
    const S = (r(1) - r0) / rho
    return function frame(k) {
      const s = (1 - Math.pow(1 - k, 1.5)) * S   // easeOut 弧长参数化（Leaflet 同款）
      const fu = uf(s) / u1
      const z = f.zoom * w0 / wf(s)
      return {
        x: W0x + (W1x - W0x) * fu - w / (2 * z),
        y: W0y + (W1y - W0y) * fu - h / (2 * z),
        zoom: z
      }
    }
  }

  const ANIM_EPS = 1e-9   // zoom 差异判定阈值

  function lerpCentered(from, to, k, vw, vh) {
    const f = from || create()
    const t = to || create()
    const w = num(vw, 0)
    const h = num(vh, 0)
    if (!(w > 0) || !(h > 0)) return lerp(from, to, k)
    // 屏幕中心世界点（from/to 两端）
    const fx = f.x + w / (2 * f.zoom)
    const fy = f.y + h / (2 * f.zoom)
    const tx = t.x + w / (2 * t.zoom)
    const ty = t.y + h / (2 * t.zoom)
    const zoomSame = Math.abs(t.zoom - f.zoom) < ANIM_EPS
    if (zoomSame) {
      // 退化：zoom 不变 → 与 lerp(from, to, easeInOutCubic(k)) 数值一致
      const ck = easeInOutCubic(clamp01(k))
      return {
        x: fx + (tx - fx) * ck - w / (2 * f.zoom),
        y: fy + (ty - fy) * ck - h / (2 * f.zoom),
        zoom: f.zoom
      }
    }
    // zoom 变化：flightPath 自带 easeOut 弧长参数化（Leaflet 同款）。
    // 此处传原始时间比例 k，不得预缓动（双重缓动会压缩起步段、扭曲飞行曲线）。
    return flightPath(f, t, w, h)(clamp01(k))
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

  // 有限画布钳制：相机视口不能越出世界边界 [0,0]-[worldW, worldH]。
  // 世界小于视口时 max=0（相机固定原点，不出现负坐标空区）。
  // folder 容器模式用：zoom 由调用方锁定，这里只钳位置。
  function clampToBounds(camera, worldW, worldH, viewportW, viewportH) {
    const c = camera || create()
    const ww = num(worldW, 0)
    const wh = num(worldH, 0)
    const vw = num(viewportW, 0)
    const vh = num(viewportH, 0)
    const maxX = Math.max(0, ww - vw / c.zoom)
    const maxY = Math.max(0, wh - vh / c.zoom)
    return {
      x: Math.min(Math.max(c.x, 0), maxX),
      y: Math.min(Math.max(c.y, 0), maxY),
      zoom: c.zoom
    }
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
    easeInOutCubic: easeInOutCubic,
    lerp: lerp,
    lerpCentered: lerpCentered,
    screenToWorld: screenToWorld,
    worldToScreen: worldToScreen,
    panBy: panBy,
    pinchBy: pinchBy,
    clampToBounds: clampToBounds,
    transform: transform,
    applyTo: applyTo
  }
})()
