// snapshot-store.js 单元测试：快照列表 CRUD、Home 位置、插入位置配置、横竖屏隔离、与 HomeStore 兼容
// 用法: node test-snapshot-store.js [项目路径]   （由 run-tests.sh 调用）
'use strict'

const fs = require('fs')
const path = require('path')
const vm = require('vm')

const PROJECT = process.argv[2] || path.join(__dirname, '..')
const NS_SRC = path.join(PROJECT, 'src', 'js', 'namespace.js')
const HOME_SRC = path.join(PROJECT, 'src', 'js', 'home-store.js')
const SNAP_SRC = path.join(PROJECT, 'src', 'js', 'snapshot-store.js')

let failures = 0
function check(cond, msg) {
  if (cond) {
    console.log('  [ok] ' + msg)
  } else {
    console.error('  [fail] ' + msg)
    failures++
  }
}

// localStorage stub
let store = {}
const ls = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null },
  setItem: function (k, v) { store[k] = String(v) },
  removeItem: function (k) { delete store[k] }
}

// 沙盒：SnapshotStore 依赖 HomeStore（兼容迁移）和 DesktopCore（取 curPath/rotation）
const sandbox = {
  App: {},
  console: console,
  localStorage: ls,
  window: { App: {} }
}
vm.createContext(sandbox)
vm.runInContext(fs.readFileSync(NS_SRC, 'utf8'), sandbox, { filename: 'namespace.js' })
const fakeCore = { state: { curPath: '' }, camera: { x: 0, y: 0, zoom: 1, rotation: 0 } }
sandbox.App.DesktopCore = fakeCore
vm.runInContext(fs.readFileSync(HOME_SRC, 'utf8'), sandbox, { filename: 'home-store.js' })
vm.runInContext(fs.readFileSync(SNAP_SRC, 'utf8'), sandbox, { filename: 'snapshot-store.js' })
const S = sandbox.App.SnapshotStore

// ── 空 store → 空快照列表 ──
store = {}
let d = S.load('rootA')
check(d && d.version === 2 && Array.isArray(d.snapshots) && d.snapshots.length === 0, '空 store load → version 2 + 空数组')

// ── 创建快照默认插入到顶部（top）──
store = {}
const cam1 = { x: 10, y: 20, zoom: 1.2, rotation: 0 }
const s1 = S.create(cam1, 'rootA')
check(!!s1 && typeof s1.id === 'string' && typeof s1.name === 'string' && s1.createdAt > 0, 'create 返回合法快照')
d = S.load('rootA')
check(d.snapshots.length === 1 && d.snapshots[0].id === s1.id, '新快照插入顶部（默认）')
check(Math.abs(d.snapshots[0].camera.x - 10) < 0.001, '相机数据保存正确')

// ── 创建第二个快照：新的在顶部，旧的被挤到第二位 ──
const cam2 = { x: 30, y: 40, zoom: 0.8, rotation: 90 }
const s2 = S.create(cam2, 'rootA')
d = S.load('rootA')
check(d.snapshots.length === 2 && d.snapshots[0].id === s2.id && d.snapshots[1].id === s1.id, '第二个快照仍插入顶部')

// ── 切换插入位置为 bottom ──
store = {}
check(S.getInsertPosition() === 'top', '默认插入位置 top')
check(S.setInsertPosition('bottom') === true, '设置 bottom 成功')
check(S.getInsertPosition() === 'bottom', '读取插入位置 bottom')
const s3 = S.create(cam1, 'rootA')
const s4 = S.create(cam2, 'rootA')
d = S.load('rootA')
check(d.snapshots.length === 2 && d.snapshots[0].id === s3.id && d.snapshots[1].id === s4.id, 'bottom 模式下新快照追加到末尾')

// ── homeIndex 与 getHome ──
S.setInsertPosition('top')
store = {}
S.create(cam1, 'rootA')
S.create(cam2, 'rootA')
d = S.load('rootA')
check(S.homeIndex(d.snapshots, 'top') === 0, 'top 模式下 Home 索引 = 0')
check(S.homeIndex(d.snapshots, 'bottom') === d.snapshots.length - 1, 'bottom 模式下 Home 索引 = 末尾')
check(S.getHome(d, 'top').id === d.snapshots[0].id, 'top 模式下 getHome 返回第一项')

// ── reorder ──
store = {}
S.create(cam1, 'rootA') // idx 0
S.create(cam2, 'rootA') // idx 0，原 cam1 到 idx 1
S.create({ x: 50, y: 60, zoom: 1, rotation: 0 }, 'rootA') // idx 0
d = S.load('rootA')
const id0 = d.snapshots[0].id
const id1 = d.snapshots[1].id
const id2 = d.snapshots[2].id
d = S.reorder(d, 0, 2) // 把第一项移到最后
check(d.snapshots[0].id === id1 && d.snapshots[1].id === id2 && d.snapshots[2].id === id0, 'reorder 0->2 正确')
d = S.reorder(d, 2, 0) // 移回
check(d.snapshots[0].id === id0 && d.snapshots[1].id === id1 && d.snapshots[2].id === id2, 'reorder 2->0 正确')
d = S.reorder(d, 1, 1)
check(d.snapshots[0].id === id0 && d.snapshots[1].id === id1 && d.snapshots[2].id === id2, '相同索引 reorder 不变')

// ── delete ──
store = {}
const a = S.create(cam1, 'rootA')
const b = S.create(cam2, 'rootA')
d = S.load('rootA')
check(d.snapshots.length === 2, '删除前 2 条')
d = S.delete(d, a.id)
check(d.snapshots.length === 1 && d.snapshots[0].id === b.id, '删除 id a 后只剩 b')
d = S.delete(d, 'nonexistent')
check(d.snapshots.length === 1, '删除不存在的 id 无影响')

