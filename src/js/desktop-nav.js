/* 目录导航模块：当前目录 + 历史栈（后退/前进）纯函数，可单测。
 * 路径一律为相对根目录的完整路径（'' = 根目录，'docs/a.txt' = 子目录内文件）。
 * 依赖: namespace.js
 * 导出: App.DesktopNav
 */
'use strict'

App.DesktopNav = (function () {
  // 历史栈：{ stack: ['', 'docs', 'docs/sub'], index: 1 }
  function create() {
    return { stack: [''], index: 0 }
  }

  // 当前路径
  function current(nav) {
    return nav.stack[nav.index]
  }

  function canBack(nav) {
    return nav.index > 0
  }

  function canForward(nav) {
    return nav.index < nav.stack.length - 1
  }

  // 进入子目录：截断前进分支，压入新路径
  function enter(nav, path) {
    const stack = nav.stack.slice(0, nav.index + 1)
    stack.push(path)
    return { stack: stack, index: stack.length - 1 }
  }

  function back(nav) {
    if (!canBack(nav)) return nav
    return { stack: nav.stack, index: nav.index - 1 }
  }

  function forward(nav) {
    if (!canForward(nav)) return nav
    return { stack: nav.stack, index: nav.index + 1 }
  }

  // 路径拼接：join('', 'a.txt') = 'a.txt'; join('docs', 'a.txt') = 'docs/a.txt'
  function join(base, name) {
    return base ? base + '/' + name : name
  }

  // 父路径：parent('docs/sub') = 'docs'; parent('a.txt') = ''
  function parent(path) {
    if (!path) return ''
    const i = path.lastIndexOf('/')
    return i < 0 ? '' : path.slice(0, i)
  }

  // 末段名：basename('docs/a.txt') = 'a.txt'
  function basename(path) {
    if (!path) return ''
    const i = path.lastIndexOf('/')
    return i < 0 ? path : path.slice(i + 1)
  }

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
