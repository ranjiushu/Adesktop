// home-store.js 单元测试：Home 位置快照存储（快照/默认视角读写、互不覆盖、脏数据回退）
// 用法: node test-home-store.js [项目路径]   （由 run-tests.sh 调用）
'use strict'

const fs = require('fs')
const path = require('path')
const vm = require('vm')

const PROJECT = process.argv[2] || path.join(__dirname, '..')
const SRC = path.join(PROJECT, 'src', 'js', 'home-store.js')

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
function makeSandbox(ls) {
  const sandbox = {
    App: {},
    console: console,
    localStorage: ls || {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null },
      setItem: function (k, v) { store[k] = String(v) },
      removeItem: function (k) { delete store[k] }
    }
  }
  vm.createContext(sandbox)
  vm.runInContext(fs.readFileSync(SRC, 'utf8'), sandbox, { filename: 'home-store.js' })
  return sandbox.App.HomeStore
}

const H = makeSandbox()
const CAM = { x: 123.5, y: -45, zoom: 1.7 }

// ── 空 store → load null ──
check(H.load() === null, '空 store load → null')

// ── saveHome / saveFallback 往返 ──
check(H.saveHome(CAM) === true, 'saveHome 成功 → true')
let d = H.load()
check(d && d.home && d.home.x === 123.5 && d.home.y === -45 && d.home.zoom === 1.7, 'saveHome → load 往返还原 home')
check(d && !d.fallback, '仅存 home 时无 fallback 字段')

// ── home 与 fallback 互不覆盖 ──
check(H.saveFallback({ x: 10, y: 20, zoom: 0.6 }) === true, 'saveFallback 成功 → true')
d = H.load()
check(d && d.home && d.fallback, 'saveFallback 后 home/fallback 并存')
check(d.home.x === 123.5 && d.fallback.x === 10, '并存时两值各自保留')

// ── 再次 saveHome 只更新 home ──
check(H.saveHome({ x: 999, y: 1, zoom: 2 }) === true, '二次 saveHome 成功')
d = H.load()
check(d.home.x === 999 && d.fallback.x === 10, '二次 saveHome 不覆盖 fallback')

// ── 非法相机 → save 返回 false（调用方告警）──
check(H.saveHome({ x: 'nan', y: 1, zoom: 1 }) === false, 'x 非数字 → saveHome false')
check(H.saveHome({ x: 1, y: 1, zoom: Infinity }) === false, 'zoom 无穷 → saveHome false')
check(H.saveHome(null) === false, 'null 相机 → saveHome false')
d = H.load()
check(d && d.home && d.home.x === 999, '非法 save 不破坏已存 home')

// ── 脏数据回退 ──
store[H.KEY] = 'not-json{{{'
check(H.load() === null, '脏 JSON load → null')
store[H.KEY] = JSON.stringify({ version: 1, home: { x: 1, y: 2, zoom: 'big' }, fallback: { x: 5, y: 6, zoom: 0.8 } })
d = H.load()
check(d && !d.home && d.fallback && d.fallback.zoom === 0.8, 'home 非法被丢弃，fallback 保留')
store[H.KEY] = JSON.stringify({ version: 1, home: { x: 1, y: 2, zoom: 3 } })
d = H.load()
check(d && d.home && d.home.zoom === 3, 'zoom 超范围也接受（应用时由 DesktopCamera 钳制）')

// ── 写入失败 → false ──
const throwingLs = {
  getItem: function () { return null },
  setItem: function () { throw new Error('quota') }
}
const H2 = makeSandbox(throwingLs)
check(H2.saveHome(CAM) === false, 'setItem 抛异常 → saveHome false（写入路径不吞错）')

// ── 出厂默认视角 ──
check(H.DEFAULT_CAMERA.x === 0 && H.DEFAULT_CAMERA.y === 0 && H.DEFAULT_CAMERA.zoom === 1, 'DEFAULT_CAMERA = (0,0,1)')

// ── [P1] root 隔离：不同 rootId 各存各的快照，互不继承 ──
store = {}
check(H.saveHome(CAM, 'rootA') === true, 'saveHome(rootA) 成功')
check(H.saveFallback({ x: 1, y: 2, zoom: 3 }, 'rootB') === true, 'saveFallback(rootB) 成功')
check(H.load('rootA').home.x === 123.5, 'rootA 快照独立')
check(H.load('rootB').fallback && !H.load('rootB').home, 'rootB 独立（无 rootA 的 home）')
check(!store['desktop.home.v1'], 'rootId key 模式下不写旧 key')

// ── [P1] 一次性迁移：旧 key 数据 → 当前 root key，随后删除旧 key ──
store = {}
store['desktop.home.v1'] = JSON.stringify({ version: 1, home: CAM })
check(H.migrateLegacy('rootA') === true, 'migrateLegacy 有旧数据 → true')
check(H.load('rootA').home.x === 123.5, '旧数据被首见 root 吸收')
check(!store['desktop.home.v1'], '迁移后删除旧 key（不再共享）')
check(H.migrateLegacy('rootA') === false, 'migrateLegacy 无旧数据 → false（幂等）')

if (failures > 0) {
  console.error('  [FAIL] home-store 测试 ' + failures + ' 项失败')
  process.exit(1)
}
console.log('  [ok] home-store 测试全部通过')
