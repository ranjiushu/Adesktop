// desktop-selection.js 纯函数单元测试：矩形归一化 + AABB 命中 + 选中集合
// 背景：框选/点选是选择系统的手感根基，命中判定（含边缘相切）必须稳定
// 用法: node test-desktop-selection.js [项目路径]   （由 run-tests.sh 调用）
'use strict'

const fs = require('fs')
const path = require('path')
const vm = require('vm')

const PROJECT = process.argv[2] || path.join(__dirname, '..')
const SRC = path.join(PROJECT, 'src', 'js', 'desktop-selection.js')

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
vm.runInContext(source, sandbox, { filename: 'desktop-selection.js' })

const S = sandbox.App.DesktopSelection

// ── rectFromPoints：任意两角点归一化 ──
check(JSON.stringify(S.rectFromPoints(0, 0, 100, 50)) === JSON.stringify({ x: 0, y: 0, w: 100, h: 50 }),
  'rectFromPoints 正向 (0,0)-(100,50) → {0,0,100,50}')
check(JSON.stringify(S.rectFromPoints(100, 50, 0, 0)) === JSON.stringify({ x: 0, y: 0, w: 100, h: 50 }),
  'rectFromPoints 反向 (100,50)-(0,0) → 归一化 {0,0,100,50}')
check(JSON.stringify(S.rectFromPoints(-20, 30, 40, -10)) === JSON.stringify({ x: -20, y: -10, w: 60, h: 40 }),
  'rectFromPoints 跨象限 → {x:-20,y:-10,w:60,h:40}')

// ── aabbIntersect ──
check(S.aabbIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }), '相交 → true')
check(!S.aabbIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 0, w: 10, h: 10 }), '分离 → false')
check(S.aabbIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 }), '边缘相切 → true')
check(S.aabbIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 2, y: 2, w: 2, h: 2 }), '包含 → true')

// ── marqueeHitTest ──
const bounds = {
  a: { x: 0, y: 0, w: 10, h: 10 },
  b: { x: 50, y: 0, w: 10, h: 10 },
  c: { x: 0, y: 50, w: 10, h: 10 }
}
check(JSON.stringify(S.marqueeHitTest({ x: -5, y: -5, w: 60, h: 60 }, bounds)) === JSON.stringify(['a', 'b', 'c']),
  '框选覆盖全部 → [a,b,c]（保序）')
check(JSON.stringify(S.marqueeHitTest({ x: -5, y: -5, w: 20, h: 20 }, bounds)) === JSON.stringify(['a']),
  '框选只覆盖 a → [a]')
check(S.marqueeHitTest({ x: 100, y: 100, w: 10, h: 10 }, bounds).length === 0, '框选空白 → 空数组')

// ── pointHitTest ──
check(S.pointHitTest(5, 5, bounds) === 'a', '点命中 a → a')
check(S.pointHitTest(55, 5, bounds) === 'b', '点命中 b → b')
check(S.pointHitTest(0, 0, bounds) === 'a', '点在 a 左上角（含边界）→ a')
check(S.pointHitTest(999, 999, bounds) === null, '点未命中 → null')

// ── 选中集合（不可变）──
const s0 = new Set()
const s1 = S.toggle(s0, 'a')
check(s1.has('a') && !s0.has('a'), 'toggle 空集加 a → {a}，原集不变')
check(!S.toggle(s1, 'a').has('a'), 'toggle {a} 去 a → 空')
check(S.add(s0, 'x').has('x') && !s0.has('x'), 'add 返回新集，原集不变')
check(!S.remove(s1, 'a').has('a') && s1.has('a'), 'remove 返回新集，原集不变')
check(S.clear().size === 0, 'clear → 空集')

if (failures > 0) {
  console.error('  [FAIL] desktop-selection 纯函数测试 ' + failures + ' 项失败')
  process.exit(1)
}
console.log('  [ok] desktop-selection 纯函数测试全部通过')
