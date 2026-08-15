/* 文件夹视图排序模块：子文件夹（Folder 容器）的条目排序纯函数，可单测。
 * 规则（传统文件管理器语义）：
 *   1. 文件夹恒排在文件前（分组），组内再按 sortBy + sortDir 排序；
 *   2. name   — localeCompare('zh')，中文拼音序；
 *   3. mtime  — 修改时间戳差值（默认方向由调用方给 dir，传统上降序=新在前）；
 *   4. type   — 扩展名（无扩展名视为空串排前），同类型再按名称；
 *   5. size   — 字节数差值。
 * 依赖: namespace.js
 * 导出: App.FolderSort
 */
'use strict'

App.FolderSort = (function () {
  // 扩展名（含点后部分，小写）；无扩展名 → ''
  function typeKey(name) {
    if (typeof name !== 'string') return ''
    const i = name.lastIndexOf('.')
    return i > 0 ? name.slice(i + 1).toLowerCase() : ''
  }

  // 比较器：文件夹优先（与方向无关），组内按 sortBy 升序比较，再乘 dir
  function compare(a, b, sortBy, dir) {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    let r = 0
    switch (sortBy) {
      case 'mtime':
        r = (a.mtime || 0) - (b.mtime || 0)
        break
      case 'type': {
        const ta = typeKey(a.name)
        const tb = typeKey(b.name)
        r = ta.localeCompare(tb) || a.name.localeCompare(b.name, 'zh')
        break
      }
      case 'size':
        r = (a.size || 0) - (b.size || 0)
        break
      default: // 'name'
        r = a.name.localeCompare(b.name, 'zh')
    }
    return r * (dir || 1)
  }

  // 排序（返回新数组，不改原数组）
  function sort(items, sortBy, sortDir) {
    const list = (items || []).slice()
    list.sort(function (a, b) { return compare(a, b, sortBy, sortDir) })
    return list
  }

  // 切换排序项时使用的默认方向（日期传统上降序，其余升序）
  function defaultDir(sortBy) {
    return sortBy === 'mtime' ? -1 : 1
  }

  return {
    sort: sort,
    typeKey: typeKey,
    defaultDir: defaultDir
  }
})()
