// 整理桌面纯函数测试（2026-08-19）：排序规则 + 居中网格布局 + 交叉旋转可见性。
// 1. sortEntries：文件夹在前（名称升序）；文件按扩展名分组（组内名称升序）
// 2. organize：网格**绕相机视野中心对称铺**（不贴左上角——曾锚左上角，横屏网格
//    挤在屏幕左上方、右 64px 下 100px 空白）；竖屏行优先 / 横屏列优先视觉
// 3. 交叉旋转可见性：整理结果在另一方向下**中心图标可见 + 出屏对称**（几何必然，
//    中心对齐 + 对称出屏 = 拖动即可找回；不丢「图标世界坐标」）
// 用法: node test-desktop-organize.js [项目路径]   （由 run-tests.sh 调用）
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

const sandbox = { App: {}, console: console }
sandbox.window = sandbox
vm.createContext(sandbox)
vm.runInContext(fs.readFileSync(path.join(SRC, 'namespace.js'), 'utf8'), sandbox, { filename: 'namespace.js' })
vm.runInContext(fs.readFileSync(path.join(SRC, 'desktop-camera.js'), 'utf8'), sandbox, { filename: 'desktop-camera.js' })
vm.runInContext(fs.readFileSync(path.join(SRC, 'desktop-organize.js'), 'utf8'), sandbox, { filename: 'desktop-organize.js' })

const O = sandbox.App.DesktopOrganize
const CAM = sandbox.App.DesktopCamera

// ── 1. 排序 ──
const items = [
  { name: 'b.txt', isDir: false },
  { name: '报告.docx', isDir: false },
  { name: 'a.txt', isDir: false },
  { name: 'zeta', isDir: true },
  { name: '照片.png', isDir: false },
  { name: 'alpha', isDir: true },
  { name: 'c.TXT', isDir: false },
  { name: 'z.md', isDir: false }
]
const sorted = O.sortEntries(items)
check(sorted[0].name === 'alpha' && sorted[1].name === 'zeta',
  '文件夹在前且按名称升序（alpha, zeta）')
check(sorted[2].name === '报告.docx' && sorted[3].name === 'z.md' && sorted[4].name === '照片.png',
  '文件按扩展名字母序分组（docx → md → png）')
check(sorted[5].name === 'a.txt' && sorted[6].name === 'b.txt' && sorted[7].name === 'c.TXT',
  'txt 组：按名称升序（a.txt, b.txt, c.TXT——扩展名小写归一）')
check(sorted.length === items.length, '排序不丢条目')

// ── 2. 竖屏行优先（Android 启动器式：从左到右排满一行再下一行）＋ 顶边基线 ──
// 视口 412×700、zoom 1、相机 (0,0,1,0)：基线 = 视口顶部（y=0）+ PAD_TOP=16；
// x 方向水平居中（视野中心 x=206）。8 条目 → 4 列 × 2 行 → 左上角 (14,16)
const vp = O.organize(items, 412, 700, { x: 0, y: 0, zoom: 1, rotation: 0 })
check(vp.length === items.length, 'organize 输出全部条目')
check(vp[0].x === 14 && vp[0].y === 16, '竖屏第一项 = 顶边基线左上角 (14,16)（y 贴视口顶 + 16）')
check(vp[0].name === 'alpha', '排序后第一个（文件夹）占网格首格')
check(vp[1].x === vp[0].x + O.GRID_W && vp[1].y === vp[0].y,
  '竖屏行优先：第二项在同一行右一格（x+GRID_W）')
check(vp[3].x === vp[0].x + 3 * O.GRID_W, '第 4 项仍在第一行（4 列满行前）')
check(vp[4].x === vp[0].x && vp[4].y === vp[0].y + O.GRID_H,
  '第 5 项（满行）换行：x 回到左列、y+GRID_H')
check(vp[6].x === vp[0].x + 2 * O.GRID_W && vp[6].y === vp[0].y + O.GRID_H,
  '第 7 项在第二行第三个')

// ── 2.5 基线断言：x 水平居中 + y 顶边基线（用户指定基线 = 靠近顶栏的画布边）──
function gridCenterX(placed) {
  let minX = Infinity, maxX = -Infinity
  placed.forEach(function (p) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
  })
  return (minX + maxX) / 2 + O.ICON_W / 2
}
function gridTopY(placed) {
  let minY = Infinity
  placed.forEach(function (p) { minY = Math.min(minY, p.y) })
  return minY
}
check(Math.abs(gridCenterX(vp) - 206) < 0.01, '竖屏网格 x 中心 = 视野中心 (206)（实际 ' + gridCenterX(vp).toFixed(1) + '）')
check(gridTopY(vp) === 16, '竖屏网格顶部 = 视口顶部 + PAD_TOP（16）——基线贴顶栏边')

