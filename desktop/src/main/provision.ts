import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
} from 'node:fs'
import { join } from 'node:path'
import { app, net } from 'electron'
import { store } from './store'
import type { CppProvisionEvent, CppProvisionResult } from '../shared/ipc-contract'

/**
 * 一键部署 MinGW-w64（便携版）。
 *
 * 下载源与校验和实现期固化；MINGW_SHA256 未固化前部署灰度关闭（见设计 R2/Q-T1），
 * 此时 provision 直接返回 failed('校验和未配置')。
 */

/** 下载源 URL（占位；MINGW_SHA256 固化前不会被请求）。 */
export const MINGW_URL =
  'https://github.com/brechtsanders/winlibs_mingw/releases/download/13.2.0-16.0.6-11.0.1-ucrt-r5/winlibs-x86_64-posix-seh-gcc-13.2.0-mingw-w64ucrt-11.0.1-r5.zip'

/** 校验和（未固化 → 空字符串 → 部署灰度关闭）。 */
export const MINGW_SHA256 = ''

/** 默认部署根目录：%APPDATA%\personal-agent\toolchains。 */
export function defaultToolchainRoot(): string {
  return join(app.getPath('appData'), 'personal-agent', 'toolchains')
}

/* ------------------------------------------------------------------ *
 * sha256 校验工具（供单元测试）
 * ------------------------------------------------------------------ */

/** 计算 Buffer/字符串的 sha256 十六进制摘要。 */
export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex')
}

/** 计算文件的 sha256 十六进制摘要（流式）。 */
export function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('data', (chunk: string | Buffer) => {
      hash.update(chunk)
    })
    stream.on('error', (err) => reject(err))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

/** 恒定时间比较两个十六进制摘要（长度不同直接 false）。 */
export function constantTimeEqual(a: string, b: string): boolean {
  const x = a.toLowerCase()
  const y = b.toLowerCase()
  if (x.length !== y.length) return false
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i)
  return diff === 0
}

/* ------------------------------------------------------------------ *
 * 工具链目录定位（递归，允许 archive 根目录 + mingw64 两级包裹）
 * ------------------------------------------------------------------ */

/**
 * 递归定位包含 `bin/g++.exe` 与 `bin/gdb.exe` 的目录；找不到返回 null。
 * WinLibs zip 解压后形如 `<archive-root>/mingw64/bin/...`，需递归穿透。
 */
export function locateToolchainRoot(dir: string, depth = 0): string | null {
  if (depth > 5 || !existsSync(dir)) return null
  if (existsSync(join(dir, 'bin', 'g++.exe')) && existsSync(join(dir, 'bin', 'gdb.exe'))) return dir
  let found: string | null = null
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (found || !e.isDirectory()) continue
      found = locateToolchainRoot(join(dir, e.name), depth + 1)
    }
  } catch {
    /* 忽略 */
  }
  return found
}

/* ------------------------------------------------------------------ *
 * 可注入依赖（供测试注入 fake 下载/解压/校验）
 * ------------------------------------------------------------------ */

export interface ProvisionDownloadResult {
  receivedBytes: number
  totalBytes: number | null
  sha256: string
}

export interface ProvisionDeps {
  download: (
    url: string,
    destZip: string,
    onProgress: (received: number, total: number | null) => void,
  ) => Promise<ProvisionDownloadResult>
  extract: (zipPath: string, destDir: string) => Promise<void>
  verify?: (toolchainDir: string) => Promise<boolean>
}

