import type { DebugFrame, DebugVariable } from '../../shared/ipc-contract'

/**
 * cdb 命令行输出解析（非 MI，纯函数，供单元测试）。
 *
 * cdb 无结构化 token，按「提示符分隔」+ 关键字匹配做 best-effort 解析，
 * 解析不出 file/line 时降级为 { level, func }。
 */

/** 判定是否为 cdb 提示符行（如 0:000>、1:015>）。 */
export function isCdbPrompt(line: string): boolean {
  const t = line.trim()
  // 进程号:线程号（十六进制，至少 2 位）后跟 >
  return /^\d+:[0-9a-fA-F]{2,}>$/.test(t)
}

/** 判定断点命中（含 "Breakpoint N hit"）。未命中返回 null。 */
export function parseCdbBreakpointHit(text: string): { hit: boolean; bpNo?: number } | null {
  const m = text.match(/Breakpoint\s+(\d+)\s+hit/i)
  if (!m) return null
  return { hit: true, bpNo: Number(m[1]) }
}

/** 解析 `k` 输出 → DebugFrame[]（best-effort）。 */
export function parseCdbFrames(text: string): DebugFrame[] {
  const frames: DebugFrame[] = []
  for (const raw of text.split(/\r?\n/)) {
    const t = raw.trim()
    // 帧行以「NN 地址 地址」开头，忽略表头（如 " # Child-SP ..."）
    const head = t.match(/^(\d{1,3})\s+[0-9a-fA-F`]+\s+[0-9a-fA-F`]+/)
    if (!head) continue
    const level = Number(head[1])
    const rest = t.slice(head[0].length)

    // 优先取 module!func 的 func；无符号时降级为模块名
    const bang = rest.match(/!([0-9a-zA-Z_@.~<>?][0-9a-zA-Z_@.~<>?]*)/)
    const bare = rest.match(/([0-9a-zA-Z_@.~<>?][0-9a-zA-Z_@.~<>?]*)(?:\+0x[0-9a-fA-F]+)?/)
    const func = bang ? bang[1] : bare ? bare[1] : 'unknown'

    // 可选 [file @ line]
    const loc = t.match(/\[([^\]]+?)\s*@\s*(\d+)\]/)
    frames.push({
      level,
      func,
      file: loc ? loc[1].trim() : undefined,
      line: loc ? Number(loc[2]) : undefined,
    })
  }
  return frames
}

/** 解析 `dv` 输出 → DebugVariable[]（匹配 `name = value`）。 */
export function parseCdbLocals(text: string): DebugVariable[] {
  const vars: DebugVariable[] = []
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(/^\s*([A-Za-z_][A-Za-z0-9_<>:]*)\s*=\s*(.+?)\s*$/)
    if (!m) continue
    vars.push({ name: m[1], value: m[2] })
  }
  return vars
}

/** 判定进程已退出（含 "process has exited" / "exit code"）。 */
export function parseCdbExited(text: string): { exited: boolean; exitCode?: number } {
  const exited = /process has exited/i.test(text) || /exit code/i.test(text)
  if (!exited) return { exited: false }
  const m = text.match(/exit code\s*(0x[0-9a-fA-F]+|\d+)/i)
  if (!m) return { exited: true }
  const v = m[1]
  const isHex = /^0x/i.test(v)
  return { exited: true, exitCode: isHex ? parseInt(v, 16) : parseInt(v, 10) }
}
