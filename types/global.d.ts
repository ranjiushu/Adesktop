/* 全局类型声明：仅类型检查用（tsc --noEmit），不参与构建。
 * build-web.sh 只拼接 JS_ORDER 登记文件，本文件不会进产物。
 * 渐进式路线：JS 文件头部加 // @ts-check 后，此处声明的类型即生效。
 */

/** 相机视角（桌面空间 / Home 快照共用形状） */
interface AppCamera {
  x: number
  y: number
  zoom: number
}

/** 平面坐标（图标布局条目） */
interface Position2D {
  x: number
  y: number
}

/** Java 桥异步回调负载（evaluateJavascript 回传） */
interface FbResult {
  ok: boolean
  data?: any
  error?: string
}

/** 传输进度负载（字节） */
interface FbProgress {
  path: string
  done: number
  total: number
}

/** 原生桥（@JavascriptInterface 暴露，方法签名见 docs/bridge-and-data-contract.md） */
interface FileBridge {
  [method: string]: (...args: any[]) => void
}

/** 文件系统 API（App.FileAPI，Promise 化桥封装） */
interface FileApi {
  rootInfo(): Promise<any>
  list(path?: string): Promise<any>
  read(path: string): Promise<any>
  write(path: string, content: string): Promise<any>
  mkdir(path: string): Promise<any>
  del(path: string): Promise<any>
  rename(oldPath: string, newPath: string): Promise<any>
  copy(srcPath: string, dstPath: string, onProgress?: (p: FbProgress) => void): Promise<any>
  move(srcPath: string, dstPath: string, onProgress?: (p: FbProgress) => void): Promise<any>
  cancelTransfer(): Promise<any>
  resolveUri(path: string): Promise<any>
  thumb(path: string): Promise<any>
  openExternal(path: string): Promise<any>
  openUrl(url: string): Promise<any>
  completeUpload(paths: string[]): Promise<any>
  chooseUploadFromSystem(): Promise<any>
  cancelUpload(): Promise<any>
  listApps(): Promise<any>
  launchApp(pkg: string): Promise<any>
  appIcon(pkg: string): Promise<any>
  hasBridge(): boolean
}

/** 布局存储（App.LayoutStore）：localStorage 图标位置 + 相机视角 */
interface AppLayoutData {
  version?: number
  icons?: Record<string, Position2D>
  camera?: AppCamera
}

interface LayoutStore {
  load(rootId: string): AppLayoutData | null
  save(data: AppLayoutData, rootId: string): boolean
  migrateLegacy(rootId: string): boolean
  keyFor(rootId: string): string
  KEY: string
}

/** Home 快照（App.HomeStore）：竖屏/横屏槽位，见 docs/operation-contract.md */
interface HomeSnapshot {
  home?: AppCamera
  fallback?: AppCamera
}

/** Home 存储持久化结构（含横屏槽位；动态槽位键映射见 home-store.js fields()） */
interface HomeStoreData {
  version: number
  home?: AppCamera
  fallback?: AppCamera
  landscapeHome?: AppCamera
  landscapeFallback?: AppCamera
  [key: string]: any
}

interface HomeStore {
  load(rootId: string, rotation?: number): HomeSnapshot | null
  saveHome(camera: AppCamera, rootId: string, rotation?: number): boolean
  saveFallback(camera: AppCamera, rootId: string, rotation?: number): boolean
  migrateLegacy(rootId: string): boolean
  keyFor(rootId: string): string
  KEY: string
  DEFAULT_CAMERA: AppCamera
}

/** App 全局命名空间（namespace.js 声明，各模块挂载；未列模块为渐进式待覆盖） */
interface AppNamespace {
  NAME: string
  VERSION: string
  BUILD: number
  BUILD_TIME: string
  FileAPI: FileApi
  LayoutStore: LayoutStore
  HomeStore: HomeStore
}

declare var App: AppNamespace

interface Window {
  App: AppNamespace
  FileBridge?: FileBridge
  __fbResolve: (id: string, result: FbResult) => void
  __fbProgress: (id: string, payload: FbProgress) => void
}
