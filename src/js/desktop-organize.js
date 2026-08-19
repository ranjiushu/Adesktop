/* 整理桌面（App.DesktopOrganize）：纯函数域——排序 + 网格布局计算。
 * 供 Morph FAB「整理桌面」动作调用：自动将桌面文件按名称和类型排序到
 * 以顶栏那条边为基线的可见网格区域。
 * 排序：文件夹在前（名称升序）；文件按扩展名分组（组内名称升序）。
 * 布局方向（画布 rotation）：竖屏 0 = 行优先（先左→右再上→下，Android 启动器式）；
 * 横屏 90 = 列内沿画布 +x（屏幕下）、换列 +y（屏幕左）——首列锚定画布上边
 *   （屏幕右缘），向画布下边生长，与竖屏同序（旋转后屏幕左 = 画布下，
 *   2026-08-19 用户指出：网格应从画布顶往下长，而非从画布底往顶长）。
 * 纯函数，可单测（test-desktop-organize.js）。
 * 依赖: namespace.js
 * 导出: App.DesktopOrganize
 */
// @ts-check
'use strict'

App.DesktopOrganize = (function () {
  const GRID_W = 100   // 与 desktop-grid.js 网格步进一致（世界坐标）
  const GRID_H = 116
  const ICON_W = 84    // 与 desktop-render.js cell 占位宽一致（网格外接框边缘）
  const ICON_H = 106   // 与 desktop-render.js cell 占位高一致（网格外接框边缘）
  const PAD_TOP = 16   // 顶边基线边距（网格不贴视口顶部）

  /** 扩展名（小写；无扩展名/点开头 = ''） */
  /** @param {string} name @returns {string} */
  function extOf(name) {
    const i = name.lastIndexOf('.')
    if (i <= 0 || i >= name.length - 1) return ''
    return name.substring(i + 1).toLowerCase()
  }

  /** 排序：文件夹在前（名称升序）；文件按扩展名分组（组内名称升序）。
   *  @param {Array<{name: string, isDir: boolean}>} items @returns {Array<{name: string, isDir: boolean}>} */
  function sortEntries(items) {
    return (items || []).slice().sort(function (a, b) {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      if (!a.isDir) {
        const ta = extOf(a.name)
        const tb = extOf(b.name)
        if (ta !== tb) return ta < tb ? -1 : 1
      }
      return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0)
    })
  }

  /** 整理锚点相机：Home 快照优先（按画布方向取槽位），无快照 → 出厂 (0,0,1)。
   *  整理以 Home 视角可见网格为基准——用户回到 Home 即可看到全部整理结果。
   *  @param {{home?: {x: number, y: number, zoom: number}, fallback?: {x: number, y: number, zoom: number}} | null} homeSnapshot
   *  @param {number} [rotation] @returns {{x: number, y: number, zoom: number, rotation: number}} */
  function anchorFromHome(homeSnapshot, rotation) {
    const rot = rotation === 90 ? 90 : 0
    if (homeSnapshot) {
      if (homeSnapshot.home) {
        return { x: homeSnapshot.home.x, y: homeSnapshot.home.y, zoom: homeSnapshot.home.zoom, rotation: rot }
      }
      if (homeSnapshot.fallback) {
        return { x: homeSnapshot.fallback.x, y: homeSnapshot.fallback.y, zoom: homeSnapshot.fallback.zoom, rotation: rot }
      }
    }
    return { x: 0, y: 0, zoom: 1, rotation: rot }
  }

  /** 网格布局：一种排列（「先左→右、再上→下」的二维网格），方向由画布旋转决定。
   *  **基线 = 顶栏那条边**（2026-08-19 用户指定）：竖屏 = 视口顶部（画布上边）；
   *  横屏 = 屏幕顶部（画布左边线）。横屏按 **Windows 式列优先**：
   *    首列从屏幕左上角开始（锚定画布左 = 屏幕顶，及屏幕左缘），
   *    列内沿画布 +x（屏幕向下），换列沿画布 -y（屏幕向右）。
   *  方向映射（desktop-camera.js 旋转契约，rotation=90）：
   *    屏幕下 = 世界 +x、屏幕右 = 世界 -y、屏幕左 = 世界 +y、屏幕顶 = 世界 -x 端（画布左）。
   *  基线实现：
   *    竖屏：y0 = camera.y + PAD_TOP（视口顶部）；x 方向水平居中（绕视野中心）。
   *    横屏：x0 = 屏幕顶部世界 x + PAD_TOP（画布左 = 顶栏边基线）；
   *      y0 = 屏幕左缘世界 y - ICON_H - PAD_TOP（首列盒左缘贴屏幕左 + 16）。
   *    注：曾居中（首列浮空窄条、列溢出时左右都裁）与锚画布上边（首列在屏幕右缘、
   *      列向左铺）——均不符合「像 Windows」的拍板（2026-08-19 用户指出
   *      「屏幕左 = 画布下」：锚定须按画布语义，首列锚画布左而非屏幕左）。
   *  @param {Array<{name: string, isDir: boolean}>} entries 排序后的条目
   *  @param {number} viewportW @param {number} viewportH
   *  @param {{x: number, y: number, zoom: number, rotation: number}} camera
   *  @param {Array<{x: number, y: number}> | null | undefined} [occupiedWorldPoints] 被占格子（锁定文件等钉子户）世界坐标点
   *  @returns {Array<{name: string, x: number, y: number}>} */
  function organize(entries, viewportW, viewportH, camera, occupiedWorldPoints) {
    const zoom = (camera && camera.zoom) || 1
    const cx = (camera && camera.x) || 0
    const cy = (camera && camera.y) || 0
    const rotation = (camera && camera.rotation) || 0
    const w = viewportW || 0
    const h = viewportH || 0
    const sorted = sortEntries(entries)
    const n = sorted.length
    if (n === 0) return []
    // 视野中心世界点（两方向同式：屏幕中心 = (c.x + w/2z, c.y + h/2z)）
    const centerX = cx + w / (2 * zoom)
    const centerY = cy + h / (2 * zoom)
    if (rotation === 90 && w > 0 && h > 0) {
      // 横屏：Windows 式列优先——首列从**屏幕左上角**开始（锚定画布左 = 屏幕顶，
      // 及屏幕左缘），列内沿画布 +x（屏幕向下），换列沿画布 -y（屏幕向右）。
      // 首列 = 排序第一的文件夹/文件，永远完整可见；多出列向右延伸（读序末端，
      // 与竖屏「行多向下溢出」对称）。曾居中（首列浮空/窄条）与锚画布上边
      // （首列在屏幕右缘，列向左铺）——均不符合用户「像 Windows」的拍板。
      const perCol = Math.max(1, Math.floor((h / zoom) / GRID_W))   // 每列格子数（屏幕高方向 = 画布 x 向可见宽）
      const x0 = cx + (w - h) / (2 * zoom) + PAD_TOP                // 画布左 = 屏幕顶 + 16（顶栏那条边基线）
      const y0 = cy + (w + h) / (2 * zoom) - ICON_H - PAD_TOP       // 屏幕左缘 + 16（首列盒左缘贴屏幕左）
      return scanPlace(sorted, perCol, x0, y0, -1, occupiedWorldPoints)
    }
    // 竖屏：行内沿世界 +x（屏幕向右，步长 GRID_W），换行沿世界 +y（屏幕向下，步长 GRID_H）。
    // 顶边基线 = 视口顶部世界 y = camera.y；x 方向水平居中。
    const perRow = Math.max(1, Math.floor((w / zoom) / GRID_W))     // 每行格子数（屏幕宽方向）
    const y0 = cy + PAD_TOP
    const x0 = centerX - ((perRow - 1) * GRID_W + ICON_W) / 2
    return scanPlace(sorted, perRow, x0, y0, 1, occupiedWorldPoints)
  }

  // 网格扫描排布：从 (0,0) 起按方向逐格分配，跳过被占格子（occupiedWorldPoints =
  // 锁定文件等钉子户的世界坐标点，转排布 cell 后跳过——整理桌面不能挪动锁定文件，
  // 否则图标与 Viewer 预览窗口分家/重叠）。colDir = 换列方向（竖屏 +y=+1，横屏 -y=-1）。
  // 世界坐标 → 排布 cell 与索引同式（竖屏：x0 行起点/y0 行基线；横屏：x0 列内起点/
  // y0 屏幕左缘基线，colDir 吸收方向差），无 occupied 时与旧连续索引排布结果一致。
  /** @param {Array<{name: string, isDir: boolean}>} sorted @param {number} per
   *  @param {number} x0 @param {number} y0 @param {number} colDir
   *  @param {Array<{x: number, y: number}> | null | undefined} occupiedWorldPoints
   *  @returns {Array<{name: string, x: number, y: number}>} */
  function scanPlace(sorted, per, x0, y0, colDir, occupiedWorldPoints) {
    /** @type {Set<string>} */
    const taken = new Set()
    ;(occupiedWorldPoints || []).forEach(function (p) {
      const pcx = Math.round((p.x - x0) / GRID_W)
      const pcy = Math.round((p.y - y0) / (GRID_H * colDir))
      taken.add(pcx + ',' + pcy)
    })
    /** @type {Array<{name: string, x: number, y: number}>} */
    const placed = []
    let cx = 0
    let cy = 0
    const advance = function () {
      cx++
      if (cx >= per) { cx = 0; cy++ }
    }
    sorted.forEach(function (item) {
      while (taken.has(cx + ',' + cy)) advance()
      taken.add(cx + ',' + cy)
      placed.push({
        name: item.name,
        x: Math.round(x0 + cx * GRID_W),
        y: Math.round(y0 + cy * GRID_H * colDir)
      })
      advance()
    })
    return placed
  }

  /** @type {DesktopOrganize} */
  return {
    sortEntries: sortEntries,
    organize: organize,
    anchorFromHome: anchorFromHome,
    GRID_W: GRID_W,
    GRID_H: GRID_H,
    ICON_W: ICON_W,
    ICON_H: ICON_H
  }
})()
