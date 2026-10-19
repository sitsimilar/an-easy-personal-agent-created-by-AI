import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  CompileResult,
  CppDebugAction,
  CppDebugEvent,
  CppProvisionEvent,
  CppProvisionResult,
  RunResult,
  ToolchainStatus,
} from '../shared/ipc-contract'
import { detectToolchain, locateVcvars } from './toolchain'
import { GdbMiSession } from './debugger/gdb-mi-session'
import { CdbSession } from './debugger/cdb-session'
import type { DebuggerSession } from './debugger/types'
import { defaultProvisionOptions, provisioner } from './provision'

/** 临时文件目录：本机工具链产物统一落在这里，best-effort 清理。 */
export const CPP_TMP_DIR = join(tmpdir(), 'personal-agent-cpp')

/** 运行超时（MVP 不支持交互式 stdin，读输入由超时兜底）。 */
const RUN_TIMEOUT_MS = 10_000
const COMPILE_TIMEOUT_MS = 30_000
/** 临时产物过期 TTL（超龄即清理）与数量上限（超出删最旧）。 */
const TMP_TTL_MS = 24 * 60 * 60 * 1000
const TMP_MAX_FILES = 50

/** 清理过期/过多的临时编译产物（best-effort，避免 tmpdir 无限堆积）。 */
function pruneTmpDir(): void {
  try {
    const entries = readdirSync(CPP_TMP_DIR, { withFileTypes: true })
    const files = entries.filter((e) => e.isFile()).map((e) => join(CPP_TMP_DIR, e.name))
    const now = Date.now()
    const stale = new Set<string>()
    for (const f of files) {
      try {
        if (now - statSync(f).mtimeMs > TMP_TTL_MS) stale.add(f)
      } catch {
        stale.add(f)
      }
    }
    for (const f of stale) {
      try { unlinkSync(f) } catch { /* 忽略 */ }
    }
    const rest = files
      .filter((f) => !stale.has(f))
      .map((f) => ({ f, m: (() => { try { return statSync(f).mtimeMs } catch { return 0 } })() }))
      .sort((a, b) => a.m - b.m)
    const overflow = rest.length - TMP_MAX_FILES
    for (let i = 0; i < overflow; i++) {
      try { unlinkSync(rest[i].f) } catch { /* 忽略 */ }
    }
  } catch {
    /* 忽略 */
  }
}

/* ------------------------------------------------------------------ *
 * 子进程工具
 * ------------------------------------------------------------------ */

interface CaptureResult {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

/** spawn + Promise 化 + 超时 kill（windowsHide 避免弹黑窗）。 */
function spawnCapture(cmd: string, args: string[], timeout: number): Promise<CaptureResult> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess
    try {
      child = spawn(cmd, args, { windowsHide: true })
    } catch (err) {
      reject(err)
      return
    }
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    const timer = setTimeout(() => {
      timedOut = true
      try {
        child.kill('SIGKILL')
      } catch {
        /* 忽略 */
      }
    }, timeout)
    child.stdout?.on('data', (d: Buffer) => {
      stdout += String(d)
    })
    child.stderr?.on('data', (d: Buffer) => {
      stderr += String(d)
    })
    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code, stdout, stderr, timedOut })
    })
  })
}

/* ------------------------------------------------------------------ *
 * 主进程推给 CppRunner 的事件回调（由 ipc.ts 用 event.sender 定向推送）
 * ------------------------------------------------------------------ */

export interface DebuggerEvents {
  onEvent: (evt: CppDebugEvent) => void
}

export interface ProvisionEvents {
  onEvent: (evt: CppProvisionEvent) => void
}

/* ------------------------------------------------------------------ *
 * CppRunner（编排层）
 * ------------------------------------------------------------------ */

export class CppRunner {
  private activeDebug: DebuggerSession | null = null

  /** 检测 4 项工具链 + 配对选择（见 toolchain.ts）。 */
  async detectToolchain(): Promise<ToolchainStatus> {
    return detectToolchain()
  }

