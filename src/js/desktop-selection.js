/* 桌面选择模块：选中集合 + 命中测试纯函数（可单测）。
 * 以文件名为 key（与 .desktop-layout.json 的 icons key 一致，阶段 D 对接）。
 * 依赖: namespace.js
 * 导出: App.DesktopSelection
 */
'use strict'

App.DesktopSelection = (function () {
  // 归一化矩形：任意两个角点 → { x, y, w, h }（x/y = 左上角，w/h = 非负宽高）
  function rectFromPoints(ax, ay, bx, by) {
    return {
      x: Math.min(ax, bx),
      y: Math.min(ay, by),
      w: Math.abs(bx - ax),
      h: Math.abs(by - ay)
    }
  }

  // AABB 相交判定（含边缘相切算相交）
  function aabbIntersect(r1, r2) {
    return !(r1.x + r1.w < r2.x || r2.x + r2.w < r1.x ||
             r1.y + r1.h < r2.y || r2.y + r2.h < r1.y)
  }

  // 框选命中：世界坐标矩形 rect vs 图标边界表 bounds({name:{x,y,w,h}})
  // 返回命中的 name 数组（保持 bounds 遍历顺序，稳定可测）
  function marqueeHitTest(rect, bounds) {
    const hits = []
    Object.keys(bounds || {}).forEach(function (name) {
      if (aabbIntersect(rect, bounds[name])) hits.push(name)
    })
    return hits
  }

  // 点命中：世界坐标点 (wx, wy) → 命中的 name（重叠时后注册者优先，无则 null）
  function pointHitTest(wx, wy, bounds) {
    let found = null
    Object.keys(bounds || {}).forEach(function (name) {
      const b = bounds[name]
      if (wx >= b.x && wx <= b.x + b.w && wy >= b.y && wy <= b.y + b.h) {
        found = name
      }
    })
    return found
  }

  // ── 选中集合（不可变风格：返回新 Set，便于追踪状态变化）──
  function selectOnly(name) { return new Set([name]) }
  function add(sel, name) { const s = new Set(sel || []); s.add(name); return s }
  function remove(sel, name) { const s = new Set(sel || []); s.delete(name); return s }
  function toggle(sel, name) {
    const s = new Set(sel || [])
    if (s.has(name)) s.delete(name); else s.add(name)
    return s
  }
  function clear() { return new Set() }

  return {
    rectFromPoints: rectFromPoints,
    aabbIntersect: aabbIntersect,
    marqueeHitTest: marqueeHitTest,
    pointHitTest: pointHitTest,
    selectOnly: selectOnly,
    add: add,
    remove: remove,
    toggle: toggle,
    clear: clear
  }
})()
