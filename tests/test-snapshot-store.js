// snapshot-store.js 单元测试：分组 CRUD、快照 CRUD、Home 位置、插入位置配置、
// 横竖屏隔离、与 HomeStore 兼容、v2/v1 迁移
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

const cam1 = { x: 10, y: 20, zoom: 1.2, rotation: 0 }
const cam2 = { x: 30, y: 40, zoom: 0.8, rotation: 90 }

function firstGroup(data) { return data.groups[0] }

// ── 空 store → 默认分组 + 空快照 ──
store = {}
let d = S.load('rootA')
check(d && d.version === 3 && Array.isArray(d.groups) && d.groups.length === 1, '空 store load → version 3 + 1 个默认分组')
check(firstGroup(d).snapshots.length === 0, '默认分组快照为空')
check(typeof firstGroup(d).name === 'string' && firstGroup(d).name.length > 0, '默认分组有名称')

// ── 创建快照默认插入到 Home 分组顶部（top）──
store = {}
const s1 = S.create(cam1, 'rootA')
check(!!s1 && typeof s1.id === 'string' && typeof s1.name === 'string' && s1.createdAt > 0, 'create 返回合法快照')
d = S.load('rootA')
check(firstGroup(d).snapshots.length === 1 && firstGroup(d).snapshots[0].id === s1.id, '新快照插入 Home 分组顶部（默认）')
check(Math.abs(firstGroup(d).snapshots[0].camera.x - 10) < 0.001, '相机数据保存正确')

// ── 创建第二个快照：新的在顶部，旧的被挤到第二位 ──
const s2 = S.create(cam2, 'rootA')
d = S.load('rootA')
check(firstGroup(d).snapshots.length === 2 && firstGroup(d).snapshots[0].id === s2.id && firstGroup(d).snapshots[1].id === s1.id, '第二个快照仍插入顶部')

// ── 切换插入位置为 bottom ──
store = {}
check(S.getInsertPosition() === 'top', '默认插入位置 top')
check(S.setInsertPosition('bottom') === true, '设置 bottom 成功')
check(S.getInsertPosition() === 'bottom', '读取插入位置 bottom')
S.create(cam1, 'rootA')
S.create(cam2, 'rootA')
d = S.load('rootA')
check(firstGroup(d).snapshots.length === 2 && firstGroup(d).snapshots[0].camera.x === cam1.x && firstGroup(d).snapshots[1].camera.x === cam2.x, 'bottom 模式下新快照追加到末尾')
S.setInsertPosition('top')

// ── homeGroupIndex / getHomeGroup / homeSnapshotIndex / getHome ──
store = {}
S.create(cam1, 'rootA')
S.create(cam2, 'rootA')
d = S.load('rootA')
check(S.homeGroupIndex(d.groups, 'top') === 0, 'top 模式下 Home 分组索引 = 0')
check(S.homeGroupIndex(d.groups, 'bottom') === d.groups.length - 1, 'bottom 模式下 Home 分组索引 = 末尾')
const homeGroup = S.getHomeGroup(d, 'top')
check(homeGroup && homeGroup.id === d.groups[0].id, 'top 模式下 getHomeGroup 返回第一组')
check(S.homeSnapshotIndex(homeGroup.snapshots, 'top') === 0, 'top 模式下 Home 快照索引 = 0')
check(S.getHome(homeGroup, 'top').id === homeGroup.snapshots[0].id, 'top 模式下 getHome 返回第一项')

