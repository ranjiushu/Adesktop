/* 演示快照存储模块（App.SnapshotStore）：桌面空间视角快照列表。
 * 结构（version 3）：
 *   { version: 3,
 *     groups: [{ id, name }],
 *     portrait:  { version: 3, groups: [{ id, snapshots: [...] }] },
 *     landscape: { version: 3, groups: [{ id, snapshots: [...] }] } }
 * 语义：
 *   - 每个 rootId 独立一份快照数据；分组列表全局共用，每个方向（竖屏/横屏）
 *     的每个分组下各自保存快照。
 *   - 快照带 `code` 字母编号（页代码，创建时分配 A..Z → AA..，全局唯一且随快照
 *     稳定——拖动排序/移动分组不改变）；页码 = 扁平顺序（排序后变化，load 时派生）。
 *   - "Home" = 当前方向分组列表中由"插入位置"决定的那一项（默认 top，索引 0）。
 *     新创建的快照按插入位置放到 Home 分组；拖动排序可把任意快照拖到 Home 位。
 *   - 插入位置（top/bottom）可由底栏菜单修改，全局生效。
 * 兼容：
 *   - v2: { version:2, portrait:{snapshots:[]}, landscape:{snapshots:[]} } → 自动产生
 *     一个默认分组并把快照移入。
 *   - v1: 扁平 snapshots 按相机 rotation 分流到默认分组。
 *   - 旧版 HomeStore 若仍有 home/fallback 数据，首次加载时按当前方向自动生成
 *     一个名为"默认分组"的初始快照，避免老用户升级后丢失 Home。
 * 写入：localStorage 缓存 + 桌面空间目录隐藏文件 .adesktop-snapshots.json（文件即真相）。
 * 依赖: namespace.js, home-store.js, file-api.js
 * 导出: App.SnapshotStore
 */
// @ts-check
'use strict'

