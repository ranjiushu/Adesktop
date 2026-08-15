/* 基础 Markdown 渲染器：纯函数，输入 md 文本输出 HTML 片段（零依赖，可单测）。
 * 支持：标题 / 无序·有序列表 / 代码块 / 行内代码 / 粗体 / 斜体 / 链接 / 引用 / 分割线 / 段落。
 * 安全：先整体转义 HTML，再做行内标记——原始内容不可能注入标签。
 * 限制（本阶段刻意不做）：表格、嵌套列表、图片、HTML 直通、下划线斜体。
 * 依赖: namespace.js
 * 导出: App.Markdown
 */
'use strict'

App.Markdown = (function () {
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  // 行内标记（先整体转义 HTML 防注入，再做标记；顺序：code → bold → italic → link）
  // 顺序依赖：先占住 `code`，再处理 ** 粗体，剩余单 * 才是斜体；
  // 链接最后处理，url 协议白名单（防 javascript: 注入）。
  function inline(text) {
    let t = escapeHtml(text)
    t = t.replace(/`([^`]+)`/g, '<code>$1</code>')
    t = t.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>')
    t = t.replace(/__([^_]+?)__/g, '<strong>$1</strong>')
    t = t.replace(/\*([^*]+?)\*/g, '<em>$1</em>')
    t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (m, label, url) {
      const safe = safeUrlRaw(url)
      if (safe) return '<a href="' + safe + '">' + label + '</a>'
      return label
    })
    return t
  }

  // 链接协议白名单：http/https/mailto/相对路径（含锚点）；其余（javascript: 等）仅显示文本
  function safeUrl(url) {
    const u = String(url).trim()
    if (!u) return ''
    if (/^(https?:|mailto:)/i.test(u)) return escapeHtml(u)
    if (/^[#/.]/i.test(u)) return escapeHtml(u)
    if (/^[a-z0-9][a-z0-9+.-]*:/i.test(u)) return ''   // 其他协议一律拒绝
    return escapeHtml(u)
  }

  // 行内链接专用：输入已整体转义，只做协议校验（不重复转义，避免 & 双转义）
  function safeUrlRaw(url) {
    const u = String(url).trim()
    if (!u) return ''
    if (/^(https?:|mailto:)/i.test(u)) return u
    if (/^[#/.]/i.test(u)) return u
    if (/^[a-z0-9][a-z0-9+.-]*:/i.test(u)) return ''   // 其他协议一律拒绝
    return u
  }

  // 块级解析：输入 md 原文 → HTML 片段
  // 逐行扫描；围栏代码块 / 列表 / 引用做连续行聚合，其余按空行分段。
  function render(md) {
    const lines = String(md == null ? '' : md).replace(/\r\n?/g, '\n').split('\n')
    const out = []
    let i = 0
    let inFence = false
    let fenceLang = ''
    const fenceBuf = []

    while (i < lines.length) {
      const line = lines[i]

      // 围栏代码块
      if (/^\s*```/.test(line)) {
        if (!inFence) {
          inFence = true
          fenceLang = line.replace(/^\s*```\s*/, '').trim()
        } else {
          inFence = false
          const code = fenceBuf.join('\n')
          out.push('<pre><code' + (fenceLang ? ' class="lang-' + escapeHtml(fenceLang) + '"' : '') + '>' + escapeHtml(code) + '</code></pre>')
          fenceBuf.length = 0
        }
        i++
        continue
      }
      if (inFence) {
        fenceBuf.push(line)
        i++
        continue
      }

      // 标题
      let m = /^(#{1,6})\s+(.*)$/.exec(line)
      if (m) {
        const level = m[1].length
        out.push('<h' + level + '>' + inline(m[2]) + '</h' + level + '>')
        i++
        continue
      }

      // 分割线
      if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
        out.push('<hr>')
        i++
        continue
      }

      // 引用：连续 > 行聚合
      if (/^\s*>\s?/.test(line)) {
        const buf = []
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
          buf.push(lines[i].replace(/^\s*>\s?/, ''))
          i++
        }
        out.push('<blockquote>' + inline(buf.join(' ')) + '</blockquote>')
        continue
      }

      // 无序列表：连续 - / * / + 行聚合；缩进续行并入当前项（多行列表项）
      if (/^\s*[-*+]\s+/.test(line)) {
        const buf = []
        while (i < lines.length) {
          const l = lines[i]
          if (/^\s*[-*+]\s+/.test(l)) {
            buf.push('<li>' + inline(l.replace(/^\s*[-*+]\s+/, '')) + '</li>')
            i++
          } else if (/^\s{2,}\S/.test(l)) {
            // 续行：并入上一项（软换行 = 空格，与段落聚合口径一致）
            buf[buf.length - 1] = buf[buf.length - 1].replace(/<\/li>$/, ' ' + inline(l.trim()) + '</li>')
            i++
          } else {
            break
          }
        }
        out.push('<ul>' + buf.join('') + '</ul>')
        continue
      }

      // 有序列表：连续数字. 行聚合；缩进续行并入当前项
      if (/^\s*\d+\.\s+/.test(line)) {
        const buf = []
        while (i < lines.length) {
          const l = lines[i]
          if (/^\s*\d+\.\s+/.test(l)) {
            buf.push('<li>' + inline(l.replace(/^\s*\d+\.\s+/, '')) + '</li>')
            i++
          } else if (/^\s{2,}\S/.test(l)) {
            buf[buf.length - 1] = buf[buf.length - 1].replace(/<\/li>$/, ' ' + inline(l.trim()) + '</li>')
            i++
          } else {
            break
          }
        }
        out.push('<ol>' + buf.join('') + '</ol>')
        continue
      }

      // 空行：跳过（段落由非空行聚合）
      if (/^\s*$/.test(line)) {
        i++
        continue
      }

      // 段落：聚合连续非空行（单换行 → 空格）
      const buf = []
      while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^\s*```/.test(lines[i])) {
        buf.push(lines[i].trim())
        i++
      }
      out.push('<p>' + inline(buf.join(' ')) + '</p>')
    }

    // 未闭合围栏：按已收集内容输出（不吞内容）
    if (inFence) {
      out.push('<pre><code>' + escapeHtml(fenceBuf.join('\n')) + '</code></pre>')
    }
    return out.join('\n')
  }

  return {
    render: render,
    inline: inline,
    escapeHtml: escapeHtml,
    safeUrl: safeUrl
  }
})()
