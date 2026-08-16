/* Home 位置快照存储模块：底栏 Home 的空间锚点语义。
 * 结构：{ version: 1, home: {x,y,zoom}, fallback: {x,y,zoom} }
 *   home     — 长按底栏 Home 记录的「当前视角快照」（点按 Home 优先恢复它）
 *   fallback — 用户经 Drawer「设为默认视角」设置的「默认摄像机视角」
 *              （无 home 快照时，点按 Home 恢复它；两者都无则回出厂 (0,0,1)）
 * 仅桌面空间（根目录）有意义的相机值；子文件夹容器相机是滚动态，不写入。
 * zoom 范围校验不在此重复常量（desktop-camera.js 是唯一权威），应用时经
 * DesktopCamera.create() 钳制即可，这里只做结构化校验（防脏数据）。
 * 依赖: namespace.js
 * 导出: App.HomeStore
 */
'use strict'

App.HomeStore = (function () {
  const LEGACY_KEY = 'desktop.home.v1'   // 旧版单根 key（迁移兼容）
  const KEY_PREFIX = 'desktop.home.'
  const DEFAULT_CAMERA = { x: 0, y: 0, zoom: 1 }

  // 动态 key：desktop.home.<rootId>.v1；rootId 为空 → 旧 key（兼容读取）
  // Home 快照是「相对当前根目录」的空间锚点，切根不得继承（见 docs/operation-contract.md 1.6）
  function keyFor(rootId) {
    return rootId ? KEY_PREFIX + rootId + '.v1' : LEGACY_KEY
  }

  // 结构化校验：x/y/zoom 均为有限数字（zoom 范围由 DesktopCamera 应用时钳制）
  function validCamera(c) {
    return !!c &&
      typeof c.x === 'number' && isFinite(c.x) &&
      typeof c.y === 'number' && isFinite(c.y) &&
      typeof c.zoom === 'number' && isFinite(c.zoom)
  }

  // 读：返回 { home?, fallback? }（只含通过校验的字段）；无数据/全脏 → null
  function load(rootId) {
    try {
      const raw = localStorage.getItem(keyFor(rootId))
      if (!raw) return null
      const data = JSON.parse(raw)
      if (!data || typeof data !== 'object') return null
      const out = {}
      if (validCamera(data.home)) out.home = { x: data.home.x, y: data.home.y, zoom: data.home.zoom }
      if (validCamera(data.fallback)) out.fallback = { x: data.fallback.x, y: data.fallback.y, zoom: data.fallback.zoom }
      return (out.home || out.fallback) ? out : null
    } catch (e) {
      return null
    }
  }

  // 写：patch 只允许 { home? } / { fallback? }，未提供的字段保持原值。
  // 成功 true，失败 false（调用方告警，铁律：写入路径不吞错）
  function save(patch, rootId) {
    const cur = load(rootId) || {}
    const data = { version: 1 }
    if (cur.home) data.home = cur.home
    if (cur.fallback) data.fallback = cur.fallback
    if (patch && Object.prototype.hasOwnProperty.call(patch, 'home')) {
      if (!validCamera(patch.home)) return false
      data.home = patch.home
    }
    if (patch && Object.prototype.hasOwnProperty.call(patch, 'fallback')) {
      if (!validCamera(patch.fallback)) return false
      data.fallback = patch.fallback
    }
    try {
      localStorage.setItem(keyFor(rootId), JSON.stringify(data))
      return true
    } catch (e) {
      return false
    }
  }

  // 一次性迁移：旧版单根 key → 当前 root key（首见 root 吸收旧数据，随后删除旧 key）。
  // 无旧数据/无 rootId → false（幂等，可重复调用）。
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
    saveHome: function (camera, rootId) { return save({ home: camera }, rootId) },
    saveFallback: function (camera, rootId) { return save({ fallback: camera }, rootId) },
    migrateLegacy: migrateLegacy,
    keyFor: keyFor,
    KEY: LEGACY_KEY,
    DEFAULT_CAMERA: DEFAULT_CAMERA
  }
})()
