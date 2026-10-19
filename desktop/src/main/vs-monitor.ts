import { EventEmitter } from 'node:events'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { store } from './store'

const execFileAsync = promisify(execFile)

/** VS 运行时探测间隔。 */
const POLL_ACTIVE_MS = 3000
/** VS 未运行时退避探测间隔（降低常驻 CPU/进程创建）。 */
const POLL_IDLE_MS = 12000
/** 前台窗口检测节流（避免每次 poll 都 spawn PowerShell + Add-Type；须 ≥ POLL_ACTIVE_MS 才真正生效）。 */
const FOREGROUND_THROTTLE_MS = 5000

export interface VsDetection {
  pid: number
  solutionPath: string | null
}

/** 从命令行提取 .sln / .csproj 绝对路径。 */
function extractSolutionPath(cmd: string | null | undefined): string | null {
  if (!cmd) return null
  const sln = cmd.match(/["']?([A-Za-z]:\\[^"'\s]*\.sln)["']?/i)
  if (sln) return sln[1]
  const csproj = cmd.match(/["']?([A-Za-z]:\\[^"'\s]*\.csproj)["']?/i)
  if (csproj) return csproj[1]
  return null
}

/** 主方案：ps-list（纯 JS，含命令行）。 */
async function detectViaPsList(): Promise<VsDetection[]> {
  try {
    const mod = (await import('ps-list')) as { default?: (() => Promise<unknown[]>) & (() => Promise<unknown[]>) }
    const psList = (mod.default ?? mod) as () => Promise<unknown[]>
    const list = await psList()
    return (Array.isArray(list) ? list : [])
      .filter((p) => {
        const name = (p as { name?: unknown }).name
        return typeof name === 'string' && /devenv\.exe$/i.test(name)
      })
      .map((p) => {
        const proc = p as { pid?: unknown; cmd?: unknown }
        return { pid: Number(proc.pid) || 0, solutionPath: extractSolutionPath(proc.cmd as string | null) }
      })
      .filter((d) => d.pid > 0)
  } catch {
    return []
  }
}

/** 兜底方案：PowerShell WMI 获取 devenv.exe 及其 CommandLine。 */
async function detectViaPowerShell(): Promise<VsDetection[]> {
  const script =
    "Get-CimInstance Win32_Process -Filter \"Name='devenv.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress"
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, maxBuffer: 10 * 1024 * 1024 },
    )
    const raw = (stdout || '').trim()
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    const arr = Array.isArray(parsed) ? parsed : [parsed]
    return (arr as Array<{ ProcessId?: unknown; CommandLine?: unknown }>)
      .filter((p) => p && p.ProcessId)
      .map((p) => ({ pid: Number(p.ProcessId) || 0, solutionPath: extractSolutionPath(p.CommandLine as string | null) }))
      .filter((d) => d.pid > 0)
  } catch {
    return []
  }
}

/** 检测前台窗口所属进程 pid（PowerShell + user32，仅 VS 运行时调用，且已节流）。 */
async function detectForegroundPid(): Promise<number | null> {
  const script = [
    "$ErrorActionPreference='SilentlyContinue'",
    "Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class Fg{[DllImport(\"user32.dll\")]public static extern IntPtr GetForegroundWindow();[DllImport(\"user32.dll\")]public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);}'",
    '$h=[Fg]::GetForegroundWindow()',
    '$p=0',
    '[Fg]::GetWindowThreadProcessId($h,[ref]$p)|Out-Null',
    '$p',
  ].join('; ')

  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { windowsHide: true, maxBuffer: 1024 * 1024 },
  )
  const pid = Number((stdout || '').trim())
  return Number.isFinite(pid) && pid > 0 ? pid : null
}

/** 探测 VS 是否安装（启动时一次性，异常返回 false 不抛）。 */
export async function detectVsInstalled(): Promise<boolean> {
  // 0) 用户手动填写的 VS 安装根（settings 同步到本地 store）
  const vsPath = store.get('vsPath')
  if (vsPath) {
    try {
      const devenv = join(vsPath, 'Common7', 'IDE', 'devenv.exe')
      if (existsSync(devenv)) return true
    } catch {
      /* 继续 */
    }
  }

  // 1) where.exe devenv（PATH 命中）
  try {
    const { stdout } = await execFileAsync('where.exe', ['devenv'], { windowsHide: true })
    if ((stdout || '').trim()) return true
  } catch {
    /* 继续 */
  }

  // 2) 常见安装目录通配
  const roots = [
    process.env.ProgramFiles ? join(process.env.ProgramFiles, 'Microsoft Visual Studio') : '',
    process.env['ProgramFiles(x86)'] ? join(process.env['ProgramFiles(x86)'], 'Microsoft Visual Studio') : '',
  ].filter(Boolean)

  for (const root of roots) {
    try {
      if (!existsSync(root)) continue
      for (const entry of readdirSync(root)) {
        const devenv = join(root, entry, 'Common7', 'IDE', 'devenv.exe')
        if (existsSync(devenv)) return true
      }
    } catch {
      /* 继续 */
    }
  }
  return false
}

/** 监听 devenv.exe：VS 运行时 3s 探测、未运行时 12s 退避；去重并触发 vs-started / vs-activated 事件。 */
export class VsMonitor extends EventEmitter {
  private timer: ReturnType<typeof setTimeout> | null = null
  private known = new Map<number, string>()
  private enabled = true
  private foregroundFailed = false
  private lastForegroundAt = 0

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (enabled) {
      this.start()
    } else {
      this.stop()
    }
  }

  isRunning(): boolean {
    return this.known.size > 0
  }

  start(): void {
    this.stop()
    void this.poll()
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.known.clear()
  }

  private scheduleNext(delay: number): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      void this.poll()
    }, delay)
  }

  private firstKnownSolution(): string | null {
    for (const value of this.known.values()) {
      if (value) return value
    }
    return null
  }

  private emitForegroundFailure(): void {
    if (this.foregroundFailed) return
    this.foregroundFailed = true
    this.emit('foreground-unavailable')
  }

  async poll(): Promise<void> {
    if (!this.enabled) return

    let detections = await detectViaPsList()
    if (detections.length === 0) {
      detections = await detectViaPowerShell()
    }

    const seen = new Set<number>()
    for (const d of detections) {
      seen.add(d.pid)
      if (!this.known.has(d.pid)) {
        this.known.set(d.pid, d.solutionPath ?? '')
        this.emit('vs-started', d)
      }
    }

    for (const pid of Array.from(this.known.keys())) {
      if (!seen.has(pid)) this.known.delete(pid)
    }

    const vsRunning = this.known.size > 0

    // 窗口激活检测（仅 VS 运行中执行，且按 2s 节流，避免每次 poll 都 spawn PowerShell + Add-Type）
    if (vsRunning) {
      const now = Date.now()
      if (now - this.lastForegroundAt >= FOREGROUND_THROTTLE_MS) {
        this.lastForegroundAt = now
        try {
          const fgPid = await detectForegroundPid()
          if (fgPid !== null && this.known.has(fgPid)) {
            const solutionPath = this.known.get(fgPid) || this.firstKnownSolution()
            this.emit('vs-activated', { pid: fgPid, solutionPath })
          }
        } catch {
          this.emitForegroundFailure()
        }
      }
    }

    this.emit('status-changed', { vsRunning })

    // 动态退避：VS 运行 3s、未运行 12s
    this.scheduleNext(vsRunning ? POLL_ACTIVE_MS : POLL_IDLE_MS)
  }
}
