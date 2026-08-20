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
check(C.clampZoom(0.1) === 0.1, 'clampZoom 下限 0.1 不截断')
check(C.clampZoom(0.05) === 0.1, 'clampZoom 0.05 → 0.1（下限）')
check(C.clampZoom(10) === 10, 'clampZoom 上限 10 不截断')
check(C.clampZoom(20) === 10, 'clampZoom 20 → 10（上限）')
check(C.clampZoom(NaN) === 1, 'clampZoom NaN → 1')
check(C.clampZoom(Infinity) === 10, 'clampZoom Infinity → 10（上限）')

// ── create ──
check(C.create().zoom === 1 && C.create().x === 0 && C.create().y === 0, 'create() 默认 {0,0,1}')
check(C.create(5, 6, 0.01).zoom === 0.1, 'create 越界 zoom 被 clamp')

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
check(pinchMax.zoom === 10, 'pinchBy 放大越界 → clamp 10')
const pinchMin = C.pinchBy(C.create(0, 0, 0.5), 100, 1, 0, 0)
check(pinchMin.zoom === 0.1, 'pinchBy 缩小越界 → clamp 0.1')

// pinchBy 非法指距 → 相机不变
const pinchBad = C.pinchBy(C.create(5, 6, 1), 0, 100, 50, 50)
check(pinchBad.x === 5 && pinchBad.y === 6 && pinchBad.zoom === 1, 'pinchBy prevDist=0 → 相机不变')

// ── transform ──
const t = C.transform(C.create(10, 20, 2))
check(approx(t.tx, -20) && approx(t.ty, -40) && t.zoom === 2, 'transform {10,20,2} → tx=-20,ty=-40')

// ── easeInOutCubic（缓入缓出曲线，Home 平滑过渡用）──
// 背景：曾用 easeOutCubic（缓出）——起步即全速（k=0 斜率最大 =3），
// 前 100ms 走完 58% 路程，人眼感知为「甩/弹射」。缓入缓出起步斜率 0、
// 中段峰值减半，无弹射；f(0.5)=0.5 对称。
check(C.easeInOutCubic(0) === 0, 'easeInOutCubic(0) = 0')
check(C.easeInOutCubic(1) === 1, 'easeInOutCubic(1) = 1')
check(approx(C.easeInOutCubic(0.5), 0.5), 'easeInOutCubic(0.5) = 0.5（对称中点）')
check(C.easeInOutCubic(-1) === 0, 'easeInOutCubic 负输入钳制 0')
check(C.easeInOutCubic(2) === 1, 'easeInOutCubic 超 1 钳制 1')
// 起步缓：前 10% 时间推进 < 1%（easeOutCubic 同区间推进 ~27%）——防「弹射」回归
check(C.easeInOutCubic(0.1) < 0.01, 'easeInOutCubic(0.1) < 0.01（起步斜率≈0，无弹射）')
// 单调性：全程单调不减
let prev = -1, mono = true
for (let i = 0; i <= 20; i++) {
  const v = C.easeInOutCubic(i / 20)
  if (v < prev) mono = false
  prev = v
}
check(mono, 'easeInOutCubic 单调不减')
// 对称性：f(k) + f(1-k) = 1（减速段与加速段镜像，首尾速度一致）
check(approx(C.easeInOutCubic(0.3) + C.easeInOutCubic(0.7), 1), 'easeInOutCubic 对称：f(0.3)+f(0.7)=1')

