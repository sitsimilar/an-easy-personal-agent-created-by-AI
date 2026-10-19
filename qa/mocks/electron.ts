/**
 * electron 模块 mock（仅供 QA 纯 Node 环境测试使用）。
 * 覆盖 app / BrowserWindow / screen / clipboard / globalShortcut，均可通过 __setElectronMock 配置。
 * 测试源码经 esbuild --alias:electron=./qa/mocks/electron.ts 替换为本文件。
 */
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface ElectronMockConfig {
  userDataDir?: string
  workArea?: { x: number; y: number; width: number; height: number }
  clipboardText?: string
  clipboardFormats?: string[]
  clipboardThrows?: boolean
  shortcutRegisterResult?: boolean
  shortcutThrows?: boolean
  /** requestSingleInstanceLock 返回值（默认 true：首个实例）。 */
  singleInstanceLock?: boolean
}

let config: ElectronMockConfig = {}

export function __setElectronMock(c: ElectronMockConfig): void {
  config = { ...config, ...c }
}

export function __resetElectronMock(): void {
  config = {}
  appHandlers.clear()
  appQuitCalls = 0
  ipcHandlerChannels.length = 0
  trayMenuTemplates.length = 0
}

/** 触发 app.whenReady 的 resolve（驱动入口模块的启动回调）。 */
export function __fireAppReady(): void {
  whenReadyResolve?.()
}

/** 取 app.on 注册的处理器映射。 */
export function __getAppHandlers(): Map<string, AppHandler[]> {
  return appHandlers
}

/** 取 ipcMain 注册的 channel 列表。 */
export function __getIpcHandlerChannels(): string[] {
  return ipcHandlerChannels
}

/** 取 Tray.setContextMenu 收到的菜单模板列表。 */
export function __getTrayMenuTemplates(): Array<Array<{ label?: string; type?: string }>> {
  return trayMenuTemplates
}

/** 取 app.quit 调用次数。 */
export function __getAppQuitCalls(): number {
  return appQuitCalls
}

/* ------------------------------------------------------------------ *
 * v2.6.0 lite 行为测试追加（append-only）：app 生命周期 / ipcMain / Tray 等
 * ------------------------------------------------------------------ */

type AppHandler = (...args: unknown[]) => void

/** app.on 注册的处理器（second-instance / window-all-closed / before-quit）。 */
const appHandlers = new Map<string, AppHandler[]>()
let appQuitCalls = 0
/** whenReady 的 deferred：测试通过 __fireAppReady() 触发启动回调。 */
let whenReadyResolve: (() => void) | null = null
const whenReadyPromise = new Promise<void>((resolve) => {
  whenReadyResolve = resolve
})

/** ipcMain.handle/on 注册记录（channel → 出现次数）。 */
const ipcHandlerChannels: string[] = []
/** Tray.setContextMenu 收到的菜单模板（tray.ts buildMenu 产出）。 */
const trayMenuTemplates: Array<Array<{ label?: string; type?: string }>> = []

export const app = {
  getPath(_name: string): string {
    return config.userDataDir || process.env.QA_STORE_DIR || join(tmpdir(), 'qa-electron-default')
  },
  /** 单实例锁（默认 true；测试可经 config.singleInstanceLock 覆盖）。 */
  requestSingleInstanceLock(): boolean {
    return config.singleInstanceLock ?? true
  },
  whenReady(): Promise<void> {
    return whenReadyPromise
  },
  on(event: string, fn: AppHandler): void {
    const a = appHandlers.get(event) ?? []
    a.push(fn)
    appHandlers.set(event, a)
  },
  setLoginItemSettings(_opts: unknown): void {},
  quit(): void {
    appQuitCalls += 1
  },
  isPackaged: false,
  getAppPath(): string {
    return join(tmpdir(), 'qa-electron-app')
  },
}

/** ipcMain mock：记录注册的 channel（不执行 handler）。 */
export const ipcMain = {
  handle(channel: string, _fn: (...args: unknown[]) => unknown): void {
    ipcHandlerChannels.push(channel)
  },
  on(channel: string, _fn: (...args: unknown[]) => unknown): void {
    ipcHandlerChannels.push(channel)
  },
}

/** Tray mock：记录 setContextMenu 的菜单模板。 */
export class Tray {
  constructor(_icon: unknown) {}
  setToolTip(_tip: string): void {}
  setContextMenu(menu: unknown): void {
    const template = (menu as { template?: Array<{ label?: string; type?: string }> }).template
    if (template) trayMenuTemplates.push(template)
  }
  destroy(): void {}
}

export const nativeImage = {
  createFromPath(_p: string): { empty: boolean } {
    return { empty: false }
  },
  createEmpty(): { empty: boolean } {
    return { empty: true }
  },
}

export const shell = {
  openExternal(_url: string): Promise<void> {
    return Promise.resolve()
  },
}

/** dialog mock：uninstall.ts 导入即用，测试不触发。 */
export const dialog = {
  showMessageBox(_opts: unknown): Promise<{ response: number }> {
    return Promise.resolve({ response: 1 })
  },
}

