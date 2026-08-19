/* 剪贴板模块：内存态 { mode:'copy'|'cut', entries:[{path,isDir}] }（Windows 剪贴板模型）。
 * 复制/剪切只记录完整相对路径，文件不动；粘贴时才真正 copy / copy+delete。
 * 依赖: namespace.js
 * 导出: App.Clipboard
 */
// @ts-check
'use strict'

App.Clipboard = (function () {
  /** @type {ClipboardState | null} */
  let state = null   // { mode, entries: [{path, isDir}] }

  // entries: [{path, isDir}]（path = 完整相对路径）
  /** @param {'copy' | 'cut'} mode @param {Array<{path: string, isDir?: boolean}>} entries @returns {boolean} */
  function set(mode, entries) {
    if (mode !== 'copy' && mode !== 'cut') return false
    const arr = (entries || []).map(function (e) {
      return { path: e.path, isDir: !!e.isDir }
    })
    state = { mode: mode, entries: arr }
    return true
  }

  /** @returns {ClipboardState | null} */
  function get() { return state }
  /** @returns {boolean} */
  function has() { return !!(state && state.entries && state.entries.length) }
  /** @returns {void} */
  function clear() { state = null }

  // 剪切源标记查询：mode=cut 且路径在剪贴板内（render 时给图标加半透明）
  /** @param {string} path @returns {boolean} */
  function isCut(path) {
    if (!state || state.mode !== 'cut') return false
    return state.entries.some(function (e) { return e.path === path })
  }

  // 粘贴目标名规划：对每个源算不冲突的目标名（重名自动加序号）。
  // items = 当前目录项 [{name,isDir}]；curPath = 当前目录（完整相对路径，''=根）。
  // 返回 [{src, dst}]（dst = 完整相对路径）。纯函数，可单测。
  // [P1] 占用键 = name 单键（真实文件系统「一名字一 entry」，不分文件/文件夹）：
  // 同目录「文件夹报告.txt + 文件报告.txt」不共存，粘贴时后者加序号。
  /** @param {ClipboardState | null} cb @param {Array<FileItem> | null} items @param {string} curPath @returns {Array<{src: string, dst: string}>} */
  function planPaste(cb, items, curPath) {
    if (!cb || !cb.entries || !cb.entries.length) return []
    const taken = (items || []).map(function (it) { return it.name })
    return cb.entries.map(function (entry) {
      const base = basename(entry.path)
      const dstName = uniqueName(taken, base, entry.isDir)
      taken.push(dstName)
      return { src: entry.path, dst: joinPath(curPath, dstName) }
    })
  }

  // 取路径末段名：'docs/a.txt' → 'a.txt'
  /** @param {string} [p] @returns {string} */
  function basename(p) {
    if (!p) return ''
    const i = p.lastIndexOf('/')
    return i < 0 ? p : p.slice(i + 1)
  }

  // 路径拼接：joinPath('', 'a.txt') = 'a.txt'; joinPath('docs', 'a.txt') = 'docs/a.txt'
  /** @param {string} base @param {string} name @returns {string} */
  function joinPath(base, name) {
    return base ? base + '/' + name : name
  }

  // 命名规划唯一入口（create / paste / delete 进回收站共用）：
  // 给定已占用名数组与期望名，返回不冲突的最终名（重名自动加序号）。
  // 文件拆主名/扩展名（「报告.txt」重名 → 「报告 2.txt」），文件夹直接加序号（「新建文件夹 2」）。
  // takenNames 为名称数组（不分类型）——调用方负责传入目标目录全部 entry 的 name。
  /** @param {Array<string> | null} takenNames @param {string} base @param {boolean} isDir @returns {string} */
  function uniqueName(takenNames, base, isDir) {
    let stem = base
    let ext = ''
    if (!isDir && base.indexOf('.') > 0) {
      const i = base.lastIndexOf('.')
      stem = base.slice(0, i)
      ext = base.slice(i)
    }
    let name = base
    let seq = 2
    /** @param {string} n @returns {boolean} */
    function exists(n) { return (takenNames || []).indexOf(n) >= 0 }
    while (exists(name)) {
      name = stem + ' ' + seq + ext
      seq++
    }
    return name
  }

  /** @type {Clipboard} */
  return {
    set: set,
    get: get,
    has: has,
    clear: clear,
    isCut: isCut,
    planPaste: planPaste,
    uniqueName: uniqueName
  }
})()
