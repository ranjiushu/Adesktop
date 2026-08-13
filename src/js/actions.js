/* 文件系统动作（FAB / Drawer / 新建对话框共享）：新建文件夹/新建文件/刷新/切换根目录 */
'use strict'

App.Actions = (function () {
  // 重名自动加序号：遍历根目录找不冲突的名字。
  // 文件拆分主名与扩展名（如「报告.txt」重名 → 「报告 2.txt」），
  // 文件夹直接加序号（「新建文件夹」→「新建文件夹 2」）。
  function _uniqueName(items, base, isDir) {
    let stem = base
    let ext = ''
    if (!isDir && base.indexOf('.') > 0) {
      let i = base.lastIndexOf('.')
      stem = base.slice(0, i)
      ext = base.slice(i)
    }
    let name = base
    let seq = 2
    function exists(n) {
      for (let i = 0; i < items.length; i++) {
        if (items[i].name === n && items[i].isDir === isDir) return true
      }
      return false
    }
    while (exists(name)) {
      name = stem + ' ' + seq + ext
      seq++
    }
    return name
  }

  function createFolder(name) {
    App.FileAPI.list('').then(function (items) {
      let finalName = _uniqueName(items, name || '新建文件夹', true)
      return App.FileAPI.mkdir(finalName).then(function () { return finalName })
    }).then(function (finalName) {
      App.toast.show('已创建文件夹: ' + finalName)
      App.Desktop.refresh()
    }).catch(function (err) {
      App.toast.show('创建失败: ' + err.message)
    })
  }

  function createFile(name) {
    App.FileAPI.list('').then(function (items) {
      // 名称原样使用（不自动补后缀）；空输入用默认名「新建文件」
      let finalName = _uniqueName(items, name || '新建文件', false)
      return App.FileAPI.write(finalName, '').then(function () { return finalName })
    }).then(function (finalName) {
      // toast 显示最终创建名（含重名序号），让用户确认名字无自动后缀
      App.toast.show('已创建文件: ' + finalName)
      App.Desktop.refresh()
    }).catch(function (err) {
      App.toast.show('创建失败: ' + err.message)
    })
  }

  function refresh() {
    App.Desktop.refresh()
    App.toast.show('已刷新')
  }

  function switchRoot() {
    if (!App.bridge.requestRootAccess()) {
      App.toast.show('当前环境不支持切换根目录')
    }
  }

  return {
    createFolder: createFolder,
    createFile: createFile,
    refresh: refresh,
    switchRoot: switchRoot
  }
})()
