/* 桌面选择模块：选中集合 + 命中测试纯函数（可单测）。
 * 以文件名为 key（与 .desktop-layout.json 的 icons key 一致，阶段 D 对接）。
 * 依赖: namespace.js
 * 导出: App.DesktopSelection
 */
// @ts-check
'use strict'

App.DesktopSelection = (function () {
  // 归一化矩形：任意两个角点 → { x, y, w, h }（x/y = 左上角，w/h = 非负宽高）
  /** @param {number} ax @param {number} ay @param {number} bx @param {number} by @returns {Bounds2D} */
  function rectFromPoints(ax, ay, bx, by) {
    return {
      x: Math.min(ax, bx),
      y: Math.min(ay, by),
      w: Math.abs(bx - ax),
      h: Math.abs(by - ay)
    }
  }

  // AABB 相交判定（含边缘相切算相交）
  /** @param {Bounds2D} r1 @param {Bounds2D} r2 @returns {boolean} */
  function aabbIntersect(r1, r2) {
    return !(r1.x + r1.w < r2.x || r2.x + r2.w < r1.x ||
             r1.y + r1.h < r2.y || r2.y + r2.h < r1.y)
  }

  // 框选命中：世界坐标矩形 rect vs 图标边界表 bounds({name:{x,y,w,h}})
  // 返回命中的 name 数组（保持 bounds 遍历顺序，稳定可测）
  /** @param {Bounds2D} rect @param {Record<string, Bounds2D> | null} bounds @returns {Array<string>} */
  function marqueeHitTest(rect, bounds) {
    /** @type {Array<string>} */
    const hits = []
    const b = bounds || {}
    Object.keys(b).forEach(function (name) {
      if (aabbIntersect(rect, b[name])) hits.push(name)
    })
    return hits
  }

  // 点命中：世界坐标点 (wx, wy) → 命中的 name（重叠时后注册者优先，无则 null）
  /** @param {number} wx @param {number} wy @param {Record<string, Bounds2D> | null} bounds @returns {string | null} */
  function pointHitTest(wx, wy, bounds) {
    let found = null
    const b = bounds || {}
    Object.keys(b).forEach(function (name) {
      const bb = b[name]
      if (wx >= bb.x && wx <= bb.x + bb.w && wy >= bb.y && wy <= bb.y + bb.h) {
        found = name
      }
    })
    return found
  }

  // ── 选中集合（不可变风格：返回新 Set，便于追踪状态变化）──
  /** @param {string} name @returns {Set<string>} */
  function selectOnly(name) { return new Set([name]) }
  /** @param {Set<string> | null} sel @param {string} name @returns {Set<string>} */
  function add(sel, name) { const s = new Set(sel || []); s.add(name); return s }
  /** @param {Set<string> | null} sel @param {string} name @returns {Set<string>} */
  function remove(sel, name) { const s = new Set(sel || []); s.delete(name); return s }
  /** @param {Set<string> | null} sel @param {string} name @returns {Set<string>} */
  function toggle(sel, name) {
    const s = new Set(sel || [])
    if (s.has(name)) s.delete(name); else s.add(name)
    return s
  }
  /** @returns {Set<string>} */
  function clear() { return new Set() }

  // 选中组外接矩形（union AABB）：覆盖组内所有图标 + 空隙，空集返回 null
  /** @param {Record<string, Bounds2D>} bounds @param {Array<string>} names @returns {Bounds2D | null} */
  function unionRect(bounds, names) {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    names.forEach(function (n) {
      const b = bounds[n]
      if (!b) return
      if (b.x < minX) minX = b.x
      if (b.y < minY) minY = b.y
      if (b.x + b.w > maxX) maxX = b.x + b.w
      if (b.y + b.h > maxY) maxY = b.y + b.h
    })
    if (minX === Infinity) return null
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
  }

  // 点是否在矩形内（含边界）
  /** @param {number} px @param {number} py @param {Bounds2D | null} rect @returns {boolean} */
  function pointInRect(px, py, rect) {
    if (!rect) return false
    return px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h
  }

  /** @type {DesktopSelection} */
  return {
    rectFromPoints: rectFromPoints,
    aabbIntersect: aabbIntersect,
    marqueeHitTest: marqueeHitTest,
    pointHitTest: pointHitTest,
    selectOnly: selectOnly,
    add: add,
    remove: remove,
    toggle: toggle,
    clear: clear,
    unionRect: unionRect,
    pointInRect: pointInRect
  }
})()