// ── lerp（相机插值：x/y/zoom 线性过渡）──
const L_FROM = C.create(100, 200, 0.5)
const L_TO = C.create(300, 400, 2)
const l0 = C.lerp(L_FROM, L_TO, 0)
check(approx(l0.x, 100) && approx(l0.y, 200) && approx(l0.zoom, 0.5), 'lerp k=0 → 起点')
const l1 = C.lerp(L_FROM, L_TO, 1)
check(approx(l1.x, 300) && approx(l1.y, 400) && approx(l1.zoom, 2), 'lerp k=1 → 终点')
const lh = C.lerp(L_FROM, L_TO, 0.5)
check(approx(lh.x, 200) && approx(lh.y, 300) && approx(lh.zoom, 1.25), 'lerp k=0.5 → 中点（含 zoom）')
// k 越界钳制
const lo = C.lerp(L_FROM, L_TO, 1.5)
check(approx(lo.x, 300) && approx(lo.zoom, 2), 'lerp k>1 钳制 1')
const lun = C.lerp(L_FROM, L_TO, -0.5)
check(approx(lun.x, 100) && approx(lun.zoom, 0.5), 'lerp k<0 钳制 0')
// 非法输入防御
const ldef = C.lerp(null, L_TO, 0.5)
check(ldef.x >= 0 && ldef.y >= 0 && ldef.zoom >= 1, 'lerp from=null → 用默认相机起步')

// ── lerpCentered（锚定屏幕中心的相机插值，Home 动画用）──
// 契约：k = 真实时间比例 [0,1]（desktop.js 不预缓动，内部统一 easeInOutCubic）。
// 曾因调用方预缓动 + 内部段边界比较缓动值，段2 平移被压缩到 18% 时间（72ms 急冲骤停）
// ——真机「震感」；且单测直传进度与生产契约不一致，防震测试失效。
// 修复后：zoom 不变时 == lerp(from, to, easeInOutCubic(k))（退化一致）。
const LC_VW = 360
const LC_VH = 640
// 1. zoom 不变 → 与 lerp 结果严格一致（退化超集，用 zoom 相同的起止点验证）
const LC_SAME_F = C.create(100, 200, 1.5)
const LC_SAME_T = C.create(300, 400, 1.5)
const lcSame = C.lerpCentered(LC_SAME_F, LC_SAME_T, 0.3, LC_VW, LC_VH)
const lpSame = C.lerp(LC_SAME_F, LC_SAME_T, C.easeInOutCubic(0.3))
check(approx(lcSame.x, lpSame.x) && approx(lcSame.y, lpSame.y) && approx(lcSame.zoom, lpSame.zoom),
  'lerpCentered zoom 不变时与 lerp 一致')
// 2. 端点：k=0/k=1 等于起止相机
const lc0 = C.lerpCentered(L_FROM, L_TO, 0, LC_VW, LC_VH)
const lc1 = C.lerpCentered(L_FROM, L_TO, 1, LC_VW, LC_VH)
check(approx(lc0.x, L_FROM.x) && approx(lc0.y, L_FROM.y) && approx(lc0.zoom, L_FROM.zoom), 'lerpCentered k=0 → 起点')
check(approx(lc1.x, L_TO.x) && approx(lc1.y, L_TO.y) && approx(lc1.zoom, L_TO.zoom), 'lerpCentered k=1 → 终点')
// 3. 核心保证：zoom 变化时屏幕中心世界点轨迹严格线性（旧 lerp 偏离 ~9.3px）
//    屏幕中心世界点 = (c.x + vw/(2·zoom), c.y + vh/(2·zoom))
function centerWorld(c) {
  return { x: c.x + LC_VW / (2 * c.zoom), y: c.y + LC_VH / (2 * c.zoom) }
}
function pointLineDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay
  const L = Math.sqrt(dx * dx + dy * dy) || 1
  return Math.abs(dx * (ay - py) - (ax - px) * dy) / L
}
const LC_FROM = C.create(500, 300, 1.0)
const LC_TO = C.create(100, 200, 1.6)
const LC_W0 = centerWorld(LC_FROM)
const LC_W1 = centerWorld(LC_TO)
let lcMaxDev = 0
for (let i = 0; i <= 100; i++) {
  const c = C.lerpCentered(LC_FROM, LC_TO, i / 100, LC_VW, LC_VH)
  const w = centerWorld(c)
  lcMaxDev = Math.max(lcMaxDev, pointLineDist(w.x, w.y, LC_W0.x, LC_W0.y, LC_W1.x, LC_W1.y))
}
check(lcMaxDev < 1e-9, 'lerpCentered 屏幕中心世界点轨迹线性（最大偏差 ' + lcMaxDev.toExponential(1) + '）')
// 4. 视口尺寸非法 → 退化为 lerp（防御）
const lcBad = C.lerpCentered(LC_FROM, LC_TO, 0.5, 0, LC_VH)
const lpBad = C.lerp(LC_FROM, LC_TO, 0.5)
check(approx(lcBad.x, lpBad.x) && approx(lcBad.zoom, lpBad.zoom), 'lerpCentered 视口 0 → 退化为 lerp')

