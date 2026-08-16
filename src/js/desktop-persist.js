/* desktop-persist.js：目录刷新 + 布局/视图偏好持久化（App.DesktopPersist）。
 * 拆分自 desktop.js 的持久化域：目录刷新（refresh，代际守卫防过期响应）、
 * 启动布局加载（initLayout）、视图偏好变更（applyViewPrefs/getViewPrefs）、
 * 布局保存（saveLayout，铁律：写入失败必须告警）。
 * 数据真相在文件系统：LayoutStore/HomeStore/ViewStore 统一出口，不裸改缓存。
 * 依赖: namespace.js, desktop-core.js, desktop-render.js, file-api.js,
 *       layout-store.js, home-store.js, view-store.js, loading.js, drawer.js
 * 导出: App.DesktopPersist
 */
'use strict'

App.DesktopPersist = (function () {
  const C = App.DesktopCore

  // refresh 代际守卫：异步链完成时若期间又发起了新 refresh（快速连续导航），
  // 旧路径的 list 结果必须丢弃——否则旧 items 渲染到新视图（先切视图再变目录）
  // + 用旧 items 做 valid 清空根级 positions（布局像初次启动，真机 Bug A）。
  // 视图模式（isFolderView）由 curPath 同步切换，但 items 异步加载——
  // 间隙经 App.Loading 显示不确定进度条（条纹滑动），加载完成隐藏，
  // 避免「先切视图再变目录」的空白/错位感。
  function refresh() {
    const seq = ++C._refreshSeq
    const path = C.state.curPath   // 快照：发起时的目标路径（list 用快照，不用动态 curPath）
    if (App.Loading && typeof App.Loading.show === 'function') {
      App.Loading.show({ title: '加载中' })   // 不确定进度：无 total → 条纹滑动
    }
    return App.FileAPI.rootInfo()
      .then(function (info) {
        if (seq !== C._refreshSeq) return null   // 过期响应：丢弃，不写状态
        C.state.rootName = info.rootName
        C.state.mode = info.mode
        C.state.trashName = info.trashName || ''
        // root 身份（布局/Home 隔离用）：首次拿到后做旧 key 一次性迁移
        if (info.rootId && info.rootId !== C.state.rootId) {
          C.state.rootId = info.rootId
          App.LayoutStore.migrateLegacy(C.state.rootId)
          App.HomeStore.migrateLegacy(C.state.rootId)
        }
        if (App.Drawer && typeof App.Drawer.updatePath === 'function') {
          const base = info.displayPath || info.rootName
          App.Drawer.updatePath(C.state.curPath ? base + '/' + C.state.curPath : base,
            info.rootName, info.mode)
        }
      })
      .catch(function () {
        if (seq !== C._refreshSeq) return
        C.state.rootName = '无法读取'
        if (App.Drawer && typeof App.Drawer.updatePath === 'function') {
          App.Drawer.updatePath(App.NAME, App.NAME, '')
        }
      })
      .then(function () {
        if (seq !== C._refreshSeq) return null
        return App.FileAPI.list(path)
      })
      .then(function (items) {
        if (seq !== C._refreshSeq) return null
        C.state.items = items
        // 清理失效布局条目（仅 desktop 空间；folder 容器位置是自动的，不存 positions）
        if (!C.isFolderView()) {
          const valid = {}
          items.forEach(function (it) { valid[C.fullPath(it.name)] = true })
          Object.keys(C.positions).forEach(function (key) {
            const inCur = key.indexOf('/') < 0
            if (!inCur) {
              delete C.positions[key]        // 子文件夹 key 残留清理（folder 自动排布，非桌面布局）
            } else if (!valid[key]) {
              delete C.positions[key]        // 根级失效 key（文件已删）
            }
          })
        }
        App.DesktopRender.render()
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

  // 加载布局（位置 + 相机视角）+ 视图偏好，无数据/损坏回退默认
  // 图标位置恢复无条件执行（与相机优先级无关）：自由摆放位置来自 LayoutStore，
  // Home 快照只决定启动相机，绝不决定图标位置——否则设置快照后重启会丢摆放
  function initLayout() {
    const saved = App.LayoutStore.load(C.state.rootId)
    if (saved && saved.icons) {
      Object.keys(saved.icons).forEach(function (key) {
        C.positions[key] = saved.icons[key]
      })
    }
    // 启动相机：Home 快照 > 默认视角 > 上次布局视角 > 出厂 (0,0,1)。
    // Home = Camera 的默认起点（空间锚点）：设置过快照后，每次进入桌面空间都落在快照位
    let cam = null
    if (App.HomeStore) {
      const home = App.HomeStore.load(C.state.rootId)
      if (home && home.home) {
        cam = App.DesktopCamera.create(home.home.x, home.home.y, home.home.zoom)
      } else if (home && home.fallback) {
        cam = App.DesktopCamera.create(home.fallback.x, home.fallback.y, home.fallback.zoom)
      }
    }
    if (!cam && saved && saved.camera) {
      cam = App.DesktopCamera.create(saved.camera.x, saved.camera.y, saved.camera.zoom)
    }
    C.camera = cam || App.DesktopCamera.create()
    const prefs = App.ViewStore.load()
    C.state.viewStyle = prefs.viewStyle
    C.state.sortBy = prefs.sortBy
    C.state.sortDir = prefs.sortDir
    C._advancedBrowse = !!prefs.advancedBrowse
  }

  // 视图/排序偏好变更（顶栏菜单驱动）：保存 + 重渲染
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
  function saveLayout() {
    if (C.isFolderView()) return
    const data = {
      version: 1,
      icons: C.positions,
      camera: { x: C.camera.x, y: C.camera.y, zoom: C.camera.zoom }
    }
    if (!App.LayoutStore.save(data, C.state.rootId)) {
      if (App.toast && typeof App.toast.show === 'function') App.toast.show('布局保存失败')
    }
  }

  return {
    refresh: refresh,
    initLayout: initLayout,
    applyViewPrefs: applyViewPrefs,
    getViewPrefs: getViewPrefs,
    saveLayout: saveLayout
  }
})()