// ── save 过滤非法快照 ──
store = {}
S.save({ version: 2, snapshots: [
  { id: 'good', name: 'ok', camera: { x: 0, y: 0, zoom: 1, rotation: 0 }, createdAt: 1 },
  { id: 'bad1', name: '', camera: { x: 'x', y: 0, zoom: 1 }, createdAt: 2 },
  { id: 'bad2', name: 'no camera', createdAt: 3 }
] }, 'rootA')
d = S.load('rootA')
check(d.snapshots.length === 1 && d.snapshots[0].id === 'good', 'save 自动过滤非法快照')

// ── 非法相机 create 返回 null ──
const bad = S.create({ x: NaN, y: 0, zoom: 1 }, 'rootA')
check(bad === null, 'NaN 相机 create 返回 null')

// ── 与旧版 HomeStore 兼容迁移 ──
store = {}
const H = sandbox.App.HomeStore
H.saveHome({ x: 100, y: 200, zoom: 1.5 }, 'legacyRoot')
// SnapshotStore.load 看到当前方向 snapshots 为空，应自动迁移
d = S.load('legacyRoot')
check(d.snapshots.length === 1 && d.snapshots[0].name === 'Home 快照', '无快照时从 HomeStore 迁移生成 Home 快照')
check(Math.abs(d.snapshots[0].camera.x - 100) < 0.001, '迁移快照相机正确')
// 再次 load 不应重复迁移（已有快照）
H.saveHome({ x: 999, y: 999, zoom: 1 }, 'legacyRoot')
d = S.load('legacyRoot')
check(d.snapshots.length === 1 && d.snapshots[0].camera.x === 100, '已有快照后不再重复迁移')

// ── 横竖屏槽位独立 ──
store = {}
fakeCore.camera.rotation = 0
S.create(cam1, 'rootA') // portrait
fakeCore.camera.rotation = 90
S.create(cam2, 'rootA') // landscape
const portraitData = S.load('rootA')
fakeCore.camera.rotation = 0
d = S.load('rootA')
check(d.snapshots.length === 1 && d.snapshots[0].camera.x === cam1.x, '竖屏槽位独立（1 条竖屏快照）')
fakeCore.camera.rotation = 90
d = S.load('rootA')
check(d.snapshots.length === 1 && d.snapshots[0].camera.x === cam2.x, '横屏槽位独立（1 条横屏快照）')
// 切换方向不覆盖
fakeCore.camera.rotation = 0
S.create({ x: 55, y: 66, zoom: 1, rotation: 0 }, 'rootA')
fakeCore.camera.rotation = 90
d = S.load('rootA')
check(d.snapshots.length === 1 && d.snapshots[0].camera.x === cam2.x, '更新竖屏快照后横屏槽位仍独立')

// ── hasAny ──
store = {}
fakeCore.camera.rotation = 0
check(S.hasAny('emptyRoot') === false, '无快照 root hasAny = false')
S.create(cam1, 'hasRoot')
check(S.hasAny('hasRoot') === true, '有竖屏快照 root hasAny = true')
store = {}
fakeCore.camera.rotation = 90
S.create(cam2, 'hasRootLand')
check(S.hasAny('hasRootLand') === true, '仅有横屏快照 root hasAny = true')

// ── rootId 隔离 ──
store = {}
fakeCore.camera.rotation = 0
S.create(cam1, 'rootA')
S.create(cam2, 'rootB')
check(S.load('rootA').snapshots.length === 1, 'rootA 一条快照')
check(S.load('rootB').snapshots.length === 1, 'rootB 一条快照')
check(S.load('rootA').snapshots[0].camera.x === cam1.x, 'rootA 数据独立')
check(S.load('rootB').snapshots[0].camera.x === cam2.x, 'rootB 数据独立')

// ── setInsertPosition 非法值 ──
check(S.setInsertPosition('middle') === false, '非法位置 middle 返回 false')
check(S.getInsertPosition() === 'top' || S.getInsertPosition() === 'bottom', '插入位置保持合法')

// ── at / 越界 ──
store = {}
S.create(cam1, 'rootA')
check(S.at(S.load('rootA'), 0).camera.x === cam1.x, 'at(0) 正确')
check(S.at(S.load('rootA'), 99) === null, 'at 越界返回 null')

// ── version 1 扁平结构兼容迁移 ──
store = {}
store['desktop.snapshots.v1Root.v2'] = JSON.stringify({
  version: 1,
  snapshots: [
    { id: 'p1', name: 'p', camera: { x: 1, y: 2, zoom: 1, rotation: 0 }, createdAt: 1 },
    { id: 'l1', name: 'l', camera: { x: 3, y: 4, zoom: 1, rotation: 90 }, createdAt: 2 }
  ]
})
fakeCore.camera.rotation = 0
d = S.load('v1Root')
check(d.snapshots.length === 1 && d.snapshots[0].id === 'p1', 'version 1 扁平数据按 rotation 分流到竖屏槽位')
fakeCore.camera.rotation = 90
d = S.load('v1Root')
check(d.snapshots.length === 1 && d.snapshots[0].id === 'l1', 'version 1 扁平数据按 rotation 分流到横屏槽位')

if (failures > 0) {
  console.error('  [FAIL] snapshot-store 测试 ' + failures + ' 项失败')
  process.exit(1)
}
console.log('  [ok] snapshot-store 测试全部通过')
