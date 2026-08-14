// desktop-camera.js 纯函数单元测试：世界坐标 + 相机变换的数学核心
// 背景：相机 pan/pinch/坐标转换是「双指平移缩放跟手」的数学根基，手感 bug 必先在此复现
// 用法: node test-desktop-camera.js [项目路径]   （由 run-tests.sh 调用）
'use strict'

const fs = require('fs')
const path = require('path')
const vm = require('vm')

const PROJECT = process.argv[2] || path.join(__dirname, '..')
const SRC = path.join(PROJECT, 'src', 'js', 'desktop-camera.js')

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

const source = fs.readFileSync(SRC, 'utf8')
const sandbox = { App: {}, console: console }
vm.createContext(sandbox)
vm.runInContext(source, sandbox, { filename: 'desktop-camera.js' })

const C = sandbox.App.DesktopCamera

// ── clampZoom ──
check(C.clampZoom(1) === 1, 'clampZoom(1) = 1')
check(C.clampZoom(0.4) === 0.4, 'clampZoom 下限 0.4 不截断')
check(C.clampZoom(0.1) === 0.4, 'clampZoom 0.1 → 0.4（下限）')
check(C.clampZoom(2.5) === 2.5, 'clampZoom 上限 2.5 不截断')
check(C.clampZoom(9) === 2.5, 'clampZoom 9 → 2.5（上限）')
check(C.clampZoom(NaN) === 1, 'clampZoom NaN → 1')
check(C.clampZoom(Infinity) === 2.5, 'clampZoom Infinity → 2.5（上限）')

// ── create ──
check(C.create().zoom === 1 && C.create().x === 0 && C.create().y === 0, 'create() 默认 {0,0,1}')
check(C.create(5, 6, 0.1).zoom === 0.4, 'create 越界 zoom 被 clamp')

// ── screenToWorld / worldToScreen 互逆 ──
const cam = C.create(10, 20, 2)
const w = C.screenToWorld(100, 50, cam)
check(approx(w.x, 60) && approx(w.y, 45), 'screenToWorld (100,50) @zoom2 → (60,45)')
const s = C.worldToScreen(w.x, w.y, cam)
check(approx(s.x, 100) && approx(s.y, 50), 'worldToScreen 与 screenToWorld 互逆')

// zoom=1 恒等（仅平移）
const cam1 = C.create(10, 20, 1)
const w1 = C.screenToWorld(30, 40, cam1)
check(approx(w1.x, 40) && approx(w1.y, 60), 'screenToWorld zoom=1 仅加相机偏移')

// ── panBy ──
const p1 = C.panBy(C.create(0, 0, 1), 10, 0)
check(approx(p1.x, -10) && approx(p1.y, 0), 'panBy zoom=1 dx=10 → x=-10')
const p2 = C.panBy(C.create(0, 0, 2), 10, 0)
check(approx(p2.x, -5), 'panBy zoom=2 dx=10 → x=-5（按 zoom 折算）')
const p3 = C.panBy(C.create(100, 100, 2), -20, 0)
check(approx(p3.x, 110), 'panBy 反向拖动（dx=-20）→ x=110')
check(p1.zoom === 1, 'panBy 不改变 zoom')

// ── pinchBy：锚点世界坐标不动 ──
// 相机 (0,0,1)，锚点屏幕 (100,100)，指距放大 2 倍
const pinch = C.pinchBy(C.create(0, 0, 1), 100, 200, 100, 100)
check(approx(pinch.zoom, 2), 'pinchBy 指距 2x → zoom=2')
const anchorWorldBefore = C.screenToWorld(100, 100, C.create(0, 0, 1))
const anchorWorldAfter = C.screenToWorld(100, 100, pinch)
check(approx(anchorWorldBefore.x, anchorWorldAfter.x) && approx(anchorWorldBefore.y, anchorWorldAfter.y),
  'pinchBy 锚点处世界坐标不动')
// 缩小时锚点不动
const pinchIn = C.pinchBy(C.create(0, 0, 2), 200, 100, 50, 50)
check(approx(pinchIn.zoom, 1), 'pinchBy 指距 0.5x → zoom=1')
const awb2 = C.screenToWorld(50, 50, C.create(0, 0, 2))
const awa2 = C.screenToWorld(50, 50, pinchIn)
check(approx(awb2.x, awa2.x) && approx(awb2.y, awa2.y), 'pinchBy 缩小锚点世界坐标仍不动')

// ── pinchBy clamp 边界 ──
const pinchMax = C.pinchBy(C.create(0, 0, 2), 100, 1000, 0, 0)
check(pinchMax.zoom === 2.5, 'pinchBy 放大越界 → clamp 2.5')
const pinchMin = C.pinchBy(C.create(0, 0, 0.5), 100, 1, 0, 0)
check(pinchMin.zoom === 0.4, 'pinchBy 缩小越界 → clamp 0.4')

// pinchBy 非法指距 → 相机不变
const pinchBad = C.pinchBy(C.create(5, 6, 1), 0, 100, 50, 50)
check(pinchBad.x === 5 && pinchBad.y === 6 && pinchBad.zoom === 1, 'pinchBy prevDist=0 → 相机不变')

// ── transform ──
const t = C.transform(C.create(10, 20, 2))
check(approx(t.tx, -20) && approx(t.ty, -40) && t.zoom === 2, 'transform {10,20,2} → tx=-20,ty=-40')

// ── clampToBounds（folder 容器有限画布）──
// 世界 416x600，视口 400x500，zoom=1：可动范围 x∈[0,16] y∈[0,100]
let cb = C.clampToBounds(C.create(8, 50, 1), 416, 600, 400, 500)
check(cb.x === 8 && cb.y === 50, 'clampToBounds 范围内不动')
cb = C.clampToBounds(C.create(-5, 50, 1), 416, 600, 400, 500)
check(cb.x === 0, 'clampToBounds x 负 → 0')
cb = C.clampToBounds(C.create(30, 50, 1), 416, 600, 400, 500)
check(cb.x === 16, 'clampToBounds x 越右界 → 16（416-400）')
cb = C.clampToBounds(C.create(8, -3, 1), 416, 600, 400, 500)
check(cb.y === 0, 'clampToBounds y 负 → 0')
cb = C.clampToBounds(C.create(8, 500, 1), 416, 600, 400, 500)
check(cb.y === 100, 'clampToBounds y 越下界 → 100（600-500）')
// 世界小于视口：可动范围 0，相机钉在原点（不出现负坐标空区）
cb = C.clampToBounds(C.create(20, 30, 1), 300, 400, 400, 500)
check(cb.x === 0 && cb.y === 0, 'clampToBounds 世界小于视口 → 钉在 (0,0)')
// zoom=2 时世界可视范围减半：x∈[0, 416-200]=[0,216]
cb = C.clampToBounds(C.create(300, 0, 2), 416, 600, 400, 500)
check(cb.x === 216, 'clampToBounds zoom=2 越界 → 216（416-400/2）')
// 保持 zoom 不变
cb = C.clampToBounds(C.create(0, 0, 1.5), 416, 600, 400, 500)
check(cb.zoom === 1.5, 'clampToBounds 不改变 zoom')

if (failures > 0) {
  console.error('  [FAIL] desktop-camera 纯函数测试 ' + failures + ' 项失败')
  process.exit(1)
}
console.log('  [ok] desktop-camera 纯函数测试全部通过')
