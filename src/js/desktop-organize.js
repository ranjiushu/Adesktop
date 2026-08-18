/* 整理桌面（App.DesktopOrganize）：纯函数域——排序 + 网格布局计算。
 * 供 Morph FAB「整理桌面」动作调用：自动将桌面文件按名称和类型排序到
 * 屏幕可见的完整网格区域（锚定当前相机可见区域左上角）。
 * 排序：文件夹在前（名称升序）；文件按扩展名分组（组内名称升序）。
 * 布局方向（画布 rotation）：竖屏 0 = 列优先（从上到下排满一列再下一列）；
 * 横屏 90 = 行优先（从左到右排满一行再下一行）。
 * 纯函数，可单测（test-desktop-organize.js）。
 * 依赖: namespace.js
 * 导出: App.DesktopOrganize
 */
// @ts-check
'use strict'

App.DesktopOrganize = (function () {
  const GRID_W = 100   // 与 desktop-grid.js 网格步进一致（世界坐标）
  const GRID_H = 116

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

  /** 网格布局：锚定相机可见区域左上角，按视口尺寸铺满可见网格。
   *  相机契约（desktop-camera.js）：x/y = **视口左上角对应的世界点**——可见区域
   *  即 [x, x+visW] × [y, y+visH]，无需再减半视口（曾误按「中心」语义偏移半个
   *  视口 → 整理结果偏左上，与 Home 区域不重合）。
   *  @param {Array<{name: string, isDir: boolean}>} entries 排序后的条目
   *  @param {number} viewportW @param {number} viewportH
   *  @param {{x: number, y: number, zoom: number, rotation: number}} camera
   *  @returns {Array<{name: string, x: number, y: number}>} */
  function organize(entries, viewportW, viewportH, camera) {
    const zoom = (camera && camera.zoom) || 1
    const cx = (camera && camera.x) || 0
    const cy = (camera && camera.y) || 0
    const rotation = (camera && camera.rotation) || 0
    const visW = viewportW / zoom
    const visH = viewportH / zoom
    // 可见区域左上角（世界坐标）：相机 x/y 即视口左上角对应世界点（左上角语义）
    const left = cx
    const top = cy
    const cols = Math.max(1, Math.floor(visW / GRID_W))
    const rows = Math.max(1, Math.floor(visH / GRID_H))
    const horizontal = rotation === 90
    const sorted = sortEntries(entries)
    return sorted.map(function (item, i) {
      let col, row
      if (horizontal) {
        row = Math.floor(i / cols)
        col = i % cols
      } else {
        col = Math.floor(i / rows)
        row = i % rows
      }
      return {
        name: item.name,
        x: Math.round(left + col * GRID_W),
        y: Math.round(top + row * GRID_H)
      }
    })
  }

  /** @type {DesktopOrganize} */
  return {
    sortEntries: sortEntries,
    organize: organize,
    anchorFromHome: anchorFromHome,
    GRID_W: GRID_W,
    GRID_H: GRID_H
  }
})()