/** 默认下载：Electron net.request 流式写盘 + 边写边算 sha256 + 200ms 节流。 */
function defaultDownload(
  url: string,
  destZip: string,
  onProgress: (received: number, total: number | null) => void,
): Promise<ProvisionDownloadResult> {
  return new Promise((resolve, reject) => {
    const req = net.request(url)
    const hash = createHash('sha256')
    const ws = createWriteStream(destZip)
    let received = 0
    let total: number | null = null
    let lastEmit = 0
    let settled = false
    let paused = false
    // Electron net 的 IncomingMessage 类型未暴露 pause/resume，收窄为最小接口做背压
    let response: { pause: () => void; resume: () => void } | null = null

    const fail = (err: Error): void => {
      if (settled) return
      settled = true
      try {
        ws.destroy()
      } catch {
        /* 忽略 */
      }
      try {
        rmSync(destZip, { force: true })
      } catch {
        /* 忽略 */
      }
      reject(err)
    }

    req.on('response', (res) => {
      const rawLen = res.headers['content-length']
      const len = Array.isArray(rawLen) ? rawLen[0] : rawLen
      total = len ? Number(len) || null : null
      if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
        fail(new Error(`下载失败：HTTP ${res.statusCode}`))
        return
      }
      response = res as unknown as { pause: () => void; resume: () => void }
      res.on('data', (chunk: Buffer) => {
        received += chunk.length
        hash.update(chunk)
        if (!ws.write(chunk) && !paused) {
          paused = true
          response?.pause()
        }
        const now = Date.now()
        if (now - lastEmit >= 200) {
          lastEmit = now
          onProgress(received, total)
        }
      })
      res.on('end', () => {
        ws.end()
      })
      res.on('error', (err) => fail(err instanceof Error ? err : new Error(String(err))))
    })
    req.on('error', (err) => fail(err instanceof Error ? err : new Error(String(err))))
    ws.on('drain', () => {
      if (paused) {
        paused = false
        if (!ws.destroyed) {
          try {
            response?.resume()
          } catch {
            /* 忽略 */
          }
        }
      }
    })
    ws.on('error', (err) => fail(err instanceof Error ? err : new Error(String(err))))
    ws.on('finish', () => {
      if (settled) return
      settled = true
      onProgress(received, total)
      resolve({ receivedBytes: received, totalBytes: total, sha256: hash.digest('hex') })
    })
    req.end()
  })
}

/** 默认解压：extract-zip（CJS、流式、无原生依赖）。 */
async function defaultExtract(zipPath: string, destDir: string): Promise<void> {
  const extract = await import('extract-zip')
  await extract.default(zipPath, { dir: destDir })
}

/** 默认校验：绝对路径跑 g++/gdb --version，均退出码 0 视为通过。 */
function spawnVersion(binPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    let child: ChildProcess
    try {
      child = spawn(binPath, ['--version'], { windowsHide: true })
    } catch {
      resolve(false)
      return
    }
    let settled = false
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* 忽略 */
      }
      if (!settled) {
        settled = true
        resolve(false)
      }
    }, 3000)
    child.on('error', () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(false)
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(code === 0)
    })
  })
}

async function defaultVerify(toolchainDir: string): Promise<boolean> {
  const [gpp, gdb] = await Promise.all([
    spawnVersion(join(toolchainDir, 'bin', 'g++.exe')),
    spawnVersion(join(toolchainDir, 'bin', 'gdb.exe')),
  ])
  return gpp && gdb
}

/* ------------------------------------------------------------------ *
 * Provisioner
 * ------------------------------------------------------------------ */

export interface ProvisionOptions {
  onEvent: (evt: CppProvisionEvent) => void
  rootDir: string
  url: string
  sha256: string
  /** 覆盖最终 mingw64 目录（默认 rootDir/mingw64），测试用。 */
  mingwDir?: string
  /** 注入下载/解压/校验（测试用）。 */
  deps?: ProvisionDeps
}

export class Provisioner {
  private busy = false
  private cancelled = false

