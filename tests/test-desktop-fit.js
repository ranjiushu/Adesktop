// 一览模式纯函数测试（2026-08-19）：fit-bounds——全部图标包围盒中心 + 当前方向最大可见 zoom。
// 1. 竖屏/横屏：fit 后全部图标经真实 worldToScreen 落在视口内 + zoom 最大化（再大一点就出屏）
// 2. 中心对齐：内容包围盒中心 = 屏幕中心世界点（两方向同式）
// 3. 边界：单文件 zoom = 恰好放下的 raw 值（max 10 只作安全网，真实视口不触发）；
//    大范围内容钳到 min（0.1）；空/非法输入 → null
// 用法: node test-desktop-fit.js [项目路径]   （由 run-tests.sh 调用）
'use strict'

const fs = require('fs')
const path = require('path')
const vm = require('vm')

const PROJECT = process.argv[2] || path.join(__dirname, '..')
const SRC = path.join(PROJECT, 'src', 'js')

let failures = 0
function check(cond, msg) {
  if (cond) {
    console.log('  [ok] ' + msg)
  } else {
    console.error('  [fail] ' + msg)
    failures++
  }
}
function approx(a, b, eps) {
  return Math.abs(a - b) <= (eps || 1e-9)
}

const sandbox = { App: {}, console: console }
sandbox.window = sandbox
vm.createContext(sandbox)
vm.runInContext(fs.readFileSync(path.join(SRC, 'namespace.js'), 'utf8'), sandbox, { filename: 'namespace.js' })
vm.runInContext(fs.readFileSync(path.join(SRC, 'desktop-camera.js'), 'utf8'), sandbox, { filename: 'desktop-camera.js' })
vm.runInContext(fs.readFileSync(path.join(SRC, 'desktop-fit.js'), 'utf8'), sandbox, { filename: 'desktop-fit.js' })

const F = sandbox.App.DesktopFit
const CAM = sandbox.App.DesktopCamera
const VW = 412
const VH = 700

// ── 通用断言：fit 后全部图标（左上角 + 右下角，含 cell 占位）在视口内（真实 worldToScreen）──
function allInViewport(placed, camera, label) {
  let ok = true
  placed.forEach(function (p) {
    const tl = CAM.worldToScreen(p.x, p.y, camera, VW, VH)
    const br = CAM.worldToScreen(p.x + F.ICON_W, p.y + F.ICON_H, camera, VW, VH)
    if (tl.x < -0.5 || tl.x > VW + 0.5 || tl.y < -0.5 || tl.y > VH + 0.5 ||
        br.x < -0.5 || br.x > VW + 0.5 || br.y < -0.5 || br.y > VH + 0.5) ok = false
  })
  check(ok, label + '：fit 后全部图标（含 cell 占位）落在视口内')
  return ok
}

// zoom 最大化断言：当前 zoom 下内容包围盒（图标 + PAD 边距）恰好放下；
// zoom×1.005 后包围盒至少一角出屏（数学保证：zoom = min(w/bw, h/bh)，放大必超界）
function zoomMaximal(cam, placed, vw, vh, label) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  placed.forEach(function (p) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y)
  })
  const bw = (maxX - minX) + F.ICON_W + 2 * F.PAD
  const bh = (maxY - minY) + F.ICON_H + 2 * F.PAD
  const cx0 = (minX + maxX + F.ICON_W) / 2
  const cy0 = (minY + maxY + F.ICON_H) / 2
  const camUp = { x: cam.x, y: cam.y, zoom: cam.zoom * 1.005, rotation: cam.rotation }
  const tl = CAM.worldToScreen(cx0 - bw / 2, cy0 - bh / 2, camUp, vw, vh)
  const br = CAM.worldToScreen(cx0 + bw / 2, cy0 + bh / 2, camUp, vw, vh)
  const out = tl.x < -0.5 || tl.x > vw + 0.5 || tl.y < -0.5 || tl.y > vh + 0.5 ||
    br.x < -0.5 || br.x > vw + 0.5 || br.y < -0.5 || br.y > vh + 0.5
  check(out, label + '：zoom 已最大化（再放大 0.5% 内容包围盒出界）')
}

// 中心对齐断言：图标包围盒中心（含 cell 占位）≈ 屏幕中心世界点（(cam.x + vw/2z, cam.y + vh/2z)）
function centerAligned(cam, placed, label) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  placed.forEach(function (p) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y)
  })
  const contentCx = (minX + maxX + F.ICON_W) / 2
  const contentCy = (minY + maxY + F.ICON_H) / 2
  const screenCx = cam.x + VW / (2 * cam.zoom)
  const screenCy = cam.y + VH / (2 * cam.zoom)
  check(Math.abs(contentCx - screenCx) < 0.01 && Math.abs(contentCy - screenCy) < 0.01,
    label + '：内容中心 = 屏幕中心世界点（偏差 ' +
      (contentCx - screenCx).toFixed(2) + ',' + (contentCy - screenCy).toFixed(2) + '）')
}

