/* 文件打开分派器：按文件类型选择 InternalViewer（内部查看）或 ExternalIntent（外部应用）。
 * FileBridge 只做文件系统操作；Viewer 业务（类型判定 + 分派）集中在本模块。
 * InternalViewer 是独立通用组件（viewer.js），本模块不持有 Desktop 引用——
 * 锚点（desktop 空间世界坐标）由调用方传入，null = 沉浸式（folder 容器）。
 * 依赖: namespace.js, file-api.js, viewer.js, toast.js
 * 导出: App.FileOpener（kindFor 纯函数可单测）
 */
'use strict'

App.FileOpener = (function () {
  // 扩展名（小写）→ 内部查看器类型
  const KIND_EXTS = {
    text: ['txt', 'log', 'ini', 'conf', 'cfg', 'csv', 'bat', 'sh'],
    markdown: ['md', 'markdown'],
    json: ['json'],
    html: ['html', 'htm'],
    svg: ['svg'],
    image: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'],
    video: ['mp4', 'webm', 'mkv', 'mov', '3gp', 'm4v'],
    audio: ['mp3', 'm4a', 'wav', 'ogg', 'aac', 'flac', 'opus', 'mid', 'midi']
  }

  function extOf(name) {
    if (typeof name !== 'string') return ''
    const i = name.lastIndexOf('.')
    if (i <= 0 || i >= name.length - 1) return ''
    return name.slice(i + 1).toLowerCase()
  }

  // 扩展名 → kind（'external' = 交外部应用）
  function kindFor(name) {
    const ext = extOf(name)
    if (!ext) return 'external'
    const kinds = Object.keys(KIND_EXTS)
    for (let i = 0; i < kinds.length; i++) {
      if (KIND_EXTS[kinds[i]].indexOf(ext) >= 0) return kinds[i]
    }
    return 'external'
  }

  // 打开：item = { name, path }（path 为完整相对路径），anchor = 桌面空间世界坐标或 null
  // camera = 打开瞬间相机快照（canvas 实体锚点不可见时居中用）
  // 返回 true = 已分派（内部查看或外部打开）；false = 分派失败
  function open(item, anchor, camera) {
    if (!item || !item.path) return false
    const kind = kindFor(item.name || '')
    if (kind === 'external') {
      App.FileAPI.openExternal(item.path)
        .then(function () {
          if (App.toast && typeof App.toast.show === 'function') {
            App.toast.show('已交给其他应用打开: ' + item.name)
          }
        })
        .catch(function (err) {
          if (App.toast && typeof App.toast.show === 'function') {
            App.toast.show('无法打开: ' + (err && err.message || '没有可处理该文件的应用'))
          }
        })
      return true
    }
    if (App.InternalViewer && typeof App.InternalViewer.open === 'function') {
      App.InternalViewer.open({
        path: item.path,
        name: item.name,
        kind: kind,
        anchor: anchor || null,        // 非 null = 画布实体（桌面空间）；null = 全屏（folder 容器）
        camera: camera || null,
        onFallback: function () {   // 内部预览失败 → 交外部应用
          App.FileAPI.openExternal(item.path).catch(function () {})
        }
      })
      return true
    }
    return false
  }

  return {
    open: open,
    kindFor: kindFor,
    extOf: extOf
  }
})()