  async provision(opts: ProvisionOptions): Promise<CppProvisionResult> {
    if (this.busy) return { ok: false, message: '正在部署中' }
    this.busy = true
    this.cancelled = false

    const deps: ProvisionDeps = opts.deps ?? {
      download: defaultDownload,
      extract: defaultExtract,
      verify: defaultVerify,
    }
    const mingwDir = opts.mingwDir ?? join(opts.rootDir, 'mingw64')
    const tmpDir = join(opts.rootDir, '.provision-tmp')
    let stagingDir: string | null = null
    let placedMingw = false

    try {
      opts.onEvent({ type: 'phase', phase: 'checking' })

      // 幂等：目标目录已就绪则直接注册
      const existing = locateToolchainRoot(mingwDir)
      if (existing) {
        store.set('toolchainDir', mingwDir)
        opts.onEvent({ type: 'phase', phase: 'done', message: '已检测到可用的 MinGW 工具链，跳过下载' })
        return { ok: true, toolchainDir: mingwDir }
      }

      // 灰度：sha256/url 未固化则禁用（R2）
      if (!opts.sha256) {
        const message = '校验和未配置'
        opts.onEvent({ type: 'phase', phase: 'failed', message })
        return { ok: false, message }
      }
      if (!opts.url) {
        const message = '下载源未配置'
        opts.onEvent({ type: 'phase', phase: 'failed', message })
        return { ok: false, message }
      }

      mkdirSync(tmpDir, { recursive: true })
      const id = randomUUID()
      const zipPath = join(tmpDir, `${id}.zip`)
      const extractedDir = join(tmpDir, `${id}-extracted`)

      opts.onEvent({ type: 'phase', phase: 'downloading' })
      const dl = await deps.download(opts.url, zipPath, (received, total) => {
        if (this.cancelled) return
        const percent = total && total > 0 ? Math.round((received / total) * 100) : -1
        opts.onEvent({ type: 'progress', percent, receivedBytes: received, totalBytes: total })
      })
      if (this.cancelled) throw new Error('已取消部署')

      // sha256 校验（下载器未返回则本地计算）
      const actual = dl.sha256 || (await sha256File(zipPath))
      if (!constantTimeEqual(actual, opts.sha256)) {
        throw new Error('下载校验失败（sha256 不匹配）')
      }

      opts.onEvent({ type: 'phase', phase: 'extracting' })
      await deps.extract(zipPath, extractedDir)

      const toolchainRoot = locateToolchainRoot(extractedDir)
      if (!toolchainRoot) throw new Error('解压后未找到 g++/gdb')

      // 原子 rename：先迁到根目录下的 staging 名，再整体替换 mingw64
      stagingDir = join(opts.rootDir, `mingw64-${id}`)
      renameSync(toolchainRoot, stagingDir)
      if (existsSync(mingwDir)) {
        rmSync(mingwDir, { recursive: true, force: true })
      }
      renameSync(stagingDir, mingwDir)
      stagingDir = null
      placedMingw = true

      opts.onEvent({ type: 'phase', phase: 'verifying' })
      const verified = await (deps.verify ?? defaultVerify)(mingwDir)
      if (!verified) throw new Error('部署校验失败（g++/gdb --version 未通过）')

      store.set('toolchainDir', mingwDir)
      opts.onEvent({ type: 'phase', phase: 'done' })
      return { ok: true, toolchainDir: mingwDir }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.rollback(tmpDir, stagingDir, placedMingw, mingwDir)
      opts.onEvent({ type: 'phase', phase: 'failed', message })
      return { ok: false, message }
    } finally {
      // 成功路径清理 tmp（幂等路径没有 tmp，清理无害）
      try {
        rmSync(tmpDir, { recursive: true, force: true })
      } catch {
        /* 忽略 */
      }
      this.busy = false
      this.cancelled = false
    }
  }

  cancel(): void {
    this.cancelled = true
  }

  isBusy(): boolean {
    return this.busy
  }

  private rollback(tmpDir: string, stagingDir: string | null, placedMingw: boolean, mingwDir: string): void {
    try {
      rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      /* 忽略 */
    }
    if (stagingDir) {
      try {
        rmSync(stagingDir, { recursive: true, force: true })
      } catch {
        /* 忽略 */
      }
    }
    if (placedMingw) {
      try {
        rmSync(mingwDir, { recursive: true, force: true })
      } catch {
        /* 忽略 */
      }
    }
  }
}

/** 默认单例（cpp-runner 委托）。 */
export const provisioner = new Provisioner()

/** 构造默认部署选项（灰度：MINGW_SHA256 为空则 provision 直接 failed）。 */
export function defaultProvisionOptions(onEvent: (evt: CppProvisionEvent) => void): ProvisionOptions {
  return {
    onEvent,
    rootDir: defaultToolchainRoot(),
    url: MINGW_URL,
    sha256: MINGW_SHA256,
  }
}
