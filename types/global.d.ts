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

/** 扩展 HTMLElement：bindPress 防重复绑定标记（utils.js）+ 移动目标守卫消息（move-target.js） */
interface HTMLElement {
  _bindPressBound?: boolean
  _bindPressSplitBound?: boolean
  _moveInvalidMsg?: string
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

/** 目录列表条目（FileBridge.list 返回） */
interface FileItem {
  name: string
  [key: string]: any
}

/** 文件系统 API（App.FileAPI，Promise 化桥封装） */
interface FileApi {
  rootInfo(): Promise<any>
  list(path?: string): Promise<Array<FileItem>>
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

/** 布局存储（App.LayoutStore）：localStorage 图标位置 + 相机视角。
 * camera 含 rotation（saveLayout 持久化画布旋转态，见 desktop-persist.js）。 */
interface AppLayoutData {
  version?: number
  icons?: Record<string, Position2D>
  camera?: DesktopCameraState
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

/** 运行时相机状态（DesktopCamera 约定：含画布旋转角） */
interface DesktopCameraState {
  x: number
  y: number
  zoom: number
  rotation: number
}

/** 世界/屏幕坐标点 */
interface WorldPoint {
  x: number
  y: number
}

/** canvas transform 参数（transform-origin: 0 0） */
interface TransformParams {
  tx: number
  ty: number
  zoom: number
  rotation: number
}

/** 桌面相机（App.DesktopCamera）：世界坐标 + 相机数学核心，纯函数 */
interface DesktopCamera {
  ZOOM_MIN: number
  ZOOM_MAX: number
  create(x?: number, y?: number, zoom?: number, rotation?: number): DesktopCameraState
  clampZoom(z: any): number
  easeInOutCubic(k: number): number
  lerp(from: DesktopCameraState | null, to: DesktopCameraState | null, k: number): DesktopCameraState
  lerpCentered(from: DesktopCameraState | null, to: DesktopCameraState | null, k: number, vw: number, vh: number): DesktopCameraState
  screenToWorld(sx: number, sy: number, camera: DesktopCameraState | null, vw: number, vh: number): WorldPoint
  worldToScreen(wx: number, wy: number, camera: DesktopCameraState | null, vw: number, vh: number): WorldPoint
  panBy(camera: DesktopCameraState | null, dx: number, dy: number): DesktopCameraState
  pinchBy(camera: DesktopCameraState | null, prevDist: number, curDist: number, anchorSx: number, anchorSy: number, vw: number, vh: number): DesktopCameraState
  clampToBounds(camera: DesktopCameraState | null, worldW: number, worldH: number, viewportW: number, viewportH: number): DesktopCameraState
  transform(camera: DesktopCameraState | null, vw: number, vh: number): TransformParams
  applyTo(camera: DesktopCameraState | null, el: HTMLElement | null, vw: number, vh: number): void
}

/** 视图偏好（App.ViewStore）：子文件夹视图样式 + 排序 */
interface ViewPrefs {
  viewStyle: 'grid' | 'list'
  sortBy: 'name' | 'mtime' | 'type' | 'size'
  sortDir: 1 | -1
  advancedBrowse?: boolean
}

interface ViewStore {
  load(): ViewPrefs
  save(data: ViewPrefs): boolean
  KEY: string
  DEFAULT: ViewPrefs
}

/** 目录刷新 + 布局/视图持久化（App.DesktopPersist） */
interface DesktopPersist {
  refresh(): Promise<any>
  initLayout(): void
  applyViewPrefs(prefs: ViewPrefs): void
  getViewPrefs(): ViewPrefs
  saveLayout(): void
}

/** 原生桥最小封装（App.bridge） */
interface AppBridge {
  vibrate(ms?: number, amplitude?: number): void
  requestRootAccess(): boolean
}

/** 桌面运行时状态（App.DesktopCore）：状态中枢，内存投影。
 * positions/bounds 以完整相对路径为 key；selection 存 fullPath。 */
interface DesktopCoreStateData {
  rootName: string
  mode: string
  items: Array<FileItem>
  curPath: string
  trashName: string
  rootId: string
  viewStyle: 'grid' | 'list'
  sortBy: string
  sortDir: number
  canvasH: number
}

/** 世界坐标 AABB（命中测试用） */
interface Bounds2D {
  x: number
  y: number
  w: number
  h: number
}

interface DesktopCore {
  state: DesktopCoreStateData
  positions: Record<string, Position2D>
  bounds: Record<string, Bounds2D>
  camera: DesktopCameraState | null
  rootCamera: DesktopCameraState | null
  selection: Set<string>
  iconEls: Record<string, HTMLElement>
  dragTargets: string[]
  dragStartWorld: WorldPoint | null
  dragStartPositions: Record<string, Position2D>
  _lockedPaths: Set<string>
  _advancedBrowse: boolean
  _tempNormalMode: boolean
  _emptyTapTime: number
  _refreshSeq: number
  nav: any
  _raf: (cb: () => void) => number
  _caf: (id: number) => void
  _now: () => number
  el: (tag: string, className?: string, text?: string | null) => HTMLElement
  viewportWidth: () => number
  viewportHeight: () => number
  isFolderView: () => boolean
  viewMode: () => string
  fmtSize: (size: any) => string
  fullPath: (name: string) => string
  isTrashPath: (path: string) => boolean
  inTrash: () => boolean
  dragIncludesTrash: () => boolean
  [key: string]: any
}

/** 按压处理器（utils.js） */
interface PressHandlers {
  onTap?: (e: Event) => void
  onLongPress?: (e: Event) => void
}

interface PressOpts {
  longPressMs?: number
  moveThreshold?: number
}

interface AppUtils {
  escapeHtml(str: any): string
  bindPress(btn: HTMLElement | null, handler: (e: Event) => void): void
  bindPressSplit(btn: HTMLElement | null, handlers: PressHandlers, opts?: PressOpts): void
}

/** 文件夹视图排布（App.FolderLayout）：网格/列表坐标纯函数 */
interface FolderLayout {
  gridPositions(count: number, viewportW: number): Array<Position2D>
  listPositions(count: number): Array<Position2D>
  canvasSize(count: number, viewportW: number, viewStyle: string): { w: number; h: number }
  iconWidth(viewportW: number): number
  COLS: number
  LIST_ROW_H: number
}

/** 文件夹视图排序（App.FolderSort）：传统文件管理器语义纯函数 */
interface FolderSort {
  sort(items: Array<FileItem> | null, sortBy: string, sortDir: number): Array<FileItem>
  typeKey(name: any): string
  defaultDir(sortBy: string): 1 | -1
}

/** 高级浏览模式 + 临时操作模式（App.DesktopBrowseMode） */
interface DesktopBrowseMode {
  syncBrowseMode(): void
  exitTempMode(): void
  setAdvancedBrowse(on: boolean): void
  isAdvancedBrowse(): boolean
}

/** 类型图标系统（App.TypeIcons）：类型判定 → 内联 SVG */
interface TypeIcons {
  kindFor(name: string, isDir: boolean): string
  svgFor(kind: string): string
  extOf(name: any): string
}

interface IconOpts {
  width?: number
  height?: number
  className?: string
  class?: string
  style?: string
}

interface AppIcons {
  get(name: string, opts?: IconOpts): string
  _NAMES?: Array<string>
  [name: string]: any
}

/** 剪贴板（App.Clipboard）：内存态 copy/cut 模型 */
interface ClipboardEntry {
  path: string
  isDir: boolean
}

interface ClipboardState {
  mode: 'copy' | 'cut'
  entries: Array<ClipboardEntry>
}

interface Clipboard {
  set(mode: 'copy' | 'cut', entries: Array<{ path: string; isDir?: boolean }>): boolean
  get(): ClipboardState | null
  has(): boolean
  clear(): void
  isCut(path: string): boolean
  planPaste(cb: ClipboardState | null, items: Array<FileItem> | null, curPath: string): Array<{ src: string; dst: string }>
  uniqueName(takenNames: Array<string> | null, base: string, isDir: boolean): string
}

/** 网页文件上传桥（App.WebUpload） */
interface WebUpload {
  setPending(paths: Array<string> | null): void
  hasPending(): boolean
  getPending(): Array<string>
  clearPending(): void
  onFileRequested(): void
  init(): void
}

/** Viewer 联动 + 布局 key 迁移（App.DesktopViewerLink） */
interface DesktopViewerLink {
  closeViewer(): void
  isLockedPath(path: string): boolean
  getLockedPaths(): Array<string>
  applyRename(oldPath: string, newPath: string): void
  applyMoves(moves: Array<{ src: string; dst: string }> | null): void
}

/** 基础 Markdown 渲染器（App.Markdown）：纯函数，先转义后标记 */
interface Markdown {
  render(md: any): string
  inline(text: string): string
  escapeHtml(s: any): string
  safeUrl(url: any): string
}

/** 快捷方式契约（App.Shortcut）：.desktop JSON ↔ 语义 */
interface AppShortcut {
  type: 'application'
  version: number
  package: string
  label: string
  isSystem: boolean
  icon: string | null
}

interface FileShortcut {
  type: 'file'
  version: number
  label: string
  uri: string
}

interface WebsiteShortcut {
  type: 'website'
  version: number
  url: string
  label: string
  trusted: boolean
}

type ShortcutMeta = AppShortcut | FileShortcut | WebsiteShortcut

interface Shortcut {
  EXT: string
  SCHEMA_VERSION: number
  extOf(name: any): string
  isShortcutName(name: any): boolean
  parseShortcut(content: string): ShortcutMeta
  buildAppShortcut(app: { package: string; label?: string; isSystem?: boolean; icon?: string }): string
  buildWebsiteShortcut(site: { url: string; label?: string; trusted?: boolean }): string
  normalizeUrl(input: any): string
  hostOf(url: any): string
  sanitizeFileName(label: any, fallback: any): string
}

/** 缩略图服务（App.Thumbnail）：渐进式获取 + 缓存 + pending 去重 */
interface ThumbnailEntry {
  state: 'pending' | 'ready' | 'failed'
  uri: string | null
  waiters: Array<{ ok: (uri: string) => void; fail: () => void }>
}

interface Thumbnail {
  canThumbnail(kind: string): boolean
  request(path: string, name: string, kind: string, onReady: (uri: string) => void, onFallback: () => void): void
  requestShortcutIcon(path: string, onReady: (uri: string) => void, onFallback: () => void): void
}

/** 文件打开分派器（App.FileOpener）：类型判定 → InternalViewer / ExternalIntent */
interface FileOpener {
  open(item: { name: string; path: string }, anchor: WorldPoint | null, camera: DesktopCameraState | null, onClose: (() => void) | null): number | boolean | null
  kindFor(name: string): string
  extOf(name: any): string
}

/** 目录导航（App.DesktopNav）：路径 + 历史栈纯函数 */
interface NavState {
  stack: Array<string>
  index: number
}

interface DesktopNav {
  create(): NavState
  current(nav: NavState): string
  canBack(nav: NavState): boolean
  canForward(nav: NavState): boolean
  enter(nav: NavState, path: string): NavState
  back(nav: NavState): NavState
  forward(nav: NavState): NavState
  join(base: string, name: string): string
  parent(path: string): string
  basename(path: string): string
}

/** 轻量吐司（App.toast） */
interface Toast {
  show(msg: string): void
  pending(): number
}

/** 通用弹窗（App.Dialog）：overlay 显隐 + 返回键关闭栈 */
interface Dialog {
  open(overlayId: string, closeFn?: (() => void) | null): boolean
  close(overlayId: string): boolean
  handleBack(): boolean
  isOpen(overlayId: string): boolean
}

/** IME 键盘适配（App.ImeAdapter）：desktop:ime 事件 → 对话框 .ime-open 类 */
interface ImeAdapter {
  init(): void
}

/** UI 工具（App.ui）：剪贴板复制 */
interface AppUi {
  copyText(text: string, msg?: string): boolean
}

/** 双击窗口判定（App.DoubleTap） */
interface TapState {
  name: string | null
  time: number
}

interface DoubleTap {
  create(): TapState | null
  hit(state: TapState | null, name: string | null, now: number, ms?: number): { state: TapState | null; double: boolean }
  within(state: TapState | null, name: string | null, now: number, ms?: number): boolean
}

/** 网格 cell 坐标 */
interface CellCoord {
  cx: number
  cy: number
}

/** 桌面网格（App.DesktopGrid）：吸附 + 放置避让纯函数 */
interface DesktopGrid {
  ORIGIN_X: number
  ORIGIN_Y: number
  GRID_W: number
  GRID_H: number
  snapToGrid(x: number, y: number): Position2D
  worldToCell(x: number, y: number): CellCoord
  cellToWorld(cx: number, cy: number): Position2D
  findFreeCell(cx: number, cy: number, taken: Set<string>): CellCoord
  resolvePlacement(moving: Array<{ name: string; x: number; y: number }>, statics: Array<{ name: string; x: number; y: number }>): Record<string, Position2D>
}

/** 桌面选择（App.DesktopSelection）：命中测试 + 选中集合纯函数 */
interface DesktopSelection {
  rectFromPoints(ax: number, ay: number, bx: number, by: number): Bounds2D
  aabbIntersect(r1: Bounds2D, r2: Bounds2D): boolean
  marqueeHitTest(rect: Bounds2D, bounds: Record<string, Bounds2D> | null): Array<string>
  pointHitTest(wx: number, wy: number, bounds: Record<string, Bounds2D> | null): string | null
  selectOnly(name: string): Set<string>
  add(sel: Set<string> | null, name: string): Set<string>
  remove(sel: Set<string> | null, name: string): Set<string>
  toggle(sel: Set<string> | null, name: string): Set<string>
  clear(): Set<string>
  unionRect(bounds: Record<string, Bounds2D>, names: Array<string>): Bounds2D | null
  pointInRect(px: number, py: number, rect: Bounds2D | null): boolean
}

/** Loading 当前文件行（字节级进度） */
interface LoadingCurrent {
  name: string
  done: number
  total: number
}

/** Loading 组件选项（loading.js show） */
interface LoadingOpts {
  title?: string
  phaseLabel?: string
  phaseDone?: number
  phaseTotal?: number
  totalLabel?: string
  totalDone?: number
  totalTotal?: number
  current?: LoadingCurrent
  cancellable?: boolean
  onCancel?: () => void
}

interface Loading {
  show(opts: LoadingOpts): void
  hide(): void
  showTag(text: string): void
  hideTag(): void
}

/** 左侧 Drawer（App.Drawer） */
interface Drawer {
  open(): void
  close(): void
  toggle(): void
  isOpen(): boolean
  updatePath(displayPath: string, rootName: string, mode: string): void
  init(): void
}

/** 底部工具栏（App.BottomBar） */
interface BottomBar {
  init(): void
  updateNavButtons(): void
  updateHomeState(): void
}

/** 桌面编排入口（App.Desktop）：各模块能力聚合 + 手势初始化 */
interface Desktop {
  refresh(): Promise<any>
  render(): void
  initGesture(): void
  clearSelection(): void
  hasSelection(): boolean
  getSelectionNames(): Array<string>
  getSelectionEntries(): Array<any>
  applyRename(oldPath: string, newPath: string): void
  applyMoves(moves: Array<{ src: string; dst: string }> | null): void
  openItem: any
  enterFolder: any
  goBack: () => void
  goForward: () => void
  goUp: () => void
  canGoBack: () => boolean
  canGoForward: () => boolean
  canGoUp: () => boolean
  getCurPath: () => string
  getLockedPaths: () => Array<string>
  isLockedPath: (path: string) => boolean
  closeViewer: () => void
  isTrashPath: (path: string) => boolean
  inTrash: () => boolean
  getTrashName: () => string
  getRootId: () => string
  viewMode: () => string
  isFolderView: () => boolean
  applyViewPrefs: (prefs: ViewPrefs) => void
  getViewPrefs: () => ViewPrefs
  captureHome: () => void
  captureDefaultView: () => void
  goHome: () => void
  setAdvancedBrowse: (on: boolean) => void
  isAdvancedBrowse: () => boolean
  exitTempMode: () => void
  toggleRotate: () => boolean
  isRotated: () => boolean
}

/** 顶栏排列/视图菜单（App.ViewMenu） */
interface ViewMenu {
  init(): void
  open(): void
  close(): void
  toggle(): void
  isOpen(): boolean
  isEnabled(): boolean
  setEnabled(on: boolean): void
}

/** 新建对话框（App.CreateDialog） */
interface CreateDialog {
  open(): void
  close(): void
  isOpen(): boolean
  init(): void
}

/** 重命名对话框（App.RenameDialog） */
interface RenameDialog {
  open(name: string): void
  close(): void
  isOpen(): boolean
  init(): void
}

/** 新建网站快捷方式对话框（App.WebsiteDialog） */
interface WebsiteDialog {
  open(): void
  close(): void
  isOpen(): boolean
  init(): void
}

/** 移动目标选择器（App.MoveTarget） */
interface MoveTarget {
  open(entries: Array<ClipboardEntry>): void
  close(): void
  isOpen(): boolean
  init(): void
}

/** 文件系统动作（App.Actions）：新建/重命名/复制/剪切/粘贴/删除/移动 */
interface Actions {
  createFolder(name: string): void
  createFile(name: string): void
  refresh(): void
  setDefaultView(): void
  switchRoot(): void
  rename(oldPath: string, newName: string): void
  copySelection(entries: Array<ClipboardEntry>): void
  cutSelection(entries: Array<ClipboardEntry>): void
  paste(): void
  deleteSelection(entries: Array<ClipboardEntry>): void
  moveIntoFolder(entries: Array<ClipboardEntry>, dirPath: string): void
}

/** 构建注入变量（build-web.sh 注入，见 tools/build-web.sh） */
declare var BUILD_COUNT: number
declare var BUILD_TIMESTAMP: string

/** App 全局命名空间（namespace.js 声明，各模块挂载）。
 * 已声明模块强类型；未声明模块经索引签名退化为 any，
 * 随 @ts-check 扩展逐步补声明（渐进式路线）。 */
interface AppNamespace {
  NAME: string
  VERSION: string
  BUILD: number
  BUILD_TIME: string
  FileAPI: FileApi
  LayoutStore: LayoutStore
  HomeStore: HomeStore
  DesktopCamera: DesktopCamera
  ViewStore: ViewStore
  DesktopPersist: DesktopPersist
  DesktopCore: DesktopCore
  DesktopNav: DesktopNav
  DesktopBrowseMode: DesktopBrowseMode
  DesktopViewerLink: DesktopViewerLink
  DesktopGrid: DesktopGrid
  DesktopSelection: DesktopSelection
  FolderLayout: FolderLayout
  FolderSort: FolderSort
  FileOpener: FileOpener
  Markdown: Markdown
  Shortcut: Shortcut
  Thumbnail: Thumbnail
  TypeIcons: TypeIcons
  Clipboard: Clipboard
  WebUpload: WebUpload
  Dialog: Dialog
  Loading: Loading
  Drawer: Drawer
  BottomBar: BottomBar
  DoubleTap: DoubleTap
  ImeAdapter: ImeAdapter
  Desktop: Desktop
  ViewMenu: ViewMenu
  CreateDialog: CreateDialog
  RenameDialog: RenameDialog
  WebsiteDialog: WebsiteDialog
  MoveTarget: MoveTarget
  Actions: Actions
  utils: AppUtils
  icons: AppIcons
  ui: AppUi
  bridge: AppBridge
  toast: Toast
  [key: string]: any
}

declare var App: AppNamespace

interface Window {
  App: AppNamespace
  FileBridge?: FileBridge
  __fbResolve: (id: string, result: FbResult) => void
  __fbProgress: (id: string, payload: FbProgress) => void
}
