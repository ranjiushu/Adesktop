// desktop-grid.js 纯函数单元测试：网格吸附 + cell 换算 + 放置避让
// 背景：避让逻辑是「重叠者让位到最近空位」，必须稳定可测（放置不重叠、尽量靠近期望位）
// 用法: node test-desktop-grid.js [项目路径]   （由 run-tests.sh 调用）
'use strict'

const fs = require('fs')
const path = require('path')
const vm = require('vm')

const PROJECT = process.argv[2] || path.join(__dirname, '..')
const SRC = path.join(PROJECT, 'src', 'js', 'desktop-grid.js')

let failures = 0
function check(cond, msg) {
  if (cond) {
    console.log('  [ok] ' + msg)
  } else {
    console.error('  [fail] ' + msg)
    failures++
  }
}

const source = fs.readFileSync(SRC, 'utf8')
const sandbox = { App: {}, console: console }
vm.createContext(sandbox)
vm.runInContext(source, sandbox, { filename: 'desktop-grid.js' })

const G = sandbox.App.DesktopGrid

// ── snapToGrid ──
check(JSON.stringify(G.snapToGrid(16, 16)) === JSON.stringify({ x: 16, y: 16 }), 'snapToGrid 已在交点 → 不动')
check(JSON.stringify(G.snapToGrid(120, 80)) === JSON.stringify({ x: 116, y: 132 }), 'snapToGrid (120,80) → (116,132)')
check(JSON.stringify(G.snapToGrid(0, 0)) === JSON.stringify({ x: 16, y: 16 }), 'snapToGrid 原点外 → 回 (16,16)')

// ── worldToCell / cellToWorld 互逆 ──
check(JSON.stringify(G.worldToCell(116, 116)) === JSON.stringify({ cx: 1, cy: 1 }), 'worldToCell (116,116) → (1,1)')
check(JSON.stringify(G.cellToWorld(1, 1)) === JSON.stringify({ x: 116, y: 132 }), 'cellToWorld (1,1) → (116,132)')
check(JSON.stringify(G.cellToWorld(G.worldToCell(316, 248).cx, G.worldToCell(316, 248).cy)) === JSON.stringify({ x: 316, y: 248 }),
  'worldToCell→cellToWorld 恒等')

// ── findFreeCell ──
check(JSON.stringify(G.findFreeCell(1, 0, new Set(['1,0']))) === JSON.stringify({ cx: 2, cy: 0 }),
  'findFreeCell 占用时 → 右邻 (2,0)')
check(JSON.stringify(G.findFreeCell(1, 0, new Set(['1,0', '2,0']))) === JSON.stringify({ cx: 1, cy: 1 }),
  'findFreeCell 右邻也被占 → 下邻 (1,1)（右/下/左/上 顺序）')

// ── resolvePlacement：无冲突 ──
let r = G.resolvePlacement([{ name: 'a', x: 116, y: 16 }], [{ name: 'b', x: 216, y: 16 }])
check(JSON.stringify(r.a) === JSON.stringify({ x: 116, y: 16 }) && JSON.stringify(r.b) === JSON.stringify({ x: 216, y: 16 }),
  '无冲突：a(116,16) b(216,16) 原地不动')

// ── resolvePlacement：单图标冲突 → 被占者让位 ──
r = G.resolvePlacement([{ name: 'a', x: 116, y: 16 }], [{ name: 'b', x: 116, y: 16 }])
check(JSON.stringify(r.a) === JSON.stringify({ x: 116, y: 16 }), '冲突：a 放期望位 (116,16)')
check(JSON.stringify(r.b) === JSON.stringify({ x: 216, y: 16 }), '冲突：b 让位到最近空位 (216,16)')

// ── resolvePlacement：组移动 + 冲突 ──
r = G.resolvePlacement(
  [{ name: 'a', x: 116, y: 16 }, { name: 'b', x: 216, y: 16 }],
  [{ name: 'c', x: 116, y: 16 }]
)
check(JSON.stringify(r.a) === JSON.stringify({ x: 116, y: 16 }) && JSON.stringify(r.b) === JSON.stringify({ x: 216, y: 16 }),
  '组移动：a、b 放期望位')
