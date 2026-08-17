/* 桌面网格系统：网格吸附 + 放置避让（纯函数，可单测）。
 * 网格：origin (16,16) + step (100,92)，图标左上角对齐网格交点，一格一图标。
 * 避让（参考成熟方案 iOS/Android 主屏「重叠者让位到最近空位」）：
 *   放置组放期望位；与之重叠的静止图标按曼哈顿距离递增，挤到最近空 cell。
 * 依赖: namespace.js
 * 导出: App.DesktopGrid
 */
// @ts-check
'use strict'

App.DesktopGrid = (function () {
  const ORIGIN_X = 16
  const ORIGIN_Y = 16
  const GRID_W = 100
  const GRID_H = 92

  // 世界坐标 → 网格交点（吸附）
  /** @param {number} x @param {number} y @returns {Position2D} */
  function snapToGrid(x, y) {
    return {
      x: ORIGIN_X + Math.round((x - ORIGIN_X) / GRID_W) * GRID_W,
      y: ORIGIN_Y + Math.round((y - ORIGIN_Y) / GRID_H) * GRID_H
    }
  }

  // 世界坐标 → cell 坐标
  /** @param {number} x @param {number} y @returns {CellCoord} */
  function worldToCell(x, y) {
    return {
      cx: Math.round((x - ORIGIN_X) / GRID_W),
      cy: Math.round((y - ORIGIN_Y) / GRID_H)
    }
  }

  // cell 坐标 → 世界坐标
  /** @param {number} cx @param {number} cy @returns {Position2D} */
  function cellToWorld(cx, cy) {
    return { x: ORIGIN_X + cx * GRID_W, y: ORIGIN_Y + cy * GRID_H }
  }

  // BFS 找最近空 cell：邻居顺序「右、下、左、上」，符合桌面从左到右、换行向下的排列习惯
  /** @param {number} cx @param {number} cy @param {Set<string>} taken @returns {CellCoord} */
  function findFreeCell(cx, cy, taken) {
    if (!taken.has(cx + ',' + cy)) return { cx: cx, cy: cy }
    const queue = [{ cx: cx, cy: cy }]
    const visited = new Set([cx + ',' + cy])
    const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]]
    let head = 0
    while (head < queue.length) {
      const cur = queue[head++]
      for (let i = 0; i < dirs.length; i++) {
        const nx = cur.cx + dirs[i][0]
        const ny = cur.cy + dirs[i][1]
        const key = nx + ',' + ny
        if (visited.has(key)) continue
        visited.add(key)
        if (!taken.has(key)) return { cx: nx, cy: ny }
        queue.push({ cx: nx, cy: ny })
      }
    }
    return { cx: cx, cy: cy }
  }

  // 放置避让：moving（移动组，世界坐标已吸附）放期望位，冲突的 statics 让位到最近空位。
  // 返回 { name: {x,y} }（移动组 + 被挤开的静止图标）
  /** @param {Array<{name: string, x: number, y: number}>} moving @param {Array<{name: string, x: number, y: number}>} statics @returns {Record<string, Position2D>} */
  function resolvePlacement(moving, statics) {
    /** @type {Set<string>} */
    const occupied = new Set()
    moving.forEach(function (m) {
      const c = worldToCell(m.x, m.y)
      occupied.add(c.cx + ',' + c.cy)
    })

    /** @type {Record<string, Position2D>} */
    const result = {}
    moving.forEach(function (m) {
      const c = worldToCell(m.x, m.y)
      result[m.name] = cellToWorld(c.cx, c.cy)
    })

    const taken = new Set(occupied)
    statics.forEach(function (s) {
      const c = worldToCell(s.x, s.y)
      const key = c.cx + ',' + c.cy
      if (taken.has(key)) {
        const free = findFreeCell(c.cx, c.cy, taken)
        taken.add(free.cx + ',' + free.cy)
        result[s.name] = cellToWorld(free.cx, free.cy)
      } else {
        taken.add(key)
        result[s.name] = cellToWorld(c.cx, c.cy)
      }
    })
    return result
  }

  /** @type {DesktopGrid} */
  return {
    ORIGIN_X: ORIGIN_X,
    ORIGIN_Y: ORIGIN_Y,
    GRID_W: GRID_W,
    GRID_H: GRID_H,
    snapToGrid: snapToGrid,
    worldToCell: worldToCell,
    cellToWorld: cellToWorld,
    findFreeCell: findFreeCell,
    resolvePlacement: resolvePlacement
  }
})()
