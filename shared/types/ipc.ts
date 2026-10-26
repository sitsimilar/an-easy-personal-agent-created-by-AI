/**
 * 桌面 IPC 消息类型（镜像 desktop/src/shared/ipc-contract.ts）。
 *
 * 唯一事实来源是 desktop/src/shared/ipc-contract.ts，本文件与其保持一致，
 * 供 Web 端（companion 模式）在编译期引用，二者修改需同步。
 */

import type { CodeIssue } from './domain'

/** 主进程推给悬浮窗的源码文件片段。 */
export interface SourceFilePayload {
  relativePath: string
  content: string
  sha256: string
}

/** VS 启动事件载荷。 */
export interface VsStartedPayload {
  solutionName: string
  solutionPath: string
  projectNames: string[]
  changedFiles: SourceFilePayload[]
  startedAt: string
}

/** 分析完成事件载荷（悬浮窗回传主进程）。 */
export interface AnalysisDonePayload {
  analysisId: number
  status: 'done' | 'failed'
  issueCount: number
  message?: string
  solutionName?: string
  solutionPath?: string
  summary?: string
  issues?: CodeIssue[]
  analyzedAt?: string
}

/** 分析结果导出载荷（主进程落盘到 %LOCALAPPDATA%\PersonalAgent\）。 */
export interface AnalysisExportPayload {
  solutionName: string
  solutionPath: string
  projectName?: string | null
  summary: string
  issues: CodeIssue[]
  status: 'done' | 'failed'
  message?: string
  analyzedAt: string
  issueCount: number
}

/** 窗口控制动作。 */
export type WindowControlAction = 'minimize' | 'maximize-toggle' | 'close'

/** 悬浮窗窗口控制动作。 */
export type FloatingWindowControlAction = 'scale-toggle' | 'minimize' | 'close' | 'fullscreen-toggle'

/** 悬浮窗状态（尺寸档位 + 是否已自动收起 + 是否全屏）。 */
export interface FloatingWindowStatePayload {
  scale: 'small' | 'large'
  docked: boolean
  fullscreen: boolean
}

/** 本地存储路径（设置页展示用）。 */
export interface LocalPathsPayload {
  /** 应用本地偏好目录（userData）。 */
  userDataDir: string
  /** 当前分析导出目录。 */
  exportDir: string
  /** 默认分析导出目录（未自定义时）。 */
  exportDefaultDir: string
}

/** 窗口状态（主窗口最大化态）载荷。 */
export interface WindowStatePayload {
  isMaximized: boolean
}

/** 选区读取结果。 */
export interface SelectionReadResult {
  status: 'ok' | 'empty' | 'non-text' | 'error'
  text?: string
  message?: string
  capturedAt?: string
}

/** 桌面伴侣运行状态。 */
export interface DesktopStatus {
  listening: boolean
  vsRunning: boolean
  /** null = 探测中 */
  vsInstalled: boolean | null
  currentSolution: string | null
  analyzing: boolean
  codeUploadEnabled: boolean
  windowVisible: boolean
  lastAnalysisAt: string | null
  lastIssueCount: number | null
  lastTriggerReason: 'start' | 'activate' | 'manual' | null
}

/** 单一工具链（g++/gdb/cl/cdb）检测结果。 */
export interface ToolchainItem {
  ok: boolean
  version?: string
  /** 实际可执行文件绝对路径（spawn 用；PATH 命中时为可执行名本身）。 */
  path?: string
  error?: string
  /** 检测来源，用于诊断文案：'path' | 'vswhere' | 'sdk' | 'registered'。 */
  source?: 'path' | 'vswhere' | 'sdk' | 'registered'
}

/** 编译器 ↔ 调试器配对选择结果。 */
export interface ToolchainSelection {
  compiler: 'gpp' | 'cl' | null
  debugger: 'gdb' | 'cdb' | null
  ready: boolean
  canDebug: boolean
  reason?: string
}

/** 本机 C++ 工具链状态（gpp/gdb 保留，新增 cl/cdb/selection）。 */
export interface ToolchainStatus {
  gpp: ToolchainItem
  gdb: ToolchainItem
  cl: ToolchainItem
  cdb: ToolchainItem
  selection: ToolchainSelection
}

/** C++ 编译结果。 */
export interface CompileResult {
  ok: boolean
  output: string
  exitCode: number | null
  binaryPath?: string
  sourcePath?: string
}

/** C++ 程序运行结果。 */
export interface RunResult {
  ok: boolean
  output: string
  exitCode: number | null
  timedOut: boolean
}

/** 调试调用栈帧。 */
export interface DebugFrame {
  level: number
  func: string
  file?: string
  fullname?: string
  line?: number
}

/** 调试局部变量。 */
export interface DebugVariable {
  name: string
  value: string
  type?: string
}

