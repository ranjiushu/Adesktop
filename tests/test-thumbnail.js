// thumbnail.js（ThumbnailService）单元测试：可缩略图判定 / 渐进式获取 /
// 缓存命中 / 请求去重 / 失败回退。vm 加载真实 thumbnail.js + namespace.js，
// 桩 FileAPI.resolveUri + Image（可控 onload/onerror）。
// 用法: node test-thumbnail.js [项目路径]   （由 run-tests.sh 调用）
'use strict'

const fs = require('fs')
const path = require('path')
const vm = require('vm')

const PROJECT = process.argv[2] || path.join(__dirname, '..')
const SRC = path.join(PROJECT, 'src', 'js')

let failures = 0
function check(cond, msg) {
  if (cond) console.log('  [ok] ' + msg)
  else { console.error('  [fail] ' + msg); failures++ }
}

// ── 可控依赖 ──
const calls = { resolveUri: [] }
const images = []          // 创建的 FakeImage 实例（供测试手动触发 onload/onerror）
let resolveUriDeferred = null
let resolveUriShouldReject = false

function resetCalls() {
  calls.resolveUri.length = 0
  images.length = 0
  resolveUriDeferred = null
  resolveUriShouldReject = false
}

const sandbox = {
  App: {},
  window: { App: {} },
  console: console,
  setTimeout: setTimeout,
  Promise: Promise,
  Image: function FakeImage() {
    this.src = null
    this.onload = null
    this.onerror = null
    images.push(this)
  }
}
vm.createContext(sandbox)
vm.runInContext(fs.readFileSync(path.join(SRC, 'namespace.js'), 'utf8'), sandbox, { filename: 'namespace.js' })
vm.runInContext(fs.readFileSync(path.join(SRC, 'thumbnail.js'), 'utf8'), sandbox, { filename: 'thumbnail.js' })

sandbox.App.FileAPI = {
  resolveUri: function (path) {
    calls.resolveUri.push(path)
    return new Promise(function (resolve, reject) {
      if (resolveUriShouldReject) { reject(new Error('无法解析')); return }
      resolveUriDeferred = function (uri) { resolve(uri) }
    })
  }
}

const T = sandbox.App.Thumbnail
const tick = function () { return new Promise(function (r) { setTimeout(r, 10) }) }

// 推进到 Image.src 已设置（resolveUri resolved → .then 执行 → new Image + img.src=uri）
async function settleImage(onload) {
  await tick()
  if (images.length > 0) {
    const img = images[images.length - 1]
    if (onload) img.onload()
    else img.onerror()
  }
  await tick()
}

async function main() {
  // ── 可缩略图判定（本次仅 image；video 预留 false）──
  check(T.canThumbnail('image') === true, 'canThumbnail(image) = true')
  check(T.canThumbnail('video') === false, 'canThumbnail(video) = false（桥层帧提取前预留）')
  check(T.canThumbnail('text') === false, 'canThumbnail(text) = false')
  check(T.canThumbnail('unknown') === false, 'canThumbnail(unknown) = false')

  // ── 成功路径：resolveUri + Image onload → onReady(uri) ──
  resetCalls()
  let readyUri = null
  T.request('a.jpg', 'a.jpg', 'image', function (uri) { readyUri = uri }, function () {})
  resolveUriDeferred('file:///a.jpg')
  await settleImage(true)
  check(calls.resolveUri.length === 1, 'request 成功 → resolveUri 调用 1 次')
  check(readyUri === 'file:///a.jpg', 'request 成功 → onReady(uri)')

  // ── 缓存命中：同 path 再次 request → 立即 onReady，不再 resolveUri ──
  let cacheReady = null
  T.request('a.jpg', 'a.jpg', 'image', function (uri) { cacheReady = uri }, function () {})
  check(calls.resolveUri.length === 1, '缓存命中 → 不再次 resolveUri')
  check(cacheReady === 'file:///a.jpg', '缓存命中 → 立即 onReady(uri)')

  // ── 请求去重：resolve 未完成时并发 request 合并，只 resolveUri 一次 ──
  resetCalls()
  let r1 = null, r2 = null
  T.request('b.png', 'b.png', 'image', function (uri) { r1 = uri }, function () {})
  T.request('b.png', 'b.png', 'image', function (uri) { r2 = uri }, function () {})
  check(calls.resolveUri.length === 1, '并发同 path → 只 resolveUri 1 次（去重）')
  resolveUriDeferred('file:///b.png')
  await settleImage(true)
  check(r1 === 'file:///b.png' && r2 === 'file:///b.png', '去重 → 两个 waiter 都收到 onReady')

  // ── 失败路径 1：resolveUri reject → onFallback ──
  resetCalls()
  let f1 = false
  resolveUriShouldReject = true
  T.request('c.jpg', 'c.jpg', 'image', function () {}, function () { f1 = true })
  await settleImage(false)
  check(f1 === true, 'resolveUri reject → onFallback')

  // ── 失败路径 2：Image onerror → onFallback ──
  resetCalls()
  let f2 = false
  T.request('d.jpg', 'd.jpg', 'image', function () {}, function () { f2 = true })
  resolveUriDeferred('file:///d.jpg')
  await settleImage(false)   // 触发 onerror
  check(f2 === true, 'Image onerror → onFallback')

  // ── 失败缓存：同 path 再次 request → 立即 onFallback，不再 resolveUri ──
  let f3 = false
  T.request('d.jpg', 'd.jpg', 'image', function () {}, function () { f3 = true })
  check(calls.resolveUri.length === 1, '失败缓存 → 不再次 resolveUri')
  check(f3 === true, '失败缓存 → 立即 onFallback')

  if (failures > 0) { console.error('  [FAIL] thumbnail 测试 ' + failures + ' 项失败'); process.exit(1) }
  console.log('  [ok] thumbnail 测试全部通过')
}

main().catch(function (e) { console.error('  [FAIL] thumbnail 测试异常: ' + (e && e.stack || e)); process.exit(1) })
