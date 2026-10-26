import { app, BrowserWindow, ipcMain } from 'electron'
import { isAbsolute, relative, resolve } from 'node:path'
import {
  IPC,
  type AnalysisDonePayload,
  type CppDebugAction,
  type CppDebugStartInput,
  type FloatingWindowControlAction,
  type WindowControlAction,
} from '../shared/ipc-contract'
import type { VsMonitor } from './vs-monitor'
import type { AnalysisOrchestrator } from './analysis-orchestrator'
import { CppRunner, CPP_TMP_DIR } from './cpp-runner'
import { store } from './store'
import {
  getFloatingWindow,
  hideFloatingWindowToTray,
  reloadRemote,
  toggleFloatingFullscreen,
  toggleFloatingScaleWin,
  toggleFloatingWindow,
  touchFloating,
} from './floating-window'
import { getMainWindow, loadMainRemote, showMainWindow } from './main-window'
import { readClipboardSelection } from './selection-analyzer'
import { exportBaseDir } from './analysis-exporter'
import { showSystemNotification } from './notifier'
import { refreshTray } from './tray'

/** C++ 工具链/调试单例（index.ts before-quit 调用 dispose 清理）。 */
export const cppRunner = new CppRunner()

/** cppCompile 源文本长度上限（1MB）。 */
const CPP_COMPILE_MAX_CHARS = 1024 * 1024
/** setExportDir 路径长度上限（保守，兼容 Windows MAX_PATH 以下）。 */
const EXPORT_DIR_MAX = 260
/** setExportDir 非法字符（Windows 路径禁用字符 + 控制字符）。 */
const EXPORT_DIR_ILLEGAL = /[<>:"|?*\u0000-\u001f]/

/** 校验 event.sender 是否属于本应用的主窗口或悬浮窗（特权 handler 的统一来源校验）。 */
function isTrustedSender(event: { sender: Electron.WebContents }): boolean {
  const sender = event.sender
  const fw = getFloatingWindow()
  const mw = getMainWindow()
  return (!!fw && !fw.isDestroyed() && sender === fw.webContents) ||
    (!!mw && !mw.isDestroyed() && sender === mw.webContents)
}

/** 校验 target 是否解析后位于 base 目录内（路径沙箱，防越权读写本地文件）。 */
function isPathWithin(base: string, target: string): boolean {
  try {
    const b = resolve(base)
    const t = resolve(target)
    const rel = relative(b, t)
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
  } catch {
    return false
  }
}

/** 特权 handler 统一来源校验；不受信任直接抛错（renderer 侧 catch 处理）。 */
function assertTrusted(event: { sender: Electron.WebContents }): void {
  if (!isTrustedSender(event)) throw new Error('来源不受信任')
}

/**
 * 注册 ipcMain 处理器（完整版唯一入口）。
 *
 * 覆盖：主窗口 / VS 监听 / 分析管线 + 悬浮窗控制 + C++ 工具链 + 托盘相关 handler。
 * 特权 handler（本地执行/读剪贴板/写配置）统一做来源校验与入参校验。
 */
export function registerIpc(orchestrator: AnalysisOrchestrator, vsMonitor: VsMonitor): void {
  ipcMain.handle(IPC.getStatus, (event) => {
    assertTrusted(event)
    return orchestrator.getStatus()
  })

  ipcMain.handle(IPC.triggerAnalysis, (event) => {
    assertTrusted(event)
    return orchestrator.triggerManual()
  })

  ipcMain.handle(IPC.setListening, (event, enabled: unknown) => {
    if (!isTrustedSender(event)) return { ok: false, message: '来源不受信任' }
    const next = Boolean(enabled)
    store.set('listening', next)
    vsMonitor.setEnabled(next)
    refreshTray()
    return { ok: true }
  })

  ipcMain.handle(IPC.setCodeUploadEnabled, (event, enabled: unknown) => {
    if (!isTrustedSender(event)) return { ok: false, message: '来源不受信任' }
    store.set('codeUploadEnabled', Boolean(enabled))
    return { ok: true }
  })

  ipcMain.handle(IPC.setFloatWindowEnabled, (event, enabled: unknown) => {
    if (!isTrustedSender(event)) return { ok: false, message: '来源不受信任' }
    const next = Boolean(enabled)
    store.set('floatWindowEnabled', next)
    // 即时生效：关闭则隐藏悬浮窗，开启则创建/显示
    if (next) {
      toggleFloatingWindow()
    } else {
      const fw = getFloatingWindow()
      if (fw && !fw.isDestroyed()) fw.hide()
    }
    return { ok: true }
  })

  ipcMain.handle(IPC.setVsPath, (event, path: unknown) => {
    if (!isTrustedSender(event)) return { ok: false, message: '来源不受信任' }
    const next = typeof path === 'string' ? path.trim() : ''
    if (next.length > EXPORT_DIR_MAX || EXPORT_DIR_ILLEGAL.test(next)) {
      return { ok: false, message: '路径格式不合法' }
    }
    store.set('vsPath', next)
    return { ok: true }
  })

  ipcMain.handle(IPC.openMainApp, (event) => {
    assertTrusted(event)
    showMainWindow()
  })

  ipcMain.handle(IPC.windowControl, (event, action: WindowControlAction) => {
    if (!isTrustedSender(event)) return { ok: false, message: '来源不受信任' }
    const win = getMainWindow()
    if (!win || win.isDestroyed()) {
      return { ok: false, message: '主窗口未就绪' }
    }
    if (action === 'minimize') win.minimize()
    else if (action === 'maximize-toggle') {
      if (win.isMaximized()) win.unmaximize()
      else win.maximize()
    } else if (action === 'close') {
      win.close() // 触发 close 事件 → 隐藏到托盘
    }
    return { ok: true }
  })

  ipcMain.handle(IPC.readSelection, (event) => {
    if (!isTrustedSender(event)) return { status: 'error' as const, message: '来源不受信任' }
    return readClipboardSelection()
  })

  ipcMain.handle(IPC.getLocalPaths, (event) => {
    if (!isTrustedSender(event)) {
      // 不向不受信任来源泄露磁盘路径
      return { userDataDir: '', exportDir: '', exportDefaultDir: '' }
    }
    return {
      userDataDir: app.getPath('userData'),
      exportDir: store.get('exportDir'),
      exportDefaultDir: exportBaseDir(),
    }
  })

  ipcMain.handle(IPC.setExportDir, (event, dir: unknown) => {
    if (!isTrustedSender(event)) return { ok: false, message: '来源不受信任' }
    const next = typeof dir === 'string' ? dir.trim() : ''
    if (next.length > EXPORT_DIR_MAX || EXPORT_DIR_ILLEGAL.test(next)) {
      return { ok: false, message: '导出目录格式不合法' }
    }
    store.set('exportDir', next)
    return { ok: true, exportDir: next }
  })

  ipcMain.handle(IPC.evtAnalysisResult, () => undefined)

  ipcMain.on(IPC.analysisDone, (event, payload: AnalysisDonePayload) => {
    if (!isTrustedSender(event)) return
    orchestrator.markAnalysisDone(payload)
  })

  // 悬浮窗重载：按事件来源窗口分发（主窗口 vs 悬浮窗）
  ipcMain.handle(IPC.reloadRemote, (event) => {
    void (async () => {
      const sender = BrowserWindow.fromWebContents(event.sender)
      if (sender && getMainWindow() && sender === getMainWindow()) {
        loadMainRemote()
      } else {
        reloadRemote()
      }
    })()
  })

  ipcMain.handle(IPC.floatingWindowControl, (event, action: FloatingWindowControlAction) => {
    if (!isTrustedSender(event)) return { ok: false, message: '来源不受信任' }
    const win = getFloatingWindow()
    if (!win || win.isDestroyed()) {
      return { ok: false, message: '悬浮窗未就绪' }
    }
    if (action === 'scale-toggle') toggleFloatingScaleWin()
    else if (action === 'minimize') hideFloatingWindowToTray()
    else if (action === 'close') hideFloatingWindowToTray()
    else if (action === 'fullscreen-toggle') toggleFloatingFullscreen()
    return { ok: true }
  })

  // 悬浮窗活动心跳：仅接受来自悬浮窗 renderer 的事件
  ipcMain.on(IPC.floatingActivity, (event) => {
    const win = getFloatingWindow()
    if (win && !win.isDestroyed() && event.sender === win.webContents) {
      touchFloating()
    }
  })

  ipcMain.handle(IPC.cppDetect, (event) => {
    assertTrusted(event)
    return cppRunner.detectToolchain()
  })
  ipcMain.handle(IPC.cppProvision, (event) => {
    assertTrusted(event)
    return cppRunner.provision({
      events: { onEvent: (evt) => event.sender.send(IPC.evtCppProvision, evt) },
    })
  })
  ipcMain.handle(IPC.cppCancelProvision, (event) => {
    assertTrusted(event)
    return cppRunner.cancelProvision()
  })

  ipcMain.handle(IPC.cppCompile, (event, source: unknown) => {
    if (!isTrustedSender(event)) {
      return { ok: false, output: '来源不受信任', exitCode: null, sourcePath: undefined }
    }
    const text = typeof source === 'string' ? source : ''
    if (text.length > CPP_COMPILE_MAX_CHARS) {
      return { ok: false, output: '源码过长，无法编译（上限 1MB）', exitCode: null, sourcePath: undefined }
    }
    return cppRunner.compile(text)
  })

  ipcMain.handle(IPC.cppRun, (event, payload: { binaryPath: string }) => {
    if (!isTrustedSender(event)) {
      return { ok: false, output: '来源不受信任', exitCode: null, timedOut: false }
    }
    const binaryPath = typeof payload?.binaryPath === 'string' ? payload.binaryPath : ''
    if (!isPathWithin(CPP_TMP_DIR, binaryPath)) {
      return { ok: false, output: '非法二进制路径', exitCode: null, timedOut: false }
    }
    return cppRunner.run(binaryPath)
  })

  ipcMain.handle(IPC.cppDebugStart, (event, input: CppDebugStartInput) => {
    if (!isTrustedSender(event)) return { ok: false, message: '来源不受信任' }
    const binaryPath = typeof input?.binaryPath === 'string' ? input.binaryPath : ''
    const sourcePath = typeof input?.sourcePath === 'string' ? input.sourcePath : ''
    if (!isPathWithin(CPP_TMP_DIR, binaryPath) || !isPathWithin(CPP_TMP_DIR, sourcePath)) {
      return { ok: false, message: '非法调试路径' }
    }
    return cppRunner.startDebug({
      ...input,
      binaryPath,
      sourcePath,
      events: { onEvent: (evt) => event.sender.send(IPC.evtCppDebug, evt) },
    })
  })
  ipcMain.handle(IPC.cppDebugAction, (event, action: CppDebugAction) => {
    assertTrusted(event)
    return cppRunner.sendDebugAction(action)
  })
  ipcMain.handle(IPC.cppDebugStop, (event) => {
    assertTrusted(event)
    return cppRunner.stopDebug().then(() => ({ ok: true }))
  })

  // 系统通知（P0-A）：渲染层 → 主进程原生 Notification
  ipcMain.handle(IPC.notify, (event, payload: unknown) => {
    if (!isTrustedSender(event)) return { ok: false, message: '来源不受信任' }
    return showSystemNotification(payload)
  })

  // 供托盘/其他模块调用的悬浮窗显隐
  ipcMain.handle('desktop:toggle-window', () => {
    toggleFloatingWindow()
  })
}
