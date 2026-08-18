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
vm.runInContext(fs.readFileSync(path.join(SRC, 'desktop-organize.js'), 'utf8'), sandbox, { filename: 'desktop-organize.js' })

const O = sandbox.App.DesktopOrganize

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

// ── 2. 竖屏列优先（从上到下）──
// 视口 412×700、zoom 1、相机中心 (0,0)：可见区域 -206..206 × -350..350，cols=4, rows=6
const vp = O.organize(items, 412, 700, { x: 0, y: 0, zoom: 1, rotation: 0 })
check(vp.length === items.length, 'organize 输出全部条目')
check(vp[0].x === -206 && vp[0].y === -350, '竖屏第一项 = 可见区域左上角 (-206, -350)')
check(vp[0].name === 'alpha', '排序后第一个（文件夹）占左上角')
check(vp[1].y === vp[0].y + O.GRID_H, '竖屏列优先：第二项在同一列下一行（y+GRID_H）')
check(vp[1].x === vp[0].x, '竖屏第二项 x 不变（同列）')
check(vp[6].y === vp[0].y, '第 7 项（rows=6 满列）换列：y 回到顶行')
check(vp[6].x === vp[0].x + O.GRID_W, '第 7 项换列：x+GRID_W')

// ── 3. 横屏行优先（从左到右）──
const hp = O.organize(items, 412, 700, { x: 0, y: 0, zoom: 1, rotation: 90 })
check(hp[0].x === -206 && hp[0].y === -350, '横屏第一项 = 左上角')
check(hp[1].x === hp[0].x + O.GRID_W, '横屏行优先：第二项在同一行右一列（x+GRID_W）')
check(hp[1].y === hp[0].y, '横屏第二项 y 不变（同行）')
check(hp[3].x === hp[0].x + 3 * O.GRID_W, '横屏第 4 项仍在第一行（cols=4 满行前）')
check(hp[4].x === hp[0].x, '第 5 项（cols=4 满行）换行：x 回到左列')
check(hp[4].y === hp[0].y + O.GRID_H, '第 5 项换行：y+GRID_H')

// ── 4. zoom 影响可见区域（网格更稀疏）──
const z2 = O.organize(items, 412, 700, { x: 0, y: 0, zoom: 2, rotation: 0 })
check(z2[1].x === z2[0].x && z2[1].y === z2[0].y + O.GRID_H, 'zoom=2 列优先语义不变')
check(z2[0].x === -103, 'zoom=2 可见区域左边界 = -206/2 = -103')

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
// 锚定 Home 视角的整理结果：首项在 Home 可见区域左上角
const anchorCam = O.anchorFromHome(null, 0)
const hv = O.organize(items, 412, 700, anchorCam)
check(hv[0].x === -206 && hv[0].y === -350, '整理结果锚定 Home 出厂视角可见区域（用户回 Home 可见全部）')

if (failures > 0) {
  console.error('[fail] organize 测试失败 ' + failures + ' 项')
  process.exit(1)
}
console.log('[ok] desktop-organize 测试全部通过')
process.exit(0)
