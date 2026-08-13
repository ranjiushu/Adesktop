/* 提交与构建信息面板（完整移植自 LexiCull settings-build）
 * 区块：贡献热力图 / 构建概览 / 仓库规模 / 源码规模 / 工具脚本配置 /
 *       Markdown 文档 / 提交动态 / 更新日志
 * 数据来源：build-web.sh + build-stats.sh 构建注入变量（缺失时区块自动隐藏）
 */
'use strict'

App.BuildInfo = (function () {
  let _open = false

  function _getEl(id) { return document.getElementById(id) }

  // ==================== 工具 ====================

  function formatBuildTime(isoStr) {
    if (!isoStr) return '--'
    try {
      let d = new Date(isoStr)
      if (isNaN(d.getTime())) return isoStr
      let p = function (n) { return (n < 10 ? '0' : '') + n }
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
        ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
    } catch (e) { return isoStr }
  }

  function _copyToClipboard(text, msg) {
    if (App.ui && typeof App.ui.copyText === 'function') App.ui.copyText(text, msg)
  }

  function _safe(fn, fallback) {
    try { return fn() } catch (e) { return fallback }
  }

  // ==================== 区块渲染器 ====================

  function wrapSection(titleHtml, bodyHtml, opts) {
    opts = opts || {}
    let secCls = 'sub-section' + (opts.secCls ? ' ' + opts.secCls : '')
    let titleCls = 'sub-section-title' + (opts.titleCls ? ' ' + opts.titleCls : '')
    let secId = opts.secId ? ' id="' + opts.secId + '"' : ''
    let titleId = opts.titleId ? ' id="' + opts.titleId + '"' : ''
    return '<div class="' + secCls + '"' + secId + '>' +
      '<div class="' + titleCls + '"' + titleId + '>' + titleHtml + '</div>' +
      bodyHtml + '</div>'
  }

  function renderKvCard(rows) {
    let html = '<div class="sub-info-card">'
    for (let i = 0; i < rows.length; i++) {
      let r = rows[i]
      if (r.divider) {
        html += '<div style="height:1px;background:var(--border-color);margin:6px 0"></div>'
        continue
      }
      let rowStyle = r.rowStyle ? ' style="' + r.rowStyle + '"' : ''
      let valueStyle = r.valueStyle || 'font-weight:500'
      html += '<div class="sub-info-card-row"' + rowStyle + '>' +
        '<span class="sub-info-label">' + App.utils.escapeHtml(r.label) + '</span>' +
        '<span class="sub-info-value" style="' + valueStyle + '">' + App.utils.escapeHtml(r.value) + '</span>' +
      '</div>'
    }
    html += '</div>'
    return html
  }

  let _barOptsCache = {}

  function renderBarList(items, opts) {
    let maxShow = 8
    if (opts.slice === 'doc' || opts.slice === 'other') {
      let kept = []
      for (let si = 0; si < items.length; si++) {
        let sIt = items[si]
        // 只首次打标原始索引；重渲染（排序）传已过滤数组，跳过覆盖防止索引错位
        if (sIt.__origIdx === undefined) sIt.__origIdx = si
        if (opts.slice === 'doc' ? sIt.type === 'doc' : sIt.type !== 'doc') kept.push(sIt)
      }
      items = kept
    }
    let sortKey = opts.sortKey || 'lines'
    let order = []
    for (let oi = 0; oi < items.length; oi++) order.push(oi)
    if (opts.sortKeys && opts.sortKeys.indexOf(sortKey) >= 0) {
      let key = sortKey
      order.sort(function (a, b) {
        if (key === 'name') return items[a].name.localeCompare(items[b].name)
        if (key === 'modified') return (items[b].modified || '').localeCompare(items[a].modified || '')
        return items[b].lines - items[a].lines
      })
    }

    let body = ''
    if (opts.sortKeys) {
      let chipsHtml = '<div style="display:flex;gap:6px;margin:6px 0 8px">'
      for (let k = 0; k < opts.sortKeys.length; k++) {
        let sk = opts.sortKeys[k]
        let label = (opts.sortLabels && opts.sortLabels[k]) || sk
        let active = sk === sortKey
        let chipStyle = active
          ? 'background:var(--accent-blue);color:#fff'
          : 'background:var(--bg-card);color:var(--text-secondary)'
        chipsHtml += '<span data-sort="' + sk + '" style="' + chipStyle + ';padding:4px 10px;font-size:11px;border-radius:10px;cursor:pointer;touch-action:manipulation">' + App.utils.escapeHtml(label) + '</span>'
      }
      chipsHtml += '</div>'
      body += chipsHtml
    }

    let maxLines = 1
    for (let mi = 0; mi < items.length; mi++) {
      if (items[mi].lines > maxLines) maxLines = items[mi].lines
    }
    body += '<div class="sub-info-card" style="padding:8px 12px">'
    for (let i = 0; i < order.length; i++) {
      let o = order[i]
      let it = items[o]
      let pct = Math.round(it.lines / maxLines * 100)
      let color = (opts.colorMap && opts.colorMap[it.type]) || '#999'
      let dotStyle = 'display:inline-block;width:8px;height:8px;border-radius:2px;background:' + color + ';vertical-align:middle;margin-right:4px'
      let nameShort = it.name.split('/').pop()
      let valueText = (it.chars ? it.chars + '字 · ' : '') + it.lines + ' 行'
      let rowStyle = 'cursor:pointer;padding:2px 0' + (i >= maxShow ? ';display:none' : '')
      let dataIdx = it.__origIdx !== undefined ? it.__origIdx : o

      body += '<div class="' + opts.rowClass + '" data-idx="' + dataIdx + '" style="' + rowStyle + '" onclick="App.BuildInfo.showFileDetailModal(' + opts.globalRef + '[' + dataIdx + '])">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1px">' +
          '<span style="font-size:11px;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:80%">' +
            '<span style="' + dotStyle + '"></span>' + App.utils.escapeHtml(nameShort) +
          '</span>' +
          '<span style="font-size:10px;color:var(--text-tertiary);flex-shrink:0">' + App.utils.escapeHtml(valueText) + '</span>' +
        '</div>' +
        (it.desc ? '<div style="font-size:10px;color:var(--text-tertiary);margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' + App.utils.escapeHtml(it.desc) + '">' + App.utils.escapeHtml(it.desc) + '</div>' : '') +
        '<div style="height:4px;background:var(--bg-card);border-radius:2px;overflow:hidden">' +
          '<div style="height:100%;width:' + pct + '%;background:' + color + ';border-radius:2px;transition:width 0.3s"></div>' +
        '</div>' +
      '</div>'
    }
    if (items.length > maxShow) {
      body += '<div id="' + opts.toggleId + '" data-expanded="0" data-expanded-text="展开全部 (' + items.length + ' 条)" style="text-align:center;margin-top:6px;font-size:11px;color:var(--accent-blue);cursor:pointer">展开全部 (' + items.length + ' 条)</div>'
    }
    body += '</div>'
    _barOptsCache[opts.bodyId] = { items: items, opts: opts, sortKey: sortKey }
    return '<div id="' + opts.bodyId + '">' + body + '</div>'
  }

  function bindExpandToggle(toggleId, itemSelector, maxShow) {
    let btn = document.getElementById(toggleId)
    if (!btn) return
    btn.addEventListener('click', function () {
      let items = document.querySelectorAll(itemSelector)
      let expanded = this.getAttribute('data-expanded') === '1'
      for (let i = maxShow; i < items.length; i++) {
        items[i].style.display = expanded ? 'none' : ''
      }
      this.textContent = expanded ? this.getAttribute('data-expanded-text') : '收起'
      this.setAttribute('data-expanded', expanded ? '0' : '1')
    })
  }

  function bindSortChips(bodyId) {
    let wrap = document.getElementById(bodyId)
    if (!wrap) return
    let chips = wrap.querySelectorAll('[data-sort]')
    for (let i = 0; i < chips.length; i++) {
      chips[i].addEventListener('click', function () {
        let cached = _barOptsCache[bodyId]
        if (!cached) return
        cached.sortKey = this.getAttribute('data-sort')
        let box = document.getElementById(bodyId)
        if (box) box.innerHTML = renderBarList(cached.items, cached.opts).replace(/^<div[^>]*>/, '').replace(/<\/div>$/, '')
        bindExpandToggle(cached.opts.toggleId, '.' + cached.opts.rowClass, 8)
        bindSortChips(bodyId)
      })
    }
  }

  function renderCommitList(commits, maxShow) {
    let html = '<div id="build-commit-list">'
    for (let i = 0; i < commits.length; i++) {
      let c = commits[i]
      let rowStyle = 'cursor:pointer' + (i >= maxShow ? ';display:none' : '')
      html += '<div class="build-commit-item" data-idx="' + i + '" style="' + rowStyle + '" onclick="App.BuildInfo.showCommitDetailModal(RECENT_COMMITS[' + i + '])">' +
        '<span class="build-commit-hash">' + App.utils.escapeHtml(c.hash || '') + '</span>' +
        '<span class="build-commit-msg">' + App.utils.escapeHtml(c.msg || '') + '</span>' +
      '</div>'
    }
    html += '</div>'
    if (commits.length > maxShow) {
      html += '<div id="commit-toggle" data-expanded="0" data-expanded-text="展开全部 (' + commits.length + ' 条)" style="text-align:center;margin-top:6px;font-size:11px;color:var(--accent-blue);cursor:pointer">展开全部 (' + commits.length + ' 条)</div>'
    }
    return html
  }

  // ==================== 贡献热力图 ====================

  function renderContributionGrid(data) {
    if (!data || !data.daily || !data.today) return ''
    let startDate = data.startDate
    let today = data.today
    let daily = data.daily
    let monthNames = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月']

    function addDays(dateStr, delta) {
      let d = new Date(dateStr + 'T00:00:00Z')
      d.setUTCDate(d.getUTCDate() + delta)
      return d.toISOString().slice(0, 10)
    }
    function weekdayOf(dateStr) { return new Date(dateStr + 'T00:00:00Z').getUTCDay() }
    function monthOf(dateStr) { return parseInt(dateStr.slice(5, 7), 10) }

    let cols = []
    for (let k = 0; ; k++) {
      let bottom = addDays(today, -7 * k)
      let top = addDays(bottom, -6)
      if (startDate && bottom < startDate) break
      let rows = []
      for (let r = 0; r < 7; r++) rows.push(addDays(top, r))
      cols.push({ rows: rows })
    }
    let renderCols = cols.slice().reverse()

    let dayLabels = []
    for (let r2 = 0; r2 < 7; r2++) {
      let wd = weekdayOf(addDays(today, -6 + r2))
      dayLabels[r2] = wd === 2 ? '星期二' : (wd === 4 ? '星期四' : (wd === 6 ? '星期六' : ''))
    }

    let monthAtCol = []
    let prevMonth = -1
    for (let i = 0; i < renderCols.length; i++) {
      let btm = renderCols[i].rows[6]
      let m = monthOf(btm)
      monthAtCol[i] = (m !== prevMonth) ? monthNames[m - 1] : ''
      prevMonth = m
    }

    let html = '<div class="heatmap-card"><div class="heatmap-scroll-row">'
    html += '<div class="heatmap-days">'
    for (let r3 = 0; r3 < 7; r3++) {
      html += '<span class="heatmap-day-label">' + App.utils.escapeHtml(dayLabels[r3]) + '</span>'
    }
    html += '</div>'

    html += '<div class="heatmap-scroll">'
    html += '<div class="heatmap-months">'
    for (let i2 = 0; i2 < renderCols.length; i2++) {
      html += '<span class="heatmap-month-label"' +
        (monthAtCol[i2] ? '' : ' style="visibility:hidden"') + '>' +
        App.utils.escapeHtml(monthAtCol[i2]) + '</span>'
    }
    html += '</div>'

    html += '<div class="heatmap-grid">'
    for (let i3 = 0; i3 < renderCols.length; i3++) {
      let col = renderCols[i3]
      for (let r4 = 0; r4 < 7; r4++) {
        let dateStr = col.rows[r4]
        let level = daily[dateStr] || 0
        html += '<span class="heatmap-cell" data-level="' + level + '" data-date="' + dateStr + '"></span>'
      }
    }
    html += '</div></div></div>'

    html += '<div class="heatmap-footer">' +
      '少' +
      '<span class="heatmap-legend-cell" data-level="0"></span>' +
      '<span class="heatmap-legend-cell" data-level="1"></span>' +
      '<span class="heatmap-legend-cell" data-level="2"></span>' +
      '<span class="heatmap-legend-cell" data-level="3"></span>' +
      '<span class="heatmap-legend-cell" data-level="4"></span>' +
      '<span class="heatmap-legend-cell" data-level="5"></span>' +
      '多'
    if (data.maxDay && data.maxCount > 0) {
      html += '<span class="heatmap-stat">最活跃: ' + App.utils.escapeHtml(data.maxDay) + ' (' + data.maxCount + '次)</span>'
    }
    html += '</div></div>'
    return html
  }

  // ==================== 详情弹窗 ====================

  function closeDetailModal() {
    let overlays = document.querySelectorAll('.modal-overlay')
    for (let i = overlays.length - 1; i >= 0; i--) {
      let o = overlays[i]
      if (o.parentNode) o.parentNode.removeChild(o)
      break
    }
  }

  function showFileDetailModal(f) {
    if (!f) return
    let overlay = document.createElement('div')
    overlay.className = 'modal-overlay'
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;animation:fadeIn .15s'
    let modal = document.createElement('div')
    modal.style.cssText = 'width:84vw;max-width:340px;max-height:70vh;background:var(--bg-card);border-radius:14px;padding:16px;box-sizing:border-box;overflow-y:auto'
    modal.innerHTML =
      '<div class="commit-modal-title" style="font-size:15px;font-weight:700;margin-bottom:8px;cursor:pointer">' + App.utils.escapeHtml((f.name || '').split('/').pop()) + '</div>' +
      '<div class="commit-modal-hash" style="font-size:12px;color:var(--text-tertiary);margin-bottom:12px;cursor:pointer">' + App.utils.escapeHtml(f.name || '') + '</div>' +
      '<div style="font-size:13px;color:var(--text-primary)">' +
        '行数: ' + App.utils.escapeHtml(String(f.lines || 0)) + (f.chars ? ' · ' + f.chars + ' 字' : '') + '<br>' +
        '创建: ' + App.utils.escapeHtml(f.created || '--') + '<br>' +
        '修改: ' + App.utils.escapeHtml(f.modified || '--') +
      '</div>' +
      '<div style="margin-top:14px;display:flex;gap:8px">' +
        '<button class="commit-modal-btn" data-copy="name" style="flex:1;padding:8px 0;border:none;border-radius:8px;background:var(--accent-blue);color:#fff;cursor:pointer;font-size:13px">复制文件名</button>' +
        '<button class="commit-modal-btn" data-copy="path" style="flex:1;padding:8px 0;border:none;border-radius:8px;background:var(--bg-page);color:var(--text-primary);cursor:pointer;font-size:13px">复制路径</button>' +
        '<button class="commit-modal-btn" data-copy="close" style="flex:1;padding:8px 0;border:none;border-radius:8px;background:var(--bg-page);color:var(--text-secondary);cursor:pointer;font-size:13px">关闭</button>' +
      '</div>'
    overlay.appendChild(modal)
    document.body.appendChild(overlay)
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeDetailModal()
    })
    modal.querySelectorAll('.commit-modal-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        let act = btn.getAttribute('data-copy')
        if (act === 'close') { closeDetailModal(); return }
        _copyToClipboard(act === 'name' ? (f.name || '').split('/').pop() : (f.name || ''), act === 'name' ? '已复制文件名' : '已复制路径')
      })
    })
  }

  function showCommitDetailModal(commit) {
    if (!commit) return
    let statHtml = ''
    if (commit.stat) {
      let parts = commit.stat.split(',')
      let files = parts[0] || ''
      let ins = ''
      let del = ''
      for (let p = 1; p < parts.length; p++) {
        let t = parts[p].trim()
        if (t.indexOf('+') >= 0) ins = t
        else if (t.indexOf('-') >= 0) del = t
      }
      statHtml = '<div class="commit-modal-stat" style="margin:8px 0">' + App.utils.escapeHtml(files)
      if (ins) statHtml += ' <span style="color:#4CAF50">' + App.utils.escapeHtml(ins) + '</span>'
      if (del) statHtml += ' <span style="color:#E57373">' + App.utils.escapeHtml(del) + '</span>'
      statHtml += '</div>'
    }
    let filesHtml = ''
    if (commit.files && commit.files.length > 0) {
      for (let i = 0; i < commit.files.length; i++) {
        let f = commit.files[i]
        filesHtml += '<div style="display:flex;justify-content:space-between;font-size:12px;padding:2px 0">' +
          '<span style="color:var(--text-primary);word-break:break-all;flex:1">' + App.utils.escapeHtml(f.name || '') + '</span>' +
          '<span style="flex-shrink:0;margin-left:8px">' +
            (f.ins > 0 ? '<span style="color:#4CAF50">+' + f.ins + '</span> ' : '') +
            (f.del > 0 ? '<span style="color:#E57373">-' + f.del + '</span>' : '') +
          '</span></div>'
      }
    }

    let overlay = document.createElement('div')
    overlay.className = 'modal-overlay'
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;animation:fadeIn .15s'
    let modal = document.createElement('div')
    modal.style.cssText = 'width:84vw;max-width:340px;max-height:70vh;background:var(--bg-card);border-radius:14px;padding:16px;box-sizing:border-box;overflow-y:auto'
    modal.innerHTML =
      '<div class="commit-modal-title" style="font-size:15px;font-weight:700;margin-bottom:6px;cursor:pointer">' + App.utils.escapeHtml(commit.msg || '') + '</div>' +
      '<div class="commit-modal-hash" style="font-size:12px;color:var(--text-tertiary);margin-bottom:6px;cursor:pointer">' + App.utils.escapeHtml(commit.fullHash || commit.hash || '') + '</div>' +
      '<div style="font-size:12px;color:var(--text-tertiary);margin-bottom:10px">' +
        (commit.author ? App.utils.escapeHtml(commit.author) + ' · ' : '') + formatBuildTime(commit.date || '') +
      '</div>' +
      statHtml + (statHtml && filesHtml ? '<div style="height:1px;background:var(--border-outer);margin:6px 0"></div>' : '') + filesHtml
    overlay.appendChild(modal)
    document.body.appendChild(overlay)
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeDetailModal()
    })
    modal.addEventListener('click', function () { closeDetailModal() })
    let titleEl = modal.querySelector('.commit-modal-title')
    if (titleEl) titleEl.addEventListener('click', function (e) {
      e.stopPropagation()
      _copyToClipboard(commit.msg || '', '已复制提交信息')
    })
    let hashEl = modal.querySelector('.commit-modal-hash')
    if (hashEl) hashEl.addEventListener('click', function (e) {
      e.stopPropagation()
      _copyToClipboard(commit.fullHash || commit.hash || '', '已复制完整 Hash')
    })
  }

  // ==================== 主渲染 ====================

  function render() {
    let container = _getEl('buildinfo-body')
    if (!container) return

    let sections = []

    // 数据解析（容忍缺失）
    let buildCount = '--', buildTime = '--', commitCount = '--', aheadMain = '--', branch = '--'
    let recentCommits = []
    _safe(function () {
      if (typeof BUILD_COUNT !== 'undefined') buildCount = BUILD_COUNT
      if (typeof BUILD_TIMESTAMP !== 'undefined') buildTime = formatBuildTime(BUILD_TIMESTAMP)
      if (typeof GIT_COMMIT_COUNT !== 'undefined') commitCount = GIT_COMMIT_COUNT
      if (typeof GIT_AHEAD_MAIN !== 'undefined') aheadMain = GIT_AHEAD_MAIN
      if (typeof GIT_BRANCH !== 'undefined') branch = GIT_BRANCH
      if (typeof RECENT_COMMITS !== 'undefined' && Array.isArray(RECENT_COMMITS)) recentCommits = RECENT_COMMITS
    }, null)

    let contribGrid = _safe(function () {
      return (typeof CONTRIBUTION_GRID !== 'undefined' && CONTRIBUTION_GRID.today && CONTRIBUTION_GRID.daily) ? CONTRIBUTION_GRID : null
    }, null)
    let sourceStats = _safe(function () { return typeof SOURCE_STATS !== 'undefined' ? SOURCE_STATS : null }, null)
    let fileStats = _safe(function () { return (typeof FILE_STATS !== 'undefined' && Array.isArray(FILE_STATS)) ? FILE_STATS : [] }, [])
    let nsStats = _safe(function () { return (typeof NON_SOURCE_STATS !== 'undefined' && Array.isArray(NON_SOURCE_STATS)) ? NON_SOURCE_STATS : [] }, [])
    let changelogHtml = _safe(function () { return (typeof CHANGELOG_HTML !== 'undefined' && CHANGELOG_HTML) ? CHANGELOG_HTML : null }, null)

    // 区块组装
    if (contribGrid) {
      sections.push(wrapSection('贡献热力图', renderContributionGrid(contribGrid)))
    }
    sections.push(wrapSection('构建概览', renderKvCard([
      { label: '构建次数', value: buildCount },
      { label: '构建时间', value: buildTime },
      { label: '提交总数', value: commitCount },
      { label: '领先 main', value: aheadMain },
      { label: '当前分支', value: branch }
    ])))
    if (sourceStats) {
      let repoRows = [
        { label: 'JavaScript', value: sourceStats.js.files + ' 个文件 · ' + sourceStats.js.lines + ' 行', valueStyle: 'font-size:12px;font-weight:500' },
        { label: 'CSS', value: (sourceStats.css.files || 0) + ' 个文件 · ' + sourceStats.css.lines + ' 行', valueStyle: 'font-size:12px;font-weight:500' },
        { label: 'HTML', value: (sourceStats.html.files || 0) + ' 个文件 · ' + sourceStats.html.lines + ' 行', valueStyle: 'font-size:12px;font-weight:500' }
      ]
      if (sourceStats.java) {
        repoRows.push({ label: 'Java（壳）', value: sourceStats.java.files + ' 个文件 · ' + sourceStats.java.lines + ' 行', valueStyle: 'font-size:12px;font-weight:500' })
      }
      repoRows.push({ divider: true })
      repoRows.push(
        { label: '源码文件', value: sourceStats.js.files + (sourceStats.css ? sourceStats.css.files : 0) + (sourceStats.html ? sourceStats.html.files : 0) + (sourceStats.java ? sourceStats.java.files : 0) + ' 个', valueStyle: 'font-size:12px;font-weight:500' },
        { label: '源码行数', value: sourceStats.total + ' 行', valueStyle: 'font-size:12px;font-weight:500' }
      )
      sections.push(wrapSection('仓库规模', renderKvCard(repoRows)))
    }
    if (fileStats.length > 0) {
      let colorMap = { js: '#F7DF1E', css: '#2965F1', html: '#E34F26', java: '#E76F00', sh: '#4EAA25', json: '#8BC34A', md: '#9E9E9E' }
      sections.push(wrapSection('源码规模', '<div id="build-source-body">' + renderBarList(fileStats, {
        rowClass: 'file-bar-row', colorMap: colorMap, globalRef: 'FILE_STATS',
        toggleId: 'file-bar-toggle', expandUnit: '文件',
        sortKeys: ['lines', 'name', 'modified'], sortLabels: ['行数', '名称', '修改时间'],
        bodyId: 'build-source-body'
      }) + '</div>'))
    }
    if (nsStats.length > 0) {
      let hasDoc = nsStats.some(function (it) { return it.type === 'doc' })
      if (hasDoc) {
        sections.push(wrapSection('Markdown 文档', '<div id="build-doc-body">' + renderBarList(nsStats, {
          slice: 'doc', rowClass: 'doc-bar-row', globalRef: 'NON_SOURCE_STATS',
          toggleId: 'doc-bar-toggle', expandUnit: '文件',
          sortKeys: ['lines', 'name', 'modified'], sortLabels: ['行数', '名称', '修改时间'],
          bodyId: 'build-doc-body'
        }) + '</div>', { secId: 'build-doc-section' }))
      }
      sections.push(wrapSection('工具/脚本/测试/配置', '<div id="build-other-body">' + renderBarList(nsStats, {
        slice: 'other', rowClass: 'other-bar-row', globalRef: 'NON_SOURCE_STATS',
        toggleId: 'other-bar-toggle', expandUnit: '文件',
        sortKeys: ['lines', 'name', 'modified'], sortLabels: ['行数', '名称', '修改时间'],
        bodyId: 'build-other-body'
      }) + '</div>', { secId: 'build-other-section' }))
    }
    if (recentCommits.length > 0) {
      sections.push(wrapSection('提交动态', renderCommitList(recentCommits, 10), { secId: 'build-commit-section' }))
    }
    if (changelogHtml) {
      sections.push(wrapSection(
        '更新日志 <span class="mcp-guide-arrow" id="build-guide-arrow">▼</span>',
        '<div class="changelog-container" id="build-guide-content" style="display:none">' + changelogHtml + '</div>',
        { secCls: 'changelog-section', titleCls: 'mcp-guide-toggle', titleId: 'build-guide-toggle' }
      ))
    }

    container.innerHTML = sections.join('')

    // 交互绑定
    bindExpandToggle('file-bar-toggle', '.file-bar-row', 8)
    bindExpandToggle('doc-bar-toggle', '.doc-bar-row', 8)
    bindExpandToggle('other-bar-toggle', '.other-bar-row', 8)
    bindExpandToggle('commit-toggle', '.build-commit-item', 10)
    bindSortChips('build-source-body')
    bindSortChips('build-doc-body')
    bindSortChips('build-other-body')

    let guideToggle = _getEl('build-guide-toggle')
    if (guideToggle) {
      guideToggle.addEventListener('click', function () {
        let content = _getEl('build-guide-content')
        let arrow = _getEl('build-guide-arrow')
        if (!content) return
        let show = content.style.display === 'none'
        content.style.display = show ? '' : 'none'
        if (arrow) arrow.style.transform = show ? 'rotate(90deg)' : ''
      })
    }

    // 热力图默认定位到最右（最新提交）
    let hScroll = container.querySelector('.heatmap-scroll')
    if (hScroll) hScroll.scrollLeft = hScroll.scrollWidth
  }

  // ==================== 面板开关（整页 + 系统返回） ====================

  function open() {
    if (_open) return
    _open = true
    render()
    let p = _getEl('buildinfo')
    if (p) {
      p.classList.add('buildinfo-open')
      p.setAttribute('aria-hidden', 'false')
    }
    if (App.Drawer && typeof App.Drawer.close === 'function') App.Drawer.close()
    App.bridge.vibrate()
    // 系统返回键支持：MainActivity 返回键 → webView.goBack() → popstate → close()
    try { history.pushState({ _buildInfoOpen: true }, '') } catch (e) { /* 降级：返回按钮仍可用 */ }
  }

  function close() {
    if (!_open) return
    _open = false
    let p = _getEl('buildinfo')
    if (p) {
      p.classList.remove('buildinfo-open')
      p.setAttribute('aria-hidden', 'true')
    }
  }

  function _onPopState() {
    if (_open) close()
  }

  function isOpen() { return _open }

  function init() {
    let btn = _getEl('btn-build-info')
    if (btn) App.utils.bindPress(btn, open)
    let backBtn = _getEl('buildinfo-back')
    if (backBtn) {
      App.utils.bindPress(backBtn, function () {
        // 优先走历史返回（触发 popstate 关闭）；栈无记录时直接关
        try {
          if (history.state && history.state._buildInfoOpen) history.back()
          else close()
        } catch (e) { close() }
      })
    }
    window.addEventListener('popstate', _onPopState)
  }

  return {
    open: open,
    close: close,
    isOpen: isOpen,
    init: init,
    // 供内联 onclick 调用
    showFileDetailModal: showFileDetailModal,
    showCommitDetailModal: showCommitDetailModal
  }
})()
