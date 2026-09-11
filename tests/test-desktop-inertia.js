// desktop-gesture.js 单指 pan 惯性（动量）单元测试
// 背景：高级浏览模式 pan 松手后按末段速度（VelocityTracker 语义）继续滑行一小段——"任意工具放大图片后滑动"的手感。
// 模型：iOS UIScrollView.DecelerationRate（每 ms 速度乘保留比例），fast=0.99 为"滑一小段即平滑停"的标准值。
//       物理核心（速度采样 + 衰减 + 收尾判定）是手感 bug 高发区，须测试先行。
// 用法: node test-desktop-inertia.js [项目路径]   （由 run-tests.sh 调用）
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

const sandbox = { App: {}, console: console }
vm.createContext(sandbox)
for (const f of ['desktop-camera.js', 'desktop-gesture.js']) {
  vm.runInContext(fs.readFileSync(path.join(SRC_DIR, f), 'utf8'), sandbox, { filename: f })
}

const G = sandbox.App.DesktopGesture
const C = sandbox.App.DesktopCamera

// ── windowVelocity：VelocityTracker 末段速度（100ms 窗口，与 drawer-swipe 一致）──
// 1. 样本不足 2 → 0 速度
let v = G.windowVelocity([], 100)
check(v.vx === 0 && v.vy === 0, 'windowVelocity 空样本 → 0')
v = G.windowVelocity([{ x: 0, y: 0, t: 0 }], 100)
check(v.vx === 0 && v.vy === 0, 'windowVelocity 单样本 → 0')

// 2. 常量样本（时间未推进）→ 0
v = G.windowVelocity([{ x: 10, y: 20, t: 100 }, { x: 10, y: 20, t: 100 }], 100)
check(v.vx === 0 && v.vy === 0, 'windowVelocity 时间未推进 → 0')

// 3. 窗口内两样本：末段位移/时间（px/ms）。首样本恰在窗口起点（100ms 内，不被裁掉）。
v = G.windowVelocity([{ x: 0, y: 0, t: 100 }, { x: 100, y: 50, t: 200 }], 100)
// cut = 200-100 = 100 → s0 = t=100 样本；dt=100, win=max(16,100)=100 → vx=100/100=1.0, vy=50/100=0.5
check(approx(v.vx, 1.0) && approx(v.vy, 0.5),
  'windowVelocity 100ms 位移 (100,50) → vx=1.0 vy=0.5（实际 ' + v.vx + ',' + v.vy + '）')

// 4. 窗口裁剪（防御式）：窗口外最早样本不参与，速度按窗口内首→尾计。
v = G.windowVelocity([
  { x: 0, y: 0, t: 0 },      // 窗口外（相对 t=200 早 200ms，忽略）
  { x: 50, y: 0, t: 100 },   // 窗口内最早
  { x: 100, y: 0, t: 200 }   // 最新
], 100)
check(approx(v.vx, 0.5) && approx(v.vy, 0),
  'windowVelocity 窗口裁剪：t=0 样本被忽略 → vx=(100-50)/100=0.5（实际 ' + v.vx + '）')

// 5. 默认窗口 100ms（不传 windowMs）：首样本在窗口内
v = G.windowVelocity([{ x: 0, y: 0, t: 100 }, { x: 100, y: 0, t: 200 }])
check(approx(v.vx, 1.0), 'windowVelocity 默认窗口 100ms → vx=(100-0)/100=1.0（实际 ' + v.vx + '）')

// ── inertiaStep：iOS DecelerationRate=0.99 衰减 + 步进 ──
// 1. 速度按 0.99^dt 衰减；位移按当前速度（首帧全速）
const cam = C.create(0, 0, 1)
const st150 = G.inertiaStep(cam, { vx: 1, vy: 0 }, 150)
// f = 0.99^150 ≈ 0.221452；位移 = 1*150 = 150px → cam.x = -150（panBy 反向）
const f150 = Math.pow(0.99, 150)
check(approx(st150.vel.vx, f150), 'inertiaStep 速度衰减到 0.99^150=' + f150.toFixed(6) + '（实际 ' + st150.vel.vx.toFixed(6) + '）')
check(approx(st150.camera.x, -150) && approx(st150.camera.y, 0),
  'inertiaStep 位移 150px → cam.x=-150（实际 ' + st150.camera.x + '）')

