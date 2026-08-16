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

// ── Viewer 态锚点：center = 视觉中心（text/parsed）；file = 文件位置（媒体）──
check(V.anchorIsCenter('text') && V.anchorIsCenter('markdown') && V.anchorIsCenter('json') && V.anchorIsCenter('html') && V.anchorIsCenter('website'), 'anchorIsCenter: 文本/解析/网站 → 视觉中心')
check(!V.anchorIsCenter('image') && !V.anchorIsCenter('video') && !V.anchorIsCenter('audio') && !V.anchorIsCenter('svg'), 'anchorIsCenter: 媒体 → 文件位置')

// ── cardSize34：3:4 竖版卡片（约束视口内，中心不变）──
let s34 = V.cardSize34(412, 915)
check(Math.abs(s34.w / s34.h - 3 / 4) < 0.01, 'cardSize34 保持 3:4 比例')
check(s34.w <= 412 - 32 + 1 && s34.h <= 915 - 96 + 1, 'cardSize34 约束在视口内')
s34 = V.cardSize34(100, 100)
check(s34.w >= 200 && s34.h >= 160, 'cardSize34 下限钳制（MIN_W/MIN_H）')

// ── visualCenter：相机视觉中心世界坐标 ──
let vc = V.visualCenter({ x: 100, y: 50, zoom: 2 }, 412, 915)
check(approx(vc.x, 100 + 412 / 4) && approx(vc.y, 50 + 915 / 4), 'visualCenter = 相机左上角 + 视口/(2·zoom)')
check(V.visualCenter(null, 412, 915) === null, 'visualCenter 相机缺失 → null 降级')

// ── 拖动手柄：handleScreenRect（屏幕坐标，固定尺寸不随 zoom）──
// 卡片世界 rect {x:100,y:200,w:200,h:100}，相机 (0,0,1)：手柄屏幕矩形位于卡片底部中心下方
let hs1 = V.handleScreenRect({ x: 100, y: 200, w: 200, h: 100 }, { x: 0, y: 0, zoom: 1 })
check(hs1 && hs1.w === 36 && hs1.h === 6, 'handleScreenRect 屏幕尺寸固定 36×6')
check(approx(hs1.x, 100 + 200 / 2 - 18) && approx(hs1.y, 200 + 100 + 14), 'handleScreenRect 位置 = 卡片底部中心 + 间距 14px')
// zoom=2：世界→屏幕翻倍，但手柄屏幕尺寸仍 36×6（位置随之缩放，间距 14px 恒定）
let hs2 = V.handleScreenRect({ x: 100, y: 200, w: 200, h: 100 }, { x: 0, y: 0, zoom: 2 })
check(hs2 && hs2.w === 36 && hs2.h === 6, 'handleScreenRect zoom=2 屏幕尺寸仍固定 36×6')
check(approx(hs2.x, (100 + 100) * 2 - 18) && approx(hs2.y, (200 + 100) * 2 + 14), 'handleScreenRect zoom=2 位置随世界坐标换算')
check(V.handleScreenRect(null, { x: 0, y: 0, zoom: 1 }) === null, 'handleScreenRect 卡片 rect 缺失 → null')

// ── 拖动手柄：handleWorldRect（世界坐标命中矩形，与屏幕矩形互逆）──
let hw1 = V.handleWorldRect({ x: 100, y: 200, w: 200, h: 100 }, { x: 0, y: 0, zoom: 1 })
check(hw1 && approx(hw1.w, 36) && approx(hw1.h, 6), 'handleWorldRect zoom=1 世界尺寸 = 屏幕尺寸')
check(approx(hw1.x + hw1.w / 2, 200) && approx(hw1.y, 314), 'handleWorldRect 中心 = 卡片底部中心，顶 = 底部+14px')
let hw2 = V.handleWorldRect({ x: 100, y: 200, w: 200, h: 100 }, { x: 0, y: 0, zoom: 2 })
check(hw2 && approx(hw2.w, 18) && approx(hw2.h, 3), 'handleWorldRect zoom=2 世界尺寸 = 屏幕尺寸/zoom（命中矩形随画布缩放）')
check(approx(hw2.y, 307), 'handleWorldRect zoom=2 间距也按 /zoom（屏幕恒定 14px）')

if (failures > 0) {
  console.error('  [FAIL] viewer 测试 ' + failures + ' 项失败')
  process.exit(1)
}
console.log('  [ok] viewer 测试全部通过')
