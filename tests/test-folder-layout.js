// folder-layout.js 单元测试：网格/列表坐标 + 画布尺寸 + 图标宽
// 用法: node test-folder-layout.js [项目路径]   （由 run-tests.sh 调用）
'use strict'

const fs = require('fs')
const path = require('path')
const vm = require('vm')

const PROJECT = process.argv[2] || path.join(__dirname, '..')
const SRC_DIR = path.join(PROJECT, 'src', 'js')

let failures = 0
function check(cond, msg) {
  if (cond) {
    console.log('  [ok] ' + msg)
  } else {
    console.error('  [fail] ' + msg)
    failures++
  }
}
function approx(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-6) }

const sandbox = { App: {}, console: console }
vm.createContext(sandbox)
for (const f of ['desktop-grid.js', 'folder-layout.js']) {
  vm.runInContext(fs.readFileSync(path.join(SRC_DIR, f), 'utf8'), sandbox, { filename: f })
}

const L = sandbox.App.FolderLayout
const G = sandbox.App.DesktopGrid

// ── 网格位置（视口 412：列宽 = (412-32)/4 = 95）──
let p = L.gridPositions(5, 412)
check(p.length === 5, 'gridPositions(5) → 5 个位置')
check(p[0].x === 16 && p[0].y === 16, '第 1 个 (16,16)')
check(approx(p[1].x, 111) && p[1].y === 16, '第 2 个 x=111（16+95）')
check(approx(p[3].x, 301) && p[3].y === 16, '第 4 个 x=301（16+3*95）')
check(approx(p[4].x, 16) && p[4].y === G.GRID_H + 16, '第 5 个换行 → (16, GRID_H+16)')

// 视口 360：列宽 82
p = L.gridPositions(4, 360)
check(approx(p[1].x, 98) && approx(p[2].x, 180) && approx(p[3].x, 262), '视口 360 列宽 82：x=16,98,180,262')

// ── 列表位置 ──
p = L.listPositions(3)
check(p[0].y === 0 && p[1].y === 56 && p[2].y === 112, 'listPositions 行高 56 递增')
check(p[0].x === 0, '列表 x 恒 0')
check(L.listPositions(0).length === 0, 'listPositions(0) → 空')

// ── 画布尺寸 ──
let c = L.canvasSize(4, 412, 'grid')
check(c.w === 412 && approx(c.h, 16 + G.GRID_H), '网格 4 项 → 1 行：高 ORIGIN_Y+GRID_H')
c = L.canvasSize(5, 412, 'grid')
check(approx(c.h, 16 + 2 * G.GRID_H), '网格 5 项 → 2 行')
c = L.canvasSize(0, 412, 'grid')
check(approx(c.h, 16 + G.GRID_H), '网格 0 项 → 至少 1 行高（纸面可见）')
c = L.canvasSize(3, 412, 'list')
check(c.w === 412 && c.h === 3 * 56, '列表 3 项 → 高 168')

// ── 图标宽 ──
check(approx(L.iconWidth(412), 87), 'iconWidth(412) = 95-8 = 87')
check(approx(L.iconWidth(360), 74), 'iconWidth(360) = 82-8 = 74')
check(L.iconWidth(200) === 48, 'iconWidth 过窄 → 下限 48')

// ── 常量 ──
check(L.COLS === 4 && L.LIST_ROW_H === 56, '常量 COLS=4 / LIST_ROW_H=56')

if (failures > 0) {
  console.error('  [FAIL] folder-layout 测试 ' + failures + ' 项失败')
  process.exit(1)
}
console.log('  [ok] folder-layout 测试全部通过')
