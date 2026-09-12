/* 桌面手势模块：viewport 上的 touch 三件套 → 手势识别。
 * 阶段 A：双指 panzoom（平移 + 缩放并行，不做二选一）。
 * 单指 tap/框选/长按拿起留待阶段 B 扩展（状态机已预留 single/dead 路径）。
 * 阶段 E：高级浏览模式——单指拖动（任意位置）→ 平移画布（桌面）/ 滚动目录（文件夹），
 *         由 _browseMode 标志控制；空位命中进入 pan 相位而非 marquee。
 * 阶段 G：单指 pan 惯性（动量）——松手后按末段速度平滑滑行一段（iOS DecelerationRate 模型，
 *         图片查看器式手感）；只对高级浏览模式 pan 相位生效，慢拖即停，新手势/目录切换打断。
 * 关键：指数突变处理——1→2 取消单指意图；2→1 剩指进 dead 直到抬起，
 *       绝不误触发 tap/框选（这是触摸手势最易出 bug 的地方）。
 * 依赖: namespace.js, desktop-camera.js
 * 导出: App.DesktopGesture（纯函数供单元测试：windowVelocity/inertiaStep/inertiaDone）
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
  // vw/vh = 视口尺寸（rotation=90 时 pinchBy 锚点需绕中心逆旋转）
  function panZoomStep(camera, prevCentroid, curCentroid, prevDist, curDist, vw, vh) {
    let cam = CAM.panBy(camera, curCentroid.x - prevCentroid.x, curCentroid.y - prevCentroid.y)
    cam = CAM.pinchBy(cam, prevDist, curDist, curCentroid.x, curCentroid.y, vw, vh)
    return cam
  }

  // ── 纯函数：末段速度（VelocityTracker 语义，100ms 窗口，与 drawer-swipe 一致）──
  // samples: [{x, y, t}]（viewport 局部坐标 + 时间戳，t 相对或绝对均可）；返回 {vx, vy}（px/ms）。
  // 取窗口内最早→最晚样本的位移/时间。样本 <2 或时间未推进 → 0（无速度可算）。
  function windowVelocity(samples, windowMs) {
    const W = (typeof windowMs === 'number' && windowMs > 0) ? windowMs : FLING_VELOCITY_WINDOW_MS
    if (!Array.isArray(samples) || samples.length < 2) return { vx: 0, vy: 0 }
    const s1 = samples[samples.length - 1]
    const cut = s1.t - W
    let s0 = samples[0]
    // 取窗口内最早样本（跳过窗口外的旧样本）
    for (let i = 0; i < samples.length; i++) {
      if (samples[i].t >= cut) { s0 = samples[i]; break }
    }
    const dt = s1.t - s0.t
    if (dt <= 0) return { vx: 0, vy: 0 }
    const win = Math.max(16, dt)   // 单帧下限 16ms：防除零 + 模拟一次 move 帧最短窗口
    return { vx: (s1.x - s0.x) / win, vy: (s1.y - s0.y) / win }
  }

  // ── 纯函数：惯性一帧（iOS DecelerationRate 衰减 + 步进）──
  // camera 当前相机；vel = {vx, vy}（px/ms，屏幕方向）；dtMs 步进时长；返回 { camera, vel }。
  // 衰减：v *= DecelerationRate^dt（每 ms 乘以保留比例，iOS UIScrollView 标准模型）；
  // 位移：dxScreen = vx·dt（经 CAM.panBy 走世界/旋转换算），收当前速度（而非衰减后）作本帧位移
  // ——第一帧全速、后续递减，起步不弹跳、收尾平滑。
  function inertiaStep(camera, vel, dtMs) {
    const dt = (typeof dtMs === 'number' && dtMs > 0) ? dtMs : 16
    const f = Math.pow(FLING_DECELERATION_RATE, dt)
    const nv = { vx: vel.vx * f, vy: vel.vy * f }
    return {
      camera: CAM.panBy(camera, vel.vx * dt, vel.vy * dt),
      vel: { vx: nv.vx, vy: nv.vy }
    }
  }

  // ── 纯函数：惯性是否应收尾（速度低于停止阈值 或 超过最大时长）──
  function inertiaDone(vel, elapsedMs) {
    if (!vel) return true
    if (typeof elapsedMs === 'number' && elapsedMs > FLING_MAX_MS) return true
    return Math.sqrt(vel.vx * vel.vx + vel.vy * vel.vy) < FLING_STOP_SPEED
  }

  // ══ 单指手势状态机（阶段 B）：pending → tap / marquee / pickedup → dragmove ══
  // 判定规则（先到先得）：位移先超阈值 → 框选；停留先超长按时长 → 拿起；快速抬起 → tap。
  const TAP_THRESHOLD = 6      // px，tap/拖拽判定阈值
  const LONGPRESS_MS = 500     // ms，长按拿起触发时长

  // ══ 单指 pan 惯性（动量）参数：采用 iOS UIScrollView 的 DecelerationRate 成熟模型。 ══
  // 手感基准 = 图片查看器/相册"放大后滑动、滑一段就平滑停"的标准手感（Apple 官方文档化参数）。
  // DecelerationRate 语义：每毫秒速度乘以该比例（v(t) = v0 · d^t），是照片/画廊类 app 公认手感的来源：
  //   normal = 0.998 → 滚动很长才停（长列表、翻页）；fast = 0.99 → 一小段就平滑停（浏览器/图片查看器滚动）。
  // 本需求是"移动一小段即停"，故取 fast = 0.99。速度单位 px/ms（viewport 局部坐标，与 pan 屏幕位移一致）。
  // 配套成熟做法（根治"滚太远""急停"）：
  //   ① 停止阈值降到接近不可见（0.005 px/ms ≈ 每帧 0.08px），避免滑动未消、视觉可感时被一刀切 → 急停感。
  //   ② 时长上限放宽为纯防死循环兜底（不主动截断，让指数衰减自然收尾，收尾平滑）。
  //   ③ 速度上限（Android VelocityTracker maxVelocity 标准做法）：防极用力甩导致速度失控滚太远。
  const FLING_VELOCITY_WINDOW_MS = 100    // 速度采样窗口（px/ms，与 drawer-swipe 一致）
  const FLING_SPEED_THRESHOLD = 0.2       // 触发惯性的最小松手速度（px/ms，低于即跟手停）
  const FLING_DECELERATION_RATE = 0.99    // iOS UIScrollView.DecelerationRate.fast（每 ms 保留比例）
  const FLING_STOP_SPEED = 0.005          // 停止阈值（px/ms，视觉不可见时才停 → 无急停感）
  const FLING_MAX_MS = 3000               // 最大时长（纯防死循环，指数衰减会提前自然收尾）
  const FLING_MAX_SPEED = 4               // 速度上限（px/ms，防失控滚太远；Android maxVelocity 标准约 5）

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
        // 已选中（文件 selected / Viewer viewer-selected）→ 直接拿起移动（不必长按）；
        // 其余（未选中图标 icon / 未选中 Viewer viewer / 空白 empty）→ 框选（划过触发选中）
        if (sg.hitType === 'selected' || sg.hitType === 'viewer-selected') {
          // sx/sy = 按下起点世界点（随事件携带，消费方可作命中基准）
          return { sg: Object.assign({}, next, { phase: 'dragmove' }), effect: { type: 'drag-start', x: x, y: y, sx: sg.startX, sy: sg.startY, hitType: sg.hitType } }
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
  // 单指 pan 惯性（动量）：_panSamples 记录最近一次 pan 的触点轨迹（VelocityTracker 采样），
  // 松手时用末段速度驱动 _flingVel（RAF 循环）；新手势/touchcancel/目录切换打断。
  let _panSamples = null // [{x, y, t}] 最近一次 pan 触点采样（viewport 局部坐标 + 时间戳）
  let _flingVel = null   // 惯性当前速度 {vx, vy}（px/ms），null = 无惯性在跑
  let _flingRaf = null   // 惯性 RAF id（借用 _raf(_caf) 驱动）
  let _flingT0 = 0       // 惯性起始时间（性能.now）
  let _flingLastT = 0    // 上一帧时间（性能.now）

  function toLocal(t) {
    if (!_rect) _rect = _viewport.getBoundingClientRect()
    return { x: t.clientX - _rect.left, y: t.clientY - _rect.top, t: Date.now() }
  }

  function toWorld(x, y) {
    return CAM.screenToWorld(x, y, _camera, _viewportW(), _viewportH())
  }

  // 视口尺寸（旋转中心用；gesture 缓存 _rect 优先，退化用 clientWidth/Height）
  function _viewportW() {
    return (_rect && _rect.width) || (_viewport ? _viewport.clientWidth : 0)
  }
  function _viewportH() {
    return (_rect && _rect.height) || (_viewport ? _viewport.clientHeight : 0)
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
    CAM.applyTo(_camera, _canvas, _viewportW(), _viewportH())
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
        if (_cb.onDragStart) _cb.onDragStart(toWorld(effect.x, effect.y), effect.hitType, toWorld(effect.sx, effect.sy))
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

  // ── RAF 驱动（无 RAF 环境兜底 setTimeout ~16ms）──
  function _now() {
    return (typeof performance === 'object' && typeof performance.now === 'function')
      ? performance.now() : Date.now()
  }
  function _raf(cb) {
    if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(cb)
    return setTimeout(function () { cb(_now()) }, 16)
  }
  function _caf(id) {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id)
    else clearTimeout(id)
  }

  // ── 单指 pan 惯性驱动（动量）：松手后按末段速度平滑滑行，指数摩擦衰减 ──
  // 触发（touchend pan 相位）：用 VelocityTracker 窗口速度；速度低于阈值不触发（跟手即停）。
  // 循环（RAF）：每帧 inertiaStep 步进 + _applyClamp 钳制（folder 边界 或 desktop 自由）+ commit。
  // 打断（onStart 新手势 / setCamera 目录切换 / touchcancel）：cancelFling 立即停，绝不让惯性
  // 与手势/动画抢相机——用户一碰或目录一切换就归直控。
  function startFling(vel) {
    if (!vel) return
    const speed = Math.sqrt(vel.vx * vel.vx + vel.vy * vel.vy)
    if (speed < FLING_SPEED_THRESHOLD) return   // 慢拖即停，不滑行
    // 速度上限（Android VelocityTracker maxVelocity 标准做法）：极用力甩的末段速度可能异常高，
    // 若原样授权会让惯性滚太远 —— 按比例缩到上限，方向不变。阈值已过才钳制（不误伤正常滑动）。
    let vx = vel.vx
    let vy = vel.vy
    if (speed > FLING_MAX_SPEED) {
      const k = FLING_MAX_SPEED / speed
      vx *= k
      vy *= k
    }
    _flingVel = { vx: vx, vy: vy }
    _flingT0 = _now()
    _flingLastT = _flingT0
    _flingRaf = _raf(flingFrame)
  }

  function flingFrame(now) {
    if (!_flingVel) { _flingRaf = null; return }
    const t = (typeof now === 'number') ? now : _now()
    const dt = Math.max(0, t - _flingLastT)
    _flingLastT = t
    const before = _camera
    const step = inertiaStep(before, _flingVel, dt)
    const clamped = _applyClamp(step.camera)
    _camera = clamped
    // 关键：把衰减后的速度写回 _flingVel —— 否则每一帧都用同一个初始速度，
    // 速度永不衰减 → 匀速无限滑（"滚太远""无摩擦"的根因，2026-08-25 真机反馈）。
    // 注意衰减后的 step.vel 才是本帧的当前速度，先写回再对钳制轴清零（清零优先覆盖）。
    _flingVel = { vx: step.vel.vx, vy: step.vel.vy }
    // 轴被钳制（本应移动但位置未变 → 撞到 folder 边界）：该轴速度清零，防贴边抖动/推墙。
    // desktop 空间无 onClamp → _applyClamp 原样返回，两轴都不会被清零，惯性自由衰减。
    if (clamped.x === before.x) _flingVel.vx = 0
    if (clamped.y === before.y) _flingVel.vy = 0
    commit()
    if (inertiaDone(_flingVel, t - _flingT0)) {
      _flingVel = null
      _flingRaf = null
      return
    }
    _flingRaf = _raf(flingFrame)
  }

  function cancelFling() {
    if (_flingRaf !== null) {
      _caf(_flingRaf)
      _flingRaf = null
    }
    _flingVel = null
  }

  // 记录一次 pan 触点采样（VelocityTracker 采样）：保留最近 100ms 窗口内的点，
  // 供松手时 windowVelocity 计算末段速度；窗口前的旧点丢弃（减小数组 + 速度更准）。
  function recordPanSample(x, y, t) {
    if (!_panSamples) _panSamples = []
    _panSamples.push({ x: x, y: y, t: t })
    const cut = t - FLING_VELOCITY_WINDOW_MS
    while (_panSamples.length > 1 && _panSamples[0].t < cut) _panSamples.shift()
  }

  function onStart(e) {
    if (!_rect) _rect = _viewport.getBoundingClientRect()
    // 任何真实手指落下都打断惯性（用户一碰就归手势直控）
    cancelFling()
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
      _panSamples = []   // 新手势清空上一次 pan 的速度采样
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
      _camera = _applyClamp(panZoomStep(_camera, _prevCentroid, curCentroid, _prevDist, curDist, _viewportW(), _viewportH()))
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
        recordPanSample(c.x, c.y, c.t)
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
      // 单指 pan 松手 → 惯性滑行（仅高级浏览模式 pan 相位，其他相位无 _panSamples）
      if (r.effect.type === 'pan-end') {
        recordPanSample(endLocal.x, endLocal.y, endLocal.t)   // 把松手点纳入窗口
        const vel = windowVelocity(_panSamples, FLING_VELOCITY_WINDOW_MS)
        _panSamples = []
        startFling(vel)
      }
    }
    syncMode()
  }

  function onCancel(e) {
    cancelLongPressTimer()
    cancelFling()   // touchcancel 打断惯性（系统接管即停，防残留滑行）
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
    cancelFling()   // 目录切换/外部重设相机 → 停掉在跑的惯性（否则惯性会覆盖新路径相机并越界漂移）
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
    _panSamples = []
    cancelFling()   // 复位惯性态，防上一实例残留 RAF 驱动
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
    windowVelocity: windowVelocity,
    inertiaStep: inertiaStep,
    inertiaDone: inertiaDone,
    createSingle: createSingle,
    singleDown: singleDown,
    singleMove: singleMove,
    singleLongPress: singleLongPress,
    singleCancel: singleCancel,
    singleUp: singleUp
  }
})()