// ── lerpCentered 平滑飞行（防图标中心点被甩出屏幕 + 无分段断续）──
// 背景：同进度插值（zoom 与屏幕中心点 W 共用同一缓动）时，图标屏幕位置 = (P-W)·z
// 是 k 的二次函数——中途出现比起终点更大的极值。数值扫描复现：zoom 0.5→2 + W 平移
// -400 世界单位，起点屏内图标中心点中途出界 120px；zoom 2→0.5 对称案例出界 30px。
// 修复：zoom 变化时走 van Wijk & Nuij 平滑飞行曲线（Leaflet flyTo 同款数学）——
// 单一连续 cosh/tanh 曲线（远距放大先 zoom-out 让路，其余 zoom 单调），无分段
// （不「断断续续」）、无骤停（不「震」）；全量扫描图标中心点出界深度 0px。
// zoom 不变时完全退化为 lerp(easeInOutCubic)。注意：保证的是中心点不出界，
// 图标 84×76 盒子在中心点距边缘 <42px 时仍可能部分出界（视觉可接受的边缘裁切）。
// 防回归：以下两个复现案例动画全程图标中心点必须留在视口内。
function lcScreenPos(P, from, to, k) {
  const cam = C.lerpCentered(from, to, k, LC_VW, LC_VH)
  return { x: (P.x - cam.x) * cam.zoom, y: (P.y - cam.y) * cam.zoom }
}
function lcMaxOutOfView(P, from, to) {
  let d = 0
  for (let i = 0; i <= 200; i++) {
    const o = lcScreenPos(P, from, to, i / 200)
    d = Math.max(d, -o.x, o.x - LC_VW, -o.y, o.y - LC_VH)
  }
  return d
}
// 放大案例（0.5→2，W 移 -400,-400）：起点 (0,44) 终点 (260,16)，旧实现中途出界 120px
const LC_ZF = C.create(0, 0, 0.5)
const LC_ZT = C.create(-130, 80, 2)   // W1 = W0 + (-400,-400)
const lcBigOut = lcMaxOutOfView({ x: 0, y: 88 }, LC_ZF, LC_ZT)
check(lcBigOut <= 0.5, '放大案例图标中心点不出界（旧实现 120px，现在 ' + lcBigOut.toFixed(1) + 'px）')
// 缩小案例（2→0.5，W 移 -400,-400）：起点 (60,400) 终点 (350,540)，旧实现中途出界 30px
const LC_SF = C.create(0, 0, 2)
const LC_ST = C.create(-670, -880, 0.5)
const lcSmallOut = lcMaxOutOfView({ x: 30, y: 200 }, LC_SF, LC_ST)
check(lcSmallOut <= 0.5, '缩小案例图标中心点不出界（旧实现 30px，现在 ' + lcSmallOut.toFixed(1) + 'px）')
// 错相不破坏端点：k=1 精确落点（zoom 无论领先/滞后都必须收敛到 to）
const lcEndBig = C.lerpCentered(LC_ZF, LC_ZT, 1, LC_VW, LC_VH)
check(approx(lcEndBig.x, LC_ZT.x) && approx(lcEndBig.y, LC_ZT.y) && approx(lcEndBig.zoom, LC_ZT.zoom),
  'lerpCentered 放大飞行 k=1 → 精确落点')
const lcEndSmall = C.lerpCentered(LC_SF, LC_ST, 1, LC_VW, LC_VH)
check(approx(lcEndSmall.x, LC_ST.x) && approx(lcEndSmall.y, LC_ST.y) && approx(lcEndSmall.zoom, LC_ST.zoom),
  'lerpCentered 缩小飞行 k=1 → 精确落点')
