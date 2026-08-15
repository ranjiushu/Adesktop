/* 剪贴板模块：内存态 { mode:'copy'|'cut', entries:[{path,isDir}] }（Windows 剪贴板模型）。
 * 复制/剪切只记录完整相对路径，文件不动；粘贴时才真正 copy / copy+delete。
 * 依赖: namespace.js
 * 导出: App.Clipboard
 */
'use strict'

App.Clipboard = (function () {
  let state = null   // { mode, entries: [{path, isDir}] }

  // entries: [{path, isDir}]（path = 完整相对路径）
  function set(mode, entries) {
    if (mode !== 'copy' && mode !== 'cut') return false
    const arr = (entries || []).map(function (e) {
      return { path: e.path, isDir: !!e.isDir }
    })
    state = { mode: mode, entries: arr }
    return true
  }

  function get() { return state }
  function has() { return !!(state && state.entries && state.entries.length) }
  function clear() { state = null }

  // 剪切源标记查询：mode=cut 且路径在剪贴板内（render 时给图标加半透明）
  function isCut(path) {
    if (!state || state.mode !== 'cut') return false
    return state.entries.some(function (e) { return e.path === path })
  }

  // 粘贴目标名规划：对每个源算不冲突的目标名（重名自动加序号）。
  // items = 当前目录项 [{name,isDir}]；curPath = 当前目录（完整相对路径，''=根）。
  // 返回 [{src, dst}]（dst = 完整相对路径）。纯函数，可单测。
  function planPaste(cb, items, curPath) {
    if (!cb || !cb.entries || !cb.entries.length) return []
    const taken = {}
    ;(items || []).forEach(function (it) {
      taken[it.name + '|' + (it.isDir ? 'd' : 'f')] = true
    })
    return cb.entries.map(function (entry) {
      const base = basename(entry.path)
      const type = entry.isDir ? 'd' : 'f'
      const dstName = uniqueName(taken, base, entry.isDir)
      taken[dstName + '|' + type] = true
      return { src: entry.path, dst: joinPath(curPath, dstName) }
    })
  }

  // 取路径末段名：'docs/a.txt' → 'a.txt'
  function basename(p) {
    if (!p) return ''
    const i = p.lastIndexOf('/')
    return i < 0 ? p : p.slice(i + 1)
  }

  // 路径拼接：joinPath('', 'a.txt') = 'a.txt'; joinPath('docs', 'a.txt') = 'docs/a.txt'
  function joinPath(base, name) {
    return base ? base + '/' + name : name
  }

  // 重名自动加序号（文件拆主名/扩展名，文件夹直接加序号）
  function uniqueName(taken, base, isDir) {
    let stem = base
    let ext = ''
    if (!isDir && base.indexOf('.') > 0) {
      const i = base.lastIndexOf('.')
      stem = base.slice(0, i)
      ext = base.slice(i)
    }
    let name = base
    let seq = 2
    function exists(n) { return !!taken[n + '|' + (isDir ? 'd' : 'f')] }
    while (exists(name)) {
      name = stem + ' ' + seq + ext
      seq++
    }
    return name
  }

  return {
    set: set,
    get: get,
    has: has,
    clear: clear,
    isCut: isCut,
    planPaste: planPaste
  }
})()
