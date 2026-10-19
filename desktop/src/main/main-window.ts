import { app, BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { store } from './store'
import { attachNativeContextMenu } from './context-menu'
import { IPC, WEB_APP_URL, type WindowStatePayload } from '../shared/ipc-contract'

const MAIN_MIN_W = 960
const MAIN_MIN_H = 640

let mainWindow: BrowserWindow | null = null
let quitting = false

/** 解析窗口图标路径（打包后从 resources 读，开发态从 build/ 读）。 */
function resolveIconPath(): string | undefined {
  try {
    if (app.isPackaged) return join(process.resourcesPath, 'icon.png')
    return join(app.getAppPath(), 'build', 'icon.png')
  } catch {
    return undefined
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function debounce(fn: () => void, wait: number): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  return () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(fn, wait)
  }
}

/** 判断保存的坐标是否仍落在当前屏幕工作区内（换显示器/改分辨率时回退居中）。 */
function isValidBounds(pos: { x?: number; y?: number }, workArea: Electron.Rectangle): boolean {
  if (typeof pos.x !== 'number' || typeof pos.y !== 'number') return false
  const margin = 8
  return (
    pos.x >= workArea.x - margin &&
    pos.y >= workArea.y - margin &&
    pos.x < workArea.x + workArea.width - margin &&
    pos.y < workArea.y + workArea.height - margin
  )
}

function sendWindowState(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const payload: WindowStatePayload = { isMaximized: mainWindow.isMaximized() }
  mainWindow.webContents.send(IPC.evtWindowStateChanged, payload)
}

/** 创建无边框主窗口（加载完整 Web 首页 ?desktop=1）。 */
export function createMainWindow(): BrowserWindow {
  const saved = store.get('mainWindowPosition')
  const { workArea } = screen.getPrimaryDisplay()

  const width = clamp(saved.width ?? 1200, MAIN_MIN_W, workArea.width)
  const height = clamp(saved.height ?? 800, MAIN_MIN_H, workArea.height)
  const useSaved = isValidBounds(saved, workArea)
  const x = useSaved ? (saved.x as number) : workArea.x + Math.round((workArea.width - width) / 2)
  const y = useSaved ? (saved.y as number) : workArea.y + Math.round((workArea.height - height) / 2)

  mainWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    thickFrame: true,
    resizable: true,
    minWidth: MAIN_MIN_W,
    minHeight: MAIN_MIN_H,
    show: false,
    backgroundColor: '#f5f6f8',
    icon: resolveIconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // 尺寸/位置持久化（防抖 500ms；最大化时只记标记、不覆盖还原前 bounds）
  const persistBounds = debounce(() => {
    const win = mainWindow
    if (!win || win.isMaximized()) return
    store.patch({ mainWindowPosition: win.getBounds() })
  }, 500)
  mainWindow.on('resize', persistBounds)
  mainWindow.on('move', persistBounds)
  mainWindow.on('maximize', () => {
    store.patch({ mainWindowMaximized: true })
    sendWindowState()
  })
  mainWindow.on('unmaximize', () => {
    store.patch({ mainWindowMaximized: false })
    sendWindowState()
  })

  // 关闭 = 隐藏到托盘（真正退出走托盘「退出」）
  mainWindow.on('close', (e) => {
    if (!quitting) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // 原生右键菜单（复制/粘贴/剪切/全选）
  attachNativeContextMenu(mainWindow)

  loadMainRemote()
  mainWindow.once('ready-to-show', () => {
    if (store.get('mainWindowMaximized')) mainWindow?.maximize()
    mainWindow?.show()
    sendWindowState()
  })

  return mainWindow
}

/** 加载主窗口远程页（失败回退到本地引导页）。 */
export function loadMainRemote(): void {
  if (!mainWindow) return
  mainWindow.loadURL(`${WEB_APP_URL}?desktop=1`).catch(() => loadMainFallback())
}

/** 远程加载失败时回退到本地引导页（含「重试」按钮）。 */
function loadMainFallback(): void {
  if (!mainWindow) return
  mainWindow.loadFile(join(__dirname, '../renderer/index.html')).catch(() => undefined)
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

/** 显示并聚焦主窗口（不存在则创建）。 */
export function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow()
    return
  }
  if (!mainWindow.isVisible()) mainWindow.show()
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
}

/** 真正退出前调用，使 close 不再被拦截为隐藏。 */
export function setQuitting(value: boolean): void {
  quitting = value
}