check(JSON.stringify(r.c) === JSON.stringify({ x: 116, y: 132 }), '组移动：c 让位到 (116,132)（右被占则下移一行）')

// ── resolvePlacement：链式让位 ──
r = G.resolvePlacement(
  [{ name: 'a', x: 116, y: 16 }],
  [{ name: 'b', x: 216, y: 16 }, { name: 'c', x: 316, y: 16 }]
)
check(JSON.stringify(r.b) === JSON.stringify({ x: 216, y: 16 }) && JSON.stringify(r.c) === JSON.stringify({ x: 316, y: 16 }),
  '链式让位：b→(216,16) c→(316,16)')

// ── resolvePlacement：immovable 钉子户（锁定文件）──
// 移动组压到钉子户格上 → 移动组让位，钉子户不动
r = G.resolvePlacement(
  [{ name: 'a', x: 116, y: 16 }],
  [{ name: 'lock', x: 116, y: 16 }],
  ['lock']
)
check(JSON.stringify(r.lock) === JSON.stringify({ x: 116, y: 16 }), 'immovable：钉子户原地不动 (116,16)')
check(JSON.stringify(r.a) === JSON.stringify({ x: 216, y: 16 }), 'immovable：冲突时移动组让位 → a(216,16)')

// 钉子户与普通静止共存：普通静止让位，钉子户不动
r = G.resolvePlacement(
  [{ name: 'a', x: 116, y: 16 }, { name: 'b', x: 216, y: 16 }],
  [{ name: 'lock', x: 116, y: 16 }, { name: 'c', x: 216, y: 16 }],
  ['lock']
)
check(JSON.stringify(r.lock) === JSON.stringify({ x: 116, y: 16 }), 'immovable：钉子户 lock 原地不动')
check(JSON.stringify(r.a) === JSON.stringify({ x: 216, y: 16 }), 'immovable：a 被钉子户挤到 (216,16)')
check(JSON.stringify(r.b) === JSON.stringify({ x: 316, y: 16 }), 'immovable：b 被 a 挤到 (316,16)')
check(JSON.stringify(r.c) === JSON.stringify({ x: 216, y: 132 }), 'immovable：普通静止 c 被 a 挤到 (216,132)')

// 无冲突时 immovable 不影响任何位置
r = G.resolvePlacement(
  [{ name: 'a', x: 116, y: 16 }],
  [{ name: 'lock', x: 316, y: 16 }],
  ['lock']
)
check(JSON.stringify(r.lock) === JSON.stringify({ x: 316, y: 16 }) && JSON.stringify(r.a) === JSON.stringify({ x: 116, y: 16 }),
  'immovable 无冲突：双方原地')

// 钉子户不在网格点（Viewer 预览窗口自由拖动位）→ 保持原始坐标，不被吸附
r = G.resolvePlacement(
  [{ name: 'a', x: 116, y: 16 }],
  [{ name: 'lock', x: 150, y: 260 }],
  ['lock']
)
check(JSON.stringify(r.lock) === JSON.stringify({ x: 150, y: 260 }), 'immovable 钉子户非网格点：保持原始坐标 (150,260) 不被吸附')
check(JSON.stringify(r.a) === JSON.stringify({ x: 116, y: 16 }), 'immovable 钉子户非网格点：无冲突移动组原位')

// 旧签名（无第三参）行为不变
r = G.resolvePlacement([{ name: 'a', x: 116, y: 16 }], [{ name: 'b', x: 116, y: 16 }])
check(JSON.stringify(r.a) === JSON.stringify({ x: 116, y: 16 }) && JSON.stringify(r.b) === JSON.stringify({ x: 216, y: 16 }),
  '无 immovable 参数：行为与旧版一致（b 让位）')

if (failures > 0) {
  console.error('  [FAIL] desktop-grid 测试 ' + failures + ' 项失败')
  process.exit(1)
}
console.log('  [ok] desktop-grid 测试全部通过')
