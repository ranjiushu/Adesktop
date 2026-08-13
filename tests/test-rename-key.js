// 重命名 key 迁移逻辑测试：positions/bounds 以 name 为 key，重命名后必须迁移布局
// 该逻辑将放在 desktop.js 的 renameApplied 中；这里用等价纯函数验证迁移规则。
// 用法: node test-rename-key.js [项目路径]   （由 run-tests.sh 调用）
'use strict'

let failures = 0
function check(cond, msg) {
  if (cond) {
    console.log('  [ok] ' + msg)
  } else {
    console.error('  [fail] ' + msg)
    failures++
  }
}

// 与 desktop.js renameApplied 等价的纯函数：迁移 positions/bounds 中 oldName → newName
function migrateKey(map, oldName, newName) {
  if (!map || !map[oldName] || oldName === newName) return false
  map[newName] = map[oldName]
  delete map[oldName]
  return true
}

// ── 基本迁移 ──
const positions = { 'a.txt': { x: 116, y: 108 }, 'b.txt': { x: 216, y: 108 } }
check(migrateKey(positions, 'a.txt', 'a2.txt') === true, '迁移返回 true')
check(positions['a2.txt'].x === 116 && positions['a2.txt'].y === 108, '新 key 保留原坐标')
check(!('a.txt' in positions), '旧 key 被删除')
check(positions['b.txt'].x === 216, '无关条目不受影响')

// ── 同名单迁移无副作用 ──
const p2 = { 'x.txt': { x: 1, y: 2 } }
check(migrateKey(p2, 'x.txt', 'x.txt') === false, 'oldName === newName 拒绝')
check(p2['x.txt'].x === 1, '同名单迁移不破坏')

// ── 目标 key 已存在 → 覆盖（重命名前已查重，防御性行为） ──
const p3 = { 'a.txt': { x: 1, y: 2 }, 'b.txt': { x: 3, y: 4 } }
migrateKey(p3, 'a.txt', 'b.txt')
check(p3['b.txt'].x === 1 && !('a.txt' in p3), '目标 key 已存在时覆盖（查重后的兜底）')

// ── 空 map / 不存在 key ──
check(migrateKey(null, 'a', 'b') === false, 'null map 拒绝')
check(migrateKey({}, 'a', 'b') === false, '空 map 拒绝')
check(migrateKey({ 'c': { x: 1, y: 2 } }, 'a', 'b') === false, '不存在的 key 拒绝')

if (failures > 0) {
  console.error('  [FAIL] rename-key 测试 ' + failures + ' 项失败')
  process.exit(1)
}
console.log('  [ok] rename-key 测试全部通过')
