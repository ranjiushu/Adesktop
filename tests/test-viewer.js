// viewer.js 纯函数单元测试：画布实体矩形（世界坐标）+ JSON 树节点
// 用法: node test-viewer.js [项目路径]   （由 run-tests.sh 调用）
'use strict'

const fs = require('fs')
const path = require('path')
const vm = require('vm')

const PROJECT = process.argv[2] || path.join(__dirname, '..')
const SRC = path.join(PROJECT, 'src', 'js', 'viewer.js')

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
vm.runInContext(source, sandbox, { filename: 'viewer.js' })

const V = sandbox.App.InternalViewer
const approx = function (a, b, tol) { return Math.abs(a - b) <= (tol || 0.001) }

// ── worldRect：卡片中心对齐锚点世界坐标 ──
let r = V.worldRect({ x: 180, y: 320 }, 380, 576)
check(approx(r.x, 180 - 190) && approx(r.y, 320 - 288), 'worldRect 中心对齐锚点')
check(approx(r.w, 380) && approx(r.h, 576), 'worldRect 保持给定尺寸')

// ── cardSize：接近屏幕尺度 ──
let s = V.cardSize(412, 768)
check(approx(s.w, 412 - 32) && approx(s.h, 768 - 96), 'cardSize = 视口 - 边距/让位（zoom=1 时接近屏幕）')
s = V.cardSize(100, 100)
check(s.w >= 200 && s.h >= 160, 'cardSize 下限钳制（MIN_W/MIN_H）')

// ── fitAspectRect：媒体自适应比例（中心点不变） ──
let ar = V.fitAspectRect({ x: 10, y: 20, w: 380, h: 672 }, 1920, 1080, 412, 768)
check(Math.abs(ar.w / ar.h - 1920 / 1080) < 0.01, '16:9 视频 → 实体宽高比 16:9')
check(ar.w <= 412 - 32 + 1 && ar.h <= 768 - 96 + 1, '自适应尺寸约束在视口内')
check(Math.abs((ar.x + ar.w / 2) - (10 + 380 / 2)) < 1, '自适应后中心点不变')
ar = V.fitAspectRect({ x: 10, y: 20, w: 380, h: 672 }, 1000, 2000, 412, 768)
check(Math.abs(ar.w / ar.h - 0.5) < 0.01, '竖图 1:2 → 实体保持竖比例')
check(V.fitAspectRect({ x: 0, y: 0, w: 100, h: 100 }, 0, 0, 412, 768) === null, '固有尺寸无效（0×0）→ null 降级')

// ── visibleRatio：全可见 / 部分出界 ──
check(approx(V.visibleRatio({ x: 0, y: 0, w: 100, h: 100 }, 360, 640), 1), '完全在视口内 → 1')
check(approx(V.visibleRatio({ x: 332, y: 0, w: 100, h: 100 }, 360, 640), 0.28), '右缘出界 → 部分可见(0.28)')

// ── jsonToNodes ──
let n = V.jsonToNodes({ a: 1, b: 'x' }, '')
check(n.type === 'object' && n.children.length === 2 && n.preview === 'Object{2}', '对象 → 2 子节点')
n = V.jsonToNodes([1, 2, 3], '')
check(n.type === 'array' && n.children.length === 3 && n.preview === 'Array[3]', '数组 → 3 子节点')
n = V.jsonToNodes('hello', 'k')
check(n.type === 'string' && n.key === 'k' && n.preview === '"hello"', '字符串带 key')
n = V.jsonToNodes(null, '')
check(n.type === 'null' && n.preview === 'null', 'null 类型')
n = V.jsonToNodes({ deep: { x: [1] } }, '')
const deep = n.children[0]
check(deep.key === 'deep' && deep.children[0].type === 'array', '嵌套层级递归')

if (failures > 0) {
  console.error('  [FAIL] viewer 测试 ' + failures + ' 项失败')
  process.exit(1)
}
console.log('  [ok] viewer 测试全部通过')
