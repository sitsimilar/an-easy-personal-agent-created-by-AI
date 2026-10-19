import { spawn, type ChildProcess } from 'node:child_process'
import type { CppDebugEvent, DebugFrame, DebugVariable } from '../../shared/ipc-contract'
import type { CppDebugAction, DebuggerSession, DebuggerStartInput } from './types'

/* ------------------------------------------------------------------ *
 * MI 文本解析（纯函数，供单元测试）
 * ------------------------------------------------------------------ */

/** MI 引号字符串反转义（处理 \\ \" \n \t \r）。 */
export function miUnquote(raw: string): string {
  if (raw.length >= 2 && raw[0] === '"' && raw[raw.length - 1] === '"') {
    const inner = raw.slice(1, -1)
    let out = ''
    for (let i = 0; i < inner.length; i++) {
      const c = inner[i]
      if (c === '\\' && i + 1 < inner.length) {
        const n = inner[i + 1]
        if (n === 'n') {
          out += '\n'
          i++
        } else if (n === 't') {
          out += '\t'
          i++
        } else if (n === 'r') {
          out += '\r'
          i++
        } else {
          out += n
          i++
        }
      } else {
        out += c
      }
    }
    return out
  }
  return raw
}

/** 提取 `key="..."` 的引号字段值（已反转义）。 */
export function extractQuoted(s: string, key: string): string | undefined {
  const m = s.match(new RegExp('(?:^|[,{\\s])' + key + '=("(?:\\\\.|[^"\\\\])*")'))
  return m ? miUnquote(m[1]) : undefined
}

/** 提取 `key={...}` 或 `key=[...]` 的平衡值（含外层括号）。 */
export function extractBalanced(s: string, key: string): string | undefined {
  const idx = s.indexOf(key + '=')
  if (idx < 0) return undefined
  const start = idx + key.length + 1
  const open = s[start]
  if (open !== '{' && open !== '[') return undefined
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let i = start
  while (i < s.length) {
    const c = s[i]
    if (c === '"') {
      i++
      while (i < s.length) {
        if (s[i] === '\\') {
          i += 2
          continue
        }
        if (s[i] === '"') {
          i++
          break
        }
        i++
      }
      continue
    }
    if (c === open) depth++
    else if (c === close) {
      depth--
      if (depth === 0) {
        i++
        break
      }
    }
    i++
  }
  return s.slice(start, i)
}

/** 按顶层逗号切分（忽略引号与嵌套 {}[] 内的逗号）。 */
export function splitTopLevel(s: string): string[] {
  const parts: string[] = []
  let depth = 0
  let cur = ''
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (c === '"') {
      cur += c
      i++
      while (i < s.length) {
        cur += s[i]
        if (s[i] === '\\') {
          cur += s[i + 1] ?? ''
          i += 2
          continue
        }
        if (s[i] === '"') {
          i++
          break
        }
        i++
      }
      continue
    }
    if (c === '{' || c === '[') depth++
    else if (c === '}' || c === ']') depth--
    if (c === ',' && depth === 0) {
      parts.push(cur.trim())
      cur = ''
      i++
      continue
    }
    cur += c
    i++
  }
  if (cur.trim()) parts.push(cur.trim())
  return parts
}

/** 解析单个 frame 记录（`{level=...,func=...,file=...,fullname=...,line=...}`）。 */
export function parseFrame(rec: string): DebugFrame | null {
  const func = extractQuoted(rec, 'func')
  if (func === undefined) return null
  const levelStr = extractQuoted(rec, 'level') ?? '0'
  const lineStr = extractQuoted(rec, 'line')
  return {
    level: Number(levelStr) || 0,
    func,
    file: extractQuoted(rec, 'file'),
    fullname: extractQuoted(rec, 'fullname'),
    line: lineStr !== undefined && lineStr !== '' ? Number(lineStr) : undefined,
  }
}

/** 解析 `*stopped` 记录 → reason + 当前帧。 */
export function parseStopped(rec: string): { reason: string; frame?: DebugFrame } {
  const reason = extractQuoted(rec, 'reason') ?? ''
  const frameRaw = extractBalanced(rec, 'frame')
  return { reason, frame: frameRaw ? (parseFrame(frameRaw) ?? undefined) : undefined }
}