// ── reorder（分组内）──
store = {}
S.create(cam1, 'rootA') // idx 0
S.create(cam2, 'rootA') // idx 0，原 cam1 到 idx 1
S.create({ x: 50, y: 60, zoom: 1, rotation: 0 }, 'rootA') // idx 0
d = S.load('rootA')
const gid = firstGroup(d).id
const id0 = firstGroup(d).snapshots[0].id
const id1 = firstGroup(d).snapshots[1].id
const id2 = firstGroup(d).snapshots[2].id
d = S.reorder(d, gid, 0, 2) // 把第一项移到最后
check(firstGroup(d).snapshots[0].id === id1 && firstGroup(d).snapshots[1].id === id2 && firstGroup(d).snapshots[2].id === id0, 'reorder 0->2 正确')
d = S.reorder(d, gid, 2, 0) // 移回
check(firstGroup(d).snapshots[0].id === id0 && firstGroup(d).snapshots[1].id === id1 && firstGroup(d).snapshots[2].id === id2, 'reorder 2->0 正确')
d = S.reorder(d, gid, 1, 1)
check(firstGroup(d).snapshots[0].id === id0 && firstGroup(d).snapshots[1].id === id1 && firstGroup(d).snapshots[2].id === id2, '相同索引 reorder 不变')
// 跨分组 reorder 不污染其它分组
const g2 = S.createGroup('rootA', '第二组').group
d = S.load('rootA')
check(d.groups.length === 2, '创建分组后 groups=2')
d = S.reorder(d, g2.id, 0, 0)
check(d.groups[0].id === gid && d.groups[1].id === g2.id, 'reorder 其他组不影响本组')

// ── delete（分组内）──
store = {}
const a = S.create(cam1, 'rootA')
const b = S.create(cam2, 'rootA')
d = S.load('rootA')
check(firstGroup(d).snapshots.length === 2, '删除前 2 条')
d = S.delete(d, firstGroup(d).id, a.id)
check(firstGroup(d).snapshots.length === 1 && firstGroup(d).snapshots[0].id === b.id, '删除 id a 后只剩 b')
d = S.delete(d, firstGroup(d).id, 'nonexistent')
check(firstGroup(d).snapshots.length === 1, '删除不存在的 id 无影响')

// ── save 过滤非法快照 ──
store = {}
S.save({ version: 3, groups: [{
  id: 'g1', name: '默认分组', snapshots: [
    { id: 'good', name: 'ok', camera: { x: 0, y: 0, zoom: 1, rotation: 0 }, createdAt: 1 },
    { id: 'bad1', name: '', camera: { x: 'x', y: 0, zoom: 1 }, createdAt: 2 },
    { id: 'bad2', name: 'no camera', createdAt: 3 }
  ]
}] }, 'rootA')
d = S.load('rootA')
check(firstGroup(d).snapshots.length === 1 && firstGroup(d).snapshots[0].id === 'good', 'save 自动过滤非法快照')

// ── 非法相机 create 返回 null ──
store = {}
const bad = S.create({ x: NaN, y: 0, zoom: 1 }, 'rootA')
check(bad === null, 'NaN 相机 create 返回 null')

// ── 与旧版 HomeStore 兼容迁移 ──
store = {}
const H = sandbox.App.HomeStore
H.saveHome({ x: 100, y: 200, zoom: 1.5 }, 'legacyRoot')
// SnapshotStore.load 看到当前方向分组快照为空，应自动迁移
d = S.load('legacyRoot')
check(firstGroup(d).snapshots.length === 1 && firstGroup(d).snapshots[0].name === 'Home 快照', '无快照时从 HomeStore 迁移生成 Home 快照')
check(Math.abs(firstGroup(d).snapshots[0].camera.x - 100) < 0.001, '迁移快照相机正确')
// 再次 load 不应重复迁移（已有快照）
H.saveHome({ x: 999, y: 999, zoom: 1 }, 'legacyRoot')
d = S.load('legacyRoot')
check(firstGroup(d).snapshots.length === 1 && firstGroup(d).snapshots[0].camera.x === 100, '已有快照后不再重复迁移')

