/* 剪贴板模块：内存态 { mode:'copy'|'cut', names:[] }（Windows 剪贴板模型，进程结束即失效）。
 * 复制/剪切只记录路径，文件不动；粘贴时才真正 copy / copy+delete。
 * 依赖: namespace.js
 * 导出: App.Clipboard
 */
'use strict'

App.Clipboard = (function () {
  let state = null   // { mode, names }

  function set(mode, names) {
    if (mode !== 'copy' && mode !== 'cut') return false
    state = { mode: mode, names: (names || []).slice() }
    return true
  }

  function get() { return state }
  function has() { return !!(state && state.names && state.names.length) }
  function clear() { state = null }

  // 剪切源标记查询：mode=cut 且名字在剪贴板内
  function isCut(name) {
    return !!(state && state.mode === 'cut' && state.names.indexOf(name) >= 0)
  }

  // 粘贴目标名规划：对每个源名算不冲突的目标名（重名自动加序号）。
  // items = 当前目录项 [{name,isDir}]；同一剪贴板内多个同名源依次加序号。
  // 返回 [{src, dst}]。纯函数，可单测。
  function planPaste(cb, items) {
    if (!cb || !cb.names || !cb.names.length) return []
    const taken = {}
    const typeOf = {}
    ;(items || []).forEach(function (it) {
      taken[it.name + '|' + (it.isDir ? 'd' : 'f')] = true
      typeOf[it.name] = it.isDir ? 'd' : 'f'
    })
    return cb.names.map(function (src) {
      // 源类型（文件/文件夹）决定序号规则；不在 items 里的源默认按文件
      const type = typeOf[src] || 'f'
      const dst = uniqueName(taken, src, type === 'd')
      taken[dst + '|' + type] = true
      return { src: src, dst: dst }
    })
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
