/* desktop-persist.js：目录刷新 + 布局/视图偏好持久化（App.DesktopPersist）。
 * 拆分自 desktop.js 的持久化域：目录刷新（refresh，代际守卫防过期响应）、
 * 启动布局加载（initLayout）、视图偏好变更（applyViewPrefs/getViewPrefs）、
 * 布局保存（saveLayout，铁律：写入失败必须告警）。
 * 数据真相在文件系统：LayoutStore/HomeStore/ViewStore 统一出口，不裸改缓存。
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
  function refresh() {
    const seq = ++C._refreshSeq
    if (App.Loading && typeof App.Loading.show === 'function') {
      App.Loading.show({ title: '加载中' })   // 不确定进度：无 total → 条纹滑动
    }
    return App.FileAPI.rootInfo()
      .then(function (info) {
        if (seq !== C._refreshSeq) return null   // 过期响应：丢弃，不写状态
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
        // 恢复上次会话的 Viewer（桌面空间；幂等，文件已删/已打开自动跳过）
        if (!C.isFolderView() && App.DesktopViewerLink &&
            typeof App.DesktopViewerLink.restoreViewers === 'function') {
          App.DesktopViewerLink.restoreViewers()
        }
        // 后退/前进按钮禁用态随目录切换更新
        if (App.BottomBar && typeof App.BottomBar.updateNavButtons === 'function') {
          App.BottomBar.updateNavButtons()
        }
        // 目录加载完成：隐藏对话框
        if (App.Loading && typeof App.Loading.hide === 'function') {
          App.Loading.hide()
        }
      })
      .catch(function (err) {
        if (seq !== C._refreshSeq) return
        if (App.Loading && typeof App.Loading.hide === 'function') {
          App.Loading.hide()
        }
        if (App.toast && typeof App.toast.show === 'function') {
          App.toast.show('读取失败: ' + err.message)
        }
      })
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
    refresh()
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
    applyViewPrefs: applyViewPrefs,
    getViewPrefs: getViewPrefs,
    saveLayout: saveLayout,
    saveDesktopRoot: saveDesktopRoot
  }
})()
