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

// ── 三模块映射：text / parsed / media ──
check(V.moduleFor('text') === 'text', 'moduleFor: text → text')
check(V.moduleFor('markdown') === 'parsed' && V.moduleFor('json') === 'parsed' && V.moduleFor('html') === 'parsed' && V.moduleFor('website') === 'parsed', 'moduleFor: md/json/html/website → parsed')
check(V.moduleFor('image') === 'media' && V.moduleFor('video') === 'media' && V.moduleFor('audio') === 'media' && V.moduleFor('svg') === 'media', 'moduleFor: 图/视频/音频/svg → media')
check(V.moduleFor('bogus') === null, 'moduleFor: 未知 → null')

// ── Viewer 态卡片形状：portrait = 3:4 固定（text/parsed/audio）；auto = 原始比例（图/视频/svg）──
check(V.cardIsPortrait('text') && V.cardIsPortrait('markdown') && V.cardIsPortrait('json') && V.cardIsPortrait('html') && V.cardIsPortrait('audio'), 'cardIsPortrait: 文本/解析/音频 → 3:4')
check(!V.cardIsPortrait('image') && !V.cardIsPortrait('video') && !V.cardIsPortrait('svg'), 'cardIsPortrait: 图/视频/svg → 原始比例')
check(!V.cardIsPortrait('website'), 'cardIsPortrait: website → 宽卡片（接近全屏，非 3:4）')

// ── 原地展开 anchorRect：卡片左上 = 图标位置，超视口夹回可视区 ──
// 相机 (0,0,1)、视口 412×915、卡片 240×320：图标在视口内 → 原位（左上对齐图标）
let ar1 = V.anchorRect({ x: 100, y: 200 }, 240, 320, { x: 0, y: 0, zoom: 1 }, 412, 915)
check(ar1 && ar1.x === 100 && ar1.y === 200, 'anchorRect: 图标在视口内 → 卡片左上 = 图标位置（原地展开）')
// 图标在屏幕右下角 → 卡片夹回视口（右/下边距 16px，顶部栏预留 96px）
let ar2 = V.anchorRect({ x: 400, y: 800 }, 240, 320, { x: 0, y: 0, zoom: 1 }, 412, 915)
check(ar2 && ar2.x === 156 && ar2.y === 579,
  'anchorRect: 卡片超视口 → 夹回 (156,579)，实际 (' + (ar2 && ar2.x) + ',' + (ar2 && ar2.y) + ')')
// 图标在左上角 → 卡片被顶部栏预留压到 y=96（x 保持 16 边距内原样）
let ar3 = V.anchorRect({ x: 16, y: 16 }, 240, 320, { x: 0, y: 0, zoom: 1 }, 412, 915)
check(ar3 && ar3.x === 16 && ar3.y === 96, 'anchorRect: 顶部图标 → y 夹到 96（顶部栏预留），x 不动')
// zoom=2：世界距离 = 屏幕 px/2，夹取边界随之缩放；卡片宽超可视区 → 贴最小边
let ar4 = V.anchorRect({ x: 300, y: 500 }, 240, 320, { x: 0, y: 0, zoom: 2 }, 412, 915)
check(ar4 && ar4.x === 8 && approx(ar4.y, 129.5),
  'anchorRect: zoom=2 卡片超宽贴 x=8、y 夹到 129.5，实际 (' + (ar4 && ar4.x) + ',' + (ar4 && ar4.y) + ')')
check(V.anchorRect(null, 240, 320, { x: 0, y: 0, zoom: 1 }, 412, 915) === null, 'anchorRect: anchor 缺失 → null')

// ── cardSize34：3:4 竖版卡片（约束视口内，中心不变）──
let s34 = V.cardSize34(412, 915)
check(Math.abs(s34.w / s34.h - 3 / 4) < 0.01, 'cardSize34 保持 3:4 比例')
check(s34.w <= 412 - 32 + 1 && s34.h <= 915 - 96 + 1, 'cardSize34 约束在视口内')
s34 = V.cardSize34(100, 100)
check(s34.w >= 200 && s34.h >= 160, 'cardSize34 下限钳制（MIN_W/MIN_H）')

// 拖动手柄已于 2026-08-20 刀 1 删除（交互模型与文件图标统一：选中即可直接拖动，
// 无需辅助入口）——handleScreenRect/handleWorldRect 纯函数随之移除，不再有手柄测试。
check(typeof V.handleScreenRect === 'undefined' && typeof V.handleWorldRect === 'undefined' &&
  typeof V.handleAt === 'undefined' && typeof V.syncHandles === 'undefined',
  '手柄 API 已整体移除（handleScreenRect/handleWorldRect/handleAt/syncHandles 不存在）')

if (failures > 0) {
  console.error('  [FAIL] viewer 测试 ' + failures + ' 项失败')
  process.exit(1)
}
console.log('  [ok] viewer 测试全部通过')