// 飞行均匀性：单一连续曲线（van Wijk & Nuij，Leaflet flyTo 同款），无分段无骤停。
// 每帧相机位移（x/y 世界位移 + zoom 差值折算）：峰值/平均 ≤ 3.5（无急冲），
// 末帧/平均 ≤ 0.5（平滑收尾，无「震」感）。
function lcFrameSpeeds(from, to) {
  const speeds = []
  let prev = null
  for (let i = 0; i <= 200; i++) {
    const cam = C.lerpCentered(from, to, i / 200, LC_VW, LC_VH)
    if (prev) {
      speeds.push(Math.hypot(cam.x - prev.x, cam.y - prev.y) + Math.abs(cam.zoom - prev.zoom) * 100)
    }
    prev = cam
  }
  return speeds
}
function lcUniformity(from, to) {
  const s = lcFrameSpeeds(from, to)
  const avg = s.reduce(function (a, b) { return a + b }, 0) / s.length
  return { maxOverAvg: Math.max.apply(null, s) / avg, lastOverAvg: s[s.length - 1] / avg }
}
const lcU1 = lcUniformity(LC_ZF, LC_ZT)   // 放大案例
const lcU2 = lcUniformity(LC_SF, LC_ST)   // 缩小案例
check(lcU1.maxOverAvg <= 3.5, '放大飞行位移均匀（峰值/平均 ' + lcU1.maxOverAvg.toFixed(2) + ' ≤ 3.5）')
check(lcU1.lastOverAvg <= 0.5, '放大飞行收尾平滑（末帧/平均 ' + lcU1.lastOverAvg.toFixed(2) + ' ≤ 0.5，无震感）')
check(lcU2.maxOverAvg <= 3.5 && lcU2.lastOverAvg <= 0.5,
  '缩小飞行均匀且收尾平滑（峰值/平均 ' + lcU2.maxOverAvg.toFixed(2) + '，末帧/平均 ' + lcU2.lastOverAvg.toFixed(2) + '）')

// ── 放宽缩放范围后的极端飞行（0.1→10，2026-08-20）──
// 缩放范围从 [0.3, 3] 放宽到 [0.1, 10] 后，Home 飞行可能出现 100x 的 zoom 比。
// 风险：flightPath 的 cosh/tanh 在极端 zoom 比下 r0/r1 截断（sq<1e-15 → -18）、
// S 弧长参数异常、中间帧溢出/NaN。扫描验证：中心点轨迹线性、端点精确、全程有限、无急冲。
const LC_WF = C.create(0, 0, 0.1)        // 屏幕中心世界点 W0 = (1800, 3200)
const LC_WT = C.create(2282, 2868, 10)   // W1 = W0 + (500, -300)
let lcWideNaN = false
let lcWideMaxDev = 0
for (let i = 0; i <= 200; i++) {
  const c = C.lerpCentered(LC_WF, LC_WT, i / 200, LC_VW, LC_VH)
  if (!isFinite(c.x) || !isFinite(c.y) || !isFinite(c.zoom)) { lcWideNaN = true; break }
  const w = centerWorld(c)
  lcWideMaxDev = Math.max(lcWideMaxDev, pointLineDist(w.x, w.y, 1800, 3200, 2300, 2900))
}
check(!lcWideNaN, '极端飞行（0.1→10）全程有限（无 NaN/Infinity）')
check(lcWideMaxDev < 1e-6, '极端飞行中心点轨迹线性（最大偏差 ' + lcWideMaxDev.toExponential(1) + '）')
const lcWideEnd = C.lerpCentered(LC_WF, LC_WT, 1, LC_VW, LC_VH)
check(approx(lcWideEnd.x, LC_WT.x) && approx(lcWideEnd.y, LC_WT.y) && approx(lcWideEnd.zoom, LC_WT.zoom),
  '极端飞行 k=1 → 精确落点')