// 2. dt 缺省/非法 → 16ms
const stDef = G.inertiaStep(cam, { vx: 1, vy: 0 })
const f16 = Math.pow(0.99, 16)
check(approx(stDef.vel.vx, f16) && approx(stDef.camera.x, -16),
  'inertiaStep 缺省 dt=16ms → 速度 0.99^16=' + f16.toFixed(6) + ' 位移 16px')

// 3. 多轴速度均衰减
const stMulti = G.inertiaStep(cam, { vx: 3, vy: -5 }, 50)
const f50 = Math.pow(0.99, 50)
check(approx(stMulti.vel.vx, 3 * f50) && approx(stMulti.vel.vy, -5 * f50),
  'inertiaStep 多轴 (3,-5) 各按相同系数衰减')

// 4. 透传 rotation（旋转态惯性不丢）
const camRot = C.create(10, 20, 1, 90)
const stRot = G.inertiaStep(camRot, { vx: 1, vy: 0 }, 16)
check(stRot.camera.rotation === 90, 'inertiaStep rotation=90 透传 rotation')
check(stRot.vel.vx < 1 && stRot.vel.vx > 0, 'inertiaStep rotation=90 速度正常衰减')

// ── inertiaDone：收尾判定（低于停止阈值 0.005 / 超 3000ms 最大时长）──
check(G.inertiaDone(null, 0) === true, 'inertiaDone null 速度 → true（收尾）')
check(G.inertiaDone({ vx: 0, vy: 0 }, 0) === true, 'inertiaDone 零速度 → true')
check(G.inertiaDone({ vx: 1.0, vy: 0 }, 100) === false, 'inertiaDone 1.0 px/ms 未低于阈值 → false')
check(G.inertiaDone({ vx: 0.004, vy: 0 }, 100) === true, 'inertiaDone 0.004 px/ms 低于停止阈值(0.005) → true')
check(G.inertiaDone({ vx: 0.01, vy: 0.01 }, 100) === false, 'inertiaDone 0.014 px/ms 高于停止阈值(0.005) → false')
check(G.inertiaDone({ vx: 1, vy: 0 }, 3001) === true, 'inertiaDone 超 3000ms 最大时长 → true')
check(G.inertiaDone({ vx: 1, vy: 0 }, 2999) === false, 'inertiaDone 2999ms 未超时长 → false')

// ── 物理数值验证：DecelerationRate=0.99 连续滑行距离收敛、速度单调递减、收尾平滑 ──
// 从 v0=（1,0）px/ms 反复步进（模拟 RAF ~16ms/帧），累计位移应收敛在 v0/(-ln0.99)≈99.5px 附近
// （实际离散略小于连续积分，因末段低于停止阈值即停）；速度单调递减保证"滑一段后自然平滑停"。
let simCam = C.create(0, 0, 1)
let simVel = { vx: 1, vy: 0 }
let totalDx = 0
let prevSpeed = Infinity
let monotonic = true
let lastStep = 0
for (let i = 0; i < 200; i++) {
  const r = G.inertiaStep(simCam, simVel, 16)
  const dx = r.camera.x - simCam.x      // panBy 反向：dx 屏幕正 → cam.x 负
  totalDx += Math.abs(dx)
  const speed = Math.sqrt(r.vel.vx * r.vel.vx + r.vel.vy * r.vel.vy)
  if (speed > prevSpeed + 1e-9) monotonic = false
  prevSpeed = speed
  simCam = r.camera
  simVel = r.vel
  lastStep = Math.abs(dx)
  if (speed < 0.005) break
}
check(monotonic, '惯性速度单调递减（不进给、不弹跳）')
check(totalDx > 60 && totalDx < 160, '惯性累计滑行距离收敛在 (60, 160)px，实际 ' + Math.round(totalDx) + 'px' +
  '（=滑一小段；过多=滚太远，过少=没手感）')
// 收尾平滑：末帧滑行位移应低于视觉可感阈值（≈0.08px/帧），杜绝"抽刀急停"
check(lastStep < 0.16, '惯性末帧滑行位移 < 0.16px（视觉几乎不可见 → 无急停感），实际 ' + lastStep.toFixed(4) + 'px')

if (failures > 0) {
  console.error('  [FAIL] desktop-inertia 单指惯性测试 ' + failures + ' 项失败')
  process.exit(1)
}
console.log('  [ok] desktop-inertia 单指惯性测试全部通过')
