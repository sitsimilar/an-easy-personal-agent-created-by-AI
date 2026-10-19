import { spawn, type ChildProcess } from 'node:child_process'
import type { CppDebugEvent } from '../../shared/ipc-contract'
import { isCdbPrompt, parseCdbBreakpointHit, parseCdbExited, parseCdbFrames, parseCdbLocals } from './cdb-parse'
import type { CppDebugAction, DebuggerSession, DebuggerStartInput } from './types'

/**
 * cdb 命令行调试后端（非 MI）。
 *
 * 交互式命令循环：stdin 写命令、stdout 逐行读；以「提示符（如 0:000>）」
 * 作为命令完成边界。程序 stdout 与 cdb 消息同流混杂，MVP 统一推
 * `{ type: 'output', stream: 'cdb', text }`（已知降级，见设计 R5/Q-T5）。
 */
export class CdbSession implements DebuggerSession {
  readonly backend = 'cdb' as const

  private child: ChildProcess
  private buffer = ''
  private closed = false
  private ready = false
  private running = false
  private stopReported = false

  private queue: { cmd: string; resolve?: (text: string) => void; launches?: boolean }[] = []
  private current: { resolve: (text: string) => void } | null = null
  private response: string[] = []
  private firstPromptResolve: (() => void) | null = null

  private onEvent: (evt: CppDebugEvent) => void

  constructor(args: { cdbPath: string; binaryPath: string; onEvent: (evt: CppDebugEvent) => void }) {
    this.onEvent = args.onEvent
    this.child = spawn(args.cdbPath, [args.binaryPath], { windowsHide: true })
    this.child.stdout?.on('data', (d: Buffer) => this.handleData(String(d)))
    this.child.stderr?.on('data', (d: Buffer) => {
      this.onEvent({ type: 'output', stream: 'stderr', text: String(d) })
    })
    this.child.on('error', (err) => {
      this.onEvent({ type: 'output', stream: 'stderr', text: `cdb 启动失败：${err.message}` })
    })
    this.child.on('close', () => {
      this.closed = true
      this.ready = false
      this.running = false
      if (this.current) {
        this.current.resolve('')
        this.current = null
      }
    })
  }

  async start(input: DebuggerStartInput): Promise<{ ok: boolean; message?: string }> {
    const ready = await this.waitForFirstPrompt(10_000)
    if (!ready) return { ok: false, message: 'cdb 启动超时' }

    // 设断点：cdb 源文件断点用反引号包裹绝对路径 + 行号
    for (const line of input.breakpoints) {
      await this.sendSync(`bp \`${input.sourcePath}:${line}\``)
    }

    this.launch('g')
    return { ok: true }
  }

  async execute(action: CppDebugAction): Promise<{ ok: boolean; message?: string }> {
    if (this.closed) return { ok: false, message: '调试会话已结束' }
    switch (action) {
      case 'continue':
        this.launch('g')
        break
      case 'step-over':
        this.launch('p')
        break
      case 'step-into':
        this.launch('t')
        break
      case 'interrupt':
        // cdb MVP 不支持运行中中断（见设计 R6/Q-T4），UI 已禁用
        break
    }
    return { ok: true }
  }

  async interrupt(): Promise<void> {
    /* cdb MVP 空实现 */
  }

  async dispose(): Promise<void> {
    if (this.closed) return
    try {
      this.child.stdin?.write('q\n')
    } catch {
      /* 忽略 */
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.kill()
        resolve()
      }, 2000)
      this.child.once('close', () => {
        clearTimeout(timer)
        resolve()
      })
    })
    this.kill()
  }

  isClosed(): boolean {
    return this.closed
  }

  /** 启动执行类命令（g/p/t）：触发 running 事件，等待下一次停止。 */
  private launch(cmd: string): void {
    this.stopReported = false
    this.queue.push({ cmd, launches: true })
    this.drain()
  }

  /** 同步命令（bp/k/dv）：等待下一个提示符，resolve 响应文本。 */
  private sendSync(cmd: string): Promise<string> {
    return new Promise<string>((resolve) => {
      this.queue.push({ cmd, resolve })
      this.drain()
    })
  }

  private writeLine(cmd: string): void {
    try {
      this.child.stdin?.write(cmd + '\n')
    } catch {
      /* 忽略 */
    }
  }

  private drain(): void {
    if (!this.ready || this.running || this.closed || this.current) return
    const next = this.queue.shift()
    if (!next) return
    if (next.resolve) {
      this.current = { resolve: next.resolve }
      this.response = []
    }
    this.writeLine(next.cmd)
    if (next.launches) {
      this.running = true
      this.onEvent({ type: 'running' })
    }
  }

  private waitForFirstPrompt(timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.ready) {
        resolve(true)
        return
      }
      const timer = setTimeout(() => {
        this.firstPromptResolve = null
        resolve(false)
      }, timeoutMs)
      this.firstPromptResolve = () => {
        clearTimeout(timer)
        resolve(true)
      }
    })
  }

  private handleData(chunk: string): void {
    this.buffer += chunk
    let idx: number
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).replace(/\r$/, '')
      this.buffer = this.buffer.slice(idx + 1)
      if (line) this.handleLine(line)
    }
  }

  private handleLine(line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return

    if (isCdbPrompt(trimmed)) {
      this.onPrompt()
      return
    }

    // 正在收集同步命令（k/dv）响应时，不当作程序输出
    if (this.current) {
      this.response.push(line)
    } else {
      this.onEvent({ type: 'output', stream: 'cdb', text: line })
    }

    const bp = parseCdbBreakpointHit(trimmed)
    if (bp && bp.hit && !this.stopReported) {
      this.stopReported = true
      this.onEvent({ type: 'stopped', reason: 'breakpoint-hit', message: `Breakpoint ${bp.bpNo ?? 0} hit` })
    }

    const ex = parseCdbExited(trimmed)
    if (ex.exited && !this.closed) {
      this.closed = true
      this.stopReported = true
      this.onEvent({ type: 'ended', exitCode: ex.exitCode })
    }
  }

  private onPrompt(): void {
    this.ready = true
    if (this.firstPromptResolve) {
      const r = this.firstPromptResolve
      this.firstPromptResolve = null
      r()
    }

    // 同步命令完成，交付响应文本
    if (this.current) {
      const text = this.response.join('\n')
      const c = this.current
      this.current = null
      this.response = []
      c.resolve(text)
    }

    // 运行中的会话回到提示符 → 停止（断点/单步结束/退出）
    if (this.running) {
      this.running = false
      if (!this.stopReported) {
        this.onEvent({ type: 'stopped', reason: 'end-stepping-range' })
      }
      this.stopReported = false
      if (!this.closed) void this.queryFramesAndVars()
    }

    this.drain()
  }

  private async queryFramesAndVars(): Promise<void> {
    const fr = await this.sendSync('k')
    const frames = parseCdbFrames(fr)
    if (frames.length > 0) this.onEvent({ type: 'frames', frames })
    const vr = await this.sendSync('dv')
    const vars = parseCdbLocals(vr)
    if (vars.length > 0) this.onEvent({ type: 'variables', variables: vars })
  }

  private kill(): void {
    try {
      this.child.kill('SIGKILL')
    } catch {
      /* 忽略 */
    }
  }
}