/** 主进程推给渲染进程的 C++ 调试事件。 */
export type CppDebugEvent =
  | { type: 'output'; stream: 'stdout' | 'stderr' | 'gdb' | 'cdb'; text: string }
  | { type: 'running' }
  | { type: 'stopped'; reason: string; frame?: DebugFrame; message?: string }
  | { type: 'frames'; frames: DebugFrame[] }
  | { type: 'variables'; variables: DebugVariable[] }
  | { type: 'ended'; exitCode?: number }

/** 启动 C++ 调试会话入参。 */
export interface CppDebugStartInput {
  binaryPath: string
  sourcePath: string
  breakpoints: number[]
}

/** 语义化调试动作（UI 对 gdb/cdb 后端无感知，由主进程翻译）。 */
export type CppDebugAction = 'continue' | 'step-over' | 'step-into' | 'interrupt'

/** 一键部署阶段。 */
export type CppProvisionPhase = 'checking' | 'downloading' | 'extracting' | 'verifying' | 'done' | 'failed'

/** 一键部署进度事件。 */
export type CppProvisionEvent =
  | { type: 'phase'; phase: CppProvisionPhase; message?: string }
  | { type: 'progress'; percent: number; receivedBytes: number; totalBytes: number | null }

/** 一键部署结果。 */
export interface CppProvisionResult {
  ok: boolean
  message?: string
  toolchainDir?: string
}

/** 系统通知载荷（renderer → main，P0-A）。 */
export interface NotifyPayload {
  /** 去重键（`记录id|remind_at`）。 */
  key: string
  recordId: number
  title: string
  body: string
}

/** 通知点击事件载荷（main → renderer，P0-A）。 */
export interface NotifyClickedPayload {
  key: string
  recordId: number
}

/**
 * preload 暴露到 window.desktopBridge 的 API。
 *
 * 完整版桌面提供全部方法（主窗口 / VS 监听 / 分析管线 + 悬浮窗 + C++ 工具链），
 * 浏览器直开（无 bridge）时 window.desktopBridge 为 undefined，调用侧需先判空。
 */
export interface DesktopBridge {
  getStatus(): Promise<DesktopStatus>
  triggerAnalysis(): Promise<{ ok: boolean; message?: string }>
  setListening(enabled: boolean): Promise<{ ok: boolean; message?: string }>
  setCodeUploadEnabled(enabled: boolean): Promise<{ ok: boolean; message?: string }>
  setFloatWindowEnabled(enabled: boolean): Promise<{ ok: boolean; message?: string }>
  setVsPath(path: string): Promise<{ ok: boolean; message?: string }>
  openMainApp(): void
  reloadRemote(): void
  windowControl(action: WindowControlAction): Promise<{ ok: boolean; message?: string }>
  readSelection(): Promise<SelectionReadResult>
  floatingWindowControl(action: FloatingWindowControlAction): Promise<{ ok: boolean; message?: string }>
  getLocalPaths(): Promise<LocalPathsPayload>
  setExportDir(dir: string): Promise<{ ok: boolean }>
  cppDetect(): Promise<ToolchainStatus>
  cppProvision(): Promise<CppProvisionResult>
  cppCancelProvision(): Promise<{ ok: boolean }>
  cppCompile(source: string): Promise<CompileResult>
  cppRun(binaryPath: string): Promise<RunResult>
  cppDebugStart(input: CppDebugStartInput): Promise<{ ok: boolean; message?: string }>
  cppDebugAction(action: CppDebugAction): Promise<{ ok: boolean; message?: string }>
  cppDebugStop(): Promise<{ ok: boolean }>
  onCppDebug(cb: (evt: CppDebugEvent) => void): () => void
  onCppProvision(cb: (evt: CppProvisionEvent) => void): () => void
  notifyFloatingActivity(): void
  notifyAnalysisDone(payload: AnalysisDonePayload): void
  /** 弹系统通知（P0-A；主进程创建原生 Notification）。 */
  notify(payload: NotifyPayload): Promise<{ ok: boolean; message?: string }>
  /** 监听通知点击（P0-A；返回取消注册函数）。 */
  onNotificationClicked(cb: (payload: NotifyClickedPayload) => void): () => void
  onVsStarted(cb: (payload: VsStartedPayload) => void): () => void
  onAnalysisResult(cb: (payload: AnalysisDonePayload) => void): () => void
  onStatusChanged(cb: (status: DesktopStatus) => void): () => void
  onWindowStateChanged(cb: (state: WindowStatePayload) => void): () => void
  onSelectionRead(cb: (result: SelectionReadResult) => void): () => void
  onFloatingWindowStateChanged(cb: (state: FloatingWindowStatePayload) => void): () => void
}

declare global {
  interface Window {
    desktopBridge?: DesktopBridge
  }
}

export {}
