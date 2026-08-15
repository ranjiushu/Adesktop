/* Shortcut File 契约层：真实文件（JSON）→ 快捷方式语义。
 * 统一「快捷方式文件」概念：.desktop 扩展名 + JSON 内容，type 字段区分子类。
 *   - application：引用已安装应用（package），双击经 PackageManager 拉起（本期实现）
 *   - file：引用外部文件（持久化 SAF URI），跨目录引用（预留，本期不实现）
 * 纯函数零 DOM，可单测；依赖仅 namespace.js。
 * 导出: App.Shortcut
 */
'use strict'

App.Shortcut = (function () {
  const EXT = 'desktop'          // 快捷方式文件扩展名（不含点）
  const SCHEMA_VERSION = 1

  function extOf(name) {
    if (typeof name !== 'string') return ''
    const i = name.lastIndexOf('.')
    if (i <= 0 || i >= name.length - 1) return ''
    return name.slice(i + 1).toLowerCase()
  }

  // 文件名是否为快捷方式（.desktop 后缀，大小写不敏感）
  function isShortcutName(name) {
    return extOf(name) === EXT
  }

  // 解析快捷方式 JSON 内容 → 规范化元信息；非法/缺字段抛错（调用方 toast）。
  function parseShortcut(content) {
    let obj
    try {
      obj = JSON.parse(content)
    } catch (e) {
      throw new Error('快捷方式内容不是有效 JSON')
    }
    if (!obj || typeof obj !== 'object') throw new Error('快捷方式内容无效')
    const type = obj.type
    if (type === 'application') {
      if (!obj.package || typeof obj.package !== 'string' || !obj.package.trim()) {
        throw new Error('应用快捷方式缺少包名')
      }
      return {
        type: 'application',
        version: typeof obj.version === 'number' ? obj.version : 1,
        package: obj.package.trim(),
        label: typeof obj.label === 'string' && obj.label ? obj.label : obj.package,
        isSystem: !!obj.isSystem,
        icon: typeof obj.icon === 'string' && obj.icon ? obj.icon : null
      }
    }
    if (type === 'file') {
      // File Shortcut 预留：schema 已兼容（避免二次改契约），本期不实现打开
      return { type: 'file', version: 1, label: obj.label || '', uri: obj.uri || '' }
    }
    throw new Error('未知的快捷方式类型: ' + (type || '（缺失）'))
  }

  // 构建 Application Shortcut 的 JSON 文本（写入文件用）。
  // icon 可选（base64 data URI）：内嵌后快捷方式自包含，可随文件迁移。
  function buildAppShortcut(app) {
    const obj = {
      type: 'application',
      version: SCHEMA_VERSION,
      package: app.package,
      label: app.label || app.package,
      isSystem: !!app.isSystem
    }
    if (app.icon && typeof app.icon === 'string') obj.icon = app.icon
    return JSON.stringify(obj)
  }

  // 标签 → 安全文件名主名（剥离路径分隔符/非法字符/控制字符/首尾点/折叠空白）。
  // 返回不含扩展名的主名；空结果回退 fallback（通常是 package）。
  function sanitizeFileName(label, fallback) {
    let s = (typeof label === 'string' && label.trim()) ? label : ''
    // 剥离路径分隔符与 Windows/Android 非法字符 + 控制字符
    s = s.replace(/[\/\\:*?"<>|\u0000-\u001f\u007f]/g, ' ')
    // 折叠连续空白
    s = s.replace(/\s+/g, ' ').trim()
    // 去首尾点（SAF/文件系统对 .name 敏感）
    s = s.replace(/^\.+/, '').replace(/\.+$/, '')
    s = s.trim()
    if (!s) s = (typeof fallback === 'string' && fallback.trim()) ? fallback : '未命名'
    return s
  }

  return {
    EXT: EXT,
    SCHEMA_VERSION: SCHEMA_VERSION,
    extOf: extOf,
    isShortcutName: isShortcutName,
    parseShortcut: parseShortcut,
    buildAppShortcut: buildAppShortcut,
    sanitizeFileName: sanitizeFileName
  }
})()
