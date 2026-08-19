/* 共享拖拽排序引擎（移植自 LexiCull）：FLIP 智能避让 + 边缘自动滚动。
 * 列表项保持 touch-action: pan-y（正常滚动），startDrag 时仅给被拖项设 inline
 * touch-action: none；长按定时器在手指首次移动前触发，浏览器尚未抢手势，
 * 此后 document 级 touchmove preventDefault 接管，拖拽与列表滚动互不干扰。
 * 依赖: namespace.js
 * 导出: App.dragSort
 */
'use strict'

App.dragSort = (function () {
  let _dragSortActiveEngine = null

  // 全局拖拽活跃查询（外部模块借此屏蔽冲突行为）
  function isDragSortActive() {
    return _dragSortActiveEngine !== null
  }

  function createDragSortEngine(config) {
    const EDGE_ZONE_TOP = config.edgeZoneTop || config.edgeZone || 72
    const EDGE_ZONE_BOTTOM = config.edgeZoneBottom || config.edgeZone || 72
    const MIN_SCROLL = config.minScroll || 3
    const MAX_SCROLL = config.maxScroll || 18
    const HARD_MAX_SCROLL = config.hardMaxScroll || 48
    const OVERSHOOT_GAIN = config.overshootGain || 0.18
    const DRAG_THRESHOLD = config.dragThreshold || 4
    /** @type {any} */
    let _state = null

    function getPointY(e) {
      return (e.touches && e.touches[0]) ? e.touches[0].clientY : e.clientY
    }

    function currentDelta(e) {
      return getPointY(e) - _state.startY + _state.scrollComp
    }

    function applyDragTransform() {
      const d = _state
      const delta = d._lastDelta != null ? d._lastDelta : 0
      d.item.style.transform = 'translateY(' + delta + 'px)'
      const divider = d.metrics[d.origIndex].divider
      if (divider) divider.style.transform = 'translateY(' + delta + 'px)'
    }

    function onDragMove(e) {
      if (!_state) return
      e.preventDefault()
      const d = _state
      d._lastDelta = currentDelta(e)

      checkEdgeScroll(getPointY(e))

      if (!d.active) {
        if (Math.abs(d._lastDelta) < DRAG_THRESHOLD) return
        d.active = true
        relayout()
        if (typeof config.onDragActivate === 'function') config.onDragActivate()
      }
      applyDragTransform()
      updateGhostIndex()
    }

    function updateGhostIndex() {
      const d = _state
      const m = d.metrics[d.origIndex]
      const dragTop = m.top + d._lastDelta
      const dragBottom = dragTop + m.height
      let idx = 0
      d.metrics.forEach(function (mm, i) {
        if (i === d.origIndex) return
        const mmBottom = mm.top + mm.height
        const ref = Math.min(m.height, mm.height) * 0.5
        if (mm.top < m.top) {
          if (dragTop > mmBottom - ref) idx++
        } else {
          if (dragTop >= mmBottom || dragBottom - mm.top >= ref) idx++
        }
      })
      if (idx !== d.ghostIndex) {
        d.ghostIndex = idx
        relayout()
      }
    }

    function relayout() {
      const d = _state
      const order = []
      for (let i = 0; i < d.items.length; i++) if (i !== d.origIndex) order.push(i)
      order.splice(d.ghostIndex, 0, d.origIndex)

      let y = d.metrics[0].top
      const tops = {}
      order.forEach(function (idx) { tops[idx] = y; y += d.metrics[idx].footprint })
      d.finalTops = tops

      d.metrics.forEach(function (mm, i) {
        if (i === d.origIndex) return
        const t = tops[i] - mm.top
        mm.el.style.transform = 'translateY(' + t + 'px)'
        if (mm.divider) mm.divider.style.transform = 'translateY(' + t + 'px)'
      })

      d.items.forEach(function (el) { el.classList.remove(config.targetClass) })
      const displaced = d.ghostIndex > d.origIndex
        ? order[d.ghostIndex - 1]
        : (d.ghostIndex < d.origIndex ? order[d.ghostIndex + 1] : null)
      if (displaced != null) d.metrics[displaced].el.classList.add(config.targetClass)
    }

    function insetOf(key) {
      const v = config[key]
      if (typeof v === 'function') return Math.max(0, v() || 0)
      return Math.max(0, v || 0)
    }

    function edgeScrollSpeed(over, zone) {
      const t = Math.min(1, over / zone)
      let speed = MIN_SCROLL + (MAX_SCROLL - MIN_SCROLL) * Math.pow(t, 1.6)
      const beyond = Math.max(0, over - zone)
      if (beyond > 0) {
        speed = Math.min(HARD_MAX_SCROLL, speed + beyond * OVERSHOOT_GAIN)
      }
      return speed
    }

    function checkEdgeScroll(clientY) {
      const d = _state
      const r = d.list.getBoundingClientRect()
      const topEdge = r.top + insetOf('edgeInsetTop')
      const bottomEdge = r.bottom - insetOf('edgeInsetBottom')
      let speed = 0
      const topOver = (topEdge + EDGE_ZONE_TOP) - clientY
      const bottomOver = clientY - (bottomEdge - EDGE_ZONE_BOTTOM)
      if (topOver > 0) {
        speed = -edgeScrollSpeed(topOver, EDGE_ZONE_TOP)
      } else if (bottomOver > 0) {
        speed = edgeScrollSpeed(bottomOver, EDGE_ZONE_BOTTOM)
      }
      d.scrollSpeed = speed
      if (speed !== 0 && d.raf == null) {
        d.raf = requestAnimationFrame(autoScrollTick)
      }
    }

    function autoScrollTick() {
      const d = _state
      if (!d) return
      if (d.scrollSpeed === 0) { d.raf = null; return }
      const before = d.list.scrollTop
      const next = Math.max(0, Math.min(d.maxScrollTop, before + d.scrollSpeed))
      d.list.scrollTop = next
      const actual = next - before
      if (actual !== 0) {
        d.scrollComp += actual
        d._lastDelta = (d._lastDelta || 0) + actual
        if (!d.active && Math.abs(d._lastDelta) >= DRAG_THRESHOLD) {
          d.active = true
          relayout()
          if (typeof config.onDragActivate === 'function') config.onDragActivate()
        }
        if (d.active) {
          applyDragTransform()
          updateGhostIndex()
        }
      }
      d.raf = requestAnimationFrame(autoScrollTick)
    }

    function onDragEnd() {
      const d = _state
      if (!d) return
      _state = null
      _dragSortActiveEngine = null

      document.removeEventListener('touchmove', onDragMove)
      document.removeEventListener('touchend', onDragEnd)
      document.removeEventListener('touchcancel', onDragEnd)
      if (d.raf != null) cancelAnimationFrame(d.raf)
      d.list.classList.remove(config.dragActiveClass)
      d.item.style.touchAction = ''

      d.item.dataset._dragSortJustFinished = '1'
      setTimeout(function () { if (d.item) d.item.dataset._dragSortJustFinished = '' }, 120)
      if (!d.active) {
        d.item.classList.remove(config.dragClass)
        d.item.style.zIndex = ''
        d.item.style.position = ''
        d.item.style.transform = ''
        d.item.style.transition = ''
        const dv0 = d.metrics[d.origIndex].divider
        if (dv0) dv0.style.transition = ''
        return
      }

      const from = d.origIndex, to = d.ghostIndex

      const target = d.finalTops[from] - d.metrics[from].top
      d.item.style.transition = 'transform .22s cubic-bezier(.2,.8,.2,1)'
      d.item.style.transform = 'translateY(' + target + 'px)'
      d.item.classList.remove(config.dragClass)
      d.item.style.zIndex = ''
      d.item.style.position = ''
      const divider = d.metrics[from].divider
      if (divider) {
        divider.style.transition = 'transform .22s cubic-bezier(.2,.8,.2,1)'
        divider.style.transform = 'translateY(' + target + 'px)'
      }
      d.items.forEach(function (el) { el.classList.remove(config.targetClass) })

      let done = false
      function commit() {
        if (done) return
        done = true
        if (typeof config.onCommit === 'function') {
          config.onCommit(from, to)
        }
      }
      d.item.addEventListener('transitionend', function h() {
        d.item.removeEventListener('transitionend', h)
        commit()
      })
      setTimeout(commit, 300)
    }

    function startDrag(itemEl, clientY) {
      if (!config.isActive || !config.isActive()) return
      if (_state) return

      const list = config.container
      const items = Array.prototype.slice.call(list.querySelectorAll(config.itemSelector))
      if (items.indexOf(itemEl) < 0) return

      if (typeof config.onDragStart === 'function') config.onDragStart()

      const listRect = list.getBoundingClientRect()
      const metrics = items.map(function (el) {
        const r = el.getBoundingClientRect()
        const next = el.nextElementSibling
        let divider = null
        if (config.dividerSelector && next) {
          divider = next.matches(config.dividerSelector) ? next : null
        }
        return {
          el: el,
          divider: divider,
          top: r.top - listRect.top + list.scrollTop,
          height: r.height + (divider ? divider.getBoundingClientRect().height : 0),
          footprint: 0
        }
      })
      for (let i = 0; i < metrics.length; i++) {
        if (i < metrics.length - 1) {
          metrics[i].footprint = metrics[i + 1].top - metrics[i].top
        } else {
          const prevGap = metrics.length > 1
            ? metrics[i].top - metrics[i - 1].top - metrics[i - 1].height
            : 0
          metrics[i].footprint = metrics[i].height + prevGap
        }
      }

      const origIndex = items.indexOf(itemEl)

      _state = {
        list: list,
        item: itemEl,
        items: items,
        metrics: metrics,
        origIndex: origIndex,
        ghostIndex: origIndex,
        startY: clientY,
        scrollComp: 0,
        scrollSpeed: 0,
        maxScrollTop: Math.max(0, list.scrollHeight - list.clientHeight),
        raf: null,
        active: false,
        finalTops: null
      }
      _dragSortActiveEngine = config

      itemEl.classList.add(config.dragClass)
      itemEl.style.position = 'relative'
      itemEl.style.zIndex = 10
      itemEl.style.touchAction = 'none'
      list.classList.add(config.dragActiveClass)
      if (metrics[origIndex].divider) {
        metrics[origIndex].divider.style.transition = 'none'
      }

      document.addEventListener('touchmove', onDragMove, { passive: false })
      document.addEventListener('touchend', onDragEnd, { passive: true })
      document.addEventListener('touchcancel', onDragEnd, { passive: true })
    }

    function cleanup() {
      if (_state) {
        if (_state.raf != null) cancelAnimationFrame(_state.raf)
        document.removeEventListener('touchmove', onDragMove)
        document.removeEventListener('touchend', onDragEnd)
        document.removeEventListener('touchcancel', onDragEnd)
        _state.item.style.touchAction = ''
        _state = null
      }
      _dragSortActiveEngine = null
      config.container.classList.remove(config.dragActiveClass)
      config.container.querySelectorAll(config.itemSelector).forEach(function (el) {
        el.classList.remove(config.dragClass, config.targetClass)
        el.style.transform = ''
        el.style.transition = ''
        el.style.zIndex = ''
        el.style.position = ''
        el.style.touchAction = ''
      })
      if (config.dividerSelector) {
        config.container.querySelectorAll(config.dividerSelector).forEach(function (dv) {
          dv.style.transform = ''
          dv.style.transition = ''
        })
      }
    }

    return {
      startDrag: startDrag,
      cleanup: cleanup,
      isDragging: function () { return _state !== null },
      config: config
    }
  }

  return {
    isDragSortActive: isDragSortActive,
    createDragSortEngine: createDragSortEngine
  }
})()
