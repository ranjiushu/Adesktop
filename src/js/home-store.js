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
  const KEY = 'desktop.home.v1'
  const DEFAULT_CAMERA = { x: 0, y: 0, zoom: 1 }

  // 结构化校验：x/y/zoom 均为有限数字（zoom 范围由 DesktopCamera 应用时钳制）
  function validCamera(c) {
    return !!c &&
      typeof c.x === 'number' && isFinite(c.x) &&
      typeof c.y === 'number' && isFinite(c.y) &&
      typeof c.zoom === 'number' && isFinite(c.zoom)
  }

  // 读：返回 { home?, fallback? }（只含通过校验的字段）；无数据/全脏 → null
  function load() {
    try {
      const raw = localStorage.getItem(KEY)
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
  function save(patch) {
    const cur = load() || {}
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
      localStorage.setItem(KEY, JSON.stringify(data))
      return true
    } catch (e) {
      return false
    }
  }

  return {
    load: load,
    saveHome: function (camera) { return save({ home: camera }) },
    saveFallback: function (camera) { return save({ fallback: camera }) },
    KEY: KEY,
    DEFAULT_CAMERA: DEFAULT_CAMERA
  }
})()
