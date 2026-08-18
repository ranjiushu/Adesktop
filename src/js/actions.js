/* 文件系统动作（FAB / Drawer / 新建对话框共享）：
 * 新建文件夹/新建文件/刷新/授权手机存储（全盘访问引导） + 阶段 C：重命名/复制/剪切/粘贴。
 * 复制/剪切只写剪贴板（内存态，Windows 模型），粘贴时才真正 copy / move（cut）。
 * 移动 = 真移动优先（FileBridge.move：私有 File.renameTo / SAF moveDocument），失败降级 copy+del。
 * 路径约定：全部使用完整相对路径（含当前目录前缀），FileAPI 桥天然匹配。
 * 依赖: namespace.js, file-api.js, clipboard.js, toast.js, desktop.js
 */
// @ts-check
'use strict'

App.Actions = (function () {
  // 命名规划唯一入口（重名自动加序号，文件拆主名/扩展名，文件夹直接加序号）：
  // 收敛自 clipboard.js——create / paste / delete 进回收站共用同一规则（见 operation-contract.md 1.2）。
  // items = 当前目录项 [{name,isDir}]；占用键为 name 单键（真实 FS「一名字一 entry」）。
  /** @param {Array<FileItem>} items @param {string} base @param {boolean} isDir @returns {string} */
  function _finalName(items, base, isDir) {
    return App.Clipboard.uniqueName(
      (items || []).map(function (it) { return it.name }), base, isDir)
  }

  // 当前目录（Desktop 提供；无则根目录）
  /** @returns {string} */
  function _curPath() {
    return (App.Desktop && typeof App.Desktop.getCurPath === 'function')
      ? App.Desktop.getCurPath() : ''
  }
  // 完整路径拼接（'' 根目录下直接返回短名）
  /** @param {string} name @returns {string} */
  function _joinPath(name) {
    const base = _curPath()
    return base ? base + '/' + name : name
  }

  /** @param {string} name @returns {void} */
  function createFolder(name) {
    App.FileAPI.list(_curPath()).then(function (items) {
      let finalName = _finalName(items, name || '新建文件夹', true)
      return App.FileAPI.mkdir(_joinPath(finalName)).then(function () { return finalName })
    }).then(function (finalName) {
      App.toast.show('已创建文件夹: ' + finalName)
      App.Desktop.refresh()
    }).catch(function (err) {
      App.toast.show('创建失败: ' + err.message)
    })
  }

  /** @param {string} name @returns {void} */
  function createFile(name) {
    App.FileAPI.list(_curPath()).then(function (items) {
      // 名称原样使用（不自动补后缀）；空输入用默认名「新建文件」
      let finalName = _finalName(items, name || '新建文件', false)
      return App.FileAPI.write(_joinPath(finalName), '').then(function () { return finalName })
    }).then(function (finalName) {
      // toast 显示最终创建名（含重名序号），让用户确认名字无自动后缀
      App.toast.show('已创建文件: ' + finalName)
      App.Desktop.refresh()
    }).catch(function (err) {
      App.toast.show('创建失败: ' + err.message)
    })
  }

  /** @returns {void} */
  function refresh() {
    App.Desktop.refresh()
    App.toast.show('已刷新')
  }

  // ── 整理桌面（Morph FAB「整理桌面」）：按名称/类型排序到 Home 视角的完整可见网格。
  //    锚点 = Home 快照相机（无快照 → 出厂 (0,0,1)）——整理结果落在 Home 可见区域，
  //    整理后相机复位到锚点（用户立即看到全部图标，不会「整理完不知道跑哪去了」）。
  //    竖屏列优先（从上到下排满一列再下一列）；横屏行优先（从左到右排满一行再下一行）。
  //    虚拟回收站（isDir）参与排序（文件夹组最前）。仅桌面空间可用。
  /** @returns {void} */
  function organizeDesktop() {
    if (App.Desktop && typeof App.Desktop.isFolderView === 'function' && App.Desktop.isFolderView()) {
      App.toast.show('整理桌面仅桌面空间可用')
      return
    }
    const C = App.DesktopCore
    if (!C || !C.state || !C.state.items || !App.DesktopOrganize) return
    const rot = C.camera && C.camera.rotation === 90 ? 90 : 0
    // 整理锚点：Home 快照（按当前画布方向取槽位）> 出厂 (0,0,1)
    const home = App.HomeStore && typeof App.HomeStore.load === 'function'
      ? App.HomeStore.load(C.state.rootId, rot) : null
    const anchor = App.DesktopOrganize.anchorFromHome(home, rot)
    const entries = C.state.items.map(function (it) {
      return { name: it.name, isDir: it.isDir }
    })
    const placed = App.DesktopOrganize.organize(
      entries, C.viewportWidth(), C.viewportHeight(), anchor)
    placed.forEach(function (p) {
      // key：虚拟回收站 = trashName（桥层根固定串）；其余 = 完整相对路径
      const key = (p.name === C.state.trashName && C.state.mode === 'all-files' && !C.isFolderView())
        ? C.state.trashName : C.fullPath(p.name)
      C.positions[key] = { x: p.x, y: p.y }
      const node = C.iconEls[key]
      if (node) {
        node.style.left = p.x + 'px'
        node.style.top = p.y + 'px'
      }
    })
    // 相机复位到整理锚点（保存/刷新后用户立即可见整理结果）
    C.camera = App.DesktopCamera.create(anchor.x, anchor.y, anchor.zoom, anchor.rotation)
    C.rootCamera = C.camera
    if (App.DesktopPersist && typeof App.DesktopPersist.saveLayout === 'function') {
      App.DesktopPersist.saveLayout()
    }
    App.Desktop.refresh()
    App.toast.show('已整理桌面')
  }

  // 设为默认摄像机视角（Drawer「设为默认视角」）：Home 无快照时的兜底视角。
  // 仅桌面空间有效（子文件夹容器相机是滚动态，Desktop.captureDefaultView 内部拒绝）
  /** @returns {void} */
  function setDefaultView() {
    if (App.Desktop && typeof App.Desktop.captureDefaultView === 'function') {
      App.Desktop.captureDefaultView()
    } else {
      App.toast.show('默认视角设置失败')
    }
  }

  /** @returns {void} */
  function switchRoot() {
    if (!App.bridge.requestRootAccess()) {
      App.toast.show('当前环境不支持切换根目录')
    }
  }

  // ── 阶段 C：重命名（单选才可用，调用方校验）──
  // oldPath = 完整相对路径；newName = 纯文件名（重命名限同目录，领域语义见
  //   docs/operation-contract.md 2.2；跨目录 = move，走 _transfer 管道，不走 rename）。
  // 重名预检：list 目标目录（oldPath 父目录，防跨目录调用检查错位置），
  // 存在同名项即拒绝——SAF renameTo 同名失败、私有模式 File.renameTo 同名行为
  // 平台相关（可能静默覆盖），两模式行为必须一致：先查后改。
  // 锁定文件（正在预览）拒绝重命名。
  /** @param {string} oldPath @param {string} newName @returns {void} */
  function rename(oldPath, newName) {
    if (!oldPath || !newName || oldPath === newName) return
    // 重命名限同目录（领域语义）：newName 必须为纯文件名，不得含路径分隔符。
    // 跨目录 = move 管道（_transfer），不走 rename——桥层同样拦截（两后端一致，见
    // docs/operation-contract.md 2.2）。防路径注入：'sub/b.txt' 这类输入直接拒绝。
    if (newName.indexOf('/') >= 0) {
      App.toast.show('重命名失败: 名称不能包含路径分隔符')
      return
    }
    if (_isLocked(oldPath)) {
      App.toast.show('文件正在预览（锁定），不可重命名')
      return
    }
    const targetDir = oldPath.indexOf('/') >= 0
      ? oldPath.slice(0, oldPath.lastIndexOf('/')) : ''
    const newPath = targetDir ? targetDir + '/' + newName : newName
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
  /** @param {Array<ClipboardEntry>} entries @returns {void} */
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

  // ── 阶段 C：剪切（只写剪贴板 + 视觉标记，文件不动；粘贴时才真正移动）──
  /** @param {Array<ClipboardEntry>} entries @returns {void} */
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
  /** @param {Array<ClipboardEntry>} entries @returns {boolean} */
  function _lockedEntry(entries) {
    const locked = App.Desktop && typeof App.Desktop.getLockedPaths === 'function'
      ? App.Desktop.getLockedPaths() : []
    if (!locked || !locked.length) return false
    for (let i = 0; i < entries.length; i++) {
      const p = entries[i].path
      for (let j = 0; j < locked.length; j++) {
        if (p === locked[j]) return true
        if (entries[i].isDir && locked[j].indexOf(p + '/') === 0) return true
      }
    }
    return false
  }
  /** @param {string} path @returns {boolean} */
  function _isLocked(path) {
    const locked = App.Desktop && typeof App.Desktop.getLockedPaths === 'function'
      ? App.Desktop.getLockedPaths() : []
    return locked.indexOf(path) >= 0
  }

  // ── 阶段 C：粘贴（目标名自动加序号；cut 模式 = 真移动，桥层降级 copy+delete）──
  // 统一执行链：paste（当前目录）与 moveIntoFolder（指定文件夹）共用。
  // cb = {mode:'copy'|'cut', entries:[{path,isDir}]}；targetDir = 完整相对路径。
  // opts.keepClipboard = true 时（拖入文件夹）不清剪贴板（非用户剪贴板操作）。
  // 移动语义（cut）：逐项调桥 move（FileBridge 真移动优先——私有模式 File.renameTo
  //   原子移动 / SAF 模式 DocumentsContract.moveDocument，失败自动降级 copy+delete）。
  //   风险收益：真移动失败 → 该项整体不动（可重试）；降级复制成功但删源失败 →
  //   目标已生成、源未删（重复，告警提示，不丢数据）。
  // 进度/取消：copy/move 传 onProgress（桥层 __fbProgress 字节级进度，节流约 200ms），
  //   刷新 Loading 当前文件行；cancellable 时显示取消按钮（请求桥层取消 + 清理半成品）。
  // 失败汇总：逐项结果收集，失败不中断，结束后失败项 >0 弹列表（成功 N / 失败 M + 原因）。
  // 移动后布局 key 迁移：positions/bounds 以完整路径为 key，不迁移刷新后丢位置。
  /** @param {ClipboardState} cb @param {string} targetDir @param {{emptyText?: string, title?: string, doneText?: string, failText?: string, keepClipboard?: boolean}} [opts] @returns {void} */
  function _transfer(cb, targetDir, opts) {
    opts = opts || {}
    App.FileAPI.list(targetDir).then(function (items) {
      const plan = App.Clipboard.planPaste(cb, items, targetDir)
      if (!plan.length) {
        // 剪贴板条目缺失（源已被删/移动）→ 明确告警，不静默
        App.toast.show((opts.emptyText || '源文件已不存在，操作已取消'))
        return
      }
      const isMove = cb.mode === 'cut'
      const title = opts.title || (isMove ? '正在移动' : '正在粘贴')
      const totalSteps = plan.length
      /** @type {Array<{name: string, ok: boolean, error: string | null}>} */
      let results = []      // 逐项结果 [{name, ok, error}]（失败汇总）
      let done = 0
      /** @type {Array<{src: string, dst: string}>} */
      let moved = []      // 成功移动项 [{src, dst}] → 布局 key 迁移
      let cancelSent = false
      let cancelled = false      // 已请求取消：剩余项不再启动（P0 修复）
      /** @type {Array<string>} */
      let cancelledItems = []    // 被取消项（未启动 + 传输中被中止），取消 ≠ 失败
      // 取消请求（防抖）：置 cancelled → 剩余项不再调度；通知桥层中止当前任务并清理半成品。
      // 桥层单线程 executor 内 cancelTransfer 直接置 volatile 标志，可打断当前传输。
      /** @returns {void} */
      function requestCancel() {
        if (cancelSent) return
        cancelSent = true
        cancelled = true
        if (App.FileAPI && typeof App.FileAPI.cancelTransfer === 'function') {
          App.FileAPI.cancelTransfer()
        }
      }
      // 进度回调：桥层字节级进度 → Loading 当前文件行
      /** @param {{src: string, dst: string}} job @returns {(p: FbProgress) => void} */
      function makeOnProgress(job) {
        return function (p) {
          if (!p || !p.path) return
          if (App.Loading && typeof App.Loading.show === 'function') {
            App.Loading.show({
              title: title,
              phaseLabel: isMove ? '移动' : '复制',
              phaseDone: done, phaseTotal: plan.length,
              totalLabel: '总进度',
              totalDone: done, totalTotal: totalSteps,
              current: { name: p.path, done: p.done, total: p.total },
              cancellable: true,
              onCancel: requestCancel
            })
          }
        }
      }
      if (App.Loading && typeof App.Loading.show === 'function') {
        App.Loading.show({
          title: title,
          phaseLabel: isMove ? '移动' : '复制',
          phaseDone: 0, phaseTotal: plan.length,
          totalLabel: '总进度',
          totalDone: 0, totalTotal: totalSteps,
          cancellable: true,
          onCancel: requestCancel
        })
      }
      // 逐项执行：copy 模式 = 桥 copy；cut 模式 = 桥 move（真移动优先，失败降级 copy+del）
      // 失败不中断（逐项收集），全部结束后统一汇总
      // [P0] 取消后剩余项不再启动：cancelled 置位后跳过未开始的 job（计入取消项而非失败）
      let chain = Promise.resolve()
      plan.forEach(function (job) {
        chain = chain.then(function () {
          if (cancelled) {
            cancelledItems.push(job.dst)
            return
          }
          const op = isMove
            ? App.FileAPI.move(job.src, job.dst, makeOnProgress(job))
            : App.FileAPI.copy(job.src, job.dst, makeOnProgress(job))
          return op.then(function () {
            done++
            results.push({ name: job.dst, ok: true, error: null })
            if (isMove) moved.push({ src: job.src, dst: job.dst })
            if (App.Loading && typeof App.Loading.show === 'function') {
              App.Loading.show({
                title: title,
                phaseLabel: isMove ? '移动' : '复制',
                phaseDone: done, phaseTotal: plan.length,
                totalLabel: '总进度',
                totalDone: done, totalTotal: totalSteps,
                cancellable: true,
                onCancel: requestCancel
              })
            }
          }).catch(function (err) {
            done++
            if (cancelled) {
              // 取消导致当前任务中止（桥层抛「操作已取消」）：计入取消项，不算失败
              cancelledItems.push(job.dst)
              return
            }
            results.push({ name: job.dst, ok: false, error: err && err.message || String(err) })
            // 失败不中断：继续下一项
          })
        })
      })
      return chain.then(function () {
        const okCount = results.filter(function (r) { return r.ok }).length
        const failList = results.filter(function (r) { return !r.ok })
        if (isMove && moved.length &&
            App.Desktop && typeof App.Desktop.applyMoves === 'function') {
          App.Desktop.applyMoves(moved)
        }
        if (isMove && !opts.keepClipboard) App.Clipboard.clear()
        if (App.Loading && typeof App.Loading.hide === 'function') {
          App.Loading.hide()
        }
        if (cancelledItems.length) {
          // 取消结束态：取消不是失败——报「已取消 N 项」，不弹失败列表
          App.toast.show((opts.doneText || (isMove ? '已移动 ' : '已粘贴 ')) + okCount +
            ' 项，已取消 ' + cancelledItems.length + ' 项')
        } else if (failList.length) {
          // 失败汇总：先 toast 概览，再弹列表（成功 N / 失败 M + 原因）
          App.toast.show((opts.doneText || (isMove ? '已移动 ' : '已粘贴 ')) + okCount + ' 项，失败 ' + failList.length + ' 项')
          _showFailSummary(failList)
        } else {
          App.toast.show((opts.doneText || (isMove ? '已移动 ' : '已粘贴 ')) + okCount + ' 项')
        }
        // Windows 原则：选中态脆弱——粘贴后源选中路径已失效（cut 源已删 / 目标已生成），
        // 清空选中 + 收起操作栏，避免「幽灵选中」残留
        App.Desktop.clearSelection()
        App.Desktop.refresh()
      }).catch(function (err) {
        if (App.Loading && typeof App.Loading.hide === 'function') {
          App.Loading.hide()
        }
        App.toast.show((opts.failText || (isMove ? '移动' : '粘贴')) + '失败: ' + err.message + '（已成功 ' + done + ' 项）')
        App.Desktop.clearSelection()
        App.Desktop.refresh()
      })
    }).catch(function (err) {
      if (App.Loading && typeof App.Loading.hide === 'function') {
        App.Loading.hide()
      }
      App.toast.show((opts.failText || (cb.mode === 'cut' ? '移动' : '粘贴')) + '失败: ' + err.message)
    })
  }

  // 批量操作失败汇总弹窗：列出失败项（名称 + 原因），「知道了」关闭。
  // 复用 dialog-overlay 结构，仅一次绑定确定按钮。
  let _failSummaryBound = false
  /** @param {Array<{name: string, ok: boolean, error: string | null}>} failList @returns {void} */
  function _showFailSummary(failList) {
    if (!failList || !failList.length) return
    const overlay = document.getElementById('transfer-fail-overlay')
    if (!overlay) return
    const listEl = document.getElementById('transfer-fail-list')
    if (listEl) {
      listEl.innerHTML = ''
      failList.forEach(function (f) {
        const li = document.createElement('li')
        const name = document.createElement('span')
        name.className = 'fail-name'
        name.textContent = f.name
        const reason = document.createElement('span')
        reason.className = 'fail-reason'
        reason.textContent = f.error || '未知错误'
        li.appendChild(name)
        li.appendChild(reason)
        listEl.appendChild(li)
      })
    }
    const summary = document.getElementById('transfer-fail-summary')
    if (summary) summary.textContent = '共失败 ' + failList.length + ' 项'
    if (!_failSummaryBound && App.utils && typeof App.utils.bindPress === 'function') {
      const okBtn = document.getElementById('transfer-fail-ok')
      if (okBtn) {
        App.utils.bindPress(okBtn, function () { App.Dialog.close('transfer-fail-overlay') })
        _failSummaryBound = true
      }
    }
    if (App.Dialog && typeof App.Dialog.open === 'function') {
      App.Dialog.open('transfer-fail-overlay')
    }
  }

  // ── 阶段 C+：删除 = 移入回收站（安全删除，不做彻底删除）──
  // entries: [{path, isDir}]（完整路径）；目标 = 根目录回收站（Desktop.getTrashName）。
  // 复用移动管道（真移动优先，桥层降级 copy+del），重名自动加序号、失败保留源（安全）。
  // 守卫：回收站自身不可删；锁定文件（正在预览）不可删；无回收站名（未授权）拒绝。
  /** @param {Array<ClipboardEntry>} entries @returns {void} */
  function deleteSelection(entries) {
    if (!entries || !entries.length) return
    const trashName = App.Desktop && typeof App.Desktop.getTrashName === 'function'
      ? App.Desktop.getTrashName() : ''
    if (!trashName) {
      App.toast.show('回收站不可用（未授权根目录）')
      return
    }
    const safe = entries.filter(function (e) {
      return !(App.Desktop && typeof App.Desktop.isTrashPath === 'function' && App.Desktop.isTrashPath(e.path))
    })
    if (!safe.length) {
      App.toast.show('回收站不可删除')
      return
    }
    if (_lockedEntry(safe)) {
      App.toast.show('文件正在预览（锁定），不可删除')
      return
    }
    _transfer({ mode: 'cut', entries: safe }, trashName, {
      keepClipboard: true,
      title: '正在删除',
      doneText: '已删除 ',
      failText: '删除'
    })
  }

  /** @returns {void} */
  function paste() {
    const cb = App.Clipboard.get()
    if (!cb || !cb.entries || !cb.entries.length) {
      App.toast.show('剪贴板为空')
      return
    }
    _transfer(cb, _curPath())
  }

  // 拖入文件夹（桌面空间拖动命中文件夹松手）：移动语义（真移动，桥层降级 copy+del 源），
  // 目标目录 = 文件夹完整路径，不清用户剪贴板（非剪贴板操作）。
  /** @param {Array<ClipboardEntry>} entries @param {string} dirPath @returns {void} */
  function moveIntoFolder(entries, dirPath) {
    if (!entries || !entries.length || !dirPath) return
    _transfer({ mode: 'cut', entries: entries }, dirPath, { keepClipboard: true })
  }

  /** @type {Actions} */
  return {
    createFolder: createFolder,
    createFile: createFile,
    refresh: refresh,
    organizeDesktop: organizeDesktop,
    setDefaultView: setDefaultView,
    switchRoot: switchRoot,
    rename: rename,
    copySelection: copySelection,
    cutSelection: cutSelection,
    paste: paste,
    deleteSelection: deleteSelection,
    moveIntoFolder: moveIntoFolder
  }
})()
