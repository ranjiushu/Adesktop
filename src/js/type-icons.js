/* 类型图标系统：按文件名/目录判定类型 → 返回内联 SVG 图标（stroke currentColor）。
 * 纯函数，零依赖（仅 namespace）。类型颜色经 CSS class `.type-icon.type-{kind}` 控制。
 * 本模块只负责「类型图标」（缩略图 fallback 基线）；缩略图判定与获取在 thumbnail.js（ThumbnailService）。
 * 导出: App.TypeIcons
 */
'use strict'

App.TypeIcons = (function () {
  // 扩展名（小写）→ 类型 key
  const EXT_KINDS = {
    text: ['txt', 'log', 'ini', 'conf', 'cfg', 'bat', 'sh', 'yml', 'yaml', 'toml', 'csv', 'tsv', 'text', 'nfo', 'readme'],
    markdown: ['md', 'markdown', 'mdown', 'mkd'],
    json: ['json', 'jsonc', 'json5'],
    html: ['html', 'htm', 'xhtml'],
    code: ['js', 'ts', 'jsx', 'tsx', 'mjs', 'cjs', 'py', 'java', 'c', 'cpp', 'h', 'hpp', 'go', 'rs', 'kt', 'swift', 'php', 'rb', 'css', 'scss', 'less', 'sass', 'sql', 'vue', 'svelte', 'xml', 'pl', 'lua', 'r', 'dart', 'zig'],
    image: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'ico', 'svg', 'heic', 'heif', 'avif'],
    video: ['mp4', 'webm', 'mkv', 'mov', '3gp', 'm4v', 'avi', 'flv', 'mpg', 'mpeg', 'wmv'],
    audio: ['mp3', 'm4a', 'wav', 'ogg', 'aac', 'flac', 'opus', 'mid', 'midi', 'wma', 'amr'],
    archive: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz', 'iso'],
    pdf: ['pdf'],
    word: ['doc', 'docx', 'odt', 'rtf'],
    excel: ['xls', 'xlsx', 'ods'],
    ppt: ['ppt', 'pptx', 'odp', 'key'],
    font: ['ttf', 'otf', 'woff', 'woff2', 'eot'],
    executable: ['apk', 'exe', 'deb', 'msi', 'dmg', 'bin', 'jar']
  }

  // 类型 → 形态（同一形态 + 不同颜色可区分相近类型，如 text/md/json/pdf 共用 fileText）
  const KIND_SHAPE = {
    folder: 'folder',
    trash: 'trash',
    text: 'fileText',
    markdown: 'fileText',
    json: 'fileText',
    html: 'code',
    code: 'code',
    image: 'image',
    video: 'film',
    audio: 'music',
    archive: 'archive',
    pdf: 'fileText',
    word: 'fileText',
    excel: 'fileText',
    ppt: 'fileText',
    font: 'type',
    executable: 'terminal',
    unknown: 'file'
  }

  // Feather 风格 SVG 内部内容（24x24 stroke），统一 stroke=currentColor
  const SHAPES = {
    folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
    trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
    file: '<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/>',
    fileText: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>',
    code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
    film: '<rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/>',
    music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    archive: '<polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/>',
    terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>',
    type: '<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/>'
  }

  function extOf(name) {
    if (typeof name !== 'string') return ''
    const i = name.lastIndexOf('.')
    if (i <= 0 || i >= name.length - 1) return ''
    return name.slice(i + 1).toLowerCase()
  }

  // 文件名/目录 → 类型 key（folder / 各文件类型 / unknown）
  function kindFor(name, isDir) {
    if (isDir) return 'folder'
    const ext = extOf(name)
    if (!ext) return 'unknown'
    const kinds = Object.keys(EXT_KINDS)
    for (let i = 0; i < kinds.length; i++) {
      if (EXT_KINDS[kinds[i]].indexOf(ext) >= 0) return kinds[i]
    }
    return 'unknown'
  }

  // 类型 → 内联 SVG 字符串（含 type-{kind} class，颜色由 CSS 控制）
  function svgFor(kind) {
    const shape = KIND_SHAPE[kind] || 'file'
    const inner = SHAPES[shape] || SHAPES.file
    return '<svg class="type-icon type-' + (kind || 'unknown') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>'
  }

  return {
    kindFor: kindFor,
    svgFor: svgFor,
    extOf: extOf
  }
})()
