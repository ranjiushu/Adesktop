/* 文件夹视图排布模块：子文件夹（Folder 容器）的网格/列表坐标纯函数，可单测。
 * 网格视图：固定 4 列，列宽自适应视口（列宽 = (视口宽 - 2*ORIGIN_X) / 4），
 *   图标宽 = 列宽 - 8（列间留 8px 空隙），画布宽 = 视口宽（无需水平滚动）。
 * 列表视图：单列，行高 LIST_ROW_H = 56，行宽 = 视口宽。
 * 依赖: namespace.js, desktop-grid.js（ORIGIN_X/ORIGIN_Y/GRID_H）
 * 导出: App.FolderLayout
 */
'use strict'

App.FolderLayout = (function () {
  const GRID = App.DesktopGrid
  const COLS = 4
  const LIST_ROW_H = 56
  const COL_GAP = 8   // 列间空隙（图标宽 = 列宽 - gap）

  // 网格位置：i 从 0 起，4 个一换行（y 步进 GRID_H）
  function gridPositions(count, viewportW) {
    const colW = (viewportW - GRID.ORIGIN_X * 2) / COLS
    const arr = []
    for (let i = 0; i < count; i++) {
      arr.push({
        x: GRID.ORIGIN_X + (i % COLS) * colW,
        y: GRID.ORIGIN_Y + Math.floor(i / COLS) * GRID.GRID_H
      })
    }
    return arr
  }

  // 列表位置：单列，行高固定
  function listPositions(count) {
    const arr = []
    for (let i = 0; i < count; i++) {
      arr.push({ x: 0, y: i * LIST_ROW_H })
    }
    return arr
  }

  // 画布尺寸（纸面）：网格 = 视口宽 x (ORIGIN_Y + 行数*GRID_H)；列表 = 视口宽 x 行数*ROW_H
  function canvasSize(count, viewportW, viewStyle) {
    if (viewStyle === 'list') {
      return { w: viewportW, h: count * LIST_ROW_H }
    }
    const rows = Math.max(1, Math.ceil(count / COLS))
    return { w: viewportW, h: GRID.ORIGIN_Y + rows * GRID.GRID_H }
  }

  // 网格模式图标宽度（列宽 - 间隙），下限 48 防过窄
  function iconWidth(viewportW) {
    return Math.max(48, (viewportW - GRID.ORIGIN_X * 2) / COLS - COL_GAP)
  }

  return {
    gridPositions: gridPositions,
    listPositions: listPositions,
    canvasSize: canvasSize,
    iconWidth: iconWidth,
    COLS: COLS,
    LIST_ROW_H: LIST_ROW_H
  }
})()
