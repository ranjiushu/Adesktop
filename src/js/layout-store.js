/* 布局存储模块：localStorage 维护图标位置 + 相机视角（文件即真相的临时方案）。
 * 结构：{ version: 1, icons: { name: {x,y} }, camera: {x,y,zoom} }
 * 条目以文件名为 key：文件删/改名 → 布局条目自然失效，回退自动排布，不报错。
 * 依赖: namespace.js
 * 导出: App.LayoutStore
 */
'use strict'

App.LayoutStore = (function () {
  const KEY = 'desktop.layout.v1'

  // 读布局：失败/无数据 → null（调用方回退自动排布）
  function load() {
    try {
      const raw = localStorage.getItem(KEY)
      if (!raw) return null
      const data = JSON.parse(raw)
      return (data && typeof data === 'object') ? data : null
    } catch (e) {
      return null
    }
  }

  // 写布局：成功 true，失败 false（调用方告警）
  function save(data) {
    try {
      localStorage.setItem(KEY, JSON.stringify(data))
      return true
    } catch (e) {
      return false
    }
  }

  return {
    load: load,
    save: save,
    KEY: KEY
  }
})()
