/* Home 位置快照存储模块：底栏 Home 的空间锚点语义。
 * 结构：{ version: 2, home?: {x,y,zoom}, fallback?: {x,y,zoom},
 *         landscapeHome?: {x,y,zoom}, landscapeFallback?: {x,y,zoom} }
 *   home / fallback     — 竖屏（rotation=0）槽位：长按底栏 Home 记录的
 *                          「当前视角快照」/ Drawer「设为默认视角」
 *   landscapeHome / landscapeFallback — 横屏（rotation=90）槽位：画布旋转 90° 时
 *                          各自独立记录/恢复（切换画布方向后 Home 回对应槽位）
 *   home 优先于 fallback；两者都无则回出厂 (0,0,1)。
 *   version 1 旧数据只有顶层字段 → 天然就是竖屏槽位（零迁移）。
 * 仅桌面空间（根目录）有意义的相机值；子文件夹容器相机是滚动态，不写入。
 * zoom 范围校验不在此重复常量（desktop-camera.js 是唯一权威），应用时经
 * DesktopCamera.create() 钳制即可，这里只做结构化校验（防脏数据）。
 * 依赖: namespace.js
 * 导出: App.HomeStore
 */
// @ts-check
'use strict'

App.HomeStore = (function () {
  const LEGACY_KEY = 'desktop.home.v1'   // 旧版单根 key（迁移兼容）
  const KEY_PREFIX = 'desktop.home.'
  const DEFAULT_CAMERA = { x: 0, y: 0, zoom: 1 }

  // 动态 key：desktop.home.<rootId>.v1；rootId 为空 → 旧 key（兼容读取）
  // Home 快照是「相对当前根目录」的空间锚点，切根不得继承（见 docs/operation-contract.md 1.6）
  /** @param {string} rootId @returns {string} */
  function keyFor(rootId) {
    return rootId ? KEY_PREFIX + rootId + '.v1' : LEGACY_KEY
  }

  // 结构化校验：x/y/zoom 均为有限数字（zoom 范围由 DesktopCamera 应用时钳制）
  /** @param {any} c @returns {boolean} */
  function validCamera(c) {
    return !!c &&
      typeof c.x === 'number' && isFinite(c.x) &&
      typeof c.y === 'number' && isFinite(c.y) &&
      typeof c.zoom === 'number' && isFinite(c.zoom)
  }

  // rotation → 数据字段映射：0/undefined = 顶层（竖屏，兼容 version 1），
  // 90 = landscape 前缀（横屏槽位）；其余输入防御回退竖屏
  /** @param {number | undefined} rotation @returns {{home: string, fallback: string}} */
  function fields(rotation) {
    if (rotation === 90) return { home: 'landscapeHome', fallback: 'landscapeFallback' }
    return { home: 'home', fallback: 'fallback' }
  }

  // 读：返回 { home?, fallback? }（只含通过校验的字段）；无数据/全脏 → null
  // rotation=90 读横屏槽位（landscape*），否则读竖屏槽位（顶层）
  /** @param {string} rootId @param {number} [rotation] @returns {HomeSnapshot | null} */
  function load(rootId, rotation) {
    try {
      const raw = localStorage.getItem(keyFor(rootId))
      if (!raw) return null
      const data = JSON.parse(raw)
      if (!data || typeof data !== 'object') return null
      const f = fields(rotation)
      /** @type {HomeSnapshot} */
      const out = {}
      if (validCamera(data[f.home])) out.home = { x: data[f.home].x, y: data[f.home].y, zoom: data[f.home].zoom }
      if (validCamera(data[f.fallback])) out.fallback = { x: data[f.fallback].x, y: data[f.fallback].y, zoom: data[f.fallback].zoom }
      return (out.home || out.fallback) ? out : null
    } catch (e) {
      return null
    }
  }

  // 写：patch 只允许 { home? } / { fallback? }，未提供的字段保持原值。
  // rotation=90 写横屏槽位（landscape*），否则写竖屏槽位（顶层）。
  // 两套槽位独立读写互不覆盖；成功 true，失败 false（调用方告警，铁律：写入路径不吞错）
  /** @param {HomeSnapshot} patch @param {string} rootId @param {number} [rotation] @returns {boolean} */
  function save(patch, rootId, rotation) {
    /** @type {HomeSnapshot} */
    const cur = load(rootId) || {}
    /** @type {HomeSnapshot} */
    const curLand = load(rootId, 90) || {}
    /** @type {HomeStoreData} */
    const data = { version: 2 }
    if (cur.home) data.home = cur.home
    if (cur.fallback) data.fallback = cur.fallback
    if (curLand.home) data.landscapeHome = curLand.home
    if (curLand.fallback) data.landscapeFallback = curLand.fallback
    const f = fields(rotation)
    if (patch && Object.prototype.hasOwnProperty.call(patch, 'home')) {
      if (!validCamera(patch.home)) return false
      data[f.home] = patch.home
    }
    if (patch && Object.prototype.hasOwnProperty.call(patch, 'fallback')) {
      if (!validCamera(patch.fallback)) return false
      data[f.fallback] = patch.fallback
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
  /** @param {string} rootId @returns {boolean} */
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

  /** @type {HomeStore} */
  return {
    load: load,
    saveHome: function (camera, rootId, rotation) { return save({ home: camera }, rootId, rotation) },
    saveFallback: function (camera, rootId, rotation) { return save({ fallback: camera }, rootId, rotation) },
    migrateLegacy: migrateLegacy,
    keyFor: keyFor,
    KEY: LEGACY_KEY,
    DEFAULT_CAMERA: DEFAULT_CAMERA
  }
})()
