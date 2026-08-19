/* 演示快照存储模块（App.SnapshotStore）：桌面空间视角快照列表。
 * 结构（version 2）：
 *   { version: 2,
 *     portrait:  { snapshots: [ { id, name, camera:{x,y,zoom,rotation}, createdAt } ] },
 *     landscape: { snapshots: [...] } }
 * 语义：
 *   - 每个 rootId 独立一份快照数据；竖屏（rotation=0）与横屏（rotation=90）
 *     各有一份快照列表，互不覆盖。
 *   - "Home" = 当前方向快照列表中由"插入位置"决定的那一项（默认 top，索引 0）。
 *     新创建的快照按插入位置放到 Home 位；拖动排序可把任意快照拖到 Home 位。
 *   - 插入位置（top/bottom）可由底栏菜单修改，全局生效（两方向共用）。
 * 兼容：
 *   - 旧版 HomeStore 若仍有 home/fallback 数据，首次加载时按当前方向自动生成
 *     一个名为"Home 快照"的初始快照，避免老用户升级后丢失 Home。
 * 写入：localStorage 缓存 + 桌面空间目录隐藏文件 .adesktop-snapshots.json（文件即真相）。
 * 依赖: namespace.js, home-store.js, file-api.js
 * 导出: App.SnapshotStore
 */
// @ts-check
'use strict'