/** 解析 `^done,stack=[frame={...},...]` → 调用栈。 */
export function parseFrames(data: string): DebugFrame[] {
  const stackRaw = extractBalanced(data, 'stack')
  if (!stackRaw) return []
  const inner = stackRaw.slice(1, -1)
  const frames: DebugFrame[] = []
  for (const item of splitTopLevel(inner)) {
    const eq = item.indexOf('frame=')
    const rec = eq >= 0 ? item.slice(eq + 'frame='.length) : item
    if (!rec.startsWith('{')) continue
    const frame = parseFrame(rec)
    if (frame) frames.push(frame)
  }
  return frames
}

/** 解析 `^done,variables=[{name=...,value=...,type=...},...]` → 局部变量。 */
export function parseVariables(data: string): DebugVariable[] {
  const varsRaw = extractBalanced(data, 'variables')
  if (!varsRaw) return []
  const inner = varsRaw.slice(1, -1)
  const vars: DebugVariable[] = []
  for (const item of splitTopLevel(inner)) {
    if (!item.startsWith('{')) continue
    const name = extractQuoted(item, 'name') ?? ''
    const value = extractQuoted(item, 'value') ?? ''
    if (!name) continue
    vars.push({ name, value, type: extractQuoted(item, 'type') })
  }
  return vars
}

/* ------------------------------------------------------------------ *
 * GDB/MI 会话
 * ------------------------------------------------------------------ */

interface MiResult {
  ok: boolean
  message?: string
  data?: string
}

/** 语义化动作 → GDB/MI 原始命令映射。 */
const ACTION_TO_MI: Record<CppDebugAction, string> = {
  continue: '-exec-continue',
  'step-over': '-exec-next',
  'step-into': '-exec-step',
  interrupt: '-exec-interrupt',
}

export class GdbMiSession implements DebuggerSession {
  readonly backend = 'gdb' as const

  private child: ChildProcess
  private pending = new Map<number, { resolve: (r: MiResult) => void }>()
  private queue: string[] = []
  private token = 0
  private idle = true
  private buffer = ''
  private closed = false
  private onEvent: (evt: CppDebugEvent) => void

  constructor(args: { gdbPath: string; binaryPath: string; onEvent: (evt: CppDebugEvent) => void }) {
    this.onEvent = args.onEvent
    this.child = spawn(args.gdbPath, ['--interpreter=mi', '--nx', '--quiet', args.binaryPath], { windowsHide: true })
    this.child.stdout?.on('data', (d: Buffer) => this.handleData(String(d)))
    this.child.stderr?.on('data', (d: Buffer) => {
      this.onEvent({ type: 'output', stream: 'stderr', text: String(d) })
    })
    this.child.on('error', (err) => {
      this.onEvent({ type: 'output', stream: 'stderr', text: `gdb 启动失败：${err.message}` })
    })
    this.child.on('close', () => {
      this.closed = true
      this.idle = true
      for (const [t, p] of this.pending) {
        p.resolve({ ok: false, message: '调试器已退出' })
        this.pending.delete(t)
      }
    })
  }

  /** 初始化 + 设断点 + 启动运行。 */
  async start(input: DebuggerStartInput): Promise<{ ok: boolean; message?: string }> {
    const init = await this.send('-gdb-set mi-async on')
    if (!init.ok) return { ok: false, message: init.message ?? 'gdb 初始化失败' }
    await this.send('-gdb-set pagination off')

    // Windows 绝对路径转正斜杠并加引号，避免反斜杠被 MI 解析为转义字符
    const gdbSourcePath = input.sourcePath.replace(/\\/g, '/')
    for (const line of input.breakpoints) {
      const bp = await this.send(`-break-insert "${gdbSourcePath}:${line}"`)
      if (!bp.ok) {
        this.onEvent({
          type: 'output',
          stream: 'gdb',
          text: `断点设置失败（行 ${line}）：${bp.message ?? '未知错误'}`,
        })
      }
    }

    // 启动运行：不 await 停止，执行状态只由 *running/*stopped 异步事件驱动
    void this.send('-exec-run').then((r) => {
      if (!r.ok) {
        this.onEvent({ type: 'output', stream: 'gdb', text: `运行启动失败：${r.message ?? ''}` })
      }
    })
    return { ok: true }
  }

