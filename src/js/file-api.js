/* 文件系统 API：Promise 封装 window.FileBridge（Java 桥）。
 * 桥协议: FileBridge[method](...args, cbId)，Java 异步完成后
 *        evaluateJavascript("window.__fbResolve('cbId', {ok,data|error})")
 * 浏览器预览（无桥）时回退到内存假文件系统，保证 UI 可独立开发调试。
 */
// @ts-check
'use strict'

App.FileAPI = (function () {
  /**
   * 桥调用排队项（pending 表值）
   * @typedef {Object} PendingCall
   * @property {(data: any) => void} resolve
   * @property {(err: Error) => void} reject
   * @property {((p: FbProgress) => void) | null} onProgress
   */

  /** @type {Record<string, PendingCall>} */
  let pending = {}
  let seq = 0

  /** @param {string} method @param {Array<any>} args @param {number} [timeoutMs] @param {((p: FbProgress) => void) | null} [onProgress] @returns {Promise<any>} */
  function call(method, args, timeoutMs, onProgress) {
    return new Promise(function (resolve, reject) {
      if (!window.FileBridge) {
        reject(new Error('FileBridge 不可用（当前环境无原生桥）'))
        return
      }
      let id = 'cb' + (++seq)
      pending[id] = { resolve: resolve, reject: reject, onProgress: onProgress || null }
      let callArgs = args.concat([id])
      try {
        window.FileBridge[method].apply(window.FileBridge, callArgs)
      } catch (e) {
        delete pending[id]
        reject(e)
      }
      setTimeout(function () {
        if (pending[id]) {
          delete pending[id]
          reject(new Error('文件操作超时: ' + method))
        }
      }, timeoutMs || 10000)
    })
  }

  // 全局回调（Java 桥 evaluateJavascript 调用）
  window.__fbResolve = function (id, result) {
    let p = pending[id]
    if (!p) return
    delete pending[id]
    if (result && result.ok) {
      p.resolve(result.data)
    } else {
      p.reject(new Error((result && result.error) || '未知错误'))
    }
  }

  // 进度回调（Java 桥传输中周期性推送）：{path, done, total}（字节）
  // 桥层节流（约 200ms 一次），前端直接刷新当前文件行，不触发 Promise
  window.__fbProgress = function (id, payload) {
    let p = pending[id]
    if (!p || !p.onProgress || !payload) return
    p.onProgress(payload)
  }

  /** @type {FileApi} */
  return {
    rootInfo: function () { return call('rootInfo', []) },
    list: function (path) { return call('list', [path || '']) },
    read: function (path) { return call('read', [path]) },
    write: function (path, content) { return call('write', [path, content]) },
    mkdir: function (path) { return call('mkdir', [path]) },
    del: function (path) { return call('delete', [path]) },
    // ⚠️ 注意：del 桥方法 = 永久删除（File.delete / DocumentFile.delete）。
    // 前端业务删除禁止调用本方法——删除 = 移入回收站（.trash）走 move 管道
    // （Actions.deleteSelection），本方法仅保留为低层能力（见 docs/bridge-and-data-contract.md 1.4）。
    rename: function (oldPath, newPath) { return call('rename', [oldPath, newPath]) },
    // 复制（长超时：大文件可能远超默认 10s；超时只兜底不取消，避免误报失败）
    // onProgress: ({path, done, total}) => void（字节级进度，桥层节流约 200ms 一次）
    copy: function (srcPath, dstPath, onProgress) { return call('copy', [srcPath, dstPath], 300000, onProgress) },
    // 移动（真移动优先，桥层失败自动降级 copy+delete）：剪切粘贴/拖入文件夹/移入回收站共用
    // 长超时 + onProgress 同上
    move: function (srcPath, dstPath, onProgress) { return call('move', [srcPath, dstPath], 300000, onProgress) },
    // 取消当前传输（复制/移动降级路径）：桥层置取消标志，当前任务尽快中止并清理半成品
    cancelTransfer: function () { return call('cancelTransfer', [], 10000) },
    // 文件 → WebView 可直接加载的 URI（content:// 或 file://），媒体流式访问用（不搬入内存）
    resolveUri: function (path) { return call('resolveUri', [path]) },
    // 缩略图：桥层采样解码 / 视频首帧提取 → file:// 缓存 URI（磁盘缓存 + 内存可控）
    thumb: function (path) { return call('thumb', [path]) },
    // 交外部应用打开（ACTION_VIEW；无可用应用时 reject）
    openExternal: function (path) { return call('openExternal', [path]) },
    // 用系统浏览器打开网址（ACTION_VIEW http/https；无浏览器时 reject）
    openUrl: function (url) { return call('openUrl', [url]) },
    // 网页上传桥：回传待上传文件路径（原生 resolveUri 后回传网页；无请求时回传失败）
    completeUpload: function (paths) { return call('completeUpload', [paths]) },
    // 网页上传桥：原生弹系统文件选择器（无请求时忽略）
    chooseUploadFromSystem: function () { return call('chooseUploadFromSystem', []) },
    // 网页上传桥：取消（回传 null，网页侧视为用户取消）
    cancelUpload: function () { return call('cancelUpload', []) },
    // 已安装应用：查询 launcher 应用列表（[{package,label,isSystem}]）
    listApps: function () { return call('listApps', []) },
    // 启动指定包名应用（getLaunchIntentForPackage + startActivity）
    launchApp: function (pkg) { return call('launchApp', [pkg]) },
    // 应用图标：PackageManager Drawable → base64 data URI（列表/快捷方式展示用）
    appIcon: function (pkg) { return call('appIcon', [pkg]) },
    hasBridge: function () { return !!window.FileBridge }
  }
})()