export const screen = {
  getPrimaryDisplay(): { workArea: { x: number; y: number; width: number; height: number } } {
    return { workArea: config.workArea ?? { x: 0, y: 0, width: 1920, height: 1040 } }
  },
}

/** Menu mock：buildFromTemplate 返回可 popup 的对象，并把 template 附到返回值上（Tray mock 读取）。 */
export const Menu = {
  buildFromTemplate(template: unknown[]): { popup: (_opts?: unknown) => void; template: unknown[] } {
    return { popup: () => undefined, template }
  },
}

type Handler = (...args: unknown[]) => void

/** BrowserWindow mock：记录构造参数，可 emit 事件、控制窗口状态。 */
export class BrowserWindow {
  static instances: BrowserWindow[] = []
  readonly options: Record<string, unknown>
  /** 最近一次 loadURL 参数（lite 行为测试断言 companion URL）。 */
  lastLoadURL?: string
  webContents: {
    send: (channel: string, payload: unknown) => void
    lastSend?: { channel: string; payload: unknown }
    on: (event: string, fn: Handler) => void
  }
  private _visible: boolean
  private _maximized = false
  private _minimized = false
  private _destroyed = false
  private _fullscreen = false
  private _bounds: { x: number; y: number; width: number; height: number }
  private handlers = new Map<string, Handler[]>()
  private onceHandlers = new Map<string, Handler[]>()

  constructor(options: Record<string, unknown>) {
    this.options = options
    this._visible = options.show === true
    this._bounds = {
      x: options.x as number,
      y: options.y as number,
      width: options.width as number,
      height: options.height as number,
    }
    const webHandlers = new Map<string, Handler[]>()
    this.webContents = {
      send: (channel: string, payload: unknown) => {
        this.webContents.lastSend = { channel, payload }
      },
      on: (event: string, fn: Handler) => {
        const a = webHandlers.get(event) ?? []
        a.push(fn)
        webHandlers.set(event, a)
      },
    }
    BrowserWindow.instances.push(this)
  }

  isMaximized(): boolean {
    return this._maximized
  }
  isMinimized(): boolean {
    return this._minimized
  }
  isDestroyed(): boolean {
    return this._destroyed
  }
  isVisible(): boolean {
    return this._visible
  }
  getBounds(): { x: number; y: number; width: number; height: number } {
    return { ...this._bounds }
  }
  getSize(): [number, number] {
    return [this._bounds.width, this._bounds.height]
  }
  getPosition(): [number, number] {
    return [this._bounds.x, this._bounds.y]
  }
  setBounds(bounds: { x: number; y: number; width: number; height: number }): void {
    this._bounds = { ...bounds }
  }
  setPosition(x: number, y: number): void {
    this._bounds.x = x
    this._bounds.y = y
  }
  isFullScreen(): boolean {
    return this._fullscreen
  }
  setFullScreen(flag: boolean): void {
    this._fullscreen = flag
  }
  show(): void {
    this._visible = true
  }
  hide(): void {
    this._visible = false
  }
  focus(): void {}
  minimize(): void {
    this._minimized = true
  }
  restore(): void {
    this._minimized = false
  }
  maximize(): void {
    this._maximized = true
    this.emit('maximize')
  }
  unmaximize(): void {
    this._maximized = false
    this.emit('unmaximize')
  }
  close(): void {
    this.emit('close', { preventDefault: () => undefined })
  }
  loadURL(url: string): Promise<void> {
    this.lastLoadURL = url
    return Promise.resolve()
  }
  loadFile(_p: string): Promise<void> {
    return Promise.resolve()
  }
  setAlwaysOnTop(_flag: boolean, _level?: string): void {}
  on(event: string, fn: Handler): void {
    const a = this.handlers.get(event) ?? []
    a.push(fn)
    this.handlers.set(event, a)
  }
  once(event: string, fn: Handler): void {
    const a = this.onceHandlers.get(event) ?? []
    a.push(fn)
    this.onceHandlers.set(event, a)
  }
  emit(event: string, ...args: unknown[]): void {
    for (const fn of [...(this.onceHandlers.get(event) ?? []), ...(this.handlers.get(event) ?? [])]) {
      fn(...args)
    }
    this.onceHandlers.delete(event)
  }
}

export const clipboard = {
  readText(): string {
    if (config.clipboardThrows) throw new Error('clipboard read failed')
    return config.clipboardText ?? ''
  },
  availableFormats(): string[] {
    if (config.clipboardThrows) throw new Error('clipboard read failed')
    return config.clipboardFormats ?? []
  },
}

export const globalShortcut = {
  register(accel: string, cb: () => void): boolean {
    if (config.shortcutThrows) throw new Error('shortcut register failed')
    const ok = config.shortcutRegisterResult ?? true
    if (ok) {
      ;(globalThis as unknown as { __registeredShortcut: { accel: string; cb: () => void } }).__registeredShortcut = {
        accel,
        cb,
      }
    }
    return ok
  },
  unregisterAll(): void {},
}

/** net mock：provision 生产路径使用 net.request，测试注入 fake download，不触发此实现。 */
export const net = {
  request(): never {
    throw new Error('net.request 未 mock：测试请注入 ProvisionDeps.download')
  },
}