App.SnapshotStore = (function () {
  const VERSION = 2
  const KEY_PREFIX = 'desktop.snapshots.'
  const INSERT_POS_KEY = 'desktop.snapshot-insert-position'
  const SNAPSHOTS_FILE = '.adesktop-snapshots.json'

  /** @param {string} rootId @returns {string} */
  function keyFor(rootId) {
    return rootId ? KEY_PREFIX + rootId + '.v' + VERSION : KEY_PREFIX + 'legacy.v' + VERSION
  }

  /** @returns {number} */
  function currentRotation() {
    return (App.DesktopCore && App.DesktopCore.camera && App.DesktopCore.camera.rotation === 90) ? 90 : 0
  }

  /** @param {number} [rotation] @returns {'portrait' | 'landscape'} */
  function slotName(rotation) {
    return (rotation === 90 ? 'landscape' : 'portrait')
  }

  /** @returns {SnapshotBundle} */
  function emptyBundle() {
    return {
      version: VERSION,
      portrait: { version: VERSION, snapshots: [] },
      landscape: { version: VERSION, snapshots: [] }
    }
  }

  /** @returns {SnapshotData} */
  function emptyData() {
    return { version: VERSION, snapshots: [] }
  }

  /** @param {any} c @returns {boolean} */
  function validCamera(c) {
    return !!c &&
      typeof c.x === 'number' && isFinite(c.x) &&
      typeof c.y === 'number' && isFinite(c.y) &&
      typeof c.zoom === 'number' && isFinite(c.zoom) &&
      (typeof c.rotation !== 'number' || isFinite(c.rotation))
  }

  /** @param {any} s @returns {boolean} */
  function validSnapshot(s) {
    return !!s && typeof s.id === 'string' && s.id &&
      typeof s.name === 'string' &&
      typeof s.createdAt === 'number' && isFinite(s.createdAt) &&
      validCamera(s.camera)
  }

  /** @param {any} data @returns {SnapshotBundle} */
  function normalizeBundle(data) {
    const out = emptyBundle()
    if (!data || typeof data !== 'object') return out
    if (data.version === VERSION && data.portrait && data.landscape) {
      if (Array.isArray(data.portrait.snapshots)) {
        out.portrait.snapshots = data.portrait.snapshots.filter(validSnapshot)
      }
      if (Array.isArray(data.landscape.snapshots)) {
        out.landscape.snapshots = data.landscape.snapshots.filter(validSnapshot)
      }
      return out
    }
    // 兼容 version 1 扁平结构：按相机 rotation 分流；无 rotation 视为竖屏
    if (data.version === 1 && Array.isArray(data.snapshots)) {
      data.snapshots.forEach(function (/** @type {any} */ s) {
        if (!validSnapshot(s)) return
        const slot = (s.camera && s.camera.rotation === 90) ? 'landscape' : 'portrait'
        out[slot].snapshots.push(s)
      })
      return out
    }
    return out
  }

  /** @returns {string} */
  function generateId() {
    return 'ss_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7)
  }

  /** @returns {string} */
  function formatName() {
    const now = new Date()
    const pad = function (/** @type {number} */ n) { return n < 10 ? '0' + n : '' + n }
    return pad(now.getMonth() + 1) + '-' + pad(now.getDate()) + ' ' +
      pad(now.getHours()) + ':' + pad(now.getMinutes())
  }

  /** @returns {'top' | 'bottom'} */
  function getInsertPosition() {
    try {
      const raw = localStorage.getItem(INSERT_POS_KEY)
      if (raw === 'bottom') return 'bottom'
    } catch (e) { /* ignore */ }
    return 'top'
  }

  /** @param {'top' | 'bottom'} pos @returns {boolean} */
  function setInsertPosition(pos) {
    if (pos !== 'top' && pos !== 'bottom') return false
    try {
      localStorage.setItem(INSERT_POS_KEY, pos)
      return true
    } catch (e) {
      return false
    }
  }

  /** @param {Array<Snapshot>} list @param {'top' | 'bottom'} pos @returns {number} */
  function homeIndex(list, pos) {
    if (!list || list.length === 0) return -1
    return pos === 'bottom' ? list.length - 1 : 0
  }

  /** @param {SnapshotBundle} bundle @param {number} rotation @returns {SnapshotData} */
  function bundleToData(bundle, rotation) {
    const slot = slotName(rotation)
    return {
      version: VERSION,
      snapshots: bundle[slot].snapshots.slice()
    }
  }

  /** @param {string} rootId @returns {Promise<SnapshotBundle | null>} */
  function _loadBundleFromFile(rootId) {
    if (!App.FileAPI || typeof App.FileAPI.read !== 'function') {
      return Promise.resolve(null)
    }
    const curPath = (App.DesktopCore && App.DesktopCore.state && App.DesktopCore.state.curPath) || ''
    const filePath = curPath ? curPath + '/' + SNAPSHOTS_FILE : SNAPSHOTS_FILE
    return App.FileAPI.read(filePath)
      .then(function (raw) {
        let data = null
        try { data = JSON.parse(raw) } catch (e) { data = null }
        if (!data || typeof data !== 'object') return null
        const bundle = normalizeBundle(data)
        // 文件为真相：覆盖缓存
        try {
          localStorage.setItem(keyFor(rootId), JSON.stringify(bundle))
        } catch (e) { /* ignore */ }
        return bundle
      })
      .catch(function () {
        return null
      })
  }

  /** @param {string} rootId @returns {SnapshotBundle} */
  function loadBundle(rootId) {
    let bundle = null
    try {
      const raw = localStorage.getItem(keyFor(rootId))
      if (raw) {
        const parsed = JSON.parse(raw)
        bundle = normalizeBundle(parsed)
      }
    } catch (e) { /* ignore */ }

    bundle = bundle || emptyBundle()
    const slot = slotName(currentRotation())
    if (bundle[slot].snapshots.length === 0) {
      const migrated = _migrateFromHomeStore(rootId)
      if (migrated) {
        bundle = migrated
        try {
          localStorage.setItem(keyFor(rootId), JSON.stringify(bundle))
        } catch (e) { /* ignore */ }
      }
    }
    return bundle
  }

  /** @param {string} rootId @returns {SnapshotData} */
  function loadSnapshots(rootId) {
    const bundle = loadBundle(rootId)
    return bundleToData(bundle, currentRotation())
  }

  /** @param {string} rootId @returns {SnapshotBundle | null} */
  function _migrateFromHomeStore(rootId) {
    if (!App.HomeStore) return null
    const rot = currentRotation()
    const home = App.HomeStore.load(rootId, rot)
    const cam = home && home.home ? home.home : (home && home.fallback ? home.fallback : null)
    if (!cam) return null
    const snapshot = {
      id: generateId(),
      name: 'Home 快照',
      camera: { x: cam.x, y: cam.y, zoom: cam.zoom, rotation: rot },
      createdAt: Date.now()
    }
    const bundle = emptyBundle()
    bundle[slotName(rot)].snapshots.push(snapshot)
    return bundle
  }

  /** @param {SnapshotData} data @param {string} rootId @returns {boolean} */
  function saveSnapshots(data, rootId) {
    const bundle = loadBundle(rootId)
    const slot = slotName(currentRotation())
    bundle[slot].snapshots = (data && Array.isArray(data.snapshots))
      ? data.snapshots.filter(validSnapshot)
      : []
    try {
      localStorage.setItem(keyFor(rootId), JSON.stringify(bundle))
    } catch (e) {
      return false
    }
    // 文件为真相：异步写入完整 bundle（双方向），失败仅告警不阻断
    if (App.FileAPI && typeof App.FileAPI.write === 'function') {
      const curPath = (App.DesktopCore && App.DesktopCore.state && App.DesktopCore.state.curPath) || ''
      const filePath = curPath ? curPath + '/' + SNAPSHOTS_FILE : SNAPSHOTS_FILE
      App.FileAPI.write(filePath, JSON.stringify(bundle)).catch(function (err) {
        if (App.toast && typeof App.toast.show === 'function') {
          App.toast.show('快照文件写入失败: ' + ((err && err.message) || '未知错误'))
        }
      })
    }
    return true
  }

  /** @param {DesktopCameraState} camera @param {string} rootId @returns {Snapshot | null} */
  function createSnapshot(camera, rootId) {
    if (!validCamera(camera)) return null
    const data = loadSnapshots(rootId)
    const snapshot = {
      id: generateId(),
      name: formatName(),
      camera: { x: camera.x, y: camera.y, zoom: camera.zoom, rotation: camera.rotation || 0 },
      createdAt: Date.now()
    }
    const pos = getInsertPosition()
    if (pos === 'bottom') {
      data.snapshots.push(snapshot)
    } else {
      data.snapshots.unshift(snapshot)
    }
    if (!saveSnapshots(data, rootId)) return null
    return snapshot
  }

  /** @param {SnapshotData} data @param {string} id @returns {SnapshotData} */
  function deleteSnapshot(data, id) {
    return {
      version: VERSION,
      snapshots: data.snapshots.filter(function (s) { return s.id !== id })
    }
  }

  /** @param {SnapshotData} data @param {number} from @param {number} to @returns {SnapshotData} */
  function reorder(data, from, to) {
    if (!data || !Array.isArray(data.snapshots)) return emptyData()
    const list = data.snapshots.slice()
    if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) {
      return { version: VERSION, snapshots: list }
    }
    const [moved] = list.splice(from, 1)
    list.splice(to, 0, moved)
    return { version: VERSION, snapshots: list }
  }

  /** @param {SnapshotData} data @param {'top' | 'bottom'} pos @returns {Snapshot | null} */
  function getHomeSnapshot(data, pos) {
    if (!data || !Array.isArray(data.snapshots) || data.snapshots.length === 0) return null
    return data.snapshots[homeIndex(data.snapshots, pos)]
  }

  /** @param {SnapshotData} data @param {number} idx @returns {Snapshot | null} */
  function snapshotAt(data, idx) {
    if (!data || !Array.isArray(data.snapshots)) return null
    if (idx < 0 || idx >= data.snapshots.length) return null
    return data.snapshots[idx]
  }

  /** @param {string} rootId @returns {boolean} */
  function hasAnySnapshot(rootId) {
    const bundle = loadBundle(rootId)
    return bundle.portrait.snapshots.length > 0 || bundle.landscape.snapshots.length > 0
  }

  /** @type {SnapshotStore} */
  return {
    VERSION: VERSION,
    SNAPSHOTS_FILE: SNAPSHOTS_FILE,
    load: loadSnapshots,
    save: saveSnapshots,
    create: createSnapshot,
    delete: deleteSnapshot,
    reorder: reorder,
    getInsertPosition: getInsertPosition,
    setInsertPosition: setInsertPosition,
    homeIndex: homeIndex,
    getHome: getHomeSnapshot,
    at: snapshotAt,
    hasAny: hasAnySnapshot,
    loadFromFile: _loadBundleFromFile
  }
})()