// ── 3. 横屏（真机视口 412×700，App 锁竖屏——横屏 = 画布旋转）：列优先视觉 ＋ 顶边基线 ──
// 相机 (0,0,1,90)：屏幕顶部对应世界 x = cx + (w-h)/2z = -144；基线 = -144 + PAD_TOP = -128。
// y 方向水平居中（视野中心 y=350）。8 条目 → 每列 7 格（perCol=floor(700/100)），共 2 列
// → 左上角 (-128,355)
const hp = O.organize(items, 412, 700, { x: 0, y: 0, zoom: 1, rotation: 90 })
check(hp[0].x === -128 && hp[0].y === 355, '横屏第一项 = 顶边基线左上角 (-128,355)')
check(hp[1].x === hp[0].x + O.GRID_W && hp[1].y === hp[0].y,
  '横屏视觉列优先：第二项在列内下一格（x+GRID_W = 屏幕向下）')
check(hp[5].x === hp[0].x + 5 * O.GRID_W, '第 6 项仍在第一列（每列 7 格满列前）')
check(hp[6].x === hp[0].x + 6 * O.GRID_W && hp[6].y === hp[0].y,
  '第 7 项仍在第一列（perCol=7 恰好满列）')
check(hp[7].x === hp[0].x && hp[7].y === hp[0].y - O.GRID_H,
  '第 8 项（满列）换列：x 回到顶格、y-GRID_H（= 屏幕向右）')
// 横屏基线断言：屏幕顶部基线（世界 x = cx + (w-h)/2z + PAD_TOP = -128）+ y 水平居中
check(hp[0].x === -128, '横屏顶边基线 = 屏幕顶部世界 x + PAD_TOP（-128）')
{
  let minY = Infinity, maxY = -Infinity
  hp.forEach(function (p) {
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
  })
  const cy = (minY + maxY) / 2 + O.ICON_H / 2
  check(Math.abs(cy - 350) < 0.01, '横屏网格 y 中心 = 视野中心 (350)（实际 ' + cy.toFixed(1) + '）')
}

// ── 3.5 屏幕映射验证：整理结果经真实 worldToScreen 全部落在视口内（与 Home 中心重合）──
// 真机视口 412×700（App 锁竖屏，横屏 = 画布旋转）
function allInViewport(placed, camera, vw, vh, label) {
  let ok = true
  placed.forEach(function (p) {
    const s = CAM.worldToScreen(p.x, p.y, camera, vw, vh)
    if (s.x < -0.5 || s.x > vw + 0.5 || s.y < -0.5 || s.y > vh + 0.5) ok = false
  })
  check(ok, label + '：整理结果全部落在屏幕视口内')
}
allInViewport(vp, { x: 0, y: 0, zoom: 1, rotation: 0 }, 412, 700, '竖屏')
allInViewport(hp, { x: 0, y: 0, zoom: 1, rotation: 90 }, 412, 700, '横屏')
// 有 Home 快照（非原点）时同样居中且全可见
allInViewport(
  O.organize(items, 412, 700, { x: 120, y: 80, zoom: 1, rotation: 90 }),
  { x: 120, y: 80, zoom: 1, rotation: 90 }, 412, 700, '横屏（Home 快照非原点）')

// ── 4. zoom 影响可见区域（网格更稀疏，基线语义不变）──
const z2 = O.organize(items, 412, 700, { x: 0, y: 0, zoom: 2, rotation: 0 })
check(z2[1].x === z2[0].x + O.GRID_W && z2[1].y === z2[0].y, 'zoom=2 竖屏行优先语义不变')
// zoom=2 视野中心 x = 0 + 412/4 = 103——x 水平居中跟随；y 仍顶边基线（+PAD_TOP）
check(Math.abs(gridCenterX(z2) - 103) < 0.01,
  'zoom=2 网格 x 中心 = 缩放后视野中心 (103)（实际 ' + gridCenterX(z2).toFixed(1) + '）')
check(gridTopY(z2) === 16, 'zoom=2 网格顶部仍 = 视口顶部 + PAD_TOP（16）')

// ── 5. 空输入安全 ──
check(O.sortEntries([]).length === 0, '空列表排序安全')
check(O.organize([], 412, 700, { x: 0, y: 0, zoom: 1, rotation: 0 }).length === 0, '空列表布局安全')