// ── 横竖屏槽位独立（分组各自保存）──
store = {}
fakeCore.camera.rotation = 0
S.create(cam1, 'rootA') // portrait
fakeCore.camera.rotation = 90
S.create(cam2, 'rootA') // landscape
fakeCore.camera.rotation = 0
d = S.load('rootA')
check(firstGroup(d).snapshots.length === 1 && firstGroup(d).snapshots[0].camera.x === cam1.x, '竖屏槽位独立（1 条竖屏快照）')
fakeCore.camera.rotation = 90
d = S.load('rootA')
check(firstGroup(d).snapshots.length === 1 && firstGroup(d).snapshots[0].camera.x === cam2.x, '横屏槽位独立（1 条横屏快照）')
// 切换方向不覆盖
fakeCore.camera.rotation = 0
S.create({ x: 55, y: 66, zoom: 1, rotation: 0 }, 'rootA')
fakeCore.camera.rotation = 90
d = S.load('rootA')
check(firstGroup(d).snapshots.length === 1 && firstGroup(d).snapshots[0].camera.x === cam2.x, '更新竖屏快照后横屏槽位仍独立')

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
check(S.load('rootA').groups[0].snapshots.length === 1, 'rootA 一条快照')
check(S.load('rootB').groups[0].snapshots.length === 1, 'rootB 一条快照')
check(S.load('rootA').groups[0].snapshots[0].camera.x === cam1.x, 'rootA 数据独立')
check(S.load('rootB').groups[0].snapshots[0].camera.x === cam2.x, 'rootB 数据独立')

// ── setInsertPosition 非法值 ──
check(S.setInsertPosition('middle') === false, '非法位置 middle 返回 false')
check(S.getInsertPosition() === 'top' || S.getInsertPosition() === 'bottom', '插入位置保持合法')

// ── at / 越界（扁平索引）──
store = {}
fakeCore.camera.rotation = 0
S.create(cam1, 'rootA')
d = S.load('rootA')
check(S.at(d, 0).camera.x === cam1.x, 'at(0) 正确')
check(S.at(d, 99) === null, 'at 越界返回 null')

// ── findIndex ──
store = {}
fakeCore.camera.rotation = 0
const f1 = S.create(cam1, 'rootA')
const f2 = S.create(cam2, 'rootA')
d = S.load('rootA')
const fi = S.findIndex(d, f1.id)
check(fi && fi.groupIdx === 0 && fi.snapshotIdx === 1, 'findIndex 命中（f1 在第二位）')
check(S.findIndex(d, 'nope') === null, 'findIndex 未命中返回 null')
check(f1.id !== f2.id, '快照 id 不重复')

// ── move（批量移动到其它分组）──
store = {}
fakeCore.camera.rotation = 0
S.create(cam1, 'rootA') // 默认分组 s1
S.create(cam2, 'rootA') // 默认分组 s2（顶部）
const mg = S.createGroup('rootA', '目标组').group
d = S.load('rootA')
const mvIds = d.groups[0].snapshots.map(function (s) { return s.id })
d = S.move(d, d.groups[0].id, mg.id, mvIds)
check(d.groups[0].snapshots.length === 0, 'move 后源分组清空')
check(d.groups[1].id === mg.id && d.groups[1].snapshots.length === 2, 'move 后目标分组 2 条')
check(S.move(d, d.groups[0].id, mg.id, []) === d, '空 id 列表 move 返回原数据')
check(S.move(d, d.groups[0].id, d.groups[0].id, ['x']) === d, '同组 move 返回原数据')
d = S.move(d, d.groups[0].id, mg.id, ['nope'])
check(d.groups[1].snapshots.length === 2, '不存在的 id 无影响')

// ── setHome（顶栏「设为 Home」：更新 Home 位快照或创建）──
store = {}
fakeCore.camera.rotation = 0
S.create(cam1, 'rootA') // Home 位 = 默认分组第一项（s1）
const sh = S.setHome({ x: 777, y: 888, zoom: 2.5, rotation: 0 }, 'rootA')
d = S.load('rootA')
check(sh && sh.camera.x === 777 && sh.camera.zoom === 2.5, 'setHome 更新已有 Home 位快照相机')
check(firstGroup(d).snapshots.length === 1, 'setHome 更新不新增快照')
// 无快照时 setHome 创建
store = {}
fakeCore.camera.rotation = 0
const sh2 = S.setHome({ x: 1, y: 2, zoom: 1, rotation: 0 }, 'emptyRoot')
d = S.load('emptyRoot')
check(sh2 && firstGroup(d).snapshots.length === 1 && firstGroup(d).snapshots[0].id === sh2.id, '无快照时 setHome 创建 Home 位快照')