// 均匀性改测屏幕空间速度（真感知指标）：世界空间指标在极端 zoom 比下失真——
// 低 zoom 段 1 屏幕像素 = 10 世界单位，同一平滑屏幕轨迹读成巨大世界位移
// （实测 0.1→10 世界空间 峰值/平均 5.26 超标，但图标屏幕速度 2.07、zoom 增量 2.09 均达标）。
function lcScreenSpeeds(P, from, to) {
  const speeds = []
  let prev = null
  for (let i = 0; i <= 200; i++) {
    const o = lcScreenPos(P, from, to, i / 200)
    if (prev) speeds.push(Math.hypot(o.x - prev.x, o.y - prev.y))
    prev = o
  }
  return speeds
}
function lcScreenUniformity(P, from, to) {
  const s = lcScreenSpeeds(P, from, to)
  const avg = s.reduce(function (a, b) { return a + b }, 0) / s.length
  return { maxOverAvg: Math.max.apply(null, s) / avg, lastOverAvg: s[s.length - 1] / avg }
}
const lcWideU = lcScreenUniformity({ x: 1800, y: 3200 }, LC_WF, LC_WT)
check(lcWideU.maxOverAvg <= 3.5, '极端飞行屏幕速度均匀（峰值/平均 ' + lcWideU.maxOverAvg.toFixed(2) + ' ≤ 3.5）')
check(lcWideU.lastOverAvg <= 0.5, '极端飞行收尾平滑（末帧/平均 ' + lcWideU.lastOverAvg.toFixed(2) + ' ≤ 0.5）')
// 反向极端飞行（10→0.1，W 移 -500,+300）
const LC_WR = C.create(2282, 2868, 10)
const LC_WRT = C.create(0, 0, 0.1)
let lcRevNaN = false
let lcRevMaxDev = 0
for (let i = 0; i <= 200; i++) {
  const c = C.lerpCentered(LC_WR, LC_WRT, i / 200, LC_VW, LC_VH)
  if (!isFinite(c.x) || !isFinite(c.y) || !isFinite(c.zoom)) { lcRevNaN = true; break }
  const w = centerWorld(c)
  lcRevMaxDev = Math.max(lcRevMaxDev, pointLineDist(w.x, w.y, 2300, 2900, 1800, 3200))
}
check(!lcRevNaN, '反向极端飞行（10→0.1）全程有限（无 NaN/Infinity）')
check(lcRevMaxDev < 1e-6, '反向极端飞行中心点轨迹线性（最大偏差 ' + lcRevMaxDev.toExponential(1) + '）')
const lcRevU = lcScreenUniformity({ x: 2300, y: 2900 }, LC_WR, LC_WRT)
check(lcRevU.maxOverAvg <= 3.5 && lcRevU.lastOverAvg <= 0.5,
  '反向极端飞行屏幕速度均匀且收尾平滑（峰值/平均 ' + lcRevU.maxOverAvg.toFixed(2) + '，末帧/平均 ' + lcRevU.lastOverAvg.toFixed(2) + '）')

// ── clampToBounds（folder 容器有限画布）──// 世界 416x600，视口 400x500，zoom=1：可动范围 x∈[0,16] y∈[0,100]
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

// ── rotation=90（旋转画布）──
// 视口 360×640，画布绕视口中心顺时针旋转 90°
const RVW = 360
const RVH = 640
const rcam = C.create(0, 0, 1, 90)
// create 透传 rotation
check(rcam.rotation === 90, 'create 透传 rotation=90')
check(C.create(0, 0, 1).rotation === 0, 'create 默认 rotation=0')
check(C.create(0, 0, 1, 45).rotation === 0, 'create 非法 rotation → 0')

// transform：旋转后世界 (0,0)（未旋转时屏幕左上角）绕中心顺时针 90°
//   → 屏幕 (vh/2 + vw/2, vh/2 - vw/2) = (500, 140)（camera 在原点 zoom=1）
const rt = C.transform(rcam, RVW, RVH)
check(approx(rt.tx, 500) && approx(rt.ty, 140), 'transform rotation=90 绕中心补偿 (500,140)')
check(rt.rotation === 90, 'transform 透传 rotation')

