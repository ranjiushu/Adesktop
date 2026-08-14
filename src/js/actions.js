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
  // 锁定文件（正在预览）拒绝重命名。
  function rename(oldPath, newPath) {
    if (!oldPath || !newPath || oldPath === newPath) return
    if (_isLocked(oldPath)) {
      App.toast.show('文件正在预览（锁定），不可重命名')
      return
    }
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
    if (_lockedEntry(entries)) {
      App.toast.show('文件正在预览（锁定），不可复制')
      return
    }
    if (App.Clipboard.set('copy', entries)) {
      App.toast.show('已复制 ' + entries.length + ' 项')
    } else {
      App.toast.show('复制失败')
    }
  }

  // ── 阶段 C：剪切（只写剪贴板 + 视觉标记，文件不动；粘贴时才 copy+delete）──
  function cutSelection(entries) {
    if (!entries || !entries.length) return
    if (_lockedEntry(entries)) {
      App.toast.show('文件正在预览（锁定），不可剪切')
      return
    }
    if (App.Clipboard.set('cut', entries)) {
      App.toast.show('已剪切 ' + entries.length + ' 项')
      App.Desktop.refresh()   // render 时对剪切源加半透明标记
    } else {
      App.toast.show('剪切失败')
    }
  }

  // 锁定检查：entries 中任一完整路径 = 锁定文件（含锁定目录内文件）→ 拒绝
  function _lockedEntry(entries) {
    const locked = App.Desktop && typeof App.Desktop.getLockedPath === 'function'
      ? App.Desktop.getLockedPath() : null
    if (!locked) return false
    for (let i = 0; i < entries.length; i++) {
      const p = entries[i].path
      if (p === locked) return true
      if (entries[i].isDir && locked.indexOf(p + '/') === 0) return true
    }
    return false
  }
  function _isLocked(path) {
    const locked = App.Desktop && typeof App.Desktop.getLockedPath === 'function'
      ? App.Desktop.getLockedPath() : null
    return !!locked && locked === path
  }

  // ── 阶段 C：粘贴（目标名自动加序号；cut 模式 copy+delete 源）──
  // 统一执行链：paste（当前目录）与 moveIntoFolder（指定文件夹）共用。
  // cb = {mode:'copy'|'cut', entries:[{path,isDir}]}；targetDir = 完整相对路径。
  // opts.keepClipboard = true 时（拖入文件夹）不清剪贴板（非用户剪贴板操作）。
  // 分阶段进度：两阶段分离执行——先全部复制，再删除源（移动语义）。
  //   - 阶段进度条：当前阶段内 done/total（复制 3/5 → 删除源 2/5）
  //   - 总进度条：跨阶段整体 done/(total*阶段数)
  // 两阶段分离的风险收益：复制阶段失败 → 源全部保留（可重试，不删源）；
  // 删除阶段失败 → 目标已生成、源未删（重复，告警提示，不丢数据）。
  function _transfer(cb, targetDir, opts) {
    opts = opts || {}
    App.FileAPI.list(targetDir).then(function (items) {
      const plan = App.Clipboard.planPaste(cb, items, targetDir)
      if (!plan.length) return
      const isMove = cb.mode === 'cut'
      const title = isMove ? '正在移动' : '正在粘贴'
      const totalSteps = plan.length * (isMove ? 2 : 1)
      if (App.Loading && typeof App.Loading.show === 'function') {
        App.Loading.show({
          title: title,
          phaseLabel: '复制',
          phaseDone: 0, phaseTotal: plan.length,
          totalLabel: '总进度',
          totalDone: 0, totalTotal: totalSteps
        })
      }
      // 阶段 1：全部复制（失败 → 源不删，可重试）
      let chain = Promise.resolve()
      let copied = 0
      plan.forEach(function (job) {
        chain = chain.then(function () {
          return App.FileAPI.copy(job.src, job.dst)
        }).then(function () {
          copied++
          if (App.Loading && typeof App.Loading.show === 'function') {
            App.Loading.show({
              title: title,
              phaseLabel: '复制',
              phaseDone: copied, phaseTotal: plan.length,
              totalLabel: '总进度',
              totalDone: copied, totalTotal: totalSteps
            })
          }
        })
      })
      // 阶段 2（仅移动）：删除源
      if (isMove) {
        chain = chain.then(function () {
          let deleted = 0
          let delChain = Promise.resolve()
          plan.forEach(function (job) {
            delChain = delChain.then(function () {
              return App.FileAPI.del(job.src)
            }).then(function () {
              deleted++
              if (App.Loading && typeof App.Loading.show === 'function') {
                App.Loading.show({
                  title: title,
                  phaseLabel: '删除源',
                  phaseDone: deleted, phaseTotal: plan.length,
                  totalLabel: '总进度',
                  totalDone: plan.length + deleted, totalTotal: totalSteps
                })
              }
            })
          })
          return delChain
        })
      }
      return chain.then(function () {
        if (isMove && !opts.keepClipboard) App.Clipboard.clear()
        if (App.Loading && typeof App.Loading.hide === 'function') {
          App.Loading.hide()
        }
        App.toast.show((isMove ? '已移动 ' : '已粘贴 ') + copied + ' 项')
        // Windows 原则：选中态脆弱——粘贴后源选中路径已失效（cut 源已删 / 目标已生成），
        // 清空选中 + 收起操作栏，避免「幽灵选中」残留
        App.Desktop.clearSelection()
        App.Desktop.refresh()
      }).catch(function (err) {
        if (App.Loading && typeof App.Loading.hide === 'function') {
          App.Loading.hide()
        }
        App.toast.show((isMove ? '移动' : '粘贴') + '失败: ' + err.message + '（已成功 ' + copied + ' 项）')
        App.Desktop.clearSelection()
        App.Desktop.refresh()
      })
    }).catch(function (err) {
      if (App.Loading && typeof App.Loading.hide === 'function') {
        App.Loading.hide()
      }
      App.toast.show((cb.mode === 'cut' ? '移动' : '粘贴') + '失败: ' + err.message)
    })
  }

  function paste() {
    const cb = App.Clipboard.get()
    if (!cb || !cb.entries || !cb.entries.length) {
      App.toast.show('剪贴板为空')
      return
    }
    _transfer(cb, _curPath())
  }

  // 拖入文件夹（桌面空间拖动命中文件夹松手）：移动语义（copy+del 源），
  // 目标目录 = 文件夹完整路径，不清用户剪贴板（非剪贴板操作）。
  function moveIntoFolder(entries, dirPath) {
    if (!entries || !entries.length || !dirPath) return
    _transfer({ mode: 'cut', entries: entries }, dirPath, { keepClipboard: true })
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
    paste: paste,
    moveIntoFolder: moveIntoFolder
  }
})()
