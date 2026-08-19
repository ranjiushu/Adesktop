// 整理桌面纯函数测试（2026-08-19）：排序规则 + 网格布局方向。
// 1. sortEntries：文件夹在前（名称升序）；文件按扩展名分组（组内名称升序）
// 2. organize：锚定相机可见区域左上角；竖屏列优先（从上到下）；横屏行优先（从左到右）
// 3. 视口/zoom 影响可见网格密度（列数/行数随 zoom 变化）
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
  { name: 'c.TXT', isDir: false }
]
const sorted = O.sortEntries(items)
check(sorted[0].name === 'alpha' && sorted[1].name === 'zeta',
  '文件夹在前且按名称升序（alpha, zeta）')
check(sorted[2].name === '报告.docx' && sorted[3].name === '照片.png',
  '文件按扩展名字母序分组（docx 组 → png 组）')
check(sorted[4].name === 'a.txt' && sorted[5].name === 'b.txt' && sorted[6].name === 'c.TXT',
  'txt 组：按名称升序（a.txt, b.txt, c.TXT——扩展名小写归一）')
check(sorted.length === items.length, '排序不丢条目')

// ── 2. 竖屏行优先（Android 启动器式：从左到右排满一行再下一行）──
// 视口 412×700、zoom 1、相机 (0,0,1,0)：可见区域 0..412 × 0..700，cols=4
const vp = O.organize(items, 412, 700, { x: 0, y: 0, zoom: 1, rotation: 0 })
check(vp.length === items.length, 'organize 输出全部条目')
check(vp[0].x === 0 && vp[0].y === 0, '竖屏第一项 = 可见区域左上角 (0,0)')
check(vp[0].name === 'alpha', '排序后第一个（文件夹）占左上角')
check(vp[1].x === vp[0].x + O.GRID_W && vp[1].y === vp[0].y,
  '竖屏行优先：第二项在同一行右一格（x+GRID_W）')
check(vp[3].x === vp[0].x + 3 * O.GRID_W, '第 4 项仍在第一行（cols=4 满行前）')
check(vp[4].x === vp[0].x && vp[4].y === vp[0].y + O.GRID_H,
  '第 5 项（cols=4 满行）换行：x 回到左列、y+GRID_H')
check(vp[6].x === vp[0].x + 2 * O.GRID_W && vp[6].y === vp[0].y + O.GRID_H,
  '第 7 项在第二行第三个')

// ── 3. 横屏列优先（Windows 桌面式：从上到下排满一列再下一列）──
// 视口 800×400、zoom 1、相机 (0,0,1,90)：屏幕左上角对应世界 (200,600)（画布绕视口中心旋转），
// 每列 4 格（屏幕高 400/GRID_W=100）、6 列（屏幕宽 800/GRID_H=116）
const hp = O.organize(items, 800, 400, { x: 0, y: 0, zoom: 1, rotation: 90 })
check(hp[0].x === 200 && hp[0].y === 600, '横屏第一项 = 屏幕左上角对应世界点 (200,600)')
check(hp[1].x === hp[0].x + O.GRID_W && hp[1].y === hp[0].y,
  '横屏列优先：第二项在同一列下一格（x+GRID_W = 屏幕向下）')
check(hp[3].x === hp[0].x + 3 * O.GRID_W, '第 4 项仍在第一列（每列 4 格满列前）')
check(hp[4].x === hp[0].x && hp[4].y === hp[0].y - O.GRID_H,
  '第 5 项（满列）换列：x 回到顶行、y-GRID_H（= 屏幕向右）')
check(hp[6].x === hp[0].x + 2 * O.GRID_W && hp[6].y === hp[0].y - O.GRID_H,
  '第 7 项在第二列第三个')

// ── 3.5 屏幕映射验证：整理结果经真实 worldToScreen 全部落在视口内（与 Home 完全重合）──
function allInViewport(placed, camera, vw, vh, label) {
  let ok = true
  placed.forEach(function (p) {
    const s = CAM.worldToScreen(p.x, p.y, camera, vw, vh)
    if (s.x < -0.5 || s.x > vw + 0.5 || s.y < -0.5 || s.y > vh + 0.5) ok = false
  })
  check(ok, label + '：整理结果全部落在屏幕视口内')
}
allInViewport(vp, { x: 0, y: 0, zoom: 1, rotation: 0 }, 412, 700, '竖屏')
allInViewport(hp, { x: 0, y: 0, zoom: 1, rotation: 90 }, 800, 400, '横屏')
// 有 Home 快照（非原点）时同样重合
allInViewport(
  O.organize(items, 800, 400, { x: 120, y: 80, zoom: 1, rotation: 90 }),
  { x: 120, y: 80, zoom: 1, rotation: 90 }, 800, 400, '横屏（Home 快照非原点）')

// ── 4. zoom 影响可见区域（网格更稀疏）──
const z2 = O.organize(items, 412, 700, { x: 0, y: 0, zoom: 2, rotation: 0 })
check(z2[1].x === z2[0].x + O.GRID_W && z2[1].y === z2[0].y, 'zoom=2 竖屏行优先语义不变')
check(z2[0].x === 0, 'zoom=2 左边界 = 相机 x（左上角语义不变）')

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
// 锚定 Home 视角的整理结果：首项在 Home 可见区域左上角（与 Home 区域完全重合）
const anchorCam = O.anchorFromHome(null, 0)
const hv = O.organize(items, 412, 700, anchorCam)
check(hv[0].x === 0 && hv[0].y === 0, '整理结果锚定 Home 出厂视角可见区域（与 Home 完全重合）')

if (failures > 0) {
  console.error('[fail] organize 测试失败 ' + failures + ' 项')
  process.exit(1)
}
console.log('[ok] desktop-organize 测试全部通过')
process.exit(0)