  async execute(action: CppDebugAction): Promise<{ ok: boolean; message?: string }> {
    const r = await this.send(ACTION_TO_MI[action])
    return { ok: r.ok, message: r.message }
  }

  async interrupt(): Promise<void> {
    await this.send('-exec-interrupt')
  }

  async dispose(): Promise<void> {
    await this.shutdown()
  }

  isClosed(): boolean {
    return this.closed
  }

  /** 排队发送 MI 命令，返回 ^done/^error/^running 解析结果。 */
  private send(cmd: string): Promise<MiResult> {
    if (this.closed) return Promise.resolve({ ok: false, message: '调试会话已结束' })
    const t = ++this.token
    this.queue.push(`${t}${cmd}`)
    return new Promise<MiResult>((resolve) => {
      this.pending.set(t, { resolve })
      this.drain()
    })
  }

  /** 直接写 stdin（不经队列，用于 -gdb-exit 等终结命令）。 */
  private writeRaw(cmd: string): void {
    if (this.closed) return
    try {
      this.child.stdin?.write(cmd + '\n')
    } catch {
      /* 忽略 */
    }
  }

  private kill(): void {
    try {
      this.child.kill('SIGKILL')
    } catch {
      /* 忽略 */
    }
  }

  /** 优雅退出：-gdb-exit → 2s 兜底 kill。 */
  private async shutdown(): Promise<void> {
    if (this.closed) return
    this.writeRaw('-gdb-exit')
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.kill()
        resolve()
      }, 2000)
      this.child.once('close', () => {
        clearTimeout(timer)
        resolve()
      })
      if (this.closed) {
        clearTimeout(timer)
        resolve()
      }
    })
    this.kill()
  }

  private drain(): void {
    if (!this.idle || this.queue.length === 0 || this.closed) return
    this.idle = false
    const line = this.queue.shift()!
    try {
      this.child.stdin?.write(line + '\n')
    } catch {
      /* 忽略 */
    }
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
    if (line.trim().startsWith('(gdb)')) {
      this.idle = true
      this.drain()
      return
    }
    if (line.startsWith('^')) {
      this.handleSync(line)
      return
    }
    if (line.startsWith('*')) {
      this.handleAsync(line.slice(1))
      return
    }
    if (line.startsWith('~')) {
      this.onEvent({ type: 'output', stream: 'gdb', text: miUnquote(line.slice(1)) })
      return
    }
    if (line.startsWith('@')) {
      this.onEvent({ type: 'output', stream: 'stdout', text: miUnquote(line.slice(1)) })
      return
    }
    if (line.startsWith('&')) {
      this.onEvent({ type: 'output', stream: 'stderr', text: miUnquote(line.slice(1)) })
      return
    }
    // `=...` 异步通知忽略
  }

  private handleSync(line: string): void {
    const m = line.match(/^(\d*)\^([a-zA-Z-]+)(?:,(.*))?$/)
    if (!m) return
    const token = m[1] ? Number(m[1]) : null
    const result = m[2]
    const rest = m[3] ?? ''

    if (token !== null) {
      const p = this.pending.get(token)
      if (p) {
        this.pending.delete(token)
        if (result === 'error') {
          p.resolve({ ok: false, message: extractQuoted(rest, 'msg') ?? rest })
        } else {
          p.resolve({ ok: true, data: rest })
        }
      }
    }
    if (result === 'exit') {
      this.closed = true
    }
  }

  private handleAsync(rec: string): void {
    if (rec.startsWith('running')) {
      this.onEvent({ type: 'running' })
      return
    }
    if (rec.startsWith('stopped')) {
      const stopped = parseStopped(rec)
      this.onEvent({ type: 'stopped', reason: stopped.reason, frame: stopped.frame })
      if (stopped.frame) {
        void this.queryFramesAndVars()
      }
      return
    }
  }

  private async queryFramesAndVars(): Promise<void> {
    const fr = await this.send('-stack-list-frames')
    if (fr.ok) this.onEvent({ type: 'frames', frames: parseFrames(fr.data ?? '') })
    const vr = await this.send('-stack-list-variables --simple-values')
    if (vr.ok) this.onEvent({ type: 'variables', variables: parseVariables(vr.data ?? '') })
  }
}
