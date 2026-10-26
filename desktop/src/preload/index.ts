import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  type AnalysisDonePayload,
  type CompileResult,
  type CppDebugAction,
  type CppDebugEvent,
  type CppDebugStartInput,
  type CppProvisionEvent,
  type CppProvisionResult,
  type DesktopStatus,
  type FloatingWindowControlAction,
  type FloatingWindowStatePayload,
  type LocalPathsPayload,
  type NotifyClickedPayload,
  type NotifyPayload,
  type RunResult,
  type SelectionReadResult,
  type ToolchainStatus,
  type VsStartedPayload,
  type WindowControlAction,
  type WindowStatePayload,
} from '../shared/ipc-contract'

/** 悬浮窗活动心跳：mousemove 300ms 节流 / mousedown / keydown / wheel。 */
let lastActivitySent = 0
function notifyActivity(): void {
  const now = Date.now()
  if (now - lastActivitySent < 300) return
  lastActivitySent = now
  ipcRenderer.send(IPC.floatingActivity)
}
window.addEventListener('mousemove', notifyActivity)
window.addEventListener('mousedown', notifyActivity)
window.addEventListener('keydown', notifyActivity)
window.addEventListener('wheel', notifyActivity)

/** 完整版 bridge：主窗口 + 悬浮窗 + VS 监听 + 分析管线全部能力。 */
const fullBridge = {
  getStatus: (): Promise<DesktopStatus> => ipcRenderer.invoke(IPC.getStatus),
  triggerAnalysis: (): Promise<{ ok: boolean; message?: string }> =>
    ipcRenderer.invoke(IPC.triggerAnalysis),
  setListening: (enabled: boolean): Promise<{ ok: boolean; message?: string }> =>
    ipcRenderer.invoke(IPC.setListening, enabled),
  setCodeUploadEnabled: (enabled: boolean): Promise<{ ok: boolean; message?: string }> =>
    ipcRenderer.invoke(IPC.setCodeUploadEnabled, enabled),
  setFloatWindowEnabled: (enabled: boolean): Promise<{ ok: boolean; message?: string }> =>
    ipcRenderer.invoke(IPC.setFloatWindowEnabled, enabled),
  setVsPath: (path: string): Promise<{ ok: boolean; message?: string }> =>
    ipcRenderer.invoke(IPC.setVsPath, path),
  openMainApp: (): void => {
    void ipcRenderer.invoke(IPC.openMainApp)
  },
  reloadRemote: (): void => {
    void ipcRenderer.invoke(IPC.reloadRemote)
  },
  windowControl: (action: WindowControlAction): Promise<{ ok: boolean; message?: string }> =>
    ipcRenderer.invoke(IPC.windowControl, action),
  floatingWindowControl: (action: FloatingWindowControlAction): Promise<{ ok: boolean; message?: string }> =>
    ipcRenderer.invoke(IPC.floatingWindowControl, action),
  getLocalPaths: (): Promise<LocalPathsPayload> => ipcRenderer.invoke(IPC.getLocalPaths),
  setExportDir: (dir: string): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.setExportDir, dir),
  cppDetect: (): Promise<ToolchainStatus> => ipcRenderer.invoke(IPC.cppDetect),
  cppProvision: (): Promise<CppProvisionResult> => ipcRenderer.invoke(IPC.cppProvision),
  cppCancelProvision: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.cppCancelProvision),
  cppCompile: (source: string): Promise<CompileResult> => ipcRenderer.invoke(IPC.cppCompile, source),
  cppRun: (binaryPath: string): Promise<RunResult> => ipcRenderer.invoke(IPC.cppRun, { binaryPath }),
  cppDebugStart: (input: CppDebugStartInput): Promise<{ ok: boolean; message?: string }> =>
    ipcRenderer.invoke(IPC.cppDebugStart, input),
  cppDebugAction: (action: CppDebugAction): Promise<{ ok: boolean; message?: string }> =>
    ipcRenderer.invoke(IPC.cppDebugAction, action),
  cppDebugStop: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.cppDebugStop),
  onCppDebug: (cb: (evt: CppDebugEvent) => void): (() => void) => {
    const handler = (_event: unknown, evt: CppDebugEvent) => cb(evt)
    ipcRenderer.on(IPC.evtCppDebug, handler)
    return () => ipcRenderer.removeListener(IPC.evtCppDebug, handler)
  },
  onCppProvision: (cb: (evt: CppProvisionEvent) => void): (() => void) => {
    const handler = (_event: unknown, evt: CppProvisionEvent) => cb(evt)
    ipcRenderer.on(IPC.evtCppProvision, handler)
    return () => ipcRenderer.removeListener(IPC.evtCppProvision, handler)
  },
  notifyFloatingActivity: (): void => {
    notifyActivity()
  },
  readSelection: (): Promise<SelectionReadResult> => ipcRenderer.invoke(IPC.readSelection),
  notifyAnalysisDone: (payload: AnalysisDonePayload): void => {
    ipcRenderer.send(IPC.analysisDone, payload)
  },
  notify: (payload: NotifyPayload): Promise<{ ok: boolean; message?: string }> =>
    ipcRenderer.invoke(IPC.notify, payload),
  onNotificationClicked: (cb: (payload: NotifyClickedPayload) => void): (() => void) => {
    const handler = (_event: unknown, payload: NotifyClickedPayload) => cb(payload)
    ipcRenderer.on(IPC.evtNotifyClicked, handler)
    return () => ipcRenderer.removeListener(IPC.evtNotifyClicked, handler)
  },
  onVsStarted: (cb: (payload: VsStartedPayload) => void): (() => void) => {
    const handler = (_event: unknown, payload: VsStartedPayload) => cb(payload)
    ipcRenderer.on(IPC.evtVsStarted, handler)
    return () => ipcRenderer.removeListener(IPC.evtVsStarted, handler)
  },
  onAnalysisResult: (cb: (payload: AnalysisDonePayload) => void): (() => void) => {
    const handler = (_event: unknown, payload: AnalysisDonePayload) => cb(payload)
    ipcRenderer.on(IPC.evtAnalysisResult, handler)
    return () => ipcRenderer.removeListener(IPC.evtAnalysisResult, handler)
  },
  onStatusChanged: (cb: (status: DesktopStatus) => void): (() => void) => {
    const handler = (_event: unknown, status: DesktopStatus) => cb(status)
    ipcRenderer.on(IPC.evtStatusChanged, handler)
    return () => ipcRenderer.removeListener(IPC.evtStatusChanged, handler)
  },
  onWindowStateChanged: (cb: (state: WindowStatePayload) => void): (() => void) => {
    const handler = (_event: unknown, state: WindowStatePayload) => cb(state)
    ipcRenderer.on(IPC.evtWindowStateChanged, handler)
    return () => ipcRenderer.removeListener(IPC.evtWindowStateChanged, handler)
  },
  onSelectionRead: (cb: (result: SelectionReadResult) => void): (() => void) => {
    const handler = (_event: unknown, result: SelectionReadResult) => cb(result)
    ipcRenderer.on(IPC.evtSelectionRead, handler)
    return () => ipcRenderer.removeListener(IPC.evtSelectionRead, handler)
  },
  onFloatingWindowStateChanged: (cb: (state: FloatingWindowStatePayload) => void): (() => void) => {
    const handler = (_event: unknown, state: FloatingWindowStatePayload) => cb(state)
    ipcRenderer.on(IPC.evtFloatingWindowStateChanged, handler)
    return () => ipcRenderer.removeListener(IPC.evtFloatingWindowStateChanged, handler)
  },
}

/** 通过 contextBridge 暴露到 window.desktopBridge（浏览器中为 undefined）。 */
const desktopBridge = fullBridge

contextBridge.exposeInMainWorld('desktopBridge', desktopBridge)

export type DesktopBridgeApi = typeof desktopBridge
