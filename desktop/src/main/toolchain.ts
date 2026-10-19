import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, win32 } from 'node:path'
import { store } from './store'
import type { ToolchainItem, ToolchainSelection, ToolchainStatus } from '../shared/ipc-contract'

/** 工具链检测超时（vswhere / --version 等短命令）。 */
const TOOLCHAIN_TIMEOUT_MS = 3_000

/* ------------------------------------------------------------------ *
 * 子进程工具（本模块自包含，避免反向依赖 cpp-runner）
 * ------------------------------------------------------------------ */

interface CaptureResult {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

/** spawn + Promise 化 + 超时 kill。 */
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

/** 以绝对路径（或 PATH 命中名）运行 `--version`，提取首行作为版本。 */
async function versionOfAt(cmd: string, displayName: string): Promise<ToolchainItem> {
  try {
    const { code, stdout } = await spawnCapture(cmd, ['--version'], TOOLCHAIN_TIMEOUT_MS)
    const firstLine = String(stdout)
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean)
    if (code === 0 || firstLine) return { ok: true, version: firstLine || displayName }
    return { ok: false, error: `${displayName} 返回非零退出码 ${code}` }
  } catch (err) {
    return { ok: false, error: `${displayName} 不可用（${err instanceof Error ? err.message : '未知错误'}）` }
  }
}

/* ------------------------------------------------------------------ *
 * 定位函数
 * ------------------------------------------------------------------ */

