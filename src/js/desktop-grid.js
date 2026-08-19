/* 桌面网格系统：网格吸附 + 放置避让（纯函数，可单测）。
 * 网格：origin (16,16) + step (100,116)，图标左上角对齐网格交点，一格一图标。
 * 垂直步进 116px：图标高度恒定 96px（名字区固定两行 38px，一行/两行名等高），
 * 余量 20px 覆盖真机字体行高差异与常见系统字体缩放（≤1.15）。
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
  const GRID_H = 116

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
  // immovable（statics 中不可让位的名字集合，如被 Viewer 锁定的文件）为「钉子户」：
  // 先占位后不可让位——移动组与钉子户冲突时**移动组让位**（Windows 式占用语义，
  // 防止整理/拖动把锁定文件顶开，造成图标与 Viewer 预览窗口分家）。
  // 返回 { name: {x,y} }（移动组 + 被挤开的静止图标 + 钉子户原位）
  /** @param {Array<{name: string, x: number, y: number}>} moving @param {Array<{name: string, x: number, y: number}>} statics @param {Array<string> | Set<string>} [immovable] @returns {Record<string, Position2D>} */
  function resolvePlacement(moving, statics, immovable) {
    const immovableSet = new Set(immovable || [])
    /** @type {Map<string, string>} */
    const occupied = new Map()   // cellKey → name（先占者优先）
    /** @type {Record<string, Position2D>} */
    const result = {}

    // 1. 钉子户（锁定文件）先占位：不可让位，冲突时移动组/普通静止让位。
    //    保持**原始世界坐标**（钉子户可能不在网格点上——Viewer 预览窗口自由拖动位），
    //    不能 cellToWorld 吸附，否则钉子户自身被挪动（分家）
    statics.forEach(function (s) {
      if (!immovableSet.has(s.name)) return
      const c = worldToCell(s.x, s.y)
      occupied.set(c.cx + ',' + c.cy, s.name)
      result[s.name] = { x: s.x, y: s.y }
    })
    // 2. 移动组放期望位；与钉子户（或先到的移动组）冲突 → 移动组让位到最近空位
    moving.forEach(function (m) {
      const c = worldToCell(m.x, m.y)
      const key = c.cx + ',' + c.cy
      if (occupied.has(key)) {
        const free = findFreeCell(c.cx, c.cy, new Set(occupied.keys()))
        occupied.set(free.cx + ',' + free.cy, m.name)
        result[m.name] = cellToWorld(free.cx, free.cy)
      } else {
        occupied.set(key, m.name)
        result[m.name] = cellToWorld(c.cx, c.cy)
      }
    })
    // 3. 普通静止图标：被占 → 让位到最近空位；否则原地
    statics.forEach(function (s) {
      if (immovableSet.has(s.name)) return
      const c = worldToCell(s.x, s.y)
      const key = c.cx + ',' + c.cy
      if (occupied.has(key)) {
        const free = findFreeCell(c.cx, c.cy, new Set(occupied.keys()))
        occupied.set(free.cx + ',' + free.cy, s.name)
        result[s.name] = cellToWorld(free.cx, free.cy)
      } else {
        occupied.set(key, s.name)
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
