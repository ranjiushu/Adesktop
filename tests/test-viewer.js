// viewer.js 纯函数单元测试：卡片矩形（锚点跟随/不随缩放）+ JSON 树节点
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

// ── calcCardRect：锚点世界坐标 → 屏幕坐标（视口 360×640） ──
// 相机 (0,0,1)：锚点 (180,320) 居中
let r = V.calcCardRect({ wx: 180, wy: 320 }, { x: 0, y: 0, zoom: 1 }, 360, 640)
check(approx(r.w, 360 - 32), '卡片宽 = 视口宽 - 2×边距（接近屏幕尺度）')
check(approx(r.h, 640 - 64), '卡片高 = 视口高 - 顶栏/底栏让位')
check(approx(r.x, 180 - r.w / 2), 'x = 锚点屏幕位置 - 宽/2（锚定中心）')
check(approx(r.y, 320 - r.h / 2), 'y = 锚点屏幕位置 - 高/2（锚定中心）')

// ── 不随 zoom 缩放：zoom 变只改位置，尺寸不变 ──
const r1 = V.calcCardRect({ wx: 180, wy: 320 }, { x: 0, y: 0, zoom: 1 }, 360, 640)
const r2 = V.calcCardRect({ wx: 180, wy: 320 }, { x: 0, y: 0, zoom: 2 }, 360, 640)
check(approx(r2.w, r1.w) && approx(r2.h, r1.h), 'zoom 变化不改变卡片尺寸')
check(approx(r2.x, 180 * 2 - r2.w / 2), 'zoom 放大 2×：位置按 zoom 平移')

// ── 画布平移跟随：相机平移 dx → 卡片平移 dx×zoom ──
const r3 = V.calcCardRect({ wx: 180, wy: 320 }, { x: 50, y: 0, zoom: 1 }, 360, 640)
check(approx(r3.x, r.x - 50), '相机右移 50 → 卡片左移 50（随文件移动）')

// ── visibleRatio：全可见 / 部分出界 ──
check(approx(V.visibleRatio({ x: 0, y: 0, w: 100, h: 100 }, 360, 640), 1), '完全在视口内 → 1')
check(approx(V.visibleRatio({ x: 332, y: 0, w: 100, h: 100 }, 360, 640), 0.28), '右缘出界 → 部分可见(0.28)')

// ── immersiveRect ──
const im = V.immersiveRect(360, 640)
check(im.x === 0 && im.y === 0 && im.w === 360 && im.h === 640, '沉浸式 = 占满内容区')

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
