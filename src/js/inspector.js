/* 职责: 元素取景器——Debug 工具，长按 FAB 800ms 激活，DOM 元素选取与属性查看
 * （移植自 LexiCull，依赖适配为 Desktop 的 utils/ui/toast/bridge）
 * 依赖: utils.js, ui.js, toast.js, bridge.js
 * 导出: App.inspector
 * 副作用: DOM #scope-*, FAB 事件监听, DOMContentLoaded 自启动
 *
 * 使命：所见即所得，所点即所查。
 *       以最小干扰提供最大信息密度，精确选取 DOM 元素并即时
 *       查看、复制其关键属性。像相机取景器一样，通过扩大/缩小
 *       选区范围在 DOM 树中穿行。
 * 触发：长按右下角 FAB（#mode-switch-fab）800ms
 */
'use strict'

App.inspector = (function () {
  let _scope = {
    active: false,
    toolbarAtTop: false,
    _currentEl: null,
    _fabTimer: null,
    _highlight: null,
    _panel: null,
    _toolbar: null,
    _dragState: null,
    _lockUntil: 0            // 关闭面板后短暂锁定，防穿透误触
  }

  // FAB 长按判定状态（fab 拖动开始时需主动取消长按 timer）
  let _fabPressed = false

  // ==================== 初始化 ====================

  function initInspector() {
    // FAB z-index 提升到所有遮罩之上
    let s = document.createElement('style')
    s.id = 'scope-style'
    s.textContent = '#mode-switch-fab{z-index:1002!important}'
    document.head.appendChild(s)

    let fab = document.getElementById('mode-switch-fab')
    if (!fab) return

    // FAB 短按屏蔽：Scope 激活时，捕获阶段拦截 touchend，防止 bindPress 触发模式切换
    fab.addEventListener('touchend', function(e) {
      if (_scope.active) { e.stopPropagation(); e.stopImmediatePropagation() }
    }, true)
    fab.addEventListener('click', function(e) {
      if (_scope.active) { e.stopPropagation(); e.stopImmediatePropagation() }
    }, true)

    fab.addEventListener('touchstart', function(e) {
      _fabPressed = true
      _scope._fabTimer = setTimeout(function() {
        if (_fabPressed) {
          _fabPressed = false; _scope._fabTimer = null
          App.bridge.vibrate()
          toggleScope()
        }
      }, 800)
    }, { passive: true })

    fab.addEventListener('touchmove', function(e) {
      if (!_fabPressed) return
      let t = e.touches[0], r = fab.getBoundingClientRect()
      if (t.clientX < r.left-20 || t.clientX > r.right+20 || t.clientY < r.top-20 || t.clientY > r.bottom+20) {
        _fabPressed = false
        if (_scope._fabTimer) { clearTimeout(_scope._fabTimer); _scope._fabTimer = null }
      }
    }, { passive: true })

    fab.addEventListener('touchend', function() { _fabPressed = false; if (_scope._fabTimer) { clearTimeout(_scope._fabTimer); _scope._fabTimer = null } })
    fab.addEventListener('touchcancel', function() { _fabPressed = false; if (_scope._fabTimer) { clearTimeout(_scope._fabTimer); _scope._fabTimer = null } })
  }

  // 拖动开始时取消长按取景器 timer，防止拖动态误触发
  function cancelFabTimer() {
    _fabPressed = false
    if (_scope._fabTimer) { clearTimeout(_scope._fabTimer); _scope._fabTimer = null }
  }

  // 取景器激活时 FAB 是退出入口，禁拖
  function isActive() { return _scope.active }

  // ==================== 开关 ====================

  function toggleScope() {
    if (_scope.active) exitScope(); else enterScope()
  }

  function enterScope() {
    if (_scope.active) return
    _scope.active = true
    _scope._lockUntil = 0  // 清残留锁
    buildScopeDOM()
    document.body.addEventListener('click', onScopeClick, true)
    document.body.addEventListener('touchstart', onScopeTouch, { passive: false, capture: true })
    toast('Scope 已激活 · 点击元素选取 · +/- 调整选区')
  }

  function exitScope() {
    _scope.active = false; _scope._currentEl = null
    _scope._lockUntil = Date.now() + 500  // 防穿透：先设锁
    destroyScopeDOM()
    // 延迟移除监听器，让锁有机会拦截残留的 touchend/click
    let _scopeRef = _scope
    setTimeout(function() {
      if (!_scopeRef.active && _scopeRef._lockUntil && Date.now() > _scopeRef._lockUntil) {
        document.body.removeEventListener('click', onScopeClick, true)
        document.body.removeEventListener('touchstart', onScopeTouch, { passive: false, capture: true })
      }
    }, 600)
  }

  // ==================== DOM 构建 ====================

  function buildScopeDOM() {
    // 高亮框
    let hl = document.createElement('div')
    hl.id = 'scope-highlight'
    hl.style.cssText = 'position:fixed;pointer-events:none;z-index:9998;border:2px solid #4A90D9;background:rgba(74,144,217,0.08);display:none;border-radius:3px;transition:all .12s ease'
    _scope._highlight = hl; document.body.appendChild(hl)

    // 信息面板（高度自适应，可拖动）
    let panel = document.createElement('div')
    panel.id = 'scope-panel'
    panel.style.cssText = 'position:fixed;z-index:9999;width:300px;left:50%;top:120px;margin-left:-150px;background:#1E1E2E;color:#CDD6F4;font:11px/1.5 monospace;border-radius:10px;box-shadow:0 4px 24px rgba(0,0,0,.55);display:none;overflow:hidden;user-select:none;-webkit-user-select:none'
    panel._baseHeight = 200
    panel.style.height = panel._baseHeight + 'px'
    panel.innerHTML =
      '<div id="scope-panel-content" style="padding:6px 12px 38px;height:100%;overflow-y:auto;box-sizing:border-box;pointer-events:auto;user-select:text;-webkit-user-select:text"></div>' +
      '<div style="position:absolute;bottom:4px;left:4px;right:4px;z-index:1;display:flex;gap:4px">' +
        '<button id="scope-panel-closebtn" style="flex:1;padding:4px 0;border:none;background:rgba(255,255,255,0.05);color:#BAC2DE;font-size:11px;border-radius:5px;cursor:pointer;touch-action:manipulation">关闭面板</button>' +
        '<button id="scope-panel-copybtn" style="flex:1;padding:4px 0;border:none;background:#89B4FA;color:#1E1E2E;font-size:11px;border-radius:5px;cursor:pointer;touch-action:manipulation">复制全部</button>' +
      '</div>'
    _scope._panel = panel; document.body.appendChild(panel)

    // 底部按钮
    bindEl(document.getElementById('scope-panel-closebtn'), function() { closePanel() })
    bindEl(document.getElementById('scope-panel-copybtn'), function() { copyAllInfo() })

    // 拖动
    panel.addEventListener('touchstart', startDragPanel, { passive: false })
    panel.addEventListener('touchmove', moveDragPanel, { passive: false })
    panel.addEventListener('touchend', endDragPanel)

    // 工具栏
    let tb = document.createElement('div')
    tb.id = 'scope-toolbar'
    tb.style.cssText = 'position:fixed;z-index:10000;left:8px;right:8px;display:flex;gap:6px;justify-content:center;padding:6px 8px;transition:all .25s ease;background:#1E1E2E;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,.5)'
    positionToolbar(tb)
    tb.innerHTML =
      '<button id="scope-btn-swap" style="flex:1;border:none;background:rgba(255,255,255,0.06);color:#BAC2DE;font-size:13px;border-radius:8px;padding:10px 0;cursor:pointer;touch-action:manipulation">交换</button>' +
      '<button id="scope-btn-down" style="flex:1;border:none;background:rgba(255,255,255,0.06);color:#BAC2DE;font-size:13px;border-radius:8px;padding:10px 0;cursor:pointer;touch-action:manipulation">扩大</button>' +
      '<button id="scope-btn-up" style="flex:1;border:none;background:rgba(255,255,255,0.06);color:#BAC2DE;font-size:13px;border-radius:8px;padding:10px 0;cursor:pointer;touch-action:manipulation">缩小</button>' +
      '<button id="scope-btn-cancel" style="flex:1;border:none;background:rgba(74,144,217,0.15);color:#89B4FA;font-size:13px;border-radius:8px;padding:10px 0;cursor:pointer;touch-action:manipulation">取消</button>'
    _scope._toolbar = tb; document.body.appendChild(tb)

    bindEl(document.getElementById('scope-btn-swap'), swapToolbar)
    bindEl(document.getElementById('scope-btn-down'), function() { navigateScope('up') })
    bindEl(document.getElementById('scope-btn-up'), function() { navigateScope('down') })
    bindEl(document.getElementById('scope-btn-cancel'), exitScope)
  }

  function destroyScopeDOM() {
    if (_scope._highlight) { _scope._highlight.remove(); _scope._highlight = null }
    if (_scope._panel) { _scope._panel.remove(); _scope._panel = null }
    if (_scope._toolbar) { _scope._toolbar.remove(); _scope._toolbar = null }
  }

  function positionToolbar(tb) {
    tb.style.top = ''; tb.style.bottom = ''
    if (_scope.toolbarAtTop) tb.style.top = 'max(12px,env(safe-area-inset-top))'
    else tb.style.bottom = 'max(12px,env(safe-area-inset-bottom))'
  }

  // ==================== 工具栏操作 ====================

  function swapToolbar() {
    _scope.toolbarAtTop = !_scope.toolbarAtTop
    positionToolbar(_scope._toolbar)
    toast('工具栏已移至' + (_scope.toolbarAtTop ? '顶部' : '底部'))
  }

  // 扩大/缩小选区：在 DOM 树中上下穿梭
  function navigateScope(direction) {
    if (!_scope._currentEl) { toast('请先点击一个元素'); return }
    let el = _scope._currentEl
    if (direction === 'up') {
      // 扩大到父元素
      let p = el.parentElement
      if (p && p !== document.body && p !== document.documentElement) {
        _scope._currentEl = p
        highlightEl(p)
        showPanel(p)
        toast('↑ ' + tagStr(p))
      } else {
        toast('已到达顶层')
      }
    } else {
      // 缩小到第一个有意义的子元素
      let children = el.children
      if (children.length > 0) {
        _scope._currentEl = children[0]
        highlightEl(children[0])
        showPanel(children[0])
        toast('↓ ' + tagStr(children[0]))
      } else {
        toast('已是叶子节点')
      }
    }
  }

  // ==================== 元素点击 ====================

  function onScopeTouch(e) {
    if (_scope._lockUntil && Date.now() < _scope._lockUntil) return
    let t = e.target
    if (t && (t.closest('#scope-toolbar') || t.closest('#scope-panel'))) return
    e.preventDefault(); e.stopPropagation()
    onScopeClick(e)
  }

  function onScopeClick(e) {
    if (_scope._lockUntil && Date.now() < _scope._lockUntil) return
    if (!_scope.active) return
    let t = e.target
    if (t && (t.closest('#scope-toolbar') || t.closest('#scope-panel'))) return
    e.preventDefault(); e.stopPropagation()
    _scope._currentEl = e.target
    highlightEl(e.target)
    showPanel(e.target)
  }

  function highlightEl(el) {
    let hl = _scope._highlight
    if (!hl || !el) return
    let r = el.getBoundingClientRect()
    hl.style.display = 'block'
    hl.style.left = r.left + 'px'; hl.style.top = r.top + 'px'
    hl.style.width = r.width + 'px'; hl.style.height = r.height + 'px'
  }

  // ==================== 信息面板 ====================

  let _panelProps = {}  // 缓存当前面板的属性，供逐条复制

  function showPanel(el) {
    let panel = _scope._panel
    let content = document.getElementById('scope-panel-content')
    if (!panel || !content) return

    let r = el.getBoundingClientRect()
    let cs = window.getComputedStyle(el)
    let tag = el.tagName.toLowerCase()
    let id = el.id || ''
    let cls = (typeof el.className === 'string') ? el.className.replace(/\s+/g, '.') : ''

    // 选择器标识（构建纯文本，供复制使用）
    let selText = tag
    if (id) selText += '#' + id
    if (cls) selText += '.' + cls

    let selHtml = '<span style="color:#89B4FA;font-weight:700">' + tag + '</span>'
    if (id) selHtml += '<span style="color:#F9E2AF">#' + App.utils.escapeHtml(id) + '</span>'
    if (cls) selHtml += '<span style="color:#A6E3A1">.' + App.utils.escapeHtml(cls) + '</span>'

    // 属性列表（每一项可点击复制）
    let rows = [
      ['选择器', selText], ['标签', tag], ['ID', id || '(无)'], ['Class', cls || '(无)'],
      ['尺寸', Math.round(r.width) + '×' + Math.round(r.height)],
      ['位置', Math.round(r.left) + ',' + Math.round(r.top)],
      ['字体', cs.fontSize + ' ' + cs.fontFamily.split(',')[0].replace(/"/g,'')],
      ['颜色', cs.color],
      ['背景', cs.backgroundColor === 'rgba(0, 0, 0, 0)' ? '透明' : cs.backgroundColor],
      ['display', cs.display],
      ['position', cs.position],
      ['z-index', cs.zIndex || 'auto'],
      ['overflow', cs.overflowX + '/' + cs.overflowY],
      ['pointer-events', cs.pointerEvents]
    ]

    _panelProps = {}
    let html = '<div style="margin-bottom:6px;cursor:pointer;padding:2px 4px;border-radius:3px" class="scope-prop-val" data-key="选择器">' + selHtml + '</div>'
    html += '<div style="display:grid;grid-template-columns:auto 1fr;gap:1px 6px">'
    rows.forEach(function(row) {
      let key = row[0], val = row[1]
      _panelProps[key] = val
      html += '<div style="color:#6C7086;white-space:nowrap">' + key + '</div>'
      html += '<div class="scope-prop-val" data-key="' + key + '" style="color:#CDD6F4;word-break:break-all;cursor:pointer;padding:1px 2px;border-radius:2px;transition:background .1s" onmouseover="this.style.background=\'rgba(255,255,255,0.05)\'" onmouseout="this.style.background=\'none\'">' + App.utils.escapeHtml(String(val)) + '</div>'
    })
    html += '</div>'

    content.innerHTML = html
    panel.style.display = 'block'

    // 自适应高度：内容行数 × 行高 + 头部 + 底部按钮 + 内边距
    let lineH = 18
    let contentH = rows.length * lineH + 50
    let toolbarH = _scope._toolbar ? _scope._toolbar.offsetHeight + 16 : 60
    let safeH = window.innerHeight - toolbarH - 24
    let maxH = Math.min(safeH, 520)
    let h = Math.round(Math.max(panel._baseHeight, Math.min(contentH + 40, maxH)))
    panel.style.height = h + 'px'

    // 每条属性可点击复制
    content.querySelectorAll('.scope-prop-val').forEach(function(el) {
      bindEl(el, function() {
        let k = el.dataset.key
        App.ui.copyText(_panelProps[k] || '', '已复制: ' + k)
      })
    })
  }

  function copyAllInfo() {
    if (Object.keys(_panelProps).length === 0) { toast('请先选取一个元素'); return }
    let lines = []
    for (let k in _panelProps) { lines.push(k + ': ' + _panelProps[k]) }
    App.ui.copyText(lines.join('\n'), '已复制全部属性')
  }

  function closePanel() {
    if (_scope._panel) _scope._panel.style.display = 'none'
    if (_scope._highlight) _scope._highlight.style.display = 'none'
    _scope._currentEl = null
    _scope._lockUntil = Date.now() + 350  // 防穿透
    toast('面板已关闭 · 点击元素重新打开')
  }

  // ==================== 面板拖动 ====================

  function startDragPanel(e) {
    // 仅从面板头部 28px 手柄区启动拖动；下方区域保留给内容滚动
    const t = e.touches[0]
    const rect = _scope._panel.getBoundingClientRect()
    if (t.clientY - rect.top > 28) return
    if (e.target.closest('#scope-panel-closebtn') || e.target.closest('#scope-panel-copybtn') ||
        e.target.closest('.scope-prop-val')) return
    const panel = _scope._panel
    _scope._dragState = {
      startX: t.clientX, startY: t.clientY,
      startLeft: panel.offsetLeft, startTop: panel.offsetTop
    }
  }

  function moveDragPanel(e) {
    if (!_scope._dragState) return
    e.preventDefault()
    let t = e.touches[0]
    let ds = _scope._dragState
    let panel = _scope._panel
    panel.style.left = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, ds.startLeft + t.clientX - ds.startX)) + 'px'
    panel.style.top = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, ds.startTop + t.clientY - ds.startY)) + 'px'
    panel.style.marginLeft = '0'  // 首次拖动后取消居中
  }

  function endDragPanel() { _scope._dragState = null }

  // ==================== 工具函数 ====================

  function bindEl(el, fn) {
    if (!el) return
    // 移动端一次触摸会依次合成 touchstart → mousedown → click，三监听器若不
    // 去重会导致 fn 一次执行 3 次。250ms 时间去重：同一手势只放行第一个事件。
    let lastFire = 0
    function fire() {
      let now = Date.now()
      if (now - lastFire < 250) return
      lastFire = now
      fn()
    }
    // touchstart 不调用 preventDefault()，保留用户手势令牌供剪贴板 API 使用
    el.addEventListener('touchstart', function(e) { e.stopPropagation(); fire() }, { passive: true })
    el.addEventListener('mousedown', function(e) { e.stopPropagation(); fire() })
    el.addEventListener('click', function(e) { e.stopPropagation(); fire() })
  }

  function tagStr(el) {
    let s = el.tagName.toLowerCase()
    if (el.id) s += '#' + el.id
    return s
  }

  function toast(msg) {
    if (typeof App.toast.show === 'function') App.toast.show(msg)
  }

  // ==================== 启动 ====================
  document.addEventListener('DOMContentLoaded', initInspector)

  return {
    initInspector: initInspector,
    cancelFabTimer: cancelFabTimer,
    isActive: isActive
  }
})()
