/* 布局存储模块：localStorage 维护图标位置 + 相机视角（文件即真相的临时方案）。
 * 结构：{ version: 1, icons: { fullPath: {x,y} }, camera: {x,y,zoom} }
 * key 带 rootId（desktop.layout.<rootId>.v1）：布局是「相对当前根目录的 fullPath」，
 * 切根 A→B 不得继承 A 的布局（见 docs/operation-contract.md 1.6）。
 * rootId 为空（启动初期/兼容读取）→ 旧版单根 key desktop.layout.v1（一次性迁移后删除）。
 * 条目以完整相对路径为 key：文件删/改名 → 布局条目自然失效，回退自动排布，不报错。
 * 依赖: namespace.js
 * 导出: App.LayoutStore
 */
'use strict'

App.LayoutStore = (function () {
  const LEGACY_KEY = 'desktop.layout.v1'   // 旧版单根 key（迁移兼容）
  const KEY_PREFIX = 'desktop.layout.'

  // 动态 key：desktop.layout.<rootId>.v1；rootId 为空 → 旧 key（兼容读取）
  function keyFor(rootId) {
    return rootId ? KEY_PREFIX + rootId + '.v1' : LEGACY_KEY
  }

  // 读布局：失败/无数据 → null（调用方回退自动排布）
  function load(rootId) {
    try {
      const raw = localStorage.getItem(keyFor(rootId))
      if (!raw) return null
      const data = JSON.parse(raw)
      return (data && typeof data === 'object') ? data : null
    } catch (e) {
      return null
    }
  }

  // 写布局：成功 true，失败 false（调用方告警）
  function save(data, rootId) {
    try {
      localStorage.setItem(keyFor(rootId), JSON.stringify(data))
      return true
    } catch (e) {
      return false
    }
  }

  // 一次性迁移：旧版单根 key → 当前 root key（首见 root 吸收旧数据，随后删除旧 key）。
  // 此后各 root 布局独立，不再共享。无旧数据/无 rootId → false（幂等，可重复调用）。
  function migrateLegacy(rootId) {
    if (!rootId) return false
    try {
      const raw = localStorage.getItem(LEGACY_KEY)
      if (raw == null) return false
      if (localStorage.getItem(keyFor(rootId)) == null) {
        localStorage.setItem(keyFor(rootId), raw)
      }
      localStorage.removeItem(LEGACY_KEY)
      return true
    } catch (e) {
      return false
    }
  }

  return {
    load: load,
    save: save,
    migrateLegacy: migrateLegacy,
    keyFor: keyFor,
    KEY: LEGACY_KEY
  }
})()
