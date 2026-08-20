/* 桌面相机模块：世界坐标 + 相机（单层 transform）的数学核心，纯函数可单测。
 * 约定：camera = { x, y, zoom, rotation }，x/y = 视口左上角对应的世界点，
 *       zoom = 缩放因子，rotation = 画布旋转角（0 或 90，顺时针）。
 * 屏幕坐标 = 视口内像素（视口左上角为原点）。
 * rotation=90 时画布绕视口中心顺时针旋转 90°：世界坐标 → 未旋转屏幕坐标
 * → 绕中心旋转。所有产生新相机对象的函数（lerp/panBy/pinchBy/clampToBounds）
 * 必须透传 rotation，否则旋转态在手指拖动/Home 动画后丢失（相机对象被替换）。
 * 依赖: namespace.js
 * 导出: App.DesktopCamera
 */
// @ts-check
'use strict'

App.DesktopCamera = (function () {
  // 缩放范围 [0.1, 10]（2026-08-20 放宽，原 [0.3, 3]）：根目录桌面空间的手感边界。
  // 下限 0.1 保数值安全（panBy 位移 = dx/zoom，zoom→0 时世界坐标会顶穿浮点精度）；
  // 上限 10 保像素精度（translate3d 超大值丢精度）与缩略图清晰度（位图放大 >4-5x 发糊）。
  // 真无穷不可行：CSS transform 与 double 都撑不住，必须留安全兜底。
  const ZOOM_MIN = 0.1
  const ZOOM_MAX = 10
  const ROT_0 = 0
  const ROT_90 = 90

  /** @param {any} v @param {number} d @returns {number} */
  function num(v, d) {
    return (typeof v === 'number' && isFinite(v)) ? v : d
  }

  /** @param {number} v @returns {number} */
  function clamp01(v) {
    return Math.min(Math.max(v, 0), 1)
  }

  // 旋转角归一化：仅支持 0 / 90（菜单 toggle 两态；其余输入防御回退 0）
  /** @param {any} r @returns {number} */
  function clampRotation(r) {
    return r === ROT_90 ? ROT_90 : ROT_0
  }

  /** @param {number} [x] @param {number} [y] @param {number} [zoom] @param {number} [rotation] @returns {DesktopCameraState} */
  function create(x, y, zoom, rotation) {
    return {
      x: num(x, 0),
      y: num(y, 0),
      zoom: clampZoom(zoom),
      rotation: clampRotation(rotation)
    }
  }

  // 缩放钳制：NaN/非数字回退 1；Infinity 自然压到 [ZOOM_MIN, ZOOM_MAX] 边界
  /** @param {any} z @returns {number} */
  function clampZoom(z) {
    if (typeof z !== 'number' || Number.isNaN(z)) return 1
    return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z))
  }

  // 缓入缓出三次曲线：k∈[0,1] → [0,1]，起步/收尾斜率 0，中段最快（可单测）。
  // 仅 zoom 不变分支使用（Home 纯平移动画）；zoom 变化分支刻意走 flightPath 的
  // easeOut 弧长参数化（Leaflet flyTo 同款手感：起步轻快、收尾平滑，见 flightPath）。
  // 曾用缓出曲线（easeOutCubic）起步即全速（k=0 斜率最大）→ 视觉「弹射/甩」，
  // 前 100ms 走完 58% 路程，且 RAF 首帧延迟会被放大。缓入缓出无起步突跳，对称 f(0.5)=0.5。
  /** @param {number} k @returns {number} */
  function easeInOutCubic(k) {
    const t = Math.min(Math.max(k, 0), 1)
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
  }

  // 相机线性插值：from/to 各字段（x/y/zoom）按 k∈[0,1] 过渡，k 越界钳制。
  // from 缺失时用默认相机起步（防御）。zoom 端点已 clamp，中间值必在端点之间。
  // rotation 不插值（旋转是瞬时的两态），沿用起点（插值期间保持当前旋转，
  // 防止 Home 飞行到 rotation=0 目标时中途闪回正）。
  /** @param {DesktopCameraState | null} from @param {DesktopCameraState | null} to @param {number} k @returns {DesktopCameraState} */
  function lerp(from, to, k) {
    const f = from || create()
    const t = to || create()
    const ck = Math.min(Math.max(k, 0), 1)
    return {
      x: f.x + (t.x - f.x) * ck,
      y: f.y + (t.y - f.y) * ck,
      zoom: f.zoom + (t.zoom - f.zoom) * ck,
      rotation: f.rotation
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
  /** @param {number} n @returns {number} */
  function _sinh(n) { return (Math.exp(n) - Math.exp(-n)) / 2 }
  /** @param {number} n @returns {number} */
  function _cosh(n) { return (Math.exp(n) + Math.exp(-n)) / 2 }
  /** @param {number} n @returns {number} */
  function _tanh(n) { return _sinh(n) / _cosh(n) }

  // 飞行路径解算（Leaflet _flyTo 同款）：返回 k∈[0,1] → {x, y, zoom}
  // 世界坐标 + 连续 zoom；w0/w1 = 屏幕基准尺寸（w 大 = zoom 小 = 视野大）
  /** @param {DesktopCameraState} f @param {DesktopCameraState} t @param {number} w @param {number} h @returns {(k: number) => DesktopCameraState} */
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
    /** @param {number} i @returns {number} */
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
    /** @param {number} s @returns {number} */
    function wf(s) { return w0 * (_cosh(r0) / _cosh(r0 + rho * s)) }
    /** @param {number} s @returns {number} */
    function uf(s) { return w0 * (_cosh(r0) * _tanh(r0 + rho * s) - _sinh(r0)) / rho2 }
    const S = (r(1) - r0) / rho
    return function frame(k) {
      const s = (1 - Math.pow(1 - k, 1.5)) * S   // easeOut 弧长参数化（Leaflet 同款）
      const fu = uf(s) / u1
      const z = f.zoom * w0 / wf(s)
      return {
        x: W0x + (W1x - W0x) * fu - w / (2 * z),
        y: W0y + (W1y - W0y) * fu - h / (2 * z),
        zoom: z,
        rotation: f.rotation
      }
    }
  }

  const ANIM_EPS = 1e-9   // zoom 差异判定阈值

  /** @param {DesktopCameraState | null} from @param {DesktopCameraState | null} to @param {number} k @param {number} vw @param {number} vh @returns {DesktopCameraState} */
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
        zoom: f.zoom,
        rotation: f.rotation
      }
    }
    // zoom 变化：flightPath 自带 easeOut 弧长参数化（Leaflet 同款）。
    // 此处传原始时间比例 k，不得预缓动（双重缓动会压缩起步段、扭曲飞行曲线）。
    return flightPath(f, t, w, h)(clamp01(k))
  }

  // 屏幕 → 世界（rotation=90 时先绕视口中心逆旋转屏幕坐标，再走原公式）
  /** @param {number} sx @param {number} sy @param {DesktopCameraState | null} camera @param {number} vw @param {number} vh @returns {WorldPoint} */
  function screenToWorld(sx, sy, camera, vw, vh) {
    const c = camera || create()
    const w = num(vw, 0)
    const h = num(vh, 0)
    if (c.rotation === ROT_90 && w > 0 && h > 0) {
      const cx = w / 2
      const cy = h / 2
      // 逆时针旋转（绕中心）：(x,y) → (y, -x)
      const lx = (sy - cy) + cx
      const ly = -(sx - cx) + cy
      return { x: c.x + lx / c.zoom, y: c.y + ly / c.zoom }
    }
    return { x: c.x + sx / c.zoom, y: c.y + sy / c.zoom }
  }

  // 世界 → 屏幕（rotation=90 时先走原公式，再绕视口中心顺时针旋转 90°）
  /** @param {number} wx @param {number} wy @param {DesktopCameraState | null} camera @param {number} vw @param {number} vh @returns {WorldPoint} */
  function worldToScreen(wx, wy, camera, vw, vh) {
    const c = camera || create()
    const w = num(vw, 0)
    const h = num(vh, 0)
    const sx0 = (wx - c.x) * c.zoom
    const sy0 = (wy - c.y) * c.zoom
    if (c.rotation === ROT_90 && w > 0 && h > 0) {
      const cx = w / 2
      const cy = h / 2
      // 顺时针旋转（绕中心）：(x,y) → (-y, x)
      return { x: -(sy0 - cy) + cx, y: (sx0 - cx) + cy }
    }
    return { x: sx0, y: sy0 }
  }

  // 平移：屏幕位移 dx/dy（手指拖动的屏幕像素）→ 相机在世界中反向移动 dx/zoom。
  // rotation=90 时屏幕位移先逆旋转到世界方向（Δc = -R⁻¹(Δs)/zoom）。
  /** @param {DesktopCameraState | null} camera @param {number} dx @param {number} dy @returns {DesktopCameraState} */
  function panBy(camera, dx, dy) {
    const c = camera || create()
    const ddx = num(dx, 0)
    const ddy = num(dy, 0)
    if (c.rotation === ROT_90) {
      // R⁻¹(ddx, ddy) = (ddy, -ddx)；Δc = -R⁻¹(Δs)/zoom
      return { x: c.x - ddy / c.zoom, y: c.y + ddx / c.zoom, zoom: c.zoom, rotation: c.rotation }
    }
    return { x: c.x - ddx / c.zoom, y: c.y - ddy / c.zoom, zoom: c.zoom, rotation: c.rotation }
  }

  // 捏合缩放：指距 prevDist → curDist，锚点屏幕坐标 (anchorSx, anchorSy) 处的世界点保持不动。
  // rotation=90 时锚点屏幕坐标先逆旋转到逻辑屏幕坐标（绕视口中心）再代入。
  /** @param {DesktopCameraState | null} camera @param {number} prevDist @param {number} curDist @param {number} anchorSx @param {number} anchorSy @param {number} vw @param {number} vh @returns {DesktopCameraState} */
  function pinchBy(camera, prevDist, curDist, anchorSx, anchorSy, vw, vh) {
    const c = camera || create()
    if (typeof prevDist !== 'number' || !isFinite(prevDist) || prevDist <= 0) {
      return { x: c.x, y: c.y, zoom: c.zoom, rotation: c.rotation }
    }
    const zoom = clampZoom(c.zoom * curDist / prevDist)
    const w = num(vw, 0)
    const h = num(vh, 0)
    let ax = num(anchorSx, 0)
    let ay = num(anchorSy, 0)
    if (c.rotation === ROT_90 && w > 0 && h > 0) {
      // 锚点屏幕坐标逆旋转到逻辑屏幕坐标
      const lx = (ay - h / 2) + w / 2
      const ly = -(ax - w / 2) + h / 2
      ax = lx
      ay = ly
    }
    const k = 1 / c.zoom - 1 / zoom
    return { x: c.x + ax * k, y: c.y + ay * k, zoom: zoom, rotation: c.rotation }
  }

  // 有限画布钳制：相机视口不能越出世界边界 [0,0]-[worldW, worldH]。
  // 世界小于视口时 max=0（相机固定原点，不出现负坐标空区）。
  // folder 容器模式用：zoom 由调用方锁定，这里只钳位置。
  /** @param {DesktopCameraState | null} camera @param {number} worldW @param {number} worldH @param {number} viewportW @param {number} viewportH @returns {DesktopCameraState} */
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
      zoom: c.zoom,
      rotation: c.rotation
    }
  }

  // canvas transform 参数（配合 transform-origin: 0 0）。
  // rotation=90 时画布绕视口中心顺时针旋转：translate 补偿 =
  //   a = c.y*zoom + (vw+vh)/2，b = -c.x*zoom + (vh-vw)/2
  // （推导：世界 p → scale → rotate → translate 的矩阵链，见 worldToScreen 注释）。
  /** @param {DesktopCameraState | null} camera @param {number} vw @param {number} vh @returns {TransformParams} */
  function transform(camera, vw, vh) {
    const c = camera || create()
    const w = num(vw, 0)
    const h = num(vh, 0)
    if (c.rotation === ROT_90 && w > 0 && h > 0) {
      return {
        tx: c.y * c.zoom + (w + h) / 2,
        ty: -c.x * c.zoom + (h - w) / 2,
        zoom: c.zoom,
        rotation: ROT_90
      }
    }
    return { tx: -c.x * c.zoom, ty: -c.y * c.zoom, zoom: c.zoom, rotation: c.rotation }
  }

  // 应用 transform 到 DOM（合成层变换，GPU 加速，不触发布局）
  /** @param {DesktopCameraState | null} camera @param {HTMLElement | null} el @param {number} vw @param {number} vh */
  function applyTo(camera, el, vw, vh) {
    if (!el) return
    const t = transform(camera, vw, vh)
    if (t.rotation === ROT_90) {
      el.style.transform = 'translate3d(' + t.tx + 'px,' + t.ty + 'px,0) rotate(90deg) scale(' + t.zoom + ')'
      return
    }
    el.style.transform = 'translate3d(' + t.tx + 'px,' + t.ty + 'px,0) scale(' + t.zoom + ')'
  }

  // 旋转保中心：**撤销**（2026-08-19）——「保持位置只转方向」本来就保中心
  // （screenToWorld 在 rotation=90 时屏幕中心对应世界点 = (x + w/2z, y + h/2z)，与竖屏相同）；
  // 曾加此位移函数，实测旋转后把图标移出视野（rotate-e2e 回归），已从 desktop.js 移除。

  /** @type {DesktopCamera} */
  return {
    ZOOM_MIN: ZOOM_MIN,
    ZOOM_MAX: ZOOM_MAX,
    create: create,
    clampZoom: clampZoom,
    clampRotation: clampRotation,
    easeInOutCubic: easeInOutCubic,
    lerp: lerp,
    lerpCentered: lerpCentered,
    panBy: panBy,
    pinchBy: pinchBy,
    clampToBounds: clampToBounds,
    screenToWorld: screenToWorld,
    worldToScreen: worldToScreen,
    transform: transform,
    applyTo: applyTo
  }
})()
