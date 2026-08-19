// desktop-gesture.js 纯函数单元测试：触点几何 + 指数突变状态机 + 双指相机步进
// 背景：1→2 指切 panzoom、2→1 指剩指 dead 不误触发，是触摸手势最易出 bug 的地方
// 用法: node test-desktop-gesture.js [项目路径]   （由 run-tests.sh 调用）
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
function approx(a, b, eps) {
  return Math.abs(a - b) <= (eps || 1e-9)
}

// 加载依赖：desktop-camera → desktop-gesture（两模块直接挂 App，无需 window）
const sandbox = { App: {}, console: console }
vm.createContext(sandbox)
for (const f of ['desktop-camera.js', 'desktop-gesture.js']) {
  const src = fs.readFileSync(path.join(SRC_DIR, f), 'utf8')
  vm.runInContext(src, sandbox, { filename: f })
}

const G = sandbox.App.DesktopGesture
const C = sandbox.App.DesktopCamera

// ── distance ──
check(approx(G.distance({ x: 0, y: 0 }, { x: 3, y: 4 }), 5), 'distance (0,0)-(3,4) = 5')
check(approx(G.distance({ x: 1, y: 1 }, { x: 1, y: 1 }), 0), 'distance 同点 = 0')

// ── centroid ──
const c2 = G.centroid(new Map([
  [1, { x: 0, y: 0 }],
  [2, { x: 100, y: 50 }]
]))
check(approx(c2.x, 50) && approx(c2.y, 25), 'centroid 双指质心 (50,25)')
check(G.centroid(new Map()) === null, 'centroid 空集 → null')

// ── modeAfter：指数突变状态机 ──
check(G.modeAfter(1, 'idle') === 'single', '0→1 指 → single')
check(G.modeAfter(2, 'single') === 'double', '1→2 指 → double')
check(G.modeAfter(1, 'double') === 'dead', '2→1 指 → dead（剩指不再触发）')
check(G.modeAfter(1, 'dead') === 'dead', 'dead 中剩指不复活 → 仍 dead')
check(G.modeAfter(2, 'dead') === 'dead', 'dead 中再落指 → 仍 dead')
check(G.modeAfter(0, 'dead') === 'idle', 'dead 全抬起 → idle')
check(G.modeAfter(0, 'single') === 'idle', 'single 抬起 → idle')
check(G.modeAfter(3, 'single') === 'double', '3 指也归 double')

// ── panZoomStep：双指一帧 ──
// 仅平移（指距不变）
const cam0 = C.create(0, 0, 1)
const panOnly = G.panZoomStep(cam0, { x: 0, y: 0 }, { x: 10, y: 20 }, 100, 100)
check(approx(panOnly.x, -10) && approx(panOnly.y, -20) && panOnly.zoom === 1,
  'panZoomStep 仅平移（指距不变）→ 等效 panBy')

// 仅缩放（质心不动）
const zoomOnly = G.panZoomStep(C.create(0, 0, 1), { x: 100, y: 100 }, { x: 100, y: 100 }, 100, 200)
check(approx(zoomOnly.zoom, 2), 'panZoomStep 仅缩放（质心不动）→ zoom=2')
const anchorBefore = C.screenToWorld(100, 100, C.create(0, 0, 1))
const anchorAfter = C.screenToWorld(100, 100, zoomOnly)
check(approx(anchorBefore.x, anchorAfter.x) && approx(anchorBefore.y, anchorAfter.y),
  'panZoomStep 缩放锚点世界坐标不动')

// panZoomStep rotation=90：双指平移+缩放，锚点世界坐标不动（vw/vh 传旋转中心）
const camRot = C.create(50, 30, 1, 90)
const panZoomRot = G.panZoomStep(camRot, { x: 110, y: 105 }, { x: 110, y: 105 }, 100, 200, 360, 640)
check(panZoomRot.rotation === 90, 'panZoomStep rotation=90 透传 rotation')
const rotAnchorBefore = C.screenToWorld(110, 105, camRot, 360, 640)
const rotAnchorAfter = C.screenToWorld(110, 105, panZoomRot, 360, 640)
check(approx(rotAnchorBefore.x, rotAnchorAfter.x) && approx(rotAnchorBefore.y, rotAnchorAfter.y),
  'panZoomStep rotation=90 缩放锚点世界坐标不动')

// ── 单指 pending 分派（沿用 Desktop 语义：selected → 拿起 / icon+empty → 框选）──
const plainOpts = { tapThreshold: 6 }
let sg = G.singleDown(100, 100, 0, 'selected')
let r2 = G.singleMove(sg, 130, 100, plainOpts)
check(r2.sg.phase === 'dragmove' && r2.effect.type === 'drag-start',
  '已选中拖动 → drag-start（直接拿起）')
sg = G.singleDown(100, 100, 0, 'icon')
r2 = G.singleMove(sg, 130, 100, plainOpts)
check(r2.sg.phase === 'marquee' && r2.effect.type === 'marquee-start',
  '未选中图标拖动 → marquee（框选）')
sg = G.singleDown(100, 100, 0, 'viewer-selected')
r2 = G.singleMove(sg, 130, 100, plainOpts)
check(r2.sg.phase === 'dragmove' && r2.effect.type === 'drag-start',
  '已选中 Viewer 拖动 → drag-start（直接拿起）')
sg = G.singleDown(100, 100, 0, 'viewer')
r2 = G.singleMove(sg, 130, 100, plainOpts)
check(r2.sg.phase === 'marquee' && r2.effect.type === 'marquee-start',
  '未选中 Viewer 拖动 → marquee（框选触发选中，不直接拿起）')
sg = G.singleDown(100, 100, 0, 'empty')
r2 = G.singleMove(sg, 130, 100, plainOpts)
check(r2.sg.phase === 'marquee' && r2.effect.type === 'marquee-start',
  '空白处拖动 → marquee（框选，folder 容器同样框选不滚动）')
// 位移未超阈值 up → tap
sg = G.singleDown(10, 10, 0, 'empty')
const upTap = G.singleUp(sg, 12, 12, plainOpts)
check(upTap.effect.type === 'tap', '小位移 up → tap（单击不受影响）')

if (failures > 0) {
  console.error('  [FAIL] desktop-gesture 纯函数测试 ' + failures + ' 项失败')
  process.exit(1)
}
console.log('  [ok] desktop-gesture 纯函数测试全部通过')
