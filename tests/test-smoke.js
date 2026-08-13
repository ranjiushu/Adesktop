// 冒烟测试：验证 dist/desktop.bundle.html 存在且结构正确
// 用法: node test-smoke.js [项目路径]   （由 run-tests.sh 调用）
'use strict'

const fs = require('fs')
const path = require('path')

const PROJECT = process.argv[2] || path.join(__dirname, '..')
const BUNDLE = path.join(PROJECT, 'dist', 'desktop.bundle.html')

let failures = 0
function check(cond, msg) {
  if (cond) {
    console.log('  [ok] ' + msg)
  } else {
    console.error('  [fail] ' + msg)
    failures++
  }
}

if (!fs.existsSync(BUNDLE)) {
  console.error('[fail] 未找到 ' + BUNDLE + '（先运行 bash tools/build-web.sh）')
  process.exit(1)
}

const s = fs.readFileSync(BUNDLE, 'utf8')

// 1. 无残留占位符
check(!s.includes('__STYLE_PLACEHOLDER__') && !s.includes('__JS_PLACEHOLDER__'), '无残留占位符')

// 2. 结构：1 个 style + 1 个 script + DOCTYPE
const styles = (s.match(/<style>/g) || []).length
const scripts = (s.match(/<script>/g) || []).length
check(styles === 1, '<style> 恰好 1 个 (实际 ' + styles + ')')
check(scripts === 1, '<script> 恰好 1 个 (实际 ' + scripts + ')')
check(s.includes('<!DOCTYPE html>'), '包含 DOCTYPE')

// 3. 注入变量存在
check(/var BUILD_COUNT=\d+;/.test(s), 'BUILD_COUNT 注入存在')
check(/var BUILD_TIMESTAMP='[^']+';/.test(s), 'BUILD_TIMESTAMP 注入存在')

// 4. 关键内容存在
check(s.includes('App.NAME'), 'namespace.js 已进产物')
check(s.includes('App.utils'), 'utils.js 已进产物')
check(s.includes('App.bridge'), 'bridge.js 已进产物')
check(s.includes('App.toast'), 'toast.js 已进产物')
check(s.includes('App.FileAPI'), 'file-api.js 已进产物')
check(s.includes('App.Desktop'), 'desktop.js 已进产物')
check(s.includes('App.fabSpeedDial'), 'fab-speed-dial.js 已进产物')
check(s.includes('App.inspector'), 'inspector.js 已进产物')
check(s.includes('App.boot'), 'main.js 已进产物')
check(s.includes('--color-accent'), 'tokens.css 已进产物')
check(s.includes('app-shell'), 'shell.css 已进产物')
check(s.includes('desktop-grid'), 'desktop.css 已进产物')
check(s.includes('mode-switch-fab'), 'fab.css 已进产物')
check(s.includes('toast-visible'), 'toast.css 已进产物')
check(s.includes('id="desktop-grid"'), 'index.html 桌面容器已进产物')
check(s.includes('id="mode-switch-fab"'), 'index.html FAB 已进产物')
check(s.includes('id="fab-speed-dial"'), 'index.html Speed Dial 已进产物')
check(s.includes('data-action="new-folder"'), 'index.html 新建文件夹按钮已进产物')
check(s.includes('data-action="switch-root"'), 'index.html 切换根目录按钮已进产物')

if (failures > 0) {
  console.error('[fail] 冒烟测试失败 ' + failures + ' 项')
  process.exit(1)
}
console.log('[ok] 冒烟测试全部通过')
process.exit(0)