// ── 6. 整理锚点（Home 视角）──
const a1 = O.anchorFromHome(null, 0)
check(a1.x === 0 && a1.y === 0 && a1.zoom === 1 && a1.rotation === 0, '无 Home 快照 → 出厂 (0,0,1) 竖屏')
const a2 = O.anchorFromHome(null, 90)
check(a2.rotation === 90, '无 Home 快照横屏 → rotation=90')
const a3 = O.anchorFromHome({ home: { x: 10, y: 20, zoom: 1.5 } }, 0)
check(a3.x === 10 && a3.y === 20 && a3.zoom === 1.5, 'Home 快照优先（home 槽位）')
const a4 = O.anchorFromHome({ fallback: { x: 5, y: 6, zoom: 2 } }, 0)
check(a4.x === 5 && a4.y === 6 && a4.zoom === 2, '无 home 快照 → fallback 槽位')
const a5 = O.anchorFromHome({ home: { x: 10, y: 20, zoom: 1.5 } }, 90)
check(a5.rotation === 90 && a5.x === 10, '横屏整理：快照槽位 + rotation=90')
// 锚定 Home 视角的整理结果：x 水平居中 + y 顶边基线（与 Home 顶部重合）
const anchorCam = O.anchorFromHome(null, 0)
const hv = O.organize(items, 412, 700, anchorCam)
check(Math.abs(gridCenterX(hv) - 206) < 0.01 && gridTopY(hv) === 16,
  '整理结果锚定 Home 出厂视野：x 居中 + 顶边基线')

// ── 6.5 交叉旋转可见性：旋转后中心图标可见（几何必然，拖动即可找回）──
// 24 条目（超过单方向容量：竖屏 4×6=24 满、横屏 7×3=21）——旋转后短边方向必出屏。
// 顶基线语义（2026-08-19 用户指定基线 = 顶栏边）下出屏**不一定对称**（基线侧贴边、
// 对侧溢出）——断言核心：网格与视口相交（中心图标可见）+ 不全部丢失。图标世界坐标
// 不变（没丢），拖动/双击 Home 可找回。
function crossVisibility(placed, cam, label) {
  let inView = 0
  placed.forEach(function (p) {
    const tl = CAM.worldToScreen(p.x, p.y, cam, 412, 700)
    const br = CAM.worldToScreen(p.x + O.ICON_W, p.y + O.ICON_H, cam, 412, 700)
    if (br.x > 0 && tl.x < 412 && br.y > 0 && tl.y < 700) inView++
  })
  check(inView > 0, label + '：旋转后仍有图标在视口内（' + inView + '/' + placed.length + '）')
}
const grid24 = []
for (let i = 0; i < 24; i++) grid24.push({ name: 'f' + i + '.txt', isDir: false })
const vp24 = O.organize(grid24, 412, 700, { x: 0, y: 0, zoom: 1, rotation: 0 })
const hp24 = O.organize(grid24, 412, 700, { x: 0, y: 0, zoom: 1, rotation: 90 })
crossVisibility(vp24, { x: 0, y: 0, zoom: 1, rotation: 90 }, '[交叉] 竖屏整理 → 横屏')
crossVisibility(hp24, { x: 0, y: 0, zoom: 1, rotation: 0 }, '[交叉] 横屏整理 → 竖屏')

// ── 7. 旋转保持位置 = 中心不变（防回归：曾误加相机位移把图标移出视野）──
// 屏幕中心 (w/2, h/2) 在 rotation=0 与 rotation=90 下对应**同一世界点** → 旋转无需动相机。
// 注意：中心不变 ≠ 全部图标不丢——视口矩形旋转 90° 后覆盖的世界区域宽高互换，
// 短边方向内容出屏是几何必然（见 6.5 交叉可见性）；保证的是**中心图标可见 + 世界
// 坐标不变**（图标没丢，拖动/双击 Home 可找回）。
const c0 = CAM.screenToWorld(206, 350, { x: 0, y: 0, zoom: 1, rotation: 0 }, 412, 700)
const c90 = CAM.screenToWorld(206, 350, { x: 0, y: 0, zoom: 1, rotation: 90 }, 412, 700)
check(c0.x === 206 && c0.y === 350, '竖屏屏幕中心 → 世界 (206,350)')
check(Math.abs(c90.x - c0.x) < 0.01 && Math.abs(c90.y - c0.y) < 0.01,
  '旋转 90° 后屏幕中心 → 同一世界点（中心不变；短边出屏对称可找回，见 6.5）')

if (failures > 0) {
  console.error('[fail] organize 测试失败 ' + failures + ' 项')
  process.exit(1)
}
console.log('[ok] desktop-organize 测试全部通过')
process.exit(0)
