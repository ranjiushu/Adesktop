/* 视图偏好存储模块：子文件夹（Folder 容器）的视图样式 + 排序偏好。
 * 结构：{ version: 1, viewStyle: 'grid'|'list', sortBy: 'name'|'mtime'|'type'|'size', sortDir: 1|-1 }
 * 全局偏好（应用于所有子文件夹），与相机/图标位置（layout-store）分离。
 * 依赖: namespace.js
 * 导出: App.ViewStore
 */
'use strict'

App.ViewStore = (function () {
  const KEY = 'desktop.view.v1'
  const DEFAULT = { viewStyle: 'grid', sortBy: 'name', sortDir: 1, advancedBrowse: false }

  function valid(data) {
    if (!data || typeof data !== 'object') return false
    if (data.viewStyle !== 'grid' && data.viewStyle !== 'list') return false
    const sortBy = ['name', 'mtime', 'type', 'size'].indexOf(data.sortBy) >= 0
    if (!sortBy) return false
    if (data.sortDir !== 1 && data.sortDir !== -1) return false
    // advancedBrowse 缺失或非法时回退 false（向后兼容旧数据）
    return true
  }

  // 读偏好：失败/损坏回退默认
  function load() {
    try {
      const raw = localStorage.getItem(KEY)
      if (!raw) return Object.assign({}, DEFAULT)
      const data = JSON.parse(raw)
      return valid(data) ? data : Object.assign({}, DEFAULT)
    } catch (e) {
      return Object.assign({}, DEFAULT)
    }
  }

  // 写偏好：成功 true，失败 false（调用方告警）
  function save(data) {
    try {
      localStorage.setItem(KEY, JSON.stringify(Object.assign({ version: 1 }, data)))
      return true
    } catch (e) {
      return false
    }
  }

  return {
    load: load,
    save: save,
    KEY: KEY,
    DEFAULT: DEFAULT
  }
})()