App.SnapshotStore = (function () {
  const VERSION = 3
  const KEY_PREFIX = 'desktop.snapshots.'
  const INSERT_POS_KEY = 'desktop.snapshot-insert-position'
  const SNAPSHOTS_FILE = '.adesktop-snapshots.json'
  const DEFAULT_GROUP_NAME = '默认分组'

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
    const gid = generateId()
    return {
      version: VERSION,
      groups: [{ id: gid, name: DEFAULT_GROUP_NAME }],
      portrait: { version: VERSION, groups: [{ id: gid, snapshots: [] }] },
      landscape: { version: VERSION, groups: [{ id: gid, snapshots: [] }] }
    }
  }

  /** @param {SnapshotBundle} bundle @param {string} id @returns {SnapshotGroupMeta | undefined} */
  function findGroupMeta(bundle, id) {
    return bundle.groups.find(function (g) { return g.id === id })
  }

  /** @param {SnapshotBundle} bundle @param {number} rotation @returns {SnapshotData} */
  function bundleToData(bundle, rotation) {
    const slot = slotName(rotation)
    const dirGroups = bundle[slot] && Array.isArray(bundle[slot].groups) ? bundle[slot].groups : []
    const groups = dirGroups.map(function (g) {
      const meta = findGroupMeta(bundle, g.id)
      return {
        id: g.id,
        name: meta ? meta.name : DEFAULT_GROUP_NAME,
        snapshots: Array.isArray(g.snapshots) ? g.snapshots.filter(validSnapshot) : []
      }
    })
    return { version: VERSION, groups: groups }
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
    if (data.version === VERSION) {
      out.groups = Array.isArray(data.groups)
        ? data.groups.filter(function (/** @type {any} */ g) { return g && typeof g.id === 'string' && typeof g.name === 'string' })
        : []
      if (out.groups.length === 0) {
        out.groups = [{ id: generateId(), name: DEFAULT_GROUP_NAME }]
      }
      const defaultId = out.groups[0].id
      out.portrait.groups = _normalizeDirection(data.portrait, defaultId)
      out.landscape.groups = _normalizeDirection(data.landscape, defaultId)
      // 清理孤儿子分组（没有 meta 的分组删除）
      out.portrait.groups = out.portrait.groups.filter(function (g) { return findGroupMeta(out, g.id) })
      out.landscape.groups = out.landscape.groups.filter(function (g) { return findGroupMeta(out, g.id) })
      return out
    }
    // 兼容 v2 双槽位：生成默认分组并迁入
    if (data.version === 2 && data.portrait && data.landscape) {
      const gid = generateId()
      out.groups = [{ id: gid, name: DEFAULT_GROUP_NAME }]
      out.portrait.groups = [{ id: gid, snapshots: (data.portrait.snapshots || []).filter(validSnapshot) }]
      out.landscape.groups = [{ id: gid, snapshots: (data.landscape.snapshots || []).filter(validSnapshot) }]
      return out
    }
    // 兼容 v1 扁平结构：按相机 rotation 分流到默认分组
    if (data.version === 1 && Array.isArray(data.snapshots)) {
      const gid = generateId()
      out.groups = [{ id: gid, name: DEFAULT_GROUP_NAME }]
      /** @type {Array<Snapshot>} */
      const p = []
      /** @type {Array<Snapshot>} */
      const l = []
      data.snapshots.forEach(function (/** @type {any} */ s) {
        if (!validSnapshot(s)) return
        if (s.camera && s.camera.rotation === 90) l.push(s)
        else p.push(s)
      })
      out.portrait.groups = [{ id: gid, snapshots: p }]
      out.landscape.groups = [{ id: gid, snapshots: l }]
      return out
    }
    return out
  }

  /** @param {any} dir @param {string} defaultId @returns {Array<{id: string, snapshots: Array<Snapshot>}>} */
  function _normalizeDirection(dir, defaultId) {
    if (!dir || typeof dir !== 'object') return [{ id: defaultId, snapshots: [] }]
    if (Array.isArray(dir.groups)) {
      return dir.groups.map(function (/** @type {any} */ g) {
        return { id: g.id || defaultId, snapshots: Array.isArray(g.snapshots) ? g.snapshots.filter(validSnapshot) : [] }
      })
    }
    // v2 遗留字段 snapshots 也兼容
    if (Array.isArray(dir.snapshots)) {
      return [{ id: defaultId, snapshots: dir.snapshots.filter(validSnapshot) }]
    }
    return [{ id: defaultId, snapshots: [] }]
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

  /** @param {Array<SnapshotGroup>} groups @param {'top' | 'bottom'} pos @returns {number} */
  function homeGroupIndex(groups, pos) {
    if (!groups || groups.length === 0) return -1
    return pos === 'bottom' ? groups.length - 1 : 0
  }

  /** @param {SnapshotData} data @param {'top' | 'bottom'} pos @returns {SnapshotGroup | null} */
  function getHomeGroup(data, pos) {
    if (!data || !Array.isArray(data.groups) || data.groups.length === 0) return null
    return data.groups[homeGroupIndex(data.groups, pos)]
  }

  /** @param {Array<Snapshot>} list @param {'top' | 'bottom'} pos @returns {number} */
  function homeSnapshotIndex(list, pos) {
    if (!list || list.length === 0) return -1
    return pos === 'bottom' ? list.length - 1 : 0
  }

  /** @param {SnapshotGroup} group @param {'top' | 'bottom'} pos @returns {Snapshot | null} */
  function getHomeSnapshot(group, pos) {
    if (!group || !Array.isArray(group.snapshots) || group.snapshots.length === 0) return null
    return group.snapshots[homeSnapshotIndex(group.snapshots, pos)]
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
    // 仅在「整个 bundle 都没有任何快照」时尝试从旧版 HomeStore 迁移，
    // 避免横竖屏切换覆盖已有另一方向的快照
    const anySnapshot = bundle.portrait.groups.some(function (g) { return g.snapshots.length > 0 }) ||
      bundle.landscape.groups.some(function (g) { return g.snapshots.length > 0 })
    if (!anySnapshot) {
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
    const data = bundleToData(bundle, currentRotation())
    return ensureCodes(data)
  }

  // ── 字母编号（快照稳定标识）──
  // 每个快照创建时分配一个唯一字母编号（A..Z → AA..AZ → ...），作为「页代码」：
  // 拖动排序/移动分组不改变字母编号，数字页码随排序变化（load 时按扁平顺序回填）。
  /** @param {number} i @returns {string} */
  function codeFromIndex(i) {
    let n = i
    let out = ''
    do {
      out = String.fromCharCode(65 + (n % 26)) + out
      n = Math.floor(n / 26) - 1
    } while (n >= 0)
    return out
  }

  /** @param {SnapshotData} data @returns {string} 分配当前数据中未使用的最小字母编号 */
  function nextCode(data) {
    const used = new Set()
    if (data && Array.isArray(data.groups)) {
      data.groups.forEach(function (g) {
        if (!g || !Array.isArray(g.snapshots)) return
        g.snapshots.forEach(function (s) {
          if (s && typeof s.code === 'string' && s.code) used.add(s.code)
        })
      })
    }
    let i = 0
    while (used.has(codeFromIndex(i))) i++
    return codeFromIndex(i)
  }

  /** @param {SnapshotData} data @returns {SnapshotData} 旧数据无 code 的按扁平顺序回填字母编号（保留已有 code） */
  function ensureCodes(data) {
    if (!data || !Array.isArray(data.groups)) return data
    const used = new Set()
    data.groups.forEach(function (g) {
      if (!g || !Array.isArray(g.snapshots)) return
      g.snapshots.forEach(function (s) {
        if (s && typeof s.code === 'string' && s.code) used.add(s.code)
      })
    })
    let cursor = 0
    function take() {
      while (used.has(codeFromIndex(cursor))) cursor++
      const c = codeFromIndex(cursor)
      used.add(c)
      cursor++
      return c
    }
    data.groups.forEach(function (g) {
      if (!g || !Array.isArray(g.snapshots)) return
      g.snapshots.forEach(function (s) {
        if (s && !s.code) s.code = take()
      })
    })
    return data
  }

  /** @param {string} rootId @returns {SnapshotBundle | null} */
  function _migrateFromHomeStore(rootId) {
    if (!App.HomeStore) return null
    const rot = currentRotation()
    const home = App.HomeStore.load(rootId, rot)
    const cam = home && home.home ? home.home : (home && home.fallback ? home.fallback : null)
    if (!cam) return null
    const gid = generateId()
    const snapshot = {
      id: generateId(),
      name: 'Home 快照',
      camera: { x: cam.x, y: cam.y, zoom: cam.zoom, rotation: rot },
      createdAt: Date.now()
    }
    return {
      version: VERSION,
      groups: [{ id: gid, name: DEFAULT_GROUP_NAME }],
      portrait: { version: VERSION, groups: [{ id: gid, snapshots: rot === 0 ? [snapshot] : [] }] },
      landscape: { version: VERSION, groups: [{ id: gid, snapshots: rot === 90 ? [snapshot] : [] }] }
    }
  }

  /** @param {SnapshotData} data @param {string} rootId @returns {boolean} */
  function saveSnapshots(data, rootId) {
    const groupList = (data && Array.isArray(data.groups)) ? data.groups : []
    /** @type {SnapshotBundle | null} */
    let bundle = null
    try {
      const raw = localStorage.getItem(keyFor(rootId))
      if (raw) bundle = normalizeBundle(JSON.parse(raw))
    } catch (e) { /* ignore */ }
    const slot = slotName(currentRotation())
    if (!bundle) {
      // 全新 bundle：分组元数据 + 两个方向槽位全部按 data.groups 初始化，
      // 避免 loadBundle 新建空 bundle 产生孤儿分组 id
      bundle = {
        version: VERSION,
        groups: groupList.map(function (g) { return { id: g.id, name: g.name } }),
        portrait: { version: VERSION, groups: groupList.map(function (g) { return { id: g.id, snapshots: [] } }) },
        landscape: { version: VERSION, groups: groupList.map(function (g) { return { id: g.id, snapshots: [] } }) }
      }
    } else {
      // 以 data.groups 为准同步全局分组元数据（id/name），避免孤儿分组被过滤
      const keepIds = groupList.map(function (g) { return g.id })
      if (keepIds.length > 0) {
        /** @type {Array<SnapshotGroupMeta>} */
        const merged = []
        /** @type {SnapshotBundle} */
        const cur = bundle
        groupList.forEach(function (g) {
          const meta = cur.groups.find(function (m) { return m.id === g.id })
          merged.push(meta ? { id: meta.id, name: g.name } : { id: g.id, name: g.name })
        })
        cur.groups = merged
      }
    }
    /** @type {SnapshotBundle} */
    const b = bundle
    b[slot].groups = groupList.map(function (g) {
      return { id: g.id, snapshots: Array.isArray(g.snapshots) ? g.snapshots.filter(validSnapshot) : [] }
    })
    try {
      localStorage.setItem(keyFor(rootId), JSON.stringify(b))
    } catch (e) {
      return false
    }
    if (App.FileAPI && typeof App.FileAPI.write === 'function') {
      const curPath = (App.DesktopCore && App.DesktopCore.state && App.DesktopCore.state.curPath) || ''
      const filePath = curPath ? curPath + '/' + SNAPSHOTS_FILE : SNAPSHOTS_FILE
      App.FileAPI.write(filePath, JSON.stringify(b)).catch(function (err) {
        if (App.toast && typeof App.toast.show === 'function') {
          App.toast.show('快照文件写入失败: ' + ((err && err.message) || '未知错误'))
        }
      })
    }
    return true
  }

  /** @param {SnapshotData} data @returns {SnapshotBundle} */
  function dataToBundle(data) {
    const bundle = loadBundle('') // 占位，实际需要传入 rootId；此处仅用于结构转换
    const slot = slotName(currentRotation())
    bundle[slot].groups = (data.groups || []).map(function (g) {
      return { id: g.id, snapshots: Array.isArray(g.snapshots) ? g.snapshots.filter(validSnapshot) : [] }
    })
    return bundle
  }

  /** @param {DesktopCameraState} camera @param {string} rootId @param {string} [groupId] @returns {Snapshot | null} */
  function createSnapshot(camera, rootId, groupId) {
    if (!validCamera(camera)) return null
    const data = loadSnapshots(rootId)
    const home = getHomeGroup(data, getInsertPosition())
    const targetGroup = groupId ? data.groups.find(function (g) { return g.id === groupId }) : home
    const group = targetGroup || home || data.groups[0]
    if (!group) return null
    const snapshot = {
      id: generateId(),
      name: formatName(),
      code: nextCode(data),
      camera: { x: camera.x, y: camera.y, zoom: camera.zoom, rotation: camera.rotation || 0 },
      createdAt: Date.now()
    }
    const pos = getInsertPosition()
    if (pos === 'bottom') {
      group.snapshots.push(snapshot)
    } else {
      group.snapshots.unshift(snapshot)
    }
    if (!saveSnapshots(data, rootId)) return null
    return snapshot
  }

  /** @param {SnapshotData} data @param {string} groupId @param {number} from @param {number} to @returns {SnapshotData} */
  function reorderSnapshot(data, groupId, from, to) {
    if (!data || !Array.isArray(data.groups)) return { version: VERSION, groups: [] }
    const groups = data.groups.map(function (g) {
      if (g.id !== groupId) return g
      const list = g.snapshots.slice()
      if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) {
        return { id: g.id, name: g.name, snapshots: list }
      }
      const moved = list.splice(from, 1)[0]
      list.splice(to, 0, moved)
      return { id: g.id, name: g.name, snapshots: list }
    })
    return { version: VERSION, groups: groups }
  }

  /** @param {SnapshotData} data @param {string} groupId @param {string} snapshotId @returns {SnapshotData} */
  function deleteSnapshot(data, groupId, snapshotId) {
    if (!data || !Array.isArray(data.groups)) return { version: VERSION, groups: [] }
    const groups = data.groups.map(function (g) {
      if (g.id !== groupId) return g
      return { id: g.id, name: g.name, snapshots: g.snapshots.filter(function (s) { return s.id !== snapshotId }) }
    })
    return { version: VERSION, groups: groups }
  }

  /** @param {SnapshotData} data @param {string} fromGroupId @param {string} toGroupId @param {Array<string>} snapshotIds @returns {SnapshotData} */
  function moveSnapshots(data, fromGroupId, toGroupId, snapshotIds) {
    if (!data || !Array.isArray(data.groups)) return { version: VERSION, groups: [] }
    const fromGroup = data.groups.find(function (g) { return g.id === fromGroupId })
    const toGroup = data.groups.find(function (g) { return g.id === toGroupId })
    if (!fromGroup || !toGroup || fromGroupId === toGroupId) return data
    const ids = snapshotIds.filter(function (id) { return typeof id === 'string' })
    if (ids.length === 0) return data
    const moved = fromGroup.snapshots.filter(function (s) { return ids.indexOf(s.id) >= 0 })
    if (moved.length === 0) return data
    const groups = data.groups.map(function (g) {
      if (g.id === fromGroupId) {
        return { id: g.id, name: g.name, snapshots: g.snapshots.filter(function (s) { return ids.indexOf(s.id) < 0 }) }
      }
      if (g.id === toGroupId) {
        return { id: g.id, name: g.name, snapshots: g.snapshots.concat(moved) }
      }
      return g
    })
    return { version: VERSION, groups: groups }
  }


  /** @param {string} rootId @param {string} name @returns {{bundle: SnapshotBundle, group: SnapshotGroupMeta} | null} */
  function createGroup(rootId, name) {
    const bundle = loadBundle(rootId)
    const gid = generateId()
    const groupName = (name && String(name).trim()) || ('分组 ' + (bundle.groups.length + 1))
    const meta = { id: gid, name: groupName }
    bundle.groups.push(meta)
    // 为新分组在各个方向创建空槽
    if (!Array.isArray(bundle.portrait.groups.find(function (g) { return g.id === gid }))) {
      bundle.portrait.groups.push({ id: gid, snapshots: [] })
    }
    if (!Array.isArray(bundle.landscape.groups.find(function (g) { return g.id === gid }))) {
      bundle.landscape.groups.push({ id: gid, snapshots: [] })
    }
    try {
      localStorage.setItem(keyFor(rootId), JSON.stringify(bundle))
    } catch (e) {
      return null
    }
    _persistBundle(rootId, bundle)
    return { bundle: bundle, group: meta }
  }

  /** @param {string} rootId @param {string} groupId @param {string} name @returns {boolean} */
  function renameGroup(rootId, groupId, name) {
    const bundle = loadBundle(rootId)
    const meta = bundle.groups.find(function (g) { return g.id === groupId })
    if (!meta) return false
    meta.name = (name && String(name).trim()) || DEFAULT_GROUP_NAME
    try {
      localStorage.setItem(keyFor(rootId), JSON.stringify(bundle))
    } catch (e) {
      return false
    }
    _persistBundle(rootId, bundle)
    return true
  }

  /** @param {string} rootId @param {string} groupId @returns {boolean} */
  function deleteGroup(rootId, groupId) {
    const bundle = loadBundle(rootId)
    const idx = bundle.groups.findIndex(function (g) { return g.id === groupId })
    if (idx < 0) return false
    bundle.groups.splice(idx, 1)
    bundle.portrait.groups = bundle.portrait.groups.filter(function (g) { return g.id !== groupId })
    bundle.landscape.groups = bundle.landscape.groups.filter(function (g) { return g.id !== groupId })
    if (bundle.groups.length === 0) {
      const gid = generateId()
      bundle.groups = [{ id: gid, name: DEFAULT_GROUP_NAME }]
      bundle.portrait.groups = [{ id: gid, snapshots: [] }]
      bundle.landscape.groups = [{ id: gid, snapshots: [] }]
    }
    try {
      localStorage.setItem(keyFor(rootId), JSON.stringify(bundle))
    } catch (e) {
      return false
    }
    _persistBundle(rootId, bundle)
    return true
  }

  /** @param {string} rootId @param {SnapshotBundle} bundle */
  function _persistBundle(rootId, bundle) {
    if (App.FileAPI && typeof App.FileAPI.write === 'function') {
      const curPath = (App.DesktopCore && App.DesktopCore.state && App.DesktopCore.state.curPath) || ''
      const filePath = curPath ? curPath + '/' + SNAPSHOTS_FILE : SNAPSHOTS_FILE
      App.FileAPI.write(filePath, JSON.stringify(bundle)).catch(function (err) {
        if (App.toast && typeof App.toast.show === 'function') {
          App.toast.show('快照文件写入失败: ' + ((err && err.message) || '未知错误'))
        }
      })
    }
  }

  /** @param {string} rootId @param {number} [rotation] @returns {Array<Snapshot>} */
  function flatSnapshots(rootId, rotation) {
    const data = loadSnapshots(rootId)
    /** @type {Array<Snapshot>} */
    const list = []
    data.groups.forEach(function (g) {
      list.push.apply(list, g.snapshots)
    })
    return list
  }

  /** @param {SnapshotData} data @param {number} idx @returns {Snapshot | null} */
  function snapshotAt(data, idx) {
    if (!data || !Array.isArray(data.groups)) return null
    let cursor = 0
    for (let i = 0; i < data.groups.length; i++) {
      const g = data.groups[i]
      if (idx >= cursor && idx < cursor + g.snapshots.length) {
        return g.snapshots[idx - cursor]
      }
      cursor += g.snapshots.length
    }
    return null
  }

  /** @param {SnapshotData} data @param {string} snapshotId @returns {{groupIdx: number, snapshotIdx: number} | null} */
  function findSnapshotIndex(data, snapshotId) {
    if (!data || !Array.isArray(data.groups)) return null
    for (let gi = 0; gi < data.groups.length; gi++) {
      const si = data.groups[gi].snapshots.findIndex(function (s) { return s.id === snapshotId })
      if (si >= 0) return { groupIdx: gi, snapshotIdx: si }
    }
    return null
  }

  /** @param {string} rootId @returns {boolean} */
  function hasAnySnapshot(rootId) {
    const data = loadSnapshots(rootId)
    return data.groups.some(function (g) { return g.snapshots.length > 0 })
  }

  /** @type {SnapshotStore} */
  return {
    VERSION: VERSION,
    SNAPSHOTS_FILE: SNAPSHOTS_FILE,
    load: loadSnapshots,
    save: saveSnapshots,
    create: createSnapshot,
    delete: deleteSnapshot,
    reorder: reorderSnapshot,
    move: moveSnapshots,
    createGroup: createGroup,
    renameGroup: renameGroup,
    deleteGroup: deleteGroup,
    getInsertPosition: getInsertPosition,
    setInsertPosition: setInsertPosition,
    nextCode: nextCode,
    ensureCodes: ensureCodes,
    homeGroupIndex: homeGroupIndex,
    getHomeGroup: getHomeGroup,
    homeSnapshotIndex: homeSnapshotIndex,
    getHome: getHomeSnapshot,
    flatSnapshots: flatSnapshots,
    at: snapshotAt,
    findIndex: findSnapshotIndex,
    hasAny: hasAnySnapshot,
    loadFromFile: _loadBundleFromFile
  }
})()
