/**
 * 桌面 IPC 通道名与消息类型常量（唯一事实来源）。
 *
 * shared/types/ipc.ts 与本文件保持一致（供 Web companion 模式引用），
 * 修改时需同步两处。
 */

export const IPC = {
  // renderer → main（invoke）
  getStatus: 'desktop:get-status',
  triggerAnalysis: 'desktop:trigger-analysis',
  setListening: 'desktop:set-listening',
  setCodeUploadEnabled: 'desktop:set-code-upload-enabled',
  setFloatWindowEnabled: 'desktop:set-float-window-enabled',
  setVsPath: 'desktop:set-vs-path',
  openMainApp: 'desktop:open-main-app',
  reloadRemote: 'desktop:reload-remote',
  windowControl: 'desktop:window-control',
  readSelection: 'desktop:read-selection',
  floatingWindowControl: 'desktop:floating-window-control',
  getLocalPaths: 'desktop:get-local-paths',
  setExportDir: 'desktop:set-export-dir',
  cppDetect: 'desktop:cpp-detect',
  cppProvision: 'desktop:cpp-provision',
  cppCancelProvision: 'desktop:cpp-cancel-provision',
  cppCompile: 'desktop:cpp-compile',
  cppRun: 'desktop:cpp-run',
  cppDebugStart: 'desktop:cpp-debug-start',
  cppDebugAction: 'desktop:cpp-debug-action',
  cppDebugStop: 'desktop:cpp-debug-stop',
  notify: 'desktop:notify',
  // renderer → main（send）
  analysisDone: 'desktop:analysis-done',
  floatingActivity: 'desktop:floating-activity',
  // main → renderer（webContents.send）
  evtVsStarted: 'desktop:vs-started',
  evtAnalysisResult: 'desktop:analysis-result',
  evtStatusChanged: 'desktop:status-changed',
  evtWindowStateChanged: 'desktop:window-state-changed',
  evtSelectionRead: 'desktop:selection-read',
  evtFloatingWindowStateChanged: 'desktop:floating-window-state-changed',
  evtCppDebug: 'desktop:cpp-debug-event',
  evtCppProvision: 'desktop:cpp-provision-event',
  evtNotifyClicked: 'desktop:notify-clicked',
} as const

/**
 * 已发布 Web 应用地址（悬浮窗加载 https://WEB_APP_URL?mode=companion，
 * 主窗口加载 https://WEB_APP_URL?desktop=1）。
 * 开源 / 多环境使用：复制 `desktop/.env.example` 为 `desktop/.env` 并填入域名。
 */
export const WEB_APP_URL = import.meta.env.VITE_WEB_APP_URL ?? ''

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

/** 代码问题条目（与 shared/types/domain.ts 的 CodeIssue 保持一致）。 */
export interface CodeIssue {
  severity: 'error' | 'warning' | 'suggestion'
  title: string
  description: string
  suggestion: string
  file?: string
  line?: number
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

/** 系统通知载荷（renderer → main）。 */
export interface NotifyPayload {
  /** 去重键（`记录id|remind_at`），点击时原样回传。 */
  key: string
  recordId: number
  title: string
  body: string
}

/** 通知点击事件载荷（main → renderer）。 */
export interface NotifyClickedPayload {
  key: string
  recordId: number
}