// ── 场景：24 文件铺满竖屏网格（4 列 × 6 行，organize 同款排布）──
const grid = []
for (let i = 0; i < 24; i++) {
  grid.push({ x: (i % 4) * 100, y: Math.floor(i / 4) * 116 })
}

// ── 1. 竖屏 fit ──
const c0 = F.fitCamera(grid, VW, VH, 0)
check(c0 !== null && c0.rotation === 0, '竖屏 fit 返回相机（rotation=0）')
allInViewport(grid, c0, '[竖屏]')
zoomMaximal(c0, grid, VW, VH, '[竖屏]')
centerAligned(c0, grid, '[竖屏]')
// 竖屏 4×6 网格：zoom 应接近 1（400×696 内容 vs 412×700 视口）
check(Math.abs(c0.zoom - 1) < 0.06, '[竖屏] 网格内容 zoom≈1（实际 ' + c0.zoom.toFixed(3) + '）')

// ── 2. 横屏 fit（画布旋转 90°：可视世界矩形宽高互换）──
const c90 = F.fitCamera(grid, VW, VH, 90)
check(c90 !== null && c90.rotation === 90, '横屏 fit 返回相机（rotation=90）')
allInViewport(grid, c90, '[横屏]')
zoomMaximal(c90, grid, VW, VH, '[横屏]')
centerAligned(c90, grid, '[横屏]')
// 横屏：可视世界宽 = 700/z、高 = 412/z。内容 400×696 → z = min(700/400, 412/696) = 0.5919
const z90Expected = Math.min(VH / (400 + 2 * F.PAD), VW / (696 + 2 * F.PAD))
check(Math.abs(c90.zoom - z90Expected) < 0.01,
  '[横屏] zoom = min(vh/bw, vw/bh)（期望 ' + z90Expected.toFixed(3) + '，实际 ' + c90.zoom.toFixed(3) + '）')

// ── 3. 分散内容（用户自由摆放很远）：横屏 fit 仍全可见 ──
const spread = [
  { x: -500, y: -300 }, { x: 1200, y: 800 }, { x: 0, y: 0 }, { x: 900, y: 100 }
]
const cs = F.fitCamera(spread, VW, VH, 90)
allInViewport(spread, cs, '[横屏-分散]')
centerAligned(cs, spread, '[横屏-分散]')

// ── 4. 单文件：zoom = raw 值不被钳制（3.55 < max 10，max 只作安全网）──
const single = F.fitCamera([{ x: 0, y: 0 }], VW, VH, 0)
const singleExpect = Math.min(VW / (F.ICON_W + 2 * F.PAD), VH / (F.ICON_H + 2 * F.PAD))
check(approx(single.zoom, singleExpect), '单文件 zoom = 恰好放下 ' + singleExpect.toFixed(3) + '（不再被 3 卡住，实际 ' + single.zoom + '）')
allInViewport([{ x: 0, y: 0 }], single, '[单文件]')
zoomMaximal(single, [{ x: 0, y: 0 }], VW, VH, '[单文件]')

// ── 5. 超大范围内容：zoom 钳到 min（0.1，物理限制尽量显示）──
const huge = []
for (let i = 0; i < 5; i++) huge.push({ x: i * 2000, y: 0 })
const ch = F.fitCamera(huge, VW, VH, 0)
check(ch.zoom === 0.1, '超大范围 zoom 钳到 min=0.1（实际 ' + ch.zoom + '）')

// ── 6. 空/非法输入安全 ──
check(F.fitCamera([], VW, VH, 0) === null, '空列表 → null')
check(F.fitCamera(null, VW, VH, 0) === null, 'null → null')
check(F.fitCamera([{ x: NaN, y: 0 }, { x: 1, y: 2 }], VW, VH, 0) !== null, '非法条目被过滤（有效条目仍可 fit）')
check(F.fitCamera([{ x: NaN, y: NaN }], VW, VH, 0) === null, '全非法条目 → null')
check(F.fitCamera(grid, 0, 0, 0) === null, '视口 0 → null')

if (failures > 0) {
  console.error('[fail] fit 测试失败 ' + failures + ' 项')
  process.exit(1)
}
console.log('[ok] desktop-fit 测试全部通过')
process.exit(0)