// 旋转后世界 (0,0) → 屏幕 (500,140)：视口右上角方向（绕中心顺时针转 90° 左上角→右上）
const ws90 = C.worldToScreen(0, 0, rcam, RVW, RVH)
check(approx(ws90.x, 500) && approx(ws90.y, 140), 'worldToScreen rotation=90 世界原点 → (500,140)')

// screenToWorld / worldToScreen 互逆（rotation=90）
const rcam2 = C.create(100, 50, 2, 90)
let invOk = true
for (let i = 0; i < 50; i++) {
  const sx = 20 + Math.random() * (RVW - 40)
  const sy = 20 + Math.random() * (RVH - 40)
  const w = C.screenToWorld(sx, sy, rcam2, RVW, RVH)
  const s = C.worldToScreen(w.x, w.y, rcam2, RVW, RVH)
  if (Math.abs(s.x - sx) > 1e-6 || Math.abs(s.y - sy) > 1e-6) invOk = false
}
check(invOk, 'rotation=90 screenToWorld/worldToScreen 互逆（随机采样 50 点）')

// 视口中心不随旋转移动：屏幕中心 = 世界中心
const cw = C.screenToWorld(RVW / 2, RVH / 2, rcam2, RVW, RVH)
const cs = C.worldToScreen(cw.x, cw.y, rcam2, RVW, RVH)
check(approx(cs.x, RVW / 2) && approx(cs.y, RVH / 2), 'rotation=90 视口中心不动点')

// panBy rotation=90：屏幕右拖 dx=10 → 相机 y 增（世界 +y 指向屏幕 +x 的逆方向？验证跟手）
// 屏幕右拖 10px，手指下世界点应保持不动
const pStart = C.screenToWorld(100, 100, rcam2, RVW, RVH)
const rpan = C.panBy(rcam2, 10, 0)
const pAfter = C.screenToWorld(110, 100, rpan, RVW, RVH)
check(approx(pAfter.x, pStart.x) && approx(pAfter.y, pStart.y), 'panBy rotation=90 屏幕右拖 → 手指下世界点不动')
check(rpan.rotation === 90, 'panBy 透传 rotation')

// pinchBy rotation=90：锚点世界坐标不动
const apBefore = C.screenToWorld(150, 200, rcam2, RVW, RVH)
const rpinch = C.pinchBy(rcam2, 100, 200, 150, 200, RVW, RVH)
const apAfter = C.screenToWorld(150, 200, rpinch, RVW, RVH)
check(approx(apBefore.x, apAfter.x) && approx(apBefore.y, apAfter.y), 'pinchBy rotation=90 锚点世界坐标不动')
check(rpinch.rotation === 90, 'pinchBy 透传 rotation')

// clampToBounds 透传 rotation
const rcb = C.clampToBounds(rcam2, 1000, 1000, RVW, RVH)
check(rcb.rotation === 90, 'clampToBounds 透传 rotation')

// lerp 透传 rotation（动画期间保持旋转态）
const rl = C.lerp(rcam2, C.create(0, 0, 1), 0.5)
check(rl.rotation === 90, 'lerp 透传起点 rotation')
const rlc = C.lerpCentered(rcam2, C.create(0, 0, 1), 0.5, RVW, RVH)
check(rlc.rotation === 90, 'lerpCentered 透传起点 rotation')

// applyTo 生成旋转 transform 字符串
const fakeEl = { style: {} }
C.applyTo(rcam, fakeEl, RVW, RVH)
check(fakeEl.style.transform.indexOf('rotate(90deg)') >= 0, 'applyTo rotation=90 含 rotate(90deg)')
C.applyTo(C.create(0, 0, 1), fakeEl, RVW, RVH)
check(fakeEl.style.transform.indexOf('rotate') < 0, 'applyTo rotation=0 无 rotate')

if (failures > 0) {
  console.error('  [FAIL] desktop-camera 纯函数测试 ' + failures + ' 项失败')
  process.exit(1)
}
console.log('  [ok] desktop-camera 纯函数测试全部通过')
