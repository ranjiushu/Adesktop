/* Viewer 状态存储模块（App.ViewerStore）：画布态 Viewer 的打开状态 + 世界坐标位置。
 * 结构（version 1）：
 *   { version: 1,
 *     viewers: [{ path, name, kind, rect: {x, y, w, h} }] }
 * 语义：
 *   - 只持久化画布态（canvas mode）Viewer——桌面空间的实体；folder 容器内是
 *     全屏预览（随退出关闭），不持久化。
 *   - 「Viewer 只能通过手动关闭」：打开状态跨重启恢复（reload 后回到原位置），
 *     关闭走 Morph FAB「关闭预览」（删除语义），无自动关闭路径。
 *   - rect = 世界坐标（位置 + 尺寸，media 加载自适应后的最终值）。
 * 写入：localStorage 缓存 + 桌面空间目录隐藏文件 .adesktop-viewers.json（文件即真相）。
 * 依赖: namespace.js, file-api.js
 * 导出: App.ViewerStore
 */
// @ts-check
'use strict'

App.ViewerStore = (function () {
  const VERSION = 1
  const KEY_PREFIX = 'desktop.viewers.'
  const VIEWERS_FILE = '.adesktop-viewers.json'

  /** @param {string} rootId @returns {string} */
  function keyFor(rootId) {
    return rootId ? KEY_PREFIX + rootId + '.v' + VERSION : KEY_PREFIX + 'legacy.v' + VERSION
  }

  /** @param {any} r @returns {boolean} */
  function validRect(r) {
    return !!r &&
      typeof r.x === 'number' && isFinite(r.x) &&
      typeof r.y === 'number' && isFinite(r.y) &&
      typeof r.w === 'number' && isFinite(r.w) && r.w > 0 &&
      typeof r.h === 'number' && isFinite(r.h) && r.h > 0
  }

  /** @param {any} v @returns {boolean} */
  function validRecord(v) {
    return !!v &&
      typeof v.path === 'string' && v.path &&
      typeof v.name === 'string' &&
      typeof v.kind === 'string' && v.kind &&
      validRect(v.rect)
  }

  /** @param {any} data @returns {{version: number, viewers: Array<ViewerRecord>}} */
  function normalize(data) {
    const out = { version: VERSION, viewers: [] }
    if (!data || typeof data !== 'object') return out
    if (Array.isArray(data.viewers)) {
      out.viewers = data.viewers.filter(validRecord).map(function (/** @type {any} */ v) {
        return {
          path: v.path,
          name: v.name,
          kind: v.kind,
          rect: { x: v.rect.x, y: v.rect.y, w: v.rect.w, h: v.rect.h }
        }
      })
    }
    return out
  }

  /** @returns {{version: number, viewers: Array<ViewerRecord>}} */
  function empty() {
    return { version: VERSION, viewers: [] }
  }

  /** @param {string} rootId @returns {{version: number, viewers: Array<ViewerRecord>}} */
  function load(rootId) {
    try {
      const raw = localStorage.getItem(keyFor(rootId))
      if (raw) return normalize(JSON.parse(raw))
    } catch (e) { /* 忽略：回退空 */ }
    return empty()
  }

  // 写 Viewer 状态：localStorage 缓存 + 桌面空间隐藏文件（文件即真相，随目录迁移）。
  // 失败返回 false（调用方告警）。
  /** @param {Array<ViewerRecord>} viewers @param {string} rootId @returns {boolean} */
  function save(viewers, rootId) {
    const data = normalize({ version: VERSION, viewers: viewers || [] })
    try {
      localStorage.setItem(keyFor(rootId), JSON.stringify(data))
    } catch (e) {
      return false
    }
    if (App.FileAPI && typeof App.FileAPI.write === 'function') {
      const curPath = (App.DesktopCore && App.DesktopCore.state && App.DesktopCore.state.curPath) || ''
      const filePath = curPath ? curPath + '/' + VIEWERS_FILE : VIEWERS_FILE
      App.FileAPI.write(filePath, JSON.stringify(data)).catch(function (err) {
        if (App.toast && typeof App.toast.show === 'function') {
          App.toast.show('Viewer 状态写入失败: ' + ((err && err.message) || '未知错误'))
        }
      })
    }
    return true
  }

  /** @type {ViewerStore} */
  return {
    VERSION: VERSION,
    VIEWERS_FILE: VIEWERS_FILE,
    load: load,
    save: save,
    keyFor: keyFor
  }
})()