/** vswhere.exe 标准安装位置（VS Installer）。 */
export function vswherePath(): string {
  const base = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
  return join(base, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe')
}

/** 用 vswhere 定位 cl.exe；无 VS 时返回 null。 */
export async function locateClExe(): Promise<string | null> {
  const vswhere = vswherePath()
  if (!existsSync(vswhere)) return null
  try {
    const { stdout } = await spawnCapture(
      vswhere,
      [
        '-latest',
        '-products',
        '*',
        '-requires',
        'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
        '-find',
        'VC\\Tools\\MSVC\\**\\bin\\Hostx64\\x64\\cl.exe',
      ],
      TOOLCHAIN_TIMEOUT_MS,
    )
    const lines = String(stdout)
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
    const cl = lines.find((l) => /[\\/]cl\.exe$/i.test(l) && existsSync(l))
    return cl ?? null
  } catch {
    return null
  }
}

/** 由 cl.exe 绝对路径反推 vcvars64.bat（VC\Auxiliary\Build\vcvars64.bat）。 */
export function locateVcvars(clPath: string): string {
  const norm = clPath.replace(/\//g, '\\')
  const marker = '\\VC\\'
  const idx = norm.indexOf(marker)
  if (idx < 0) return ''
  const vcRoot = norm.slice(0, idx + marker.length)
  return win32.join(vcRoot, 'Auxiliary', 'Build', 'vcvars64.bat')
}

/** 由 cl.exe 目录名解析 MSVC 版本号（14.xx → 19.xx）。 */
export function msvcVersionOf(clPath: string): string {
  const m = clPath.match(/MSVC[\\/](\d+)\.(\d+)/)
  if (!m) return 'MSVC'
  return `19.${m[2]}`
}

/** Windows SDK cdb.exe 固定路径。 */
export function sdkCdbPath(): string {
  const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
  return join(pf86, 'Windows Kits', '10', 'Debuggers', 'x64', 'cdb.exe')
}

/* ------------------------------------------------------------------ *
 * 检测项
 * ------------------------------------------------------------------ */

/** 检测单个 MinGW 可执行（先注册目录后 PATH），返回带 path/source 的 ToolchainItem。 */
export async function detectMingwBin(kind: 'g++' | 'gdb'): Promise<ToolchainItem> {
  const bin = kind === 'g++' ? 'g++' : 'gdb'
  const exe = kind === 'g++' ? 'g++.exe' : 'gdb.exe'

  const registeredDir = store.get('toolchainDir')
  if (registeredDir) {
    const registeredBin = join(registeredDir, 'bin', exe)
    if (existsSync(registeredBin)) {
      const item = await versionOfAt(registeredBin, bin)
      if (item.ok) return { ...item, path: registeredBin, source: 'registered' }
    }
  }

  const item = await versionOfAt(bin, bin)
  if (item.ok) return { ...item, path: bin, source: 'path' }
  return { ok: false, error: item.error ?? `${bin} 不可用` }
}

/** 检测 MSVC cl.exe（文件存在即 ok，版本从目录名解析，不 spawn 运行）。 */
export async function detectCl(): Promise<ToolchainItem> {
  const clPath = await locateClExe()
  if (!clPath || !existsSync(clPath)) {
    return { ok: false, error: '未找到 MSVC cl.exe（需安装 Visual Studio 生成工具）' }
  }
  return { ok: true, version: msvcVersionOf(clPath), path: clPath, source: 'vswhere' }
}

/** 检测 Windows SDK cdb.exe（固定路径 + `cdb -version`）。 */
export async function detectCdb(): Promise<ToolchainItem> {
  const cdb = sdkCdbPath()
  if (!existsSync(cdb)) {
    return { ok: false, error: '未找到 Windows SDK 调试器 cdb.exe' }
  }
  try {
    const { stdout } = await spawnCapture(cdb, ['-version'], TOOLCHAIN_TIMEOUT_MS)
    const firstLine = String(stdout)
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean)
    return { ok: true, version: firstLine || 'Windows SDK cdb', path: cdb, source: 'sdk' }
  } catch {
    return { ok: true, version: 'Windows SDK cdb', path: cdb, source: 'sdk' }
  }
}

/* ------------------------------------------------------------------ *
 * 配对选择（VS/MSVC 优先，MinGW 兜底）
 * ------------------------------------------------------------------ */

/**
 * 编译器 ↔ 调试器配对选择。
 *
 * 优先级：MSVC cl + cdb 完整 → 首选；MinGW g++ + gdb 完整 → 次选；
 * 其余按「编译可用但缺调试器 / 只有调试器 / 全缺失」逐级降级。
 */
export function selectPairing(s: {
  gpp: ToolchainItem
  gdb: ToolchainItem
  cl: ToolchainItem
  cdb: ToolchainItem
}): ToolchainSelection {
  const msvcFull = s.cl.ok && s.cdb.ok
  const mingwFull = s.gpp.ok && s.gdb.ok
  if (msvcFull) return { compiler: 'cl', debugger: 'cdb', ready: true, canDebug: true }
  if (mingwFull) return { compiler: 'gpp', debugger: 'gdb', ready: true, canDebug: true }

  // —— 以下为残缺场景，逐级降级 ——
  if (s.cl.ok && !s.cdb.ok)
    return {
      compiler: 'cl',
      debugger: null,
      ready: true,
      canDebug: false,
      reason: '缺失 Windows SDK 调试器 cdb，无法调试；可一键部署 MinGW 补齐 gdb',
    }
  if (s.gpp.ok && !s.gdb.ok)
    return {
      compiler: 'gpp',
      debugger: null,
      ready: true,
      canDebug: false,
      reason: '缺失 gdb，无法调试；可一键部署 MinGW 补齐',
    }
  if (!s.gpp.ok && !s.cl.ok && (s.gdb.ok || s.cdb.ok))
    return { compiler: null, debugger: null, ready: false, canDebug: false, reason: '缺少编译器（只有调试器），可一键部署 MinGW' }
  return { compiler: null, debugger: null, ready: false, canDebug: false, reason: '未检测到 C++ 工具链，可一键部署 MinGW' }
}

/* ------------------------------------------------------------------ *
 * 汇总检测
 * ------------------------------------------------------------------ */

/** 检测 4 项工具链并做配对选择。 */
export async function detectToolchain(): Promise<ToolchainStatus> {
  const [gpp, gdb, cl, cdb] = await Promise.all([
    detectMingwBin('g++'),
    detectMingwBin('gdb'),
    detectCl(),
    detectCdb(),
  ])
  const selection = selectPairing({ gpp, gdb, cl, cdb })
  return { gpp, gdb, cl, cdb, selection }
}
