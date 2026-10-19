import { app, BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { store } from './store'
import { attachNativeContextMenu } from './context-menu'
import { IPC, WEB_APP_URL, type FloatingWindowStatePayload } from '../shared/ipc-contract'
import {
  EDGE_VISIBLE,
  FLOAT_MAX,
  FLOAT_MIN,
  FLOAT_SMALL,
  SNAP_THRESHOLD,
  clamp,
  dockTargetPosition,
  isLargeScale,
  isSnappedToEdge,
  keepAnchorX,
  keepAnchorY,
  nearestDockEdge,
  scaleTargetOf,
} from './floating-geometry'

/** 自动收起参数。 */
const IDLE_MS = 5000
const DOCK_DURATION = 180

let floatingWindow: BrowserWindow | null = null

/** 自动收起状态机（与 small/large 缩放正交）。 */
let docked = false
let dockedX = 0
let dockedY = 0
/** 最近一次唤醒恢复到的位置（贴靠检测据此跳过，避免唤醒后立即重新收起）。 */
let wakeRestoreX = -99999
let wakeRestoreY = -99999
let animating = false
let suspended = false
let autoCollapseTimer: ReturnType<typeof setTimeout> | null = null

function debounce(fn: () => void, wait: number): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  return () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(fn, wait)
  }
}

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

/** 当前尺寸档位。 */
function currentScale(): 'small' | 'large' {
  if (!floatingWindow) return 'small'
  const [w] = floatingWindow.getSize()
  return isLargeScale(w) ? 'large' : 'small'
}

/** 向渲染进程推送悬浮窗状态（scale + docked + fullscreen）。 */
function sendFloatingState(): void {
  if (!floatingWindow || floatingWindow.isDestroyed()) return
  const payload: FloatingWindowStatePayload = {
    scale: currentScale(),
    docked,
    fullscreen: floatingWindow.isFullScreen(),
  }
  floatingWindow.webContents.send(IPC.evtFloatingWindowStateChanged, payload)
}

/** 大/小两档缩放：贴右/贴下锚定，避免放大溢出屏幕。 */
function resizeKeepAnchor(win: BrowserWindow, width: number, height: number): void {
  const b = win.getBounds()
  const { workArea } = screen.getDisplayMatching(b)
  const newX = keepAnchorX(b, workArea, width)
  const newY = keepAnchorY(b, workArea, height)
  win.setBounds({ x: newX, y: newY, width, height })
}

/** 大/小两档切换。 */
function toggleFloatingScale(win: BrowserWindow): void {
  const [w] = win.getSize()
  const target = scaleTargetOf(w)
  resizeKeepAnchor(win, target.width, target.height)
  sendFloatingState()
}

/** 隐藏到托盘（最小化/关闭同语义）。 */
function hideFloatingToTray(): void {
  if (!floatingWindow || floatingWindow.isDestroyed()) return
  clearAutoCollapseTimer()
  floatingWindow.hide()
}

/** 活动心跳：重置 5s 计时；收起态下任何活动都唤醒。 */
function touch(): void {
  if (animating) return // 动画期间的 setPosition 回环 move 事件不参与
  resetTimer()
  if (docked) wake()
}

function resetTimer(): void {
  clearAutoCollapseTimer()
  if (!store.get('autoCollapseEnabled')) return
  autoCollapseTimer = setTimeout(dock, IDLE_MS)
}

function clearAutoCollapseTimer(): void {
  if (autoCollapseTimer) {
    clearTimeout(autoCollapseTimer)
    autoCollapseTimer = null
  }
}

/** 暂停自动收起（分析进行中调用）。 */
function suspendAutoCollapse(): void {
  suspended = true
  clearAutoCollapseTimer()
}

/** 恢复自动收起（分析完成调用）。 */
function resumeAutoCollapse(): void {
  suspended = false
  if (docked) {
    wake()
  } else {
    resetTimer()
  }
}

/** 收起：滑到距离最近的屏幕边缘（左/右/上/下），仅露 8px 窄边。 */
function dock(): void {
  if (suspended) return
  const win = floatingWindow
  if (!win || docked || !win.isVisible() || win.isMinimized()) return
  const b = win.getBounds()
  const { workArea } = screen.getDisplayMatching(b)
  dockedX = b.x
  dockedY = b.y
  docked = true

  const edge = nearestDockEdge(b, workArea)
  const target = dockTargetPosition(b, workArea, edge, EDGE_VISIBLE)
  animateTo(win, b.x, b.y, target.x, target.y, DOCK_DURATION)
  sendFloatingState()
}

/** 唤醒：从边缘滑回收起前位置。 */
function wake(): void {
  const win = floatingWindow
  if (!win || !docked) return
  docked = false
  const b = win.getBounds()
  const { workArea } = screen.getDisplayMatching(b)
  const x = clamp(dockedX, workArea.x, Math.max(workArea.x, workArea.x + workArea.width - b.width))
  const y = clamp(dockedY, workArea.y, Math.max(workArea.y, workArea.y + workArea.height - b.height))
  wakeRestoreX = x
  wakeRestoreY = y
  animateTo(win, b.x, b.y, x, y, DOCK_DURATION)
  sendFloatingState()
}

/** 位移动画（收起/唤醒共用，支持 X/Y 任意组合）。 */
function animateTo(
  win: BrowserWindow,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  duration: number,
): void {
  animating = true
  const start = Date.now()
  const step = (): void => {
    if (win.isDestroyed()) {
      animating = false
      return
    }
    const t = Math.min(1, (Date.now() - start) / duration)
    win.setPosition(
      Math.round(fromX + (toX - fromX) * t),
      Math.round(fromY + (toY - fromY) * t),
    )
    if (t < 1) {
      setTimeout(step, 15)
    } else {
      animating = false
    }
  }
  step()
}

