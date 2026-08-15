/* 文件系统 API：Promise 封装 window.FileBridge（Java 桥）。
 * 桥协议: FileBridge[method](...args, cbId)，Java 异步完成后
 *        evaluateJavascript("window.__fbResolve('cbId', {ok,data|error})")
 * 浏览器预览（无桥）时回退到内存假文件系统，保证 UI 可独立开发调试。
 */
'use strict'

App.FileAPI = (function () {
  let pending = {}
  let seq = 0

  function call(method, args, timeoutMs) {
    return new Promise(function (resolve, reject) {
      if (!window.FileBridge) {
        reject(new Error('FileBridge 不可用（当前环境无原生桥）'))
        return
      }
      let id = 'cb' + (++seq)
      pending[id] = { resolve: resolve, reject: reject }
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

  return {
    rootInfo: function () { return call('rootInfo', []) },
    list: function (path) { return call('list', [path || '']) },
    read: function (path) { return call('read', [path]) },
    write: function (path, content) { return call('write', [path, content]) },
    mkdir: function (path) { return call('mkdir', [path]) },
    del: function (path) { return call('delete', [path]) },
    rename: function (oldPath, newPath) { return call('rename', [oldPath, newPath]) },
    copy: function (srcPath, dstPath) { return call('copy', [srcPath, dstPath]) },
    // 文件 → WebView 可直接加载的 URI（content:// 或 file://），媒体流式访问用（不搬入内存）
    resolveUri: function (path) { return call('resolveUri', [path]) },
    // 缩略图：桥层采样解码 / 视频首帧提取 → file:// 缓存 URI（磁盘缓存 + 内存可控）
    thumb: function (path) { return call('thumb', [path]) },
    // 交外部应用打开（ACTION_VIEW；无可用应用时 reject）
    openExternal: function (path) { return call('openExternal', [path]) },
    // 已安装应用：查询 launcher 应用列表（[{package,label,isSystem}]）
    listApps: function () { return call('listApps', []) },
    // 启动指定包名应用（getLaunchIntentForPackage + startActivity）
    launchApp: function (pkg) { return call('launchApp', [pkg]) },
    // 应用图标：PackageManager Drawable → base64 data URI（列表/快捷方式展示用）
    appIcon: function (pkg) { return call('appIcon', [pkg]) },
    hasBridge: function () { return !!window.FileBridge }
  }
})()
