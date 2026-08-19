/* 目录导航模块：当前目录 + 历史栈（后退/前进）纯函数，可单测。
 * 路径一律为相对根目录的完整路径（'' = 根目录，'docs/a.txt' = 子目录内文件）。
 * 依赖: namespace.js
 * 导出: App.DesktopNav
 */
// @ts-check
'use strict'

App.DesktopNav = (function () {
  // 历史栈：{ stack: ['', 'docs', 'docs/sub'], index: 1 }
  /** @returns {NavState} */
  function create() {
    return { stack: [''], index: 0 }
  }

  // 当前路径
  /** @param {NavState} nav @returns {string} */
  function current(nav) {
    return nav.stack[nav.index]
  }

  /** @param {NavState} nav @returns {boolean} */
  function canBack(nav) {
    return nav.index > 0
  }

  /** @param {NavState} nav @returns {boolean} */
  function canForward(nav) {
    return nav.index < nav.stack.length - 1
  }

  // 进入子目录：截断前进分支，压入新路径
  /** @param {NavState} nav @param {string} path @returns {NavState} */
  function enter(nav, path) {
    const stack = nav.stack.slice(0, nav.index + 1)
    stack.push(path)
    return { stack: stack, index: stack.length - 1 }
  }

  /** @param {NavState} nav @returns {NavState} */
  function back(nav) {
    if (!canBack(nav)) return nav
    return { stack: nav.stack, index: nav.index - 1 }
  }

  /** @param {NavState} nav @returns {NavState} */
  function forward(nav) {
    if (!canForward(nav)) return nav
    return { stack: nav.stack, index: nav.index + 1 }
  }

  // 路径拼接：join('', 'a.txt') = 'a.txt'; join('docs', 'a.txt') = 'docs/a.txt'
  /** @param {string} base @param {string} name @returns {string} */
  function join(base, name) {
    return base ? base + '/' + name : name
  }

  // 父路径：parent('docs/sub') = 'docs'; parent('a.txt') = ''
  /** @param {string} path @returns {string} */
  function parent(path) {
    if (!path) return ''
    const i = path.lastIndexOf('/')
    return i < 0 ? '' : path.slice(0, i)
  }

  // 末段名：basename('docs/a.txt') = 'a.txt'
  /** @param {string} path @returns {string} */
  function basename(path) {
    if (!path) return ''
    const i = path.lastIndexOf('/')
    return i < 0 ? path : path.slice(i + 1)
  }

  /** @type {DesktopNav} */
  return {
    create: create,
    current: current,
    canBack: canBack,
    canForward: canForward,
    enter: enter,
    back: back,
    forward: forward,
    join: join,
    parent: parent,
    basename: basename
  }
})()