/** 解析窗口图标路径（打包后从 resources 读，开发态从 build/ 读）。 */
function resolveIconPath(): string | undefined {
  try {
    if (app.isPackaged) return join(process.resourcesPath, 'icon.png')
    const p = join(app.getAppPath(), 'build', 'icon.png')
    return p
  } catch {
    return undefined
  }
}

/** 创建无边框置顶悬浮窗，默认右下角（恢复 saved floatPosition），加载远程 companion 页。 */
export function createFloatingWindow(): BrowserWindow {
  const saved = store.get('floatPosition')
  const { workArea } = screen.getPrimaryDisplay()
  const width = clamp(saved.width ?? FLOAT_SMALL.width, FLOAT_MIN.width, FLOAT_MAX.width)
  const height = clamp(saved.height ?? FLOAT_SMALL.height, FLOAT_MIN.height, FLOAT_MAX.height)
  const useSaved = isValidBounds(saved, workArea)
  const x = useSaved ? (saved.x as number) : workArea.x + workArea.width - width - 16
  const y = useSaved ? (saved.y as number) : workArea.y + workArea.height - height - 16

  floatingWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    show: true,
    minWidth: FLOAT_MIN.width,
    minHeight: FLOAT_MIN.height,
    maxWidth: FLOAT_MAX.width,
    maxHeight: FLOAT_MAX.height,
    backgroundColor: '#ffffff',
    icon: resolveIconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  floatingWindow.setAlwaysOnTop(true, 'screen-saver')

  const persist = debounce(() => {
    const win = floatingWindow
    if (win && !docked) store.patch({ floatPosition: win.getBounds() })
  }, 500)

  // 贴靠检测：拖动停止（400ms 无 move）后，窗口贴近任一屏幕边缘则自动收起到该边
  const snapCheck = debounce(() => {
    const win = floatingWindow
    if (!win || docked || animating || suspended || !win.isVisible() || win.isMinimized()) return
    if (!store.get('autoCollapseEnabled')) return
    const b = win.getBounds()
    // 刚从收起唤醒回原位时跳过，避免唤醒后立即重新收起
    if (Math.abs(b.x - wakeRestoreX) < 4 && Math.abs(b.y - wakeRestoreY) < 4) return
    const { workArea: wa } = screen.getDisplayMatching(b)
    if (isSnappedToEdge(b, wa, SNAP_THRESHOLD)) dock()
  }, 400)

  floatingWindow.on('resize', () => {
    persist()
    touch()
  })
  floatingWindow.on('move', () => {
    persist()
    touch()
    snapCheck()
  })
  floatingWindow.on('focus', () => touch())
  floatingWindow.on('blur', () => touch())
  floatingWindow.on('enter-full-screen', () => sendFloatingState())
  floatingWindow.on('leave-full-screen', () => sendFloatingState())
  floatingWindow.on('closed', () => {
    floatingWindow = null
    docked = false
    animating = false
    clearAutoCollapseTimer()
  })

  // 原生右键菜单（复制/粘贴/剪切/全选）
  attachNativeContextMenu(floatingWindow)

  loadRemote()
  sendFloatingState()
  resetTimer()
  return floatingWindow
}

/** 加载远程 Web companion 页（悬浮窗渲染 CompanionPanel）。 */
function loadRemote(): void {
  if (!floatingWindow) return
  floatingWindow.loadURL(`${WEB_APP_URL}?mode=companion`).catch(() => {
    loadLocalFallback()
  })
}

/** 远程加载失败时回退到本地引导页。 */
function loadLocalFallback(): void {
  if (!floatingWindow) return
  floatingWindow.loadFile(join(__dirname, '../renderer/index.html')).catch(() => undefined)
}

export function getFloatingWindow(): BrowserWindow | null {
  return floatingWindow
}

export function reloadRemote(): void {
  loadRemote()
}

/** 托盘「显示/隐藏悬浮窗」：显示分支先唤醒再 show+focus。 */
export function toggleFloatingWindow(): void {
  if (!floatingWindow) {
    createFloatingWindow()
    return
  }
  if (floatingWindow.isVisible()) {
    floatingWindow.hide()
  } else {
    wake()
    floatingWindow.show()
    floatingWindow.focus()
  }
}

/** 供 ipc.ts：缩放切换。 */
export function toggleFloatingScaleWin(): void {
  if (floatingWindow && !floatingWindow.isDestroyed()) toggleFloatingScale(floatingWindow)
}

/** 供 ipc.ts：隐藏到托盘。 */
export function hideFloatingWindowToTray(): void {
  hideFloatingToTray()
}

/** 供 ipc.ts：全屏/退出全屏切换。 */
export function toggleFloatingFullscreen(): void {
  const win = floatingWindow
  if (!win || win.isDestroyed()) return
  win.setFullScreen(!win.isFullScreen())
  sendFloatingState()
}

/** 供 ipc.ts / 业务事件：活动心跳（分析中不收起）。 */
export function touchFloating(): void {
  touch()
}

/** 暂停自动收起（代码分析开始，保持窗口展开）。 */
export function suspendFloatingAutoCollapse(): void {
  suspendAutoCollapse()
}

/** 恢复自动收起（代码分析结束）。 */
export function resumeFloatingAutoCollapse(): void {
  resumeAutoCollapse()
}

/** 供 index.ts before-quit 清理计时器。 */
export function clearFloatingAutoCollapseTimer(): void {
  clearAutoCollapseTimer()
}

/** 向悬浮窗页面推送事件。 */
export function sendToRenderer(channel: string, payload: unknown): void {
  floatingWindow?.webContents.send(channel, payload)
}
