/* 职责: Morph FAB 悬浮球拖拽定位——按住左右滑动切换左/右档位，拖动态显示原位影子与对侧候选位置
 * 移植自 LexiCull fab-drag.js，适配 Desktop：
 *   - 空闲态判定：Speed Dial 展开 / 取景器激活 / 弹窗打开 禁拖（Desktop 无辞书排序/学习态）
 *   - 持久化：localStorage desktop_fab_position（Desktop 无通用设置模块，默认开启，无开关）
 *   - 幽灵提示 z-index 1498（低于 FAB 1500 / backdrop 1499，高于页面其余层）
 *   - 与 bindPress（短按展开）+ inspector（长按 800ms 取景器）协调：
 *     拖动开始 dispatch touchcancel → bindPress 作废本次点击、inspector 清长按 timer
 * 依赖: namespace.js, bridge.js, fab-speed-dial.js, inspector.js
 * 导出: App.fabDrag
 * 副作用: 拖动态运行时创建/销毁幽灵提示元素；localStorage desktop_fab_position
 */
'use strict'

App.fabDrag = (function () {
  let FAB_ID = 'mode-switch-fab'
  let POS_KEY = 'desktop_fab_position'
  let DRAG_THRESHOLD = 15    // 位移超过此值判定为拖动（> Android 8dp touch slop 防手指抖动）
  let DRAG_FLING_MS = 120    // 甩动速度采样窗口（松手前）
  let DRAG_FLING_VELOCITY = 1.0  // px/ms：窗口内速度超此值判定为甩动
  let EDGE = 28              // 与 fab.css right/left 边距保持一致
  let FAB_SIZE = 36
  let SNAP_MS = 240          // 吸附动画时长，与 .fab-snapping transition 一致

  let _dragging = false
  let _potential = false     // touchstart 已记录、未决（可能是 tap 也可能是拖动）
  let _startX = 0
  let _startY = 0
  let _startT = 0
  let _baseLeft = 0
  let _baseTop = 0
  let _velSamples = []
  let _ghosts = []

  function _getFab() { return document.getElementById(FAB_ID) }

  // ── 空闲态判定：仅空闲态允许拖动 ──
  // 其余状态（菜单展开 / 取景器激活 / 弹窗打开）FAB 是操作出口，禁拖
  function _isIdle() {
    if (App.fabSpeedDial && typeof App.fabSpeedDial.isExpanded === 'function' && App.fabSpeedDial.isExpanded()) return false
    if (App.inspector && typeof App.inspector.isActive === 'function' && App.inspector.isActive()) return false
    if (document.querySelector('.dialog-overlay.dialog-overlay-visible')) return false
    return true
  }

  function _readPosition() {
    try { return localStorage.getItem(POS_KEY) === 'left' ? 'left' : 'right' } catch (e) { return 'right' }
  }
  function _savePosition(pos) {
    try { localStorage.setItem(POS_KEY, pos) } catch (e) { /* 忽略 */ }
  }
  function _applyPosition(pos) {
    document.body.classList.toggle('fab-pos-left', pos === 'left')
  }

  function getPosition() { return _readPosition() }

  function setPosition(pos) {
    const target = pos === 'left' ? 'left' : 'right'
    _savePosition(target)
    _applyPosition(target)
    return target
  }

  // ── 幽灵提示：原位占位 + 对侧候选（虚线描边 + 半透明「+」矢量图） ──
  function _makeGhost(left, top) {
    const el = document.createElement('div')
    el.className = 'fab-drag-ghost'
    el.style.left = left + 'px'
    el.style.top = top + 'px'
    el.innerHTML = '<svg class="fab-drag-ghost-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><use href="#icon-plus"/></svg>'
    document.body.appendChild(el)
    return el
  }

  function _spawnGhosts(fabRect, vw) {
    _ghosts.push(_makeGhost(fabRect.left, fabRect.top))
    const targetLeft = (fabRect.left < vw / 2) ? vw - EDGE - FAB_SIZE : EDGE
    _ghosts.push(_makeGhost(targetLeft, fabRect.top))
  }

  function _clearGhosts() {
    for (let i = 0; i < _ghosts.length; i++) {
      const el = _ghosts[i]
      if (el && el.parentNode) el.parentNode.removeChild(el)
    }
    _ghosts = []
  }

  // ── 进入拖动 ──
  function _beginDrag() {
    _dragging = true
    // 取消取景器长按 800ms timer，防止拖动态误触发
    if (App.inspector && typeof App.inspector.cancelFabTimer === 'function') App.inspector.cancelFabTimer()
    const fab = _getFab()
    // 通知 bindPress / inspector 本次触摸作废（touchcancel 清 pressed + 长按 timer）
    try { fab.dispatchEvent(new TouchEvent('touchcancel')) } catch (e) { try { fab.dispatchEvent(new Event('touchcancel')) } catch (e2) {} }
    const r = fab.getBoundingClientRect()
    _baseLeft = r.left
    _baseTop = r.top
    _velSamples = [{ x: _startX, t: _startT }]
    const vw = document.documentElement.clientWidth
    _spawnGhosts(r, vw)
    fab.classList.add('fab-dragging')
    fab.style.left = _baseLeft + 'px'
    fab.style.top = _baseTop + 'px'
    if (fab.style.right) fab.style.removeProperty('right')
    // 进入拖动轻震（10ms/振幅70）：确认已进入拖动态
    if (App.bridge && typeof App.bridge.vibrate === 'function') App.bridge.vibrate(10, 70)
  }

  // ── 手势：FAB 上 touchstart（记录起点） ──
  function _onTouchStart(e) {
    if (!_isIdle()) return
    _potential = true
    _startX = e.touches[0].clientX
    _startY = e.touches[0].clientY
    _startT = Date.now()
  }

  // ── 手势：FAB 上 touchmove（首次超阈值进入拖动，preventDefault 抢占手势） ──
  function _onFabTouchMove(e) {
    if (!_potential || _dragging) return
    const t = e.touches[0]
    if (Math.abs(t.clientX - _startX) < DRAG_THRESHOLD && Math.abs(t.clientY - _startY) < DRAG_THRESHOLD) return
    e.preventDefault()
    _beginDrag()
  }

  // ── 手势：document touchmove（拖动跟手，水平/垂直自由；同步甩动速度采样） ──
  function _onDocTouchMove(e) {
    if (!_dragging) return
    e.preventDefault()
    const fab = _getFab()
    if (!fab) return
    const vw = document.documentElement.clientWidth
    const vh = document.documentElement.clientHeight
    const now = Date.now()
    const tx = e.touches[0].clientX
    _velSamples.push({ x: tx, t: now })
    while (_velSamples.length > 1 && now - _velSamples[0].t > DRAG_FLING_MS) _velSamples.shift()
    const dx = tx - _startX
    const dy = e.touches[0].clientY - _startY
    const minLeft = 0
    const maxLeft = vw - FAB_SIZE
    let left = _baseLeft + dx
    if (left < minLeft) left = minLeft
    if (left > maxLeft) left = maxLeft
    let top = _baseTop + dy
    if (top < 0) top = 0
    if (top > vh - FAB_SIZE) top = vh - FAB_SIZE
    fab.style.left = left + 'px'
    fab.style.top = top + 'px'
  }

  // ── 甩动判定：窗口内水平速度超阈值 → 返回方向（1 右 / -1 左），否则 0 ──
  function _getFlingDir() {
    if (_velSamples.length < 2) return 0
    const first = _velSamples[0]
    const last = _velSamples[_velSamples.length - 1]
    const dt = last.t - first.t
    if (dt <= 0) return 0
    const vx = (last.x - first.x) / dt
    if (Math.abs(vx) < DRAG_FLING_VELOCITY) return 0
    return vx > 0 ? 1 : -1
  }

  // ── 松手：甩动优先（方向判定），否则就近吸附到左/右档位 ──
  // 吸附 = left/top 终点同时写入，由 .fab-snapping 的同步 transition 插值 → 对角线直线最短路径
  function _finishDrag(fab, restore) {
    const vw = document.documentElement.clientWidth
    const vh = document.documentElement.clientHeight
    let pos
    if (!restore) {
      const fling = _getFlingDir()
      if (fling !== 0) pos = fling > 0 ? 'right' : 'left'
      else pos = (fab.getBoundingClientRect().left + FAB_SIZE / 2) < vw / 2 ? 'left' : 'right'
    } else {
      pos = getPosition()
    }
    const targetLeft = (pos === 'left') ? EDGE : vw - EDGE - FAB_SIZE
    // 目标 top = CSS bottom 定位的等效像素（读计算值，--safe-bottom/键盘态动态调整时仍准确）
    const bottomPx = parseFloat(getComputedStyle(fab).bottom) || 0
    const targetTop = vh - bottomPx - FAB_SIZE
    fab.classList.add('fab-snapping')
    fab.style.left = targetLeft + 'px'
    fab.style.top = targetTop + 'px'
    if (!restore) setPosition(pos)
    setTimeout(function () {
      fab.classList.remove('fab-snapping')
      fab.classList.remove('fab-dragging')
      fab.style.removeProperty('left')
      fab.style.removeProperty('top')
      _clearGhosts()
      // 吸附完成确认震（20ms/振幅110）：表示已落位
      if (!restore && App.bridge && typeof App.bridge.vibrate === 'function') App.bridge.vibrate(20, 110)
    }, SNAP_MS + 40)
  }

  function _onTouchEnd() {
    if (_dragging) {
      const fab = _getFab()
      if (fab) _finishDrag(fab, false)
    }
    _dragging = false
    _potential = false
    _velSamples = []
  }

  function _onTouchCancel() {
    if (_dragging) {
      const fab = _getFab()
      if (fab) _finishDrag(fab, true)
    }
    _dragging = false
    _potential = false
    _velSamples = []
  }

  // ── 初始化 ──
  function init() {
    const fab = _getFab()
    if (!fab) return
    fab.addEventListener('touchstart', _onTouchStart, { passive: true })
    fab.addEventListener('touchmove', _onFabTouchMove, { passive: false })
    document.addEventListener('touchmove', _onDocTouchMove, { passive: false })
    document.addEventListener('touchend', _onTouchEnd, { passive: true })
    document.addEventListener('touchcancel', _onTouchCancel, { passive: true })
    _applyPosition(getPosition())
  }

  return {
    init: init,
    getPosition: getPosition,
    setPosition: setPosition,
    isDragging: function () { return _dragging }
  }
})()
