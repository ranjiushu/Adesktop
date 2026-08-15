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

  // git %ai 时间（"YYYY-MM-DD HH:MM:SS +HHMM"，作者时区）→ 北京时区（+08:00）显示。
  // 口径统一：构建信息页其他时间（构建时间/首次构建）均为北京时间；git 时间若不转换，
  // 页面会显示 UTC 原值（差 8 小时）——「弹窗信息不准确」的根因。
  function formatGitTime(gitStr) {
    if (!gitStr) return '--'
    let m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/.exec(gitStr)
    if (!m) return formatBuildTime(gitStr)
    let sign = m[7] === '-' ? -1 : 1
    let offMin = sign * (parseInt(m[8], 10) * 60 + parseInt(m[9], 10))
    let utcMs = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - offMin * 60000
    let d = new Date(utcMs + 8 * 3600000)
    let p = function (n) { return (n < 10 ? '0' : '') + n }
    return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) +
      ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes())
  }

  // git %ai 时间（"YYYY-MM-DD HH:MM:SS +HHMM"，UTC 或带偏移）→ 北京时区（+08:00）显示。
  // 口径统一：构建信息页其他时间（构建时间/首次构建）均为北京时间，提交/文件时间若不转换
  // 会差 8 小时（历史上「信息不准确」的根因：git 时间原样显示 UTC）。
  function formatGitTime(gitStr) {
    if (!gitStr) return '--'
    let m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/.exec(gitStr)
    if (!m) return formatBuildTime(gitStr)
    let sign = m[7] === '-' ? -1 : 1
    let offMin = sign * (parseInt(m[8], 10) * 60 + parseInt(m[9], 10))
    let utcMs = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - offMin * 60000
    let d = new Date(utcMs + 8 * 3600000)
    let p = function (n) { return (n < 10 ? '0' : '') + n }
    return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) +
      ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes())
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
        if (key === 'chars') return (items[b].chars || 0) - (items[a].chars || 0)
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
        let newKey = this.getAttribute('data-sort')
        if (newKey === cached.sortKey) return
        // 关键：sortKey 必须写回 opts（renderBarList 只读 opts.sortKey），
        // 否则重渲染仍按旧键排序——「切换排列方式标签不工作」的根因
        cached.sortKey = newKey
        cached.opts.sortKey = newKey
        let box = document.getElementById(bodyId)
        if (box) {
          box.innerHTML = renderBarList(cached.items, cached.opts).replace(/^<div[^>]*>/, '').replace(/<\/div>$/, '')
        }
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

  // ==================== 详情弹窗（统一 dialog-overlay + dialog 模板） ====================
  // 关闭途径：点击遮罩空白（overlay 本体）/ 系统返回键（handleSystemBack → App.Dialog.handleBack）。
  // 模块约定：不设「取消/关闭」按钮；弹窗正文可长按选择复制（.dialog 保证 user-select:text）；
  // 点击弹窗本体不关闭（否则长按选字会被点击打断——「文字不可复制」的根因）。
  let DETAIL_OVERLAY_ID = 'detail-modal-overlay'

  function closeDetailModal() {
    let o = document.getElementById(DETAIL_OVERLAY_ID)
    if (o) {
      App.Dialog.close(DETAIL_OVERLAY_ID)
      if (o.parentNode) o.parentNode.removeChild(o)
    }
  }

  function _openDetailModal(innerHtml) {
    let overlay = document.createElement('div')
    overlay.id = DETAIL_OVERLAY_ID
    overlay.className = 'dialog-overlay'
    overlay.setAttribute('aria-hidden', 'true')
    let modal = document.createElement('div')
    modal.className = 'dialog build-detail-modal'
    modal.setAttribute('role', 'dialog')
    modal.setAttribute('aria-modal', 'true')
    modal.innerHTML = innerHtml
    overlay.appendChild(modal)
    document.body.appendChild(overlay)
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeDetailModal()
    })
    // 点击即复制（模块约定：「点击谁就复制谁」+ 吐司提示）：
    // 弹窗内所有 [data-copy] 元素——复制 data-copy-text（缺省 = 该元素文本），
    // 吐司 data-toast（缺省 '已复制'）。长按选字不受影响（click 与 selection 手势互斥）。
    let copyEls = modal.querySelectorAll('[data-copy]')
    for (let i = 0; i < copyEls.length; i++) {
      copyEls[i].addEventListener('click', function () {
        let text = this.getAttribute('data-copy-text')
        if (text === null) text = this.textContent
        _copyToClipboard(text, this.getAttribute('data-toast') || '已复制')
      })
    }
    App.Dialog.open(DETAIL_OVERLAY_ID, closeDetailModal)
  }

  function showFileDetailModal(f) {
    if (!f) return
    let shortName = (f.name || '').split('/').pop()
    let fullPath = f.name || ''
    let rows = '<span class="build-detail-label">行数</span><span class="build-detail-value" data-copy data-toast="已复制">' + App.utils.escapeHtml(String(f.lines || 0)) + '</span>'
    if (f.chars) rows += '<span class="build-detail-label">字数</span><span class="build-detail-value" data-copy data-toast="已复制">' + App.utils.escapeHtml(String(f.chars)) + '</span>'
    rows += '<span class="build-detail-label">创建</span><span class="build-detail-value" data-copy data-toast="已复制">' + App.utils.escapeHtml(formatGitTime(f.created)) + '</span>' +
      '<span class="build-detail-label">修改</span><span class="build-detail-value" data-copy data-toast="已复制">' + App.utils.escapeHtml(formatGitTime(f.modified)) + '</span>'
    _openDetailModal(
      '<h2 class="dialog-title" data-copy data-toast="已复制文件名">' + App.utils.escapeHtml(shortName) + '</h2>' +
      '<div class="build-detail-path" data-copy data-toast="已复制路径">' + App.utils.escapeHtml(fullPath) + '</div>' +
      '<div class="build-detail-grid">' + rows + '</div>' +
      '<div class="dialog-actions">' +
        '<button class="dialog-btn dialog-btn-secondary" data-copy data-copy-text="' + App.utils.escapeHtml(shortName) + '" data-toast="已复制文件名">复制文件名</button>' +
        '<button class="dialog-btn dialog-btn-primary" data-copy data-copy-text="' + App.utils.escapeHtml(fullPath) + '" data-toast="已复制路径">复制路径</button>' +
      '</div>'
    )
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
      statHtml = '<div class="build-detail-stat" data-copy data-toast="已复制变更统计">' + App.utils.escapeHtml(files)
      if (ins) statHtml += ' <span class="build-detail-stat-ins">' + App.utils.escapeHtml(ins) + '</span>'
      if (del) statHtml += ' <span class="build-detail-stat-del">' + App.utils.escapeHtml(del) + '</span>'
      statHtml += '</div>'
    }
    let filesHtml = ''
    if (commit.files && commit.files.length > 0) {
      for (let i = 0; i < commit.files.length; i++) {
        let f = commit.files[i]
        filesHtml += '<div class="build-detail-file" data-copy data-copy-text="' + App.utils.escapeHtml(f.name || '') + '" data-toast="已复制文件路径">' +
          '<span class="build-detail-file-name">' + App.utils.escapeHtml(f.name || '') + '</span>' +
          '<span class="build-detail-file-stat">' +
            (f.ins > 0 ? '<span class="build-detail-stat-ins">+' + f.ins + '</span> ' : '') +
            (f.del > 0 ? '<span class="build-detail-stat-del">-' + f.del + '</span>' : '') +
          '</span></div>'
      }
    }
    let inner =
      '<h2 class="dialog-title" data-copy data-toast="已复制提交信息">' + App.utils.escapeHtml(commit.msg || '') + '</h2>' +
      '<div class="build-detail-path" data-copy data-toast="已复制完整 Hash">' + App.utils.escapeHtml(commit.fullHash || commit.hash || '') + '</div>' +
      '<div class="build-detail-meta" data-copy data-toast="已复制作者与时间">' +
        (commit.author ? App.utils.escapeHtml(commit.author) + ' · ' : '') + App.utils.escapeHtml(formatGitTime(commit.date || '')) +
      '</div>' +
      statHtml +
      (statHtml && filesHtml ? '<div class="build-detail-divider"></div>' : '') + filesHtml
    _openDetailModal(inner)
  }

  // ==================== 主渲染 ====================

  function render() {
    let container = _getEl('buildinfo-body')
    if (!container) return

    let sections = []

    // 数据解析（容忍缺失）
    let buildCount = '--', buildTime = '--', commitCount = '--', aheadMain = '--', branch = '--'
    let firstTime = '--', spanDays = '--'
    let recentCommits = []
    _safe(function () {
      if (typeof BUILD_COUNT !== 'undefined') buildCount = BUILD_COUNT
      if (typeof BUILD_TIMESTAMP !== 'undefined') buildTime = formatBuildTime(BUILD_TIMESTAMP)
      if (typeof GIT_COMMIT_COUNT !== 'undefined') commitCount = GIT_COMMIT_COUNT
      if (typeof GIT_AHEAD_MAIN !== 'undefined') aheadMain = GIT_AHEAD_MAIN
      if (typeof GIT_BRANCH !== 'undefined') branch = GIT_BRANCH
      if (typeof RECENT_COMMITS !== 'undefined' && Array.isArray(RECENT_COMMITS)) recentCommits = RECENT_COMMITS
      if (typeof FIRST_BUILD_TIMESTAMP !== 'undefined') firstTime = formatBuildTime(FIRST_BUILD_TIMESTAMP)
      // 跨度 = 首次构建 → 当前构建 的天数
      if (typeof FIRST_BUILD_TIMESTAMP !== 'undefined' && typeof BUILD_TIMESTAMP !== 'undefined') {
        let first = new Date(FIRST_BUILD_TIMESTAMP)
        let last = new Date(BUILD_TIMESTAMP)
        if (!isNaN(first.getTime()) && !isNaN(last.getTime())) {
          spanDays = Math.max(1, Math.round((last.getTime() - first.getTime()) / 86400000)) + ''
        }
      }
    }, null)

    let contribGrid = _safe(function () {
      return (typeof CONTRIBUTION_GRID !== 'undefined' && CONTRIBUTION_GRID.today && CONTRIBUTION_GRID.daily) ? CONTRIBUTION_GRID : null
    }, null)
    let sourceStats = _safe(function () { return typeof SOURCE_STATS !== 'undefined' ? SOURCE_STATS : null }, null)
    let fileStats = _safe(function () { return (typeof FILE_STATS !== 'undefined' && Array.isArray(FILE_STATS)) ? FILE_STATS : [] }, [])
    let nsStats = _safe(function () { return (typeof NON_SOURCE_STATS !== 'undefined' && Array.isArray(NON_SOURCE_STATS)) ? NON_SOURCE_STATS : [] }, [])
    let changelogMd = _safe(function () { return (typeof CHANGELOG_MD !== 'undefined' && CHANGELOG_MD) ? CHANGELOG_MD : null }, null)

    // 区块组装
    if (contribGrid) {
      sections.push(wrapSection('贡献热力图', renderContributionGrid(contribGrid)))
    }
    sections.push(wrapSection('构建概览', renderKvCard([
      { label: '首次构建', value: firstTime },
      { label: '当前版本', value: buildTime },
      { label: '建构次数', value: buildCount + ' 次' },
      { label: '提交总数', value: commitCount + ' 次' },
      { label: '领先 main', value: aheadMain + ' 个提交', valueStyle: 'font-weight:500;color:' + (parseInt(aheadMain, 10) >= 50 ? '#e0563f' : 'inherit') },
      { label: '当前分支', value: branch, valueStyle: 'font-size:12px;font-weight:500;font-family:monospace' },
      { label: '跨度', value: spanDays + ' 天' }
    ])))
    if (sourceStats) {
      // 非源码分类统计：工具/脚本/测试/配置行数（非 doc）与 md 文档字数（chars 字段）
      let nsOtherLines = 0
      let nsDocChars = 0
      for (let i = 0; i < nsStats.length; i++) {
        if (nsStats[i].type === 'doc') nsDocChars += nsStats[i].chars || 0
        else nsOtherLines += nsStats[i].lines
      }
      let srcTotalFiles = sourceStats.js.files + (sourceStats.css ? sourceStats.css.files : 0) + (sourceStats.html ? sourceStats.html.files : 0) + (sourceStats.java ? sourceStats.java.files : 0)
      let grandTotalFiles = srcTotalFiles + nsStats.length
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
        { label: '文件总数', value: grandTotalFiles + ' 个', valueStyle: 'font-weight:600;color:var(--text-primary)', rowStyle: 'border:none' },
        { label: '源码行数', value: sourceStats.total + ' 行', valueStyle: 'font-size:12px;font-weight:500' },
        { label: '工具/脚本/测试/配置行数', value: nsOtherLines + ' 行', valueStyle: 'font-size:12px;font-weight:500' },
        { label: 'md 文档字数', value: nsDocChars + ' 字', valueStyle: 'font-size:12px;font-weight:500' }
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
      // 工具/脚本/测试/配置在前、Markdown 文档在后（与 LexiCull 顺序一致）
      sections.push(wrapSection('工具/脚本/测试/配置', '<div id="build-other-body">' + renderBarList(nsStats, {
        slice: 'other', rowClass: 'ns-bar-row', globalRef: 'NON_SOURCE_STATS',
        toggleId: 'other-bar-toggle', expandUnit: '个文件',
        sortKeys: ['lines', 'name', 'modified'], sortLabels: ['行数', '名称', '最近修改'],
        bodyId: 'build-other-body'
      }) + '</div>', { secId: 'build-other-section' }))
      let hasDoc = nsStats.some(function (it) { return it.type === 'doc' })
      if (hasDoc) {
        sections.push(wrapSection('Markdown 文档', '<div id="build-doc-body">' + renderBarList(nsStats, {
          slice: 'doc', rowClass: 'doc-bar-row', globalRef: 'NON_SOURCE_STATS',
          toggleId: 'doc-bar-toggle', expandUnit: '个文档',
          sortKeys: ['lines', 'name', 'modified', 'chars'], sortLabels: ['行数', '名称', '最近修改', '字数'],
          bodyId: 'build-doc-body'
        }) + '</div>', { secId: 'build-doc-section' }))
      }
    }
    if (recentCommits.length > 0) {
      sections.push(wrapSection('提交动态', renderCommitList(recentCommits, 10), { secId: 'build-commit-section' }))
    }
    if (changelogMd) {
      // 更新日志：注入原文（CHANGELOG_MD），运行时用 App.Markdown 渲染——
      // 与仓库内其他 markdown 共用同一渲染器（h1-h6/多行列表/有序列表/引用/代码等），
      // 避免构建期 python 迷你渲染器语法覆盖不全（### 标题/列表续行被拆段）
      sections.push(wrapSection(
        '<span class="mcp-guide-arrow" id="build-guide-arrow">▶</span> 更新日志',
        '<div class="changelog-container" id="build-guide-content" style="display:none">' + App.Markdown.render(changelogMd) + '</div>',
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
