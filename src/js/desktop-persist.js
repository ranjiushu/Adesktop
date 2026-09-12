/* desktop-persist.js：目录刷新 + 布局/视图偏好持久化（App.DesktopPersist）。
 * 拆分自 desktop.js 的持久化域：目录刷新（refresh，代际守卫防过期响应）、
 * 启动布局加载（initLayout）、视图偏好变更（applyViewPrefs/getViewPrefs）、
 * 布局保存（saveLayout，铁律：写入失败必须告警）。
 * 数据真相在文件系统：LayoutStore/HomeStore/ViewStore 统一出口，不裸改缓存。
 * 目录导航秒开（refresh({nav:true})）：复用内存根信息 + 目录清单缓存先同步渲染，
 * 随后静默向桥层重取对齐（stale-while-revalidate；缓存只是显示加速层，见 _dirCache 注释）。
 * 依赖: namespace.js, desktop-core.js, desktop-render.js, file-api.js,
 *       layout-store.js, home-store.js, view-store.js, loading.js, drawer.js
 * 导出: App.DesktopPersist
 */
// @ts-check
'use strict'

App.DesktopPersist = (function () {
  const C = App.DesktopCore

  // 桌面根持久化 key（localStorage）：all-files 模式桌面空间渲染的相对目录，默认 'Desktop'
  const DESKTOP_ROOT_KEY = 'desktop-root'
  // 布局数据文件：位于**桌面空间目录**内的隐藏文件（文件即真相，localStorage 降级为缓存）。
  // 切到某目录（设为桌面根）→ 读该目录的数据文件；布局随目录文件存在，不因 rootId 变化丢失。
  const LAYOUT_FILE = C.LAYOUT_FILE || '.adesktop-layout.json'
  // 启动快照缓存 key（localStorage）：最近一次成功刷新的**桌面空间**快照（mode/curPath/items 等）。
  // 仅作首屏先行渲染（进入桌面秒出图标）；真实数据仍走 refresh 拉文件系统——文件即真相不破。
  const STARTUP_CACHE_KEY = 'desktop.startup-cache.v1'

  // ── 目录导航秒开的两个前提（会话内缓存，不落盘）──
  // ① _dirCache：目录清单缓存（path → items）。导航（进/退/前进）命中时**同步渲染**
  //    （不等桥往返、不弹 loading），随后立即向桥层重取一次对齐——stale-while-revalidate：
  //    文件系统仍是唯一真相，缓存只是显示加速层；内容有变才重渲染（_sameItems 比对），
  //    无变化零打扰。因此「退出文件夹」这类回到已看过的目录不再有加载等待。
  /** @type {Record<string, Array<FileItem>>} */
  let _dirCache = {}
  /** @type {Array<string>} 插入顺序（配 DIR_CACHE_MAX 做简单 LRU 淘汰） */
  let _dirCacheKeys = []
  const DIR_CACHE_MAX = 24
  // ② _rootInfoCache：最近一次 rootInfo（rootName/mode/trashName/rootId/displayPath 在
  //    会话内不随目录切换变化）。导航复用 → 省一次桥往返（SAF 模式 rootInfo 还会
  //    ensureTrash 查一次目录）；根授权变更/权限变化走非导航 refresh，仍取真实值。
  /** @type {any} */
  let _rootInfoCache = null
  // loading 延迟显示（导航时避免「闪一下」）；非导航（变更操作，带进度语义）仍立即显示
  /** @type {any} */
  let _loadingTimer = null
  const LOADING_DELAY_MS = 180

  /** 校验桌面根：允许 ''（全盘根）；拒绝绝对路径 / 空段 / .. 逃逸 */
  /** @param {string} dir @returns {boolean} */
  function isSafeDesktopRoot(dir) {
    if (typeof dir !== 'string') return false
    if (dir === '') return true
    if (dir.indexOf('/') === 0) return false
    const parts = dir.split('/')
    for (let i = 0; i < parts.length; i++) {
      if (parts[i] === '..' || parts[i] === '') return false
    }
    return true
  }

  // 布局数据文件路径：桌面空间目录（curPath === 桌面根）下的隐藏文件；
  // SAF/私有模式桌面 = '' → 根目录下。folder 容器无布局文件。
  /** @returns {string} */
  function layoutFilePath() {
    return C.state.curPath ? C.state.curPath + '/' + LAYOUT_FILE : LAYOUT_FILE
  }

  // 读布局数据文件（异步）：文件为真相，localStorage 为缓存。
  // 命中 → 覆盖缓存（LayoutStore.save，后续启动/迁移一致性）+ 返回 {icons, camera}；
  // 文件不存在/损坏/无 read 能力 → null（用缓存数据兜底，兼容迁移）。
  // icons key = C.positions 原样（完整相对路径），读写零转换（虚拟回收站 .trash 天然支持）。
  /** @returns {Promise<AppLayoutData | null>} */
  function _loadLayoutFromFile() {
    if (!App.FileAPI || typeof App.FileAPI.read !== 'function') {
      return Promise.resolve(null)
    }
    return App.FileAPI.read(layoutFilePath())
      .then(function (raw) {
        let data = null
        try { data = JSON.parse(raw) } catch (e) { data = null }
        if (!data || typeof data !== 'object') return null
        const out = {
          version: 1,
          icons: (data.icons && typeof data.icons === 'object') ? data.icons : {},
          camera: data.camera || null
        }
        // 覆盖缓存（文件为真相：一致性 + 迁移）
        App.LayoutStore.save(out, C.state.rootId)
        return out
      })
      .catch(function () {
        return null
      })
  }

  // refresh 代际守卫：异步链完成时若期间又发起了新 refresh（快速连续导航），
  // 旧路径的 list 结果必须丢弃——否则旧 items 渲染到新视图（先切视图再变目录）
  // + 用旧 items 做 valid 清空根级 positions（布局像初次启动，真机 Bug A）。
  // 视图模式（isFolderView）由 curPath 同步切换，但 items 异步加载——
  // 间隙经 App.Loading 显示不确定进度条（条纹滑动），加载完成隐藏，
  // 避免「先切视图再变目录」的空白/错位感。
  /** @param {{nav?: boolean}} [opts] opts.nav = 目录导航（进/退/前进）→ 复用根信息 + 允许清单缓存 */
  function refresh(opts) {
    opts = opts || {}
    const nav = !!opts.nav
    const seq = ++C._refreshSeq
    // 首屏已用缓存渲染（C._bootstrapShown=true）→ 本次 refresh 是后台对齐，不弹 loading 转圈
    // （避免「图标已出又转圈」的撕裂感）；仅首屏这一次，之后刷新照常弹（标志已重置）。
    const isFirstAlign = C._bootstrapShown
    if (isFirstAlign) C._bootstrapShown = false

    // ── 秒开路径：导航 + 目标目录清单已缓存 → 同步渲染（不等桥往返、不弹 loading），
    //    随后 _revalidate 静默对齐文件系统（内容有变才重渲染）。退出/重进看过的目录走这条。──
    if (nav && !isFirstAlign) {
      const navPath = C.state.curPath
      const cached = _dirCache[navPath]
      if (cached) {
        _hideLoading()
        _applyItems(cached)
        _revalidate(navPath, seq)
        return Promise.resolve()
      }
    }

    if (isFirstAlign) _hideLoading()
    else if (nav) _showLoading(LOADING_DELAY_MS)   // 导航：延迟显示——快目录不闪「加载中」
    else _showLoading(0)                           // 变更操作/启动：立即显示（进度语义）
    const infoPromise = (nav && _rootInfoCache)
      ? Promise.resolve(_rootInfoCache)            // 导航：根信息会话内不变，复用省一次桥往返
      : App.FileAPI.rootInfo()
    return infoPromise
      .then(function (info) {
        if (seq !== C._refreshSeq) return null   // 过期响应：丢弃，不写状态
        _rootInfoCache = info                    // 缓存根信息（导航复用；授权变更走非导航 refresh）
        C.state.rootName = info.rootName
        C.state.mode = info.mode
        C.state.trashName = info.trashName || ''
        // all-files 模式：rootId 带桌面根（布局/Home 按桌面目录隔离，切桌面根不继承布局）；
        // 启动/模式切换时桌面空间 = desktopRoot（curPath 从 '' 初始化，导航栈同步重建）
        let rootId = info.rootId
        if (info.mode === 'all-files') {
          rootId = 'all-files:' + C.state.desktopRoot
          if (C.state.curPath === '') {
            C.state.curPath = C.state.desktopRoot
            C.nav = App.DesktopNav.enter(App.DesktopNav.create(), C.state.desktopRoot)
          }
        }
        // root 身份（布局/Home 隔离用）：首次拿到后做旧 key 一次性迁移
        if (rootId && rootId !== C.state.rootId) {
          C.state.rootId = rootId
          App.LayoutStore.migrateLegacy(C.state.rootId)
          App.HomeStore.migrateLegacy(C.state.rootId)
          // [修复] rootId 就绪前 initLayout 用旧 key 加载（旧 key 迁移后删除）——
          // 必须用 rootId key 重载，否则后续启动布局丢失（回自动排布，见 test-desktop-layout-reload.js）
          _reloadLayoutForRoot()
        }
        if (App.Drawer && typeof App.Drawer.updatePath === 'function') {
          const base = info.displayPath || info.rootName
          App.Drawer.updatePath(C.state.curPath ? base + '/' + C.state.curPath : base,
            info.rootName, info.mode)
        }
        // 全盘授权引导（首次启动未授权时弹出；localStorage 标记防重复，Drawer 可再进）
        if (App.Drawer && typeof App.Drawer.maybePromptAllFiles === 'function') {
          App.Drawer.maybePromptAllFiles()
        }
        return info
      })
      .catch(function () {
        if (seq !== C._refreshSeq) return
        C.state.rootName = '无法读取'
        if (App.Drawer && typeof App.Drawer.updatePath === 'function') {
          App.Drawer.updatePath(App.NAME, App.NAME, '')
        }
      })
      .then(function (info) {
        if (seq !== C._refreshSeq) return null
        // 桌面空间：读布局数据文件（文件为真相）——rootInfo 之后、list 之前串行，
        // 快速切换目录时被代际守卫丢弃，无竞态
        if (info && !C.isFolderView()) {
          return _loadLayoutFromFile()
        }
        return null
      })
      .then(function (layoutData) {
        if (seq !== C._refreshSeq) return null
        // 应用文件布局（文件为真相，覆盖缓存数据）：positions 清空重建（保持引用不变）
        const icons = (layoutData && layoutData.icons) || null
        if (icons) {
          Object.keys(C.positions).forEach(function (k) { delete C.positions[k] })
          Object.keys(icons).forEach(function (k) {
            C.positions[k] = icons[k]
          })
        }
        const cam = (layoutData && layoutData.camera) || null
        if (cam) {
          C.camera = App.DesktopCamera.create(
            cam.x, cam.y, cam.zoom, cam.rotation || 0)
          if (C.rootCamera) C.rootCamera = C.camera
          if (App.DesktopNavigation && typeof App.DesktopNavigation.applyCameraForPath === 'function') {
            App.DesktopNavigation.applyCameraForPath()
          }
        }
        // 快照目标路径（rootInfo 之后拍：all-files 桌面根初始化/桌面目录切换已生效；
        // list 用快照防异步竞态——代际守卫语义不变）
        const path = C.state.curPath
        return App.FileAPI.list(path)
      })
      .then(function (items) {
        if (seq !== C._refreshSeq) return null
        if (!items) return null
        _cachePut(C.state.curPath, items)   // 清单缓存（导航秒开用）
        _applyItems(items)
        _hideLoading()
      })
      .catch(function (err) {
        if (seq !== C._refreshSeq) return
        _hideLoading()
        if (App.toast && typeof App.toast.show === 'function') {
          App.toast.show('读取失败: ' + err.message)
        }
      })
  }

  // ── 刷新收尾（完整路径与秒开路径共用）──
  // items 已确认为**当前目录**内容：落状态 → 清理失效布局条目 → 渲染 → 快照/Viewer/导航按钮收尾
  /** @param {Array<FileItem>} items @returns {void} */
  function _applyItems(items) {
    C.state.items = items
    // 清理失效布局条目（仅 desktop 空间；folder 容器位置是自动的，不存 positions）
    if (!C.isFolderView()) {
      /** @type {Record<string, boolean>} */
      const valid = {}
      items.forEach(function (it) { valid[C.fullPath(it.name)] = true })
      // 布局 key = 相对桥层根的完整路径；「当前目录」判定 = 前缀匹配且无更深段：
      //   curPath=''（SAF/私有根）→ prefix=''，key 无 '/' 即根级（原语义）；
      //   curPath='Desktop'（桌面根）→ prefix='Desktop/'，直接子项才保留——
      //   Bug 修复（2026-08-19）：此前按「key 无 '/'」判定，桌面根 fullPath 全含
      //   '/' → 每次刷新清空全部 positions，布局持久化被破坏
      const prefix = C.state.curPath ? C.state.curPath + '/' : ''
      Object.keys(C.positions).forEach(function (key) {
        // 虚拟回收站（all-files 桌面空间）：key = trashName（桥层根固定串），恒保留
        const isVirtualTrash = C.state.mode === 'all-files' &&
          key === C.state.trashName
        if (isVirtualTrash) return
        const inCur = key.indexOf(prefix) === 0 && key.indexOf('/', prefix.length) < 0
        if (!inCur) {
          delete C.positions[key]        // 非当前目录 key 残留清理（folder 自动排布，非桌面布局）
        } else if (!valid[key]) {
          delete C.positions[key]        // 失效 key（文件已删/隐藏文件）
        }
      })
    }
    App.DesktopRender.render()
    //（桌面空间）写最新启动快照：下次启动首屏秒出用；文件夹视图不缓存，避免启动错进子目录。
    if (!C.isFolderView()) {
      _saveStartupCache({
        version: 1,
        mode: C.state.mode,
        curPath: C.state.curPath,
        desktopRoot: C.state.desktopRoot,
        trashName: C.state.trashName,
        rootId: C.state.rootId,
        rootName: C.state.rootName,
        displayPath: C.state.curPath ? C.state.rootName + '/' + C.state.curPath : C.state.rootName,
        items: items
      })
    }
    // 恢复上次会话的 Viewer（桌面空间；幂等，文件已删/已打开自动跳过）
    if (!C.isFolderView() && App.DesktopViewerLink &&
        typeof App.DesktopViewerLink.restoreViewers === 'function') {
      App.DesktopViewerLink.restoreViewers()
    }
    // 后退/前进按钮禁用态随目录切换更新
    if (App.BottomBar && typeof App.BottomBar.updateNavButtons === 'function') {
      App.BottomBar.updateNavButtons()
    }
  }

  // ── 清单缓存：写入（带简单 LRU 上限）/ 静默对齐 ──
  /** @param {string} path @param {Array<FileItem>} items @returns {void} */
  function _cachePut(path, items) {
    if (!path && path !== '') return
    _dirCache[path] = items
    _dirCacheKeys = _dirCacheKeys.filter(function (k) { return k !== path })
    _dirCacheKeys.push(path)
    while (_dirCacheKeys.length > DIR_CACHE_MAX) {
      const oldest = _dirCacheKeys.shift()
      if (oldest === undefined) break
      delete _dirCache[oldest]
    }
  }

  // 秒开后的后台对齐：向桥层重取清单 → 同样的代际守卫；内容与已渲染的一致则**不重渲染**
  // （零打扰，绝大多数导航属于这种）；不一致才重渲染（文件系统是真相，缓存只是加速层）。
  // 对齐失败静默（保持缓存渲染，不弹错误——用户没主动发起任何文件操作）。
  /** @param {string} path @param {number} seq @returns {void} */
  function _revalidate(path, seq) {
    App.FileAPI.list(path).then(function (items) {
      if (seq !== C._refreshSeq) return
      if (!items) return
      _cachePut(path, items)
      if (C.state.curPath !== path) return
      if (_sameItems(C.state.items, items)) return
      _applyItems(items)
    }).catch(function () { /* 静默：下次导航/操作再对齐 */ })
  }

  // 清单等价判定（导航对齐用）：顺序 + 四项条目字段全等即视为无变化
  /** @param {Array<FileItem>} a @param {Array<FileItem>} b @returns {boolean} */
  function _sameItems(a, b) {
    if (!a || !b || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      const x = a[i]
      const y = b[i]
      if (!x || !y) return false
      if (x.name !== y.name || !!x.isDir !== !!y.isDir ||
          x.size !== y.size || x.mtime !== y.mtime) return false
    }
    return true
  }

  // ── loading 显隐（延迟显示：导航时避免「闪一下」）──
  /** @param {number} delayMs @returns {void} */
  function _showLoading(delayMs) {
    if (!App.Loading || typeof App.Loading.show !== 'function') return
    if (_loadingTimer) {
      clearTimeout(_loadingTimer)
      _loadingTimer = null
    }
    if (!delayMs) {
      App.Loading.show({ title: '加载中' })   // 不确定进度：无 total → 条纹滑动
      return
    }
    _loadingTimer = setTimeout(function () {
      _loadingTimer = null
      App.Loading.show({ title: '加载中' })
    }, delayMs)
  }

  /** @returns {void} */
  function _hideLoading() {
    if (_loadingTimer) {
      clearTimeout(_loadingTimer)
      _loadingTimer = null
    }
    if (App.Loading && typeof App.Loading.hide === 'function') {
      App.Loading.hide()
    }
  }

  // 加载布局（positions）+ 相机（Home 快照 > 布局相机）——initLayout 与 rootId 就绪后重载共用。
  // 清空 positions 保持引用不变（外部持有 C.positions 引用，替换会留下幽灵投影）。
  function _loadLayoutAndCamera() {
    const saved = App.LayoutStore.load(C.state.rootId)
    Object.keys(C.positions).forEach(function (k) { delete C.positions[k] })
    const savedIcons = saved && saved.icons
    if (savedIcons) {
      Object.keys(savedIcons).forEach(function (key) {
        C.positions[key] = savedIcons[key]
      })
    }
    // 相机优先级：Home 快照 > 默认视角 > 上次布局视角（与 initLayout 原语义一致）。
    // rotation 透传：按当前画布方向读对应槽位（竖屏/横屏各自恢复）
    let cam = null
    if (App.HomeStore) {
      const rot = C.camera && C.camera.rotation === 90 ? 90 : 0
      const home = App.HomeStore.load(C.state.rootId, rot)
      if (home && home.home) {
        cam = App.DesktopCamera.create(home.home.x, home.home.y, home.home.zoom, rot)
      } else if (home && home.fallback) {
        cam = App.DesktopCamera.create(home.fallback.x, home.fallback.y, home.fallback.zoom, rot)
      }
    }
    if (!cam && saved && saved.camera) {
      cam = App.DesktopCamera.create(saved.camera.x, saved.camera.y, saved.camera.zoom, saved.camera.rotation)
    }
    if (cam) C.camera = cam
  }

  // rootId 就绪后重载布局/相机（Bug 修复，2026-08-17）：
  // initLayout 在 rootId 就绪前同步执行（rootId='' → 读旧 key），而 migrateLegacy 会删除
  // 旧 key——第二次启动起 initLayout 永远读不到旧 key → 布局丢回自动排布（3*n）。
  // 这里用 rootId key 重载；切 root 场景（rootId A→B）同样触发重载 B 的布局。
  function _reloadLayoutForRoot() {
    _loadLayoutAndCamera()
    if (C.rootCamera) C.rootCamera = C.camera   // 同步根目录相机基准（applyCameraForPath 用）
    // 重新应用相机到 DOM + 同步手势层引用（applyCameraForPath 内部 setCamera+commit）：
    // 否则启动画面停留在初始视角（不能缩放/移动到 Home），且 goHome 的 from=C.camera
    // 已是目标值 → 无动画（回归测试：test-desktop-layout-reload.js）
    if (App.DesktopNavigation && typeof App.DesktopNavigation.applyCameraForPath === 'function') {
      App.DesktopNavigation.applyCameraForPath()
    }
  }

  // ── 启动快照缓存（首屏先行渲染用）────────────────────────
  // 仅在桌面空间（!isFolderView）缓存/读取；文件夹视图不缓存，避免启动错进子目录。
  // 快照 = 最近一次成功刷新看到的桌面 items + 当时的 state 上下文（mode/curPath/rootId/...）。
  // 缓存只是首屏投影，真实数据以 refresh 的 rootInfo/list 为准（文件即真相不破）。
  /** @returns {StartupSnapshot | null} */
  function _loadStartupCache() {
    try {
      const raw = localStorage.getItem(STARTUP_CACHE_KEY)
      if (!raw) return null
      const data = JSON.parse(raw)
      if (!data || typeof data !== 'object' || !Array.isArray(data.items)) return null
      return data
    } catch (e) {
      return null
    }
  }

  /** @param {StartupSnapshot} snap @returns {void} */
  function _saveStartupCache(snap) {
    try {
      localStorage.setItem(STARTUP_CACHE_KEY, JSON.stringify(snap))
    } catch (e) { /* 缓存失败不阻断：非真相数据，可重建 */ }
  }

  // 首屏缓存先行渲染：App.boot 的 refresh 之前调用，用启动快照还原桌面状态并渲染图标，
  // 实现「进入桌面秒出」，随后真实 refresh 后台对齐。不弹 loading 转圈。
  // 有缓存可用时返回 true（首屏已渲染出图标）；无缓存/空 → 返回 false，refresh 照常弹 loading。
  /** @returns {boolean} */
  function renderFromCache() {
    if (C._bootstrapShown) return true          // 已首渲过（幂等，重复调用不再渲染）
    const snap = _loadStartupCache()
    if (!snap || !snap.items || !snap.items.length) return false   // 无快照/空 → 走正常加载
    // 用快照 rootId 加载对应根目录的布局（位置+相机）：initLayout 尚无 rootId（读旧 key），
    // 此处用快照 rootId 恢复真实摆放，首屏即落在用户上次的位置（避免自动排布→真实位置跳动）
    if (snap.rootId && snap.rootId !== C.state.rootId) {
      C.state.rootId = snap.rootId
      _loadLayoutAndCamera()
      if (C.rootCamera) C.rootCamera = C.camera
    }
    // 还原桌面状态上下文（首屏渲染需正确判定 isFolderView / trash 渲染 / 桌面根）
    C.state.mode = snap.mode
    C.state.curPath = snap.curPath
    C.state.desktopRoot = snap.desktopRoot
    C.state.trashName = snap.trashName || ''
    C.state.rootName = snap.rootName || ''
    C.state.items = snap.items
    C._bootstrapShown = true
    // 应用相机到 DOM（initLayout 已恢复 Home/布局相机，这里落到 canvas transform）
    if (App.DesktopNavigation && typeof App.DesktopNavigation.applyCameraForPath === 'function') {
      App.DesktopNavigation.applyCameraForPath()
    }
    App.DesktopRender.render()
    return true
  }

  // 启动布局加载（位置 + 相机视角）+ 视图偏好，无数据/损坏回退默认
  // 图标位置恢复无条件执行（与相机优先级无关）：自由摆放位置来自 LayoutStore，
  // Home 快照只决定启动相机，绝不决定图标位置——否则设置快照后重启会丢摆放
  function initLayout() {
    _loadLayoutAndCamera()
    C.camera = C.camera || App.DesktopCamera.create()
    // 桌面根（all-files 模式桌面空间渲染目录）：localStorage 持久化，损坏/非法回退默认
    try {
      const raw = localStorage.getItem(DESKTOP_ROOT_KEY)
      if (raw !== null && isSafeDesktopRoot(raw)) C.state.desktopRoot = raw
    } catch (e) { /* 忽略 */ }
    const prefs = App.ViewStore.load()
    C.state.viewStyle = prefs.viewStyle
    C.state.sortBy = prefs.sortBy
    C.state.sortDir = prefs.sortDir
    C._advancedBrowse = !!prefs.advancedBrowse
  }

  /** 切换桌面根（all-files 模式）：更新状态 + 持久化 + 回到新桌面根重新加载。
   *  布局/Home 按 rootId（all-files:<桌面根>）隔离——切换即重置为新桌面根的布局。
   *  @param {string} dir 相对路径（'' = 全盘根）；校验失败返回 false（调用方 toast） */
  /** @param {string} dir @returns {boolean} */
  function saveDesktopRoot(dir) {
    if (!isSafeDesktopRoot(dir)) return false
    C.state.desktopRoot = dir
    try {
      localStorage.setItem(DESKTOP_ROOT_KEY, dir)
    } catch (e) { /* 忽略 */ }
    if (C.state.mode === 'all-files') {
      C.state.curPath = dir
      C.nav = App.DesktopNav.enter(App.DesktopNav.create(), dir)
      refresh()
    }
    return true
  }

  // 视图/排序偏好变更（顶栏菜单驱动）：保存 + 重渲染
  /** @param {ViewPrefs} prefs */
  function applyViewPrefs(prefs) {
    if (!prefs) return
    C.state.viewStyle = prefs.viewStyle
    C.state.sortBy = prefs.sortBy
    C.state.sortDir = prefs.sortDir
    if (!App.ViewStore.save(prefs)) {
      if (App.toast && typeof App.toast.show === 'function') App.toast.show('视图偏好保存失败')
    }
    // 视图偏好只影响排序/排布（清单内容不变）→ 直接重渲染：不向桥层重取、不弹「加载中」。
    // 原先走整轮 refresh 会闪一次模态 + 白跑一次 list（网格↔列表每切必闪）。
    App.DesktopRender.render()
  }

  // 当前视图偏好（ViewMenu 渲染选中态用）
  function getViewPrefs() {
    return { viewStyle: C.state.viewStyle, sortBy: C.state.sortBy, sortDir: C.state.sortDir }
  }

  // 保存布局（位置 + 相机），失败告警（铁律：写入路径失败必须告警）
  // folder 容器：布局自动排布，不持久化（位置/相机均不写）
  // rotation 透传：崩溃恢复后按保存时的旋转态重建相机（竖屏/横屏视角不混淆）
  // 双写：localStorage 缓存（同步，兼容启动读/迁移）+ 桌面空间目录布局文件（异步，文件即真相）。
  // 文件写失败只告警不阻断（缓存仍在，下次保存重试）。
  function saveLayout() {
    if (C.isFolderView()) return
    const cam = C.camera || App.DesktopCamera.create()
    const data = {
      version: 1,
      icons: C.positions,
      camera: { x: cam.x, y: cam.y, zoom: cam.zoom, rotation: cam.rotation || 0 }
    }
    if (!App.LayoutStore.save(data, C.state.rootId)) {
      if (App.toast && typeof App.toast.show === 'function') App.toast.show('布局保存失败')
    }
    // 文件为真相：布局数据落对应目录（切桌面根/重启后按目录读取，不因 rootId 变化丢失）
    if (App.FileAPI && typeof App.FileAPI.write === 'function') {
      App.FileAPI.write(layoutFilePath(), JSON.stringify(data)).catch(function (err) {
        if (App.toast && typeof App.toast.show === 'function') {
          App.toast.show('布局文件写入失败: ' + ((err && err.message) || '未知错误'))
        }
      })
    }
  }

  /** @type {DesktopPersist} */
  return {
    refresh: refresh,
    initLayout: initLayout,
    renderFromCache: renderFromCache,
    applyViewPrefs: applyViewPrefs,
    getViewPrefs: getViewPrefs,
    saveLayout: saveLayout,
    saveDesktopRoot: saveDesktopRoot
  }
})()