// ── flatSnapshots ──
store = {}
fakeCore.camera.rotation = 0
S.create(cam1, 'rootA')
S.create(cam2, 'rootA')
const flat = S.flatSnapshots('rootA')
check(flat.length === 2, 'flatSnapshots 返回全部快照')

// ── createGroup / renameGroup / deleteGroup ──
store = {}
fakeCore.camera.rotation = 0
S.create(cam1, 'rootA')
const cg = S.createGroup('rootA', '工作')
check(cg && cg.group && cg.group.name === '工作', 'createGroup 成功')
d = S.load('rootA')
check(d.groups.length === 2 && d.groups[1].name === '工作', '新分组出现在分组列表')
// 在指定分组创建快照
S.create(cam2, 'rootA', cg.group.id)
d = S.load('rootA')
check(d.groups[0].snapshots.length === 1 && d.groups[1].snapshots.length === 1, '指定分组创建快照成功')
// rename
check(S.renameGroup('rootA', cg.group.id, '工作区') === true, 'renameGroup 成功')
d = S.load('rootA')
check(d.groups[1].name === '工作区', '分组重命名生效')
// deleteGroup 删除组内快照
check(S.deleteGroup('rootA', cg.group.id) === true, 'deleteGroup 成功')
d = S.load('rootA')
check(d.groups.length === 1 && d.groups[0].snapshots.length === 1, '删除分组后只剩默认分组及其快照')
// 删除最后一个分组 → 自动重建默认分组
check(S.deleteGroup('rootA', d.groups[0].id) === true, '删除最后一个分组成功')
d = S.load('rootA')
check(d.groups.length === 1 && d.groups[0].snapshots.length === 0, '删除最后一个分组后自动重建默认分组')

// ── version 2 双槽位结构兼容迁移 ──
store = {}
store['desktop.snapshots.v2Root.v3'] = JSON.stringify({
  version: 2,
  portrait: { snapshots: [{ id: 'p1', name: 'p', camera: { x: 1, y: 2, zoom: 1, rotation: 0 }, createdAt: 1 }] },
  landscape: { snapshots: [{ id: 'l1', name: 'l', camera: { x: 3, y: 4, zoom: 1, rotation: 90 }, createdAt: 2 }] }
})
fakeCore.camera.rotation = 0
d = S.load('v2Root')
check(firstGroup(d).snapshots.length === 1 && firstGroup(d).snapshots[0].id === 'p1', 'version 2 数据迁入默认分组（竖屏）')
fakeCore.camera.rotation = 90
d = S.load('v2Root')
check(firstGroup(d).snapshots.length === 1 && firstGroup(d).snapshots[0].id === 'l1', 'version 2 数据迁入默认分组（横屏）')

// ── version 1 扁平结构兼容迁移 ──
store = {}
store['desktop.snapshots.v1Root.v3'] = JSON.stringify({
  version: 1,
  snapshots: [
    { id: 'p1', name: 'p', camera: { x: 1, y: 2, zoom: 1, rotation: 0 }, createdAt: 1 },
    { id: 'l1', name: 'l', camera: { x: 3, y: 4, zoom: 1, rotation: 90 }, createdAt: 2 }
  ]
})
fakeCore.camera.rotation = 0
d = S.load('v1Root')
check(firstGroup(d).snapshots.length === 1 && firstGroup(d).snapshots[0].id === 'p1', 'version 1 扁平数据按 rotation 分流（竖屏）')
fakeCore.camera.rotation = 90
d = S.load('v1Root')
check(firstGroup(d).snapshots.length === 1 && firstGroup(d).snapshots[0].id === 'l1', 'version 1 扁平数据按 rotation 分流（横屏）')

if (failures > 0) {
  console.error('  [FAIL] snapshot-store 测试 ' + failures + ' 项失败')
  process.exit(1)
}
console.log('  [ok] snapshot-store 测试全部通过')
