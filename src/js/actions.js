/* 文件系统动作（FAB / Drawer / 新建对话框共享）：
 * 新建文件夹/新建文件/刷新/切换根目录 + 阶段 C：重命名/复制/剪切/粘贴。
 * 复制/剪切只写剪贴板（内存态，Windows 模型），粘贴时才真正 copy / copy+delete。
 * 路径约定：全部使用完整相对路径（含当前目录前缀），FileAPI 桥天然匹配。
 * 依赖: namespace.js, file-api.js, clipboard.js, toast.js, desktop.js
 */
'use strict'

App.Actions = (function () {
  // 重名自动加序号：遍历目录找不冲突的名字。
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

  // 当前目录（Desktop 提供；无则根目录）
  function _curPath() {
    return (App.Desktop && typeof App.Desktop.getCurPath === 'function')
      ? App.Desktop.getCurPath() : ''
  }
  // 完整路径拼接（'' 根目录下直接返回短名）
  function _joinPath(name) {
    const base = _curPath()
    return base ? base + '/' + name : name
  }

  function createFolder(name) {
    App.FileAPI.list(_curPath()).then(function (items) {
      let finalName = _uniqueName(items, name || '新建文件夹', true)
      return App.FileAPI.mkdir(_joinPath(finalName)).then(function () { return finalName })
    }).then(function (finalName) {
      App.toast.show('已创建文件夹: ' + finalName)
      App.Desktop.refresh()
    }).catch(function (err) {
      App.toast.show('创建失败: ' + err.message)
    })
  }

  function createFile(name) {
    App.FileAPI.list(_curPath()).then(function (items) {
      // 名称原样使用（不自动补后缀）；空输入用默认名「新建文件」
      let finalName = _uniqueName(items, name || '新建文件', false)
      return App.FileAPI.write(_joinPath(finalName), '').then(function () { return finalName })
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

  // 设为默认摄像机视角（Drawer「设为默认视角」）：Home 无快照时的兜底视角。
  // 仅桌面空间有效（子文件夹容器相机是滚动态，Desktop.captureDefaultView 内部拒绝）
  function setDefaultView() {
    if (App.Desktop && typeof App.Desktop.captureDefaultView === 'function') {
      App.Desktop.captureDefaultView()
    } else {
      App.toast.show('默认视角设置失败')
    }
  }

  function switchRoot() {
    if (!App.bridge.requestRootAccess()) {
      App.toast.show('当前环境不支持切换根目录')
    }
  }

  // ── 阶段 C：重命名（单选才可用，调用方校验）──
  // oldPath/newPath 均为完整相对路径（选中集合以完整路径为 key，FileAPI 桥天然匹配）。
  // 重名预检：list 目标目录（oldPath 父目录，防跨目录调用检查错位置），
  // 存在同名项即拒绝——SAF renameTo 同名失败、私有模式 File.renameTo 同名行为
  // 平台相关（可能静默覆盖），两模式行为必须一致：先查后改。
  function rename(oldPath, newPath) {
    if (!oldPath || !newPath || oldPath === newPath) return
    const newName = newPath.indexOf('/') >= 0
      ? newPath.slice(newPath.lastIndexOf('/') + 1) : newPath
    const targetDir = oldPath.indexOf('/') >= 0
      ? oldPath.slice(0, oldPath.lastIndexOf('/')) : ''
    App.FileAPI.list(targetDir).then(function (items) {
      for (let i = 0; i < items.length; i++) {
        if (items[i].name === newName) {
          throw new Error('已存在同名项: ' + newName)
        }
      }
      return App.FileAPI.rename(oldPath, newPath)
    }).then(function () {
      // 布局 key 迁移：positions/bounds 以完整路径为 key，改名后必须迁移，
      // 否则新名字刷新后回退自动排布（丢位置）。
      if (App.Desktop && typeof App.Desktop.applyRename === 'function') {
        App.Desktop.applyRename(oldPath, newPath)
      }
      App.toast.show('已重命名: ' + newPath)
    }).catch(function (err) {
      App.toast.show('重命名失败: ' + err.message)
    })
  }

  // ── 阶段 C：复制（只写剪贴板，Windows 模型，文件不动）──
  // entries: [{path, isDir}]（完整路径 + 源类型，供跨目录粘贴）
  function copySelection(entries) {
    if (!entries || !entries.length) return
    if (App.Clipboard.set('copy', entries)) {
      App.toast.show('已复制 ' + entries.length + ' 项')
    } else {
      App.toast.show('复制失败')
    }
  }

  // ── 阶段 C：剪切（只写剪贴板 + 视觉标记，文件不动；粘贴时才 copy+delete）──
  function cutSelection(entries) {
    if (!entries || !entries.length) return
    if (App.Clipboard.set('cut', entries)) {
      App.toast.show('已剪切 ' + entries.length + ' 项')
      App.Desktop.refresh()   // render 时对剪切源加半透明标记
    } else {
      App.toast.show('剪切失败')
    }
  }

  // ── 阶段 C：粘贴（目标名自动加序号；cut 模式 copy+delete 源）──
  function paste() {
    const cb = App.Clipboard.get()
    if (!cb || !cb.entries || !cb.entries.length) {
      App.toast.show('剪贴板为空')
      return
    }
    App.FileAPI.list(_curPath()).then(function (items) {
      const plan = App.Clipboard.planPaste(cb, items, _curPath())
      if (!plan.length) return
      // 串行执行（写入路径失败必须告警，不吞错）
      let chain = Promise.resolve()
      let copied = 0
      plan.forEach(function (job) {
        chain = chain.then(function () {
          return App.FileAPI.copy(job.src, job.dst)
        }).then(function () {
          copied++
          // 剪切模式：粘贴成功后删除源（移动语义）
          if (cb.mode === 'cut') {
            return App.FileAPI.del(job.src)
          }
        })
      })
      return chain.then(function () {
        if (cb.mode === 'cut') App.Clipboard.clear()
        App.toast.show((cb.mode === 'cut' ? '已移动 ' : '已粘贴 ') + copied + ' 项')
        // Windows 原则：选中态脆弱——粘贴后源选中路径已失效（cut 源已删 / 目标已生成），
        // 清空选中 + 收起操作栏，避免「幽灵选中」残留
        App.Desktop.clearSelection()
        App.Desktop.refresh()
      }).catch(function (err) {
        App.toast.show('粘贴失败: ' + err.message + '（已成功 ' + copied + ' 项）')
        App.Desktop.clearSelection()
        App.Desktop.refresh()
      })
    }).catch(function (err) {
      App.toast.show('粘贴失败: ' + err.message)
    })
  }

  return {
    createFolder: createFolder,
    createFile: createFile,
    refresh: refresh,
    setDefaultView: setDefaultView,
    switchRoot: switchRoot,
    rename: rename,
    copySelection: copySelection,
    cutSelection: cutSelection,
    paste: paste
  }
})()
