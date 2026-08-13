/* Drawer 手势：底栏右划跟手拉出 + Drawer 上跟手关闭（移植 LexiCull swipe.js 抽屉域）。
 * 手势规范（Material 风格，与 LexiCull 一致）：
 *   - 角度阈值 tan(25°)≈0.466，超过此角度的斜划释出为滚动
 *   - 松手决策：滑出 30% 宽度 或 末段速度 > 0.3 px/ms（fling 语义）
 *   - 速度采样：100ms 窗口（VelocityTracker 语义）
 * 依赖: namespace.js, drawer.js
 * 导出: App.DrawerSwipe（纯函数供单元测试）
 * 触发: 底栏右划（拉出）/ Drawer 或其遮罩上朝合拢方向滑（跟手关闭）
 */
'use strict'

App.DrawerSwipe = (function () {
  let DRAWER_WIDTH_FALLBACK = 280  // 抽屉宽度兜底值（px），实测失败时使用
  let DEADZONE = 6                 // px，死区内不触发任何变换
  let ANGLE_TAN = 0.466            // tan(25°)

  // 实测抽屉渲染宽度：CSS 为 78vw / max-width:320px，随屏幕分辨率变化。
  // 手势位移必须按实测宽度换算，否则行程末段不跟手。
  function drawerWidth() {
    let el = document.getElementById('drawer')
    return el && el.offsetWidth ? el.offsetWidth : DRAWER_WIDTH_FALLBACK
  }

  // ── 纯函数：末段瞬时速度（px/ms）──
  function segmentVelocity(deltaPx, dtMs) {
    if (typeof deltaPx !== 'number' || !isFinite(deltaPx)) return 0
    if (typeof dtMs !== 'number' || !isFinite(dtMs) || dtMs <= 0) return 0
    // 单帧下限 16ms：防除零 + 模拟一次 move 帧的最短采样窗口
    return deltaPx / Math.max(16, dtMs)
  }

  // ── 纯函数：100ms 采样窗口速度（VelocityTracker 语义）──
  function windowVelocity(samples) {
    if (!Array.isArray(samples) || samples.length < 2) return 0
    let s0 = samples[0]
    let s1 = samples[samples.length - 1]
    if (typeof s0.px !== 'number' || typeof s1.px !== 'number' ||
        typeof s0.t !== 'number' || typeof s1.t !== 'number') return 0
    if (s1.t <= s0.t) return 0
    return segmentVelocity(s1.px - s0.px, s1.t - s0.t)
  }

  // ── 纯函数：松手决策（progress 0..1，velocity px/ms）→ 'open' | 'close' ──
  function decideDrawerSettle(progress, velocity, thresholdP, thresholdV) {
    let tp = (typeof thresholdP === 'number' && isFinite(thresholdP)) ? thresholdP : 0.3
    let tv = (typeof thresholdV === 'number' && isFinite(thresholdV)) ? thresholdV : 0.3
    if (typeof progress !== 'number' || !isFinite(progress)) progress = 0
    if (typeof velocity !== 'number' || !isFinite(velocity)) velocity = 0
    return (progress > tp || velocity > tv) ? 'open' : 'close'
  }

  // 清掉手势期间的 inline 样式，让 CSS class + transition 接管动画
  function _clearInline(drawer, overlay) {
    if (drawer) { drawer.style.transition = ''; drawer.style.transform = '' }
    if (overlay) { overlay.style.transition = ''; overlay.style.opacity = '' }
  }

  // ── 底栏右划跟手拉出 Drawer ──
  function setupDrawerReveal() {
    let bar = document.getElementById('bottom-bar')
    if (!bar) return
    let state = 'idle'            // 'idle' | 'deciding' | 'drawer'
    let startX = 0, startY = 0
    let _drawerW = DRAWER_WIDTH_FALLBACK
    let _drawerPx = -DRAWER_WIDTH_FALLBACK
    let _overlay = null
    let _samplePts = []

    bar.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) return
      // Drawer 已打开时不做拉出（关闭手势由 drawer 自身接管）
      if (App.Drawer && typeof App.Drawer.isOpen === 'function' && App.Drawer.isOpen()) return
      startX = e.touches[0].clientX
      startY = e.touches[0].clientY
      _drawerW = drawerWidth()
      _drawerPx = -_drawerW
      _samplePts = [{ px: -_drawerW, t: Date.now() }]
      state = 'deciding'
    }, { passive: true })

    bar.addEventListener('touchmove', function (e) {
      if (state === 'idle') return
      let x = e.touches[0].clientX
      let y = e.touches[0].clientY
      let dx = x - startX
      let dy = y - startY

      if (state === 'deciding') {
        if (Math.abs(dx) < DEADZONE && Math.abs(dy) < DEADZONE) return
        // 底栏右滑且水平占优（≤25°）→ 抽屉手势；否则放弃本次
        if (dx > 0 && Math.abs(dy) <= Math.abs(dx) * ANGLE_TAN) {
          state = 'drawer'
          let d = document.getElementById('drawer')
          let o = document.getElementById('drawer-overlay')
          if (d) d.style.transition = 'none'
          if (o) o.style.transition = 'none'
          _overlay = o
        } else {
          state = 'idle'
          return
        }
      }
      if (state !== 'drawer') return

      // 从触摸原点跟手：直接落到「已滑出 dx」的位置
      _drawerPx = Math.min(0, -_drawerW + dx)
      let now = Date.now()
      _samplePts.push({ px: _drawerPx, t: now })
      while (_samplePts.length > 1 && now - _samplePts[0].t > 100) _samplePts.shift()
      let d = document.getElementById('drawer')
      if (d) d.style.transform = 'translateX(' + _drawerPx + 'px)'
      if (_overlay) _overlay.style.opacity = String(Math.min(1, Math.abs(_drawerPx) / _drawerW))
      e.preventDefault()
    }, { passive: false })

    bar.addEventListener('touchend', function () {
      if (state !== 'drawer') { state = 'idle'; return }
      state = 'idle'
      let progress = (_drawerPx + _drawerW) / _drawerW
      let velocity = windowVelocity(_samplePts)
      let d = document.getElementById('drawer')
      _clearInline(d, _overlay)
      if (decideDrawerSettle(progress, velocity) === 'open') {
        if (App.Drawer && typeof App.Drawer.open === 'function') App.Drawer.open()
      }
      _overlay = null
    }, { passive: true })

    bar.addEventListener('touchcancel', function () {
      if (state !== 'drawer') { state = 'idle'; return }
      state = 'idle'
      let d = document.getElementById('drawer')
      _clearInline(d, _overlay)
      _overlay = null
    }, { passive: true })
  }

  // ── Drawer 打开后，在 Drawer 或遮罩上朝合拢方向滑动，跟手关闭 ──
  function setupDrawerCloseSwipe() {
    let drawer = document.getElementById('drawer')
    let overlay = document.getElementById('drawer-overlay')
    if (!drawer || !overlay) return

    let _sx = 0, _sy = 0
    let _state = 'idle'  // 'idle' | 'tracking' | 'closing'
    let _width = DRAWER_WIDTH_FALLBACK
    let _samplePts = []

    function handleStart(e) {
      if (e.touches.length !== 1) return
      if (!drawer.classList.contains('drawer-open')) return
      // 触摸可交互元素时不启动关闭手势（按钮走 bindPress，输入框走键盘）
      let t = e.target
      if (t && (t.tagName === 'BUTTON' || t.tagName === 'INPUT' ||
                t.tagName === 'TEXTAREA' || t.tagName === 'A' ||
                t.tagName === 'SELECT')) return
      if (t && t.closest('button, input, textarea, a, select')) return
      _sx = e.touches[0].clientX
      _sy = e.touches[0].clientY
      _samplePts = []
      _state = 'tracking'
      _width = drawer.offsetWidth || DRAWER_WIDTH_FALLBACK
    }

    function handleMove(e) {
      if (_state === 'idle') return
      let dx = e.touches[0].clientX - _sx
      let dy = e.touches[0].clientY - _sy

      if (_state === 'tracking') {
        if (Math.abs(dx) < DEADZONE && Math.abs(dy) < DEADZONE) return
        // 超过 25° 的斜划释出为滚动
        if (Math.abs(dy) > Math.abs(dx) * ANGLE_TAN) { _state = 'idle'; return }
        // 左抽屉合拢 = 左滑 dx<0（右滑 = 拉开，丢弃）
        if (dx > 0) { _state = 'idle'; return }
        _state = 'closing'
        drawer.style.transition = 'none'
        overlay.style.transition = 'none'
      }

      if (_state !== 'closing') return

      // 跟手：合拢进度 dist（正 = 朝合拢方向），左抽屉镜像位移
      let dist = Math.min(_width, Math.abs(dx))
      drawer.style.transform = 'translateX(' + (-dist) + 'px)'
      overlay.style.opacity = String(Math.max(0, 1 - dist / _width))
      let now = Date.now()
      _samplePts.push({ px: dist, t: now })
      while (_samplePts.length > 1 && now - _samplePts[0].t > 100) _samplePts.shift()
      e.preventDefault()
    }

    function handleEnd(e) {
      if (_state !== 'closing') { _state = 'idle'; return }
      _state = 'idle'
      let dist = Math.abs((e && e.changedTouches && e.changedTouches[0]
        ? e.changedTouches[0].clientX : 0) - _sx)
      let progress = Math.min(_width, dist) / _width
      let velocity = windowVelocity(_samplePts)
      _clearInline(drawer, overlay)
      // 决策方向：progress 为合拢进度、velocity 为合拢速度（均朝关闭方向），
      // 滑出 30% 或快速甩出 → 'open' → 关闭；否则弹回保持打开。
      if (decideDrawerSettle(progress, velocity) === 'open') {
        if (App.Drawer && typeof App.Drawer.close === 'function') App.Drawer.close()
      } else {
        if (App.Drawer && typeof App.Drawer.open === 'function') App.Drawer.open()
      }
    }

    function handleCancel() {
      _state = 'idle'
      _clearInline(drawer, overlay)
      if (App.Drawer && typeof App.Drawer.open === 'function') App.Drawer.open()
    }

    // capture:true 确保在 bindPress 之前拦截（drawer 内按钮 touchstart 已被跳过）
    drawer.addEventListener('touchstart', handleStart, { passive: true })
    drawer.addEventListener('touchmove', handleMove, { passive: false, capture: true })
    drawer.addEventListener('touchend', handleEnd, { capture: true })
    drawer.addEventListener('touchcancel', handleCancel, { passive: true })
    overlay.addEventListener('touchstart', handleStart, { passive: true })
    overlay.addEventListener('touchmove', handleMove, { passive: false })
    overlay.addEventListener('touchend', handleEnd, { passive: true })
    overlay.addEventListener('touchcancel', handleCancel, { passive: true })
  }

  function init() {
    setupDrawerReveal()
    setupDrawerCloseSwipe()
  }

  return {
    init: init,
    segmentVelocity: segmentVelocity,
    windowVelocity: windowVelocity,
    decideDrawerSettle: decideDrawerSettle
  }
})()
