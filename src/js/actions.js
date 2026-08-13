/* 文件系统动作（FAB / Drawer / 新建对话框共享）：
 * 新建文件夹/新建文件/刷新/切换根目录 + 阶段 C：重命名/复制/剪切/粘贴。
 * 复制/剪切只写剪贴板（内存态，Windows 模型），粘贴时才真正 copy / copy+delete。
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

  // ── 阶段 C：重命名（单选才可用，调用方校验）──
  function rename(oldName, newName) {
    if (!oldName || !newName || oldName === newName) return
    App.FileAPI.rename(oldName, newName)
      .then(function () {
        // 布局 key 迁移：positions/bounds 以名字为 key，改名后必须迁移，
        // 否则新名字刷新后回退自动排布（丢位置）。
        if (App.Desktop && typeof App.Desktop.applyRename === 'function') {
          App.Desktop.applyRename(oldName, newName)
        }
        App.toast.show('已重命名: ' + newName)
      })
      .catch(function (err) {
        App.toast.show('重命名失败: ' + err.message)
      })
  }

  // ── 阶段 C：复制（只写剪贴板，Windows 模型，文件不动）──
  function copySelection(names) {
    if (!names || !names.length) return
    if (App.Clipboard.set('copy', names)) {
      App.toast.show('已复制 ' + names.length + ' 项')
    } else {
      App.toast.show('复制失败')
    }
  }

  // ── 阶段 C：剪切（只写剪贴板 + 视觉标记，文件不动；粘贴时才 copy+delete）──
  function cutSelection(names) {
    if (!names || !names.length) return
    if (App.Clipboard.set('cut', names)) {
      App.toast.show('已剪切 ' + names.length + ' 项')
      App.Desktop.refresh()   // render 时对剪切源加半透明标记
    } else {
      App.toast.show('剪切失败')
    }
  }

  // ── 阶段 C：粘贴（目标名自动加序号；cut 模式 copy+delete 源）──
  function paste() {
    const cb = App.Clipboard.get()
    if (!cb || !cb.names || !cb.names.length) {
      App.toast.show('剪贴板为空')
      return
    }
    App.FileAPI.list('').then(function (items) {
      const plan = App.Clipboard.planPaste(cb, items)
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
        App.Desktop.refresh()
      }).catch(function (err) {
        App.toast.show('粘贴失败: ' + err.message + '（已成功 ' + copied + ' 项）')
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
    switchRoot: switchRoot,
    rename: rename,
    copySelection: copySelection,
    cutSelection: cutSelection,
    paste: paste
  }
})()
