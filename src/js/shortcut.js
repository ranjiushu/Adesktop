/* Shortcut File 契约层：真实文件（JSON）→ 快捷方式语义。
 * 统一「快捷方式文件」概念：.desktop 扩展名 + JSON 内容，type 字段区分子类。
 *   - application：引用已安装应用（package），双击经 PackageManager 拉起（本期实现）
 *   - website：引用网址（url），双击在画布内以 iframe 打开（本期实现）
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
    if (type === 'website') {
      if (!obj.url || typeof obj.url !== 'string' || !obj.url.trim()) {
        throw new Error('网站快捷方式缺少网址')
      }
      return {
        type: 'website',
        version: typeof obj.version === 'number' ? obj.version : 1,
        url: obj.url.trim(),
        label: typeof obj.label === 'string' && obj.label ? obj.label : obj.url.trim(),
        trusted: !!obj.trusted
      }
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

  // 构建 Website Shortcut 的 JSON 文本（写入文件用）。
  // trusted=true 时内嵌标记（网站以 allow-same-origin 完整加载，可读写授权目录——用户显式信任）。
  function buildWebsiteShortcut(site) {
    const obj = {
      type: 'website',
      version: SCHEMA_VERSION,
      url: site.url,
      label: site.label || site.url
    }
    if (site.trusted) obj.trusted = true
    return JSON.stringify(obj)
  }

  // 网址规范化：无协议（http:// https:// 等）时补 https://；已有协议原样保留。
  // 空 / 非字符串 → 空串（调用方据此拒绝创建）。
  function normalizeUrl(input) {
    if (typeof input !== 'string') return ''
    const s = input.trim()
    if (!s) return ''
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s
    return 'https://' + s
  }

  // 网址 → 主机名（含端口，不含协议/路径/查询）：https://example.com/a → example.com。
  // 无法解析（无协议）时原样返回 trim 值（供文件名兜底）。
  function hostOf(url) {
    if (typeof url !== 'string') return ''
    const s = url.trim()
    if (!s) return ''
    const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(s)
    return m ? m[1] : s
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
    buildWebsiteShortcut: buildWebsiteShortcut,
    normalizeUrl: normalizeUrl,
    hostOf: hostOf,
    sanitizeFileName: sanitizeFileName
  }
})()