  /** 编译：按 selection 选择 g++ 或 cl（经 vcvars64.bat 包装）。 */
  async compile(source: string): Promise<CompileResult> {
    const tc = await detectToolchain()
    const sel = tc.selection
    mkdirSync(CPP_TMP_DIR, { recursive: true })
    pruneTmpDir()
    const id = randomUUID()
    const sourcePath = join(CPP_TMP_DIR, `${id}.cpp`)
    const binaryPath = join(CPP_TMP_DIR, `${id}.exe`)
    writeFileSync(sourcePath, source, 'utf-8')

    if (!sel.ready || !sel.compiler) {
      return {
        ok: false,
        output: `未检测到可用的 C++ 编译器：${sel.reason ?? '工具链缺失'}`,
        exitCode: null,
        sourcePath,
      }
    }

    try {
      if (sel.compiler === 'gpp') {
        const gpp = tc.gpp.path ?? 'g++'
        const { code, stdout, stderr } = await spawnCapture(
          gpp,
          ['-g', '-O0', '-std=c++17', '-o', binaryPath, sourcePath],
          COMPILE_TIMEOUT_MS,
        )
        const output = `${stdout}\n${stderr}`.trim()
        return {
          ok: code === 0,
          output,
          exitCode: code,
          binaryPath: code === 0 ? binaryPath : undefined,
          sourcePath,
        }
      }

      // MSVC cl：需 vcvars64.bat 注入 INCLUDE/LIB/PATH 后运行（子 shell 隔离）
      const cl = tc.cl.path
      if (!cl) {
        return { ok: false, output: 'MSVC cl.exe 路径缺失', exitCode: null, sourcePath }
      }
      const vcvars = locateVcvars(cl)
      if (!vcvars) {
        return { ok: false, output: '无法定位 vcvars64.bat', exitCode: null, sourcePath }
      }
      const command = `call "${vcvars}" >nul 2>&1 && cl /nologo /EHsc /Zi /Od /std:c++17 /utf-8 /Fe:"${binaryPath}" "${sourcePath}"`
      const { code, stdout, stderr } = await spawnCapture('cmd.exe', ['/d', '/s', '/c', command], COMPILE_TIMEOUT_MS)
      const output = `${stdout}\n${stderr}`.trim()
      return {
        ok: code === 0,
        output,
        exitCode: code,
        binaryPath: code === 0 ? binaryPath : undefined,
        sourcePath,
      }
    } catch (err) {
      return {
        ok: false,
        output: `编译失败：${err instanceof Error ? err.message : String(err)}`,
        exitCode: null,
        sourcePath,
      }
    }
  }

  /** 运行已编译二进制（默认 10s 超时）。 */
  async run(binaryPath: string, timeoutMs = RUN_TIMEOUT_MS): Promise<RunResult> {
    try {
      const { code, stdout, stderr, timedOut } = await spawnCapture(binaryPath, [], timeoutMs)
      return {
        ok: code === 0 && !timedOut,
        output: `${stdout}\n${stderr}`.trim() || '（无输出）',
        exitCode: code,
        timedOut,
      }
    } catch (err) {
      return {
        ok: false,
        output: `运行失败：${err instanceof Error ? err.message : String(err)}`,
        exitCode: null,
        timedOut: false,
      }
    }
  }

  /** 启动调试会话：按 selection 选择 gdb/cdb 后端（互斥）。 */
  async startDebug(args: {
    binaryPath: string
    sourcePath: string
    breakpoints: number[]
    events: DebuggerEvents
  }): Promise<{ ok: boolean; message?: string }> {
    if (this.activeDebug) return { ok: false, message: '已有调试会话，请先结束' }

    const tc = await detectToolchain()
    const sel = tc.selection
    let session: DebuggerSession

    if (sel.compiler === 'cl' && sel.debugger === 'cdb') {
      session = new CdbSession({
        cdbPath: tc.cdb.path ?? 'cdb',
        binaryPath: args.binaryPath,
        onEvent: args.events.onEvent,
      })
    } else if (sel.compiler === 'gpp' && sel.debugger === 'gdb') {
      session = new GdbMiSession({
        gdbPath: tc.gdb.path ?? 'gdb',
        binaryPath: args.binaryPath,
        onEvent: args.events.onEvent,
      })
    } else {
      return { ok: false, message: sel.reason ?? '调试器不可用' }
    }

    this.activeDebug = session
    const start = await session.start({ sourcePath: args.sourcePath, breakpoints: args.breakpoints })
    if (!start.ok) {
      this.activeDebug = null
      await session.dispose()
      return { ok: false, message: start.message ?? '调试启动失败' }
    }
    return { ok: true }
  }

  /** 发送语义化调试动作（由后端翻译）。 */
  async sendDebugAction(action: CppDebugAction): Promise<{ ok: boolean; message?: string }> {
    const session = this.activeDebug
    if (!session) return { ok: false, message: '没有进行中的调试会话' }
    return session.execute(action)
  }

  /** 结束调试：优雅退出 + 兜底 kill。 */
  async stopDebug(): Promise<void> {
    const session = this.activeDebug
    this.activeDebug = null
    if (session) await session.dispose()
  }

  getDebugActive(): boolean {
    return this.activeDebug !== null && !this.activeDebug.isClosed()
  }

  /** 一键部署 MinGW（委托 Provisioner 单例）。 */
  async provision(args: { events: ProvisionEvents }): Promise<CppProvisionResult> {
    return provisioner.provision(defaultProvisionOptions(args.events.onEvent))
  }

  /** 取消一键部署。 */
  async cancelProvision(): Promise<{ ok: boolean }> {
    provisioner.cancel()
    return { ok: true }
  }

  /** before-quit：清理调试子进程 + 临时文件。 */
  dispose(): void {
    const session = this.activeDebug
    this.activeDebug = null
    if (session) void session.dispose()
    try {
      rmSync(CPP_TMP_DIR, { recursive: true, force: true })
    } catch {
      /* 忽略 */
    }
  }
}
