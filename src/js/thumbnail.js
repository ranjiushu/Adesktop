/* 缩略图服务（ThumbnailService）：文件展示层数据，与 Desktop 核心引擎解耦。
 * File 对象本身不含缩略图状态——desktop.js / selection / layout-store 只关心
 * name/path/type/position；缩略图的「能否生成 + 获取 + 缓存」全部收敛在本模块。
 *
 * 职责：
 *   - canThumbnail(kind)：判定类型是否可生成缩略图（图片 + 视频）
 *   - request(path, name, kind, onReady, onFallback)：渐进式获取缩略图 URI
 *       · 命中缓存（ready）→ 立即 onReady(uri)
 *       · 失败缓存（failed）→ 立即 onFallback()
 *       · 未命中 → 先回退类型图标，异步桥层 thumb（采样/帧提取/磁盘缓存）+ 解码验证，成功后 onReady
 *       · 同一路径并发请求合并（pending 去重），避免重复 thumb / 解码
 *   - requestShortcutIcon(path, onReady, onFallback)：快捷方式图标（.desktop 内嵌 base64）
 *       · 读 JSON → App.Shortcut.parseShortcut → 取 icon（data URI）→ 解码验证 → onReady
 * 依赖: namespace.js, file-api.js, shortcut.js
 * 导出: App.Thumbnail
 */
// @ts-check
'use strict'

App.Thumbnail = (function () {
  // path -> { state: 'pending'|'ready'|'failed', uri, waiters: [{ok,fail}] }
  /** @type {Record<string, ThumbnailEntry>} */
  let entries = {}
  // path -> 同上（快捷方式图标缓存，与缩略图分池）
  /** @type {Record<string, ThumbnailEntry>} */
  let shortcutEntries = {}

  // 可缩略图类型：图片（采样解码，含 SVG 渲染预览 / GIF 首帧）+ 视频（首帧提取）。
  // 桥层 FileBridge.thumb 统一处理采样 / 帧提取 / 磁盘缓存（内存可控）。
  /** @param {string} kind @returns {boolean} */
  function canThumbnail(kind) {
    return kind === 'image' || kind === 'video'
  }

  /** @param {string} path @param {string} name @param {string} kind @param {(uri: string) => void} onReady @param {() => void} onFallback */
  function request(path, name, kind, onReady, onFallback) {
    const e = entries[path]
    if (e) {
      if (e.state === 'ready') { onReady(/** @type {string} */ (e.uri)); return }
      if (e.state === 'failed') { onFallback(); return }
      // pending：合并 waiter（同一文件并发请求共享一次生成）
      e.waiters.push({ ok: onReady, fail: onFallback })
      return
    }
    /** @type {ThumbnailEntry} */
    const entry = { state: 'pending', uri: null, waiters: [{ ok: onReady, fail: onFallback }] }
    entries[path] = entry
    generate(path, entry)
  }

  /** @param {string} path @param {ThumbnailEntry} entry */
  function generate(path, entry) {
    App.FileAPI.thumb(path).then(function (uri) {
      // 解码验证：Image onload = 稳定可解码；onerror = 无法作为缩略图
      const img = new Image()
      img.onload = function () {
        entry.state = 'ready'
        entry.uri = uri
        const ws = entry.waiters
        entry.waiters = []
        ws.forEach(function (w) { w.ok(uri) })
      }
      img.onerror = function () {
        entry.state = 'failed'
        const ws = entry.waiters
        entry.waiters = []
        ws.forEach(function (w) { w.fail() })
      }
      img.src = uri
    }).catch(function () {
      entry.state = 'failed'
      const ws = entry.waiters
      entry.waiters = []
      ws.forEach(function (w) { w.fail() })
    })
  }

  // 快捷方式图标：读 .desktop JSON → 提取内嵌 base64 icon → 解码验证 → onReady。
  // 与缩略图同一「渐进式 + pending 去重」模型；失败回退类型图标。
  /** @param {string} path @param {(uri: string) => void} onReady @param {() => void} onFallback */
  function requestShortcutIcon(path, onReady, onFallback) {
    const e = shortcutEntries[path]
    if (e) {
      if (e.state === 'ready') { onReady(/** @type {string} */ (e.uri)); return }
      if (e.state === 'failed') { onFallback(); return }
      e.waiters.push({ ok: onReady, fail: onFallback })
      return
    }
    /** @type {ThumbnailEntry} */
    const entry = { state: 'pending', uri: null, waiters: [{ ok: onReady, fail: onFallback }] }
    shortcutEntries[path] = entry
    generateShortcutIcon(path, entry)
  }

  /** @param {string} path @param {ThumbnailEntry} entry */
  function generateShortcutIcon(path, entry) {
    App.FileAPI.read(path).then(function (content) {
      const meta = App.Shortcut.parseShortcut(content)
      const uri = meta.type === 'application' ? meta.icon : null
      if (!uri || typeof uri !== 'string' || uri.indexOf('data:image/') !== 0) {
        throw new Error('快捷方式无图标')
      }
      // data URI 已随文件落盘（桥层 appIcon 产出），无需二次 Image 解码验证——
      // 交给 setThumbImg 的 onerror 兜底；直接标记 ready，消除「onload 偶发不触发 → 卡 pending」。
      entry.state = 'ready'
      entry.uri = uri
      const ws = entry.waiters
      entry.waiters = []
      ws.forEach(function (w) { w.ok(uri) })
    }).catch(function () {
      // 失败不永久缓存：删除条目，下次 render 重试——防瞬时读失败毒化缓存（否则需重启才恢复）
      const ws = entry.waiters
      entry.waiters = []
      delete shortcutEntries[path]
      ws.forEach(function (w) { w.fail() })
    })
  }

  /** @type {Thumbnail} */
  return {
    canThumbnail: canThumbnail,
    request: request,
    requestShortcutIcon: requestShortcutIcon
  }
})()
