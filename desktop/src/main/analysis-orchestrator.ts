import { basename } from 'node:path'
import { IPC, type AnalysisDonePayload, type DesktopStatus, type VsStartedPayload } from '../shared/ipc-contract'
import type { JsonStore } from './store'
import type { VsMonitor } from './vs-monitor'
import { readSolution } from './solution-reader'
import { exportAnalysis } from './analysis-exporter'
import { resumeFloatingAutoCollapse, suspendFloatingAutoCollapse } from './floating-window'

interface OrchestratorDeps {
  vsMonitor: VsMonitor
  store: JsonStore
  getWindow: () => Electron.BrowserWindow | null
  onStatus?: (status: DesktopStatus) => void
  onNotice?: (message: string | null) => void
}

type TriggerReason = 'start' | 'activate' | 'manual'

/** 编排：监听 VS 启动/激活 → 读码 → IPC 推给悬浮窗 → 接收分析完成状态。 */
export class AnalysisOrchestrator {
  private status: DesktopStatus = {
    listening: true,
    vsRunning: false,
    vsInstalled: null,
    currentSolution: null,
    analyzing: false,
    codeUploadEnabled: true,
    windowVisible: true,
    lastAnalysisAt: null,
    lastIssueCount: null,
    lastTriggerReason: null,
  }

  private lastTriggerAt = new Map<string, number>()
  private readonly COOLDOWN_MS = 30_000

  constructor(private deps: OrchestratorDeps) {}

  start(): void {
    this.deps.vsMonitor.on('vs-started', (payload: { pid: number; solutionPath: string | null }) => {
      void this.triggerSolution(payload.solutionPath, 'start')
    })
    this.deps.vsMonitor.on('vs-activated', (payload: { pid: number; solutionPath: string | null }) => {
      void this.triggerSolution(payload.solutionPath, 'activate')
    })
    this.deps.vsMonitor.on('status-changed', (payload: { vsRunning: boolean }) => {
      this.status.vsRunning = payload.vsRunning
      this.broadcast()
    })
    this.deps.vsMonitor.on('foreground-unavailable', () => {
      this.deps.onNotice?.('前台检测不可用，仅进程启动触发')
    })
    this.status.listening = this.deps.store.get('listening')
    this.status.codeUploadEnabled = this.deps.store.get('codeUploadEnabled')
  }

  getStatus(): DesktopStatus {
    return { ...this.status }
  }

  setVsInstalled(installed: boolean): void {
    this.status.vsInstalled = installed
    this.broadcast()
  }

  private broadcast(): void {
    const status = this.getStatus()
    const win = this.deps.getWindow()
    win?.webContents.send(IPC.evtStatusChanged, status)
    this.deps.onStatus?.(status)
  }

  private async triggerSolution(
    solutionPath: string | null,
    reason: TriggerReason,
  ): Promise<void> {
    if (!solutionPath) {
      this.status.currentSolution = null
      this.broadcast()
      return
    }

    // 窗口激活受 30s 冷却约束（进程启动/手动不受冷却）
    if (reason === 'activate') {
      const last = this.lastTriggerAt.get(solutionPath)
      if (last && Date.now() - last < this.COOLDOWN_MS) return
    }
    this.lastTriggerAt.set(solutionPath, Date.now())
    this.pruneLastTriggerAt()

    this.status.currentSolution = solutionPath
    this.status.lastTriggerReason = reason
    this.broadcast()

    const win = this.deps.getWindow()
    if (!win) return

    const base = basename(solutionPath, '.sln')

    // 隐私开关：关闭时不读取、不推送源码，也不进入 analyzing（无需 suspend）
    if (!this.deps.store.get('codeUploadEnabled')) {
      win.webContents.send(IPC.evtVsStarted, {
        solutionName: base,
        solutionPath,
        projectNames: [],
        changedFiles: [],
        startedAt: new Date().toISOString(),
      } satisfies VsStartedPayload)
      return
    }

    // 确认真正进入分析后才暂停自动收起（保证所有出口都能 resume）
    this.status.analyzing = true
    this.broadcast()
    suspendFloatingAutoCollapse()

    try {
      const prevHashes = this.deps.store.get('cache')[solutionPath] ?? {}
      const result = await readSolution(solutionPath, prevHashes)

      // 更新增量缓存（hash 变化才重分析；限制最近 50 个方案，防配置膨胀）
      const cache = this.pruneCache({ ...this.deps.store.get('cache'), [solutionPath]: result.hashes })
      this.deps.store.set('cache', cache)

      if (result.changedFiles.length === 0) {
        // 无变更文件：无需分析，复位并恢复收起
        this.status.analyzing = false
        this.broadcast()
        resumeFloatingAutoCollapse()
        return
      }

      win.webContents.send(IPC.evtVsStarted, {
        solutionName: result.solutionName,
        solutionPath,
        projectNames: result.projectNames,
        changedFiles: result.changedFiles,
        startedAt: new Date().toISOString(),
      } satisfies VsStartedPayload)
      // 分析在 web 端进行，analyzing 保持 true 直到 markAnalysisDone 回传
    } catch {
      win.webContents.send(IPC.evtVsStarted, {
        solutionName: base,
        solutionPath,
        projectNames: [],
        changedFiles: [],
        startedAt: new Date().toISOString(),
      } satisfies VsStartedPayload)
      this.status.analyzing = false
      this.broadcast()
      resumeFloatingAutoCollapse()
    }
  }

  /** 清理过期的冷却时间戳，防止 Map 无限增长。 */
  private pruneLastTriggerAt(): void {
    const cutoff = Date.now() - this.COOLDOWN_MS * 2
    for (const [key, ts] of this.lastTriggerAt) {
      if (ts < cutoff) this.lastTriggerAt.delete(key)
    }
  }

  /** 限制增量 hash 缓存为最近 N 个方案（FIFO 淘汰，防 preferences.json 膨胀）。 */
  private pruneCache(cache: Record<string, Record<string, string>>): Record<string, Record<string, string>> {
    const keys = Object.keys(cache)
    if (keys.length <= 50) return cache
    const out: Record<string, Record<string, string>> = {}
    for (const key of keys.slice(keys.length - 50)) out[key] = cache[key]
    return out
  }

  /** 悬浮窗回传分析完成，回填结果状态并导出到本地供 VSIX 读取。 */
  markAnalysisDone(payload: AnalysisDonePayload): void {
    this.status.analyzing = false
    this.status.lastAnalysisAt = new Date().toISOString()
    this.status.lastIssueCount = payload.issueCount ?? null
    this.broadcast()

    // 分析结束：恢复自动收起（若已被收起则唤醒）
    resumeFloatingAutoCollapse()

    if (payload.solutionName && payload.solutionPath) {
      exportAnalysis({
        solutionName: payload.solutionName,
        solutionPath: payload.solutionPath,
        summary: payload.summary ?? '',
        issues: payload.issues ?? [],
        status: payload.status,
        message: payload.message,
        analyzedAt: payload.analyzedAt ?? new Date().toISOString(),
        issueCount: payload.issueCount ?? 0,
      })
    }
  }

  /** 手动触发当前解决方案分析。 */
  async triggerManual(): Promise<{ ok: boolean; message?: string }> {
    if (!this.status.vsRunning) {
      return { ok: false, message: '未检测到正在运行的 Visual Studio，请先启动' }
    }
    const current = this.status.currentSolution
    if (!current) {
      return { ok: false, message: '未检测到当前 VS 解决方案，请先打开一个解决方案' }
    }
    await this.triggerSolution(current, 'manual')
    return { ok: true }
  }
}
