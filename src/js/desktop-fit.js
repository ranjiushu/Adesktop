/* 一览模式（App.DesktopFit）：纯函数——计算「把全部文件放进屏幕」的目标相机（fit-bounds）。
 * 双击底栏 Home 触发：位置 = 全部图标包围盒中心；缩放 = 当前方向下恰好放下的最大 zoom。
 * 用户语义（2026-08-19）：「尽可能多的文件出现在屏幕里面」——zoom 最大化（能全放下就尽量大），
 * 内容整体居中（包围盒中心 = 屏幕中心），旋转方向与当前画布一致。
 * rotation 感知：竖屏可视世界矩形 = vw/z × vh/z；横屏（画布旋转 90°）宽高互换 = vh/z × vw/z，
 *   zoom 公式相应互换（min(vh/bw, vw/bh)）；中心对齐公式与 rotation 无关
 *   （屏幕中心世界点 = (c.x + vw/2z, c.y + vh/2z)，两方向同式，见 desktop-camera.js 推导）。
 * 纯函数可单测（test-desktop-fit.js）。
 * 依赖: namespace.js, desktop-camera.js（clampZoom）
 * 导出: App.DesktopFit
 */
// @ts-check
'use strict'

App.DesktopFit = (function () {
  const ICON_W = 84    // 与 desktop-render.js cell 占位宽一致（包围盒右边缘）
  const ICON_H = 106   // 与 desktop-render.js cell 占位高一致（包围盒下边缘）
  const PAD = 16       // 内容外扩边距（世界坐标），避免图标贴屏幕边缘

  /** fit-bounds：全部图标包围盒 + 当前方向最大可见 zoom。
   *  @param {Array<{x: number, y: number}>} positions 全部图标位置（左上角世界坐标）
   *  @param {number} viewportW @param {number} viewportH
   *  @param {number} [rotation] 0 或 90
   *  @returns {DesktopCameraState | null} 空/非法输入 → null（调用方 toast 提示） */
  function fitCamera(positions, viewportW, viewportH, rotation) {
    const w = viewportW || 0
    const h = viewportH || 0
    if (!(w > 0) || !(h > 0) || !positions || !positions.length) return null
    const rot = rotation === 90 ? 90 : 0
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    let count = 0
    positions.forEach(function (p) {
      if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') return
      if (!isFinite(p.x) || !isFinite(p.y)) return
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
      count++
    })
    if (!count) return null
    // 内容尺寸 = 图标包围盒 + cell 占位（最后一个图标右/下边缘）+ 边距
    const bw = (maxX - minX) + ICON_W + 2 * PAD
    const bh = (maxY - minY) + ICON_H + 2 * PAD
    // 当前方向最大可见 zoom：横屏可视世界矩形宽高互换（宽 = h/z、高 = w/z）
    const zRaw = rot === 90 ? Math.min(h / bw, w / bh) : Math.min(w / bw, h / bh)
    const zoom = App.DesktopCamera.clampZoom(zRaw)
    // 中心对齐（两方向同公式）：屏幕中心世界点 = (c.x + w/2z, c.y + h/2z)。
    // 内容中心 = 图标包围盒中心（PAD 对称分布在两侧，不偏移中心）
    const cx = (minX + maxX + ICON_W) / 2
    const cy = (minY + maxY + ICON_H) / 2
    return {
      x: cx - w / (2 * zoom),
      y: cy - h / (2 * zoom),
      zoom: zoom,
      rotation: rot
    }
  }

  /** @type {DesktopFit} */
  return {
    fitCamera: fitCamera,
    ICON_W: ICON_W,
    ICON_H: ICON_H,
    PAD: PAD
  }
})()
