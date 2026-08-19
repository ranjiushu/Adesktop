/* 全局命名空间：所有模块挂载到 App 上，禁止裸全局变量（构建注入变量除外） */
// @ts-check
'use strict'

window.App = /** @type {AppNamespace} */ (window.App || {})

App.NAME = 'Adesktop'
App.VERSION = '0.1.0'
App.BUILD = typeof BUILD_COUNT !== 'undefined' ? BUILD_COUNT : 0
App.BUILD_TIME = typeof BUILD_TIMESTAMP !== 'undefined' ? BUILD_TIMESTAMP : ''
