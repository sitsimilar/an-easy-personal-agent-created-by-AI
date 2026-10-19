import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, dirname, join, relative } from 'node:path'
import { createHash } from 'node:crypto'
import type { SourceFilePayload } from '../shared/ipc-contract'

const SOURCE_EXTENSIONS = new Set([
  '.cs', '.cpp', '.h', '.js', '.ts', '.py', '.java', '.go', '.rs', '.vue', '.tsx', '.jsx', '.sql', '.xml', '.json',
])
const SKIP_DIRS = new Set(['bin', 'obj', 'node_modules', '.git', '.vs', 'packages'])
const MAX_FILE_BYTES = 200 * 1024
const MAX_TOTAL_BYTES = 2 * 1024 * 1024

export interface ReadSolutionResult {
  solutionName: string
  projectNames: string[]
  changedFiles: SourceFilePayload[]
  hashes: Record<string, string>
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function extOf(p: string): string {
  const i = p.lastIndexOf('.')
  return i === -1 ? '' : p.slice(i).toLowerCase()
}

function isSkipped(relPath: string): boolean {
  return relPath.split('/').some((seg) => SKIP_DIRS.has(seg.toLowerCase()))
}

/** 解析 .sln 中的项目相对路径。 */
function parseSlnProjects(content: string): string[] {
  const out: string[] = []
  const re = /Project\("\{[^}]*\}"\)\s*=\s*"[^"]*",\s*"([^"]+)",\s*"\{[^}]*\}"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    const rel = m[1].replace(/\\/g, '/')
    if (rel.toLowerCase().endsWith('.csproj')) out.push(rel)
  }
  return out
}

/** 解析 .csproj 中的源文件相对路径。 */
function parseCsprojSources(content: string): string[] {
  const out: string[] = []
  const re = /<(?:Compile|None|Content)\s+[^>]*Include="([^"]+)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    const rel = m[1].replace(/\\/g, '/')
    if (SOURCE_EXTENSIONS.has(extOf(rel))) out.push(rel)
  }
  return out
}

/** 目录递归收集白名单源文件（有界，用于 .csproj 未列出文件的兜底）。 */
async function collectByExtension(dir: string, out: string[], limit: number): Promise<void> {
  if (out.length >= limit) return
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (out.length >= limit) return
    if (entry.name.startsWith('.')) continue
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name.toLowerCase())) continue
      await collectByExtension(abs, out, limit)
    } else if (SOURCE_EXTENSIONS.has(extOf(entry.name))) {
      out.push(abs)
    }
  }
}

/**
 * 读取解决方案：.sln → .csproj → 源码（白名单扩展名 + 大小限制 + 增量 sha256）。
 * 异步读取，避免阻塞 Electron 主进程（托盘/悬浮窗/快捷键）。
 */
export async function readSolution(
  solutionPath: string,
  prevHashes: Record<string, string> = {},
): Promise<ReadSolutionResult> {
  const slnContent = await readFile(solutionPath, 'utf-8')
  const slnDir = dirname(solutionPath)
  const solutionName = basename(solutionPath, '.sln')
  const projectRels = parseSlnProjects(slnContent)

  const fileSet = new Set<string>()
  const projectNames: string[] = []

  for (const rel of projectRels) {
    const csprojAbs = join(slnDir, rel)
    let csprojContent: string
    try {
      csprojContent = await readFile(csprojAbs, 'utf-8')
    } catch {
      continue
    }
    projectNames.push(basename(rel, '.csproj'))
    const sources = parseCsprojSources(csprojContent)
    for (const src of sources) {
      fileSet.add(join(dirname(csprojAbs), src))
    }
  }

  const files = Array.from(fileSet)
  if (files.length === 0) {
    await collectByExtension(slnDir, files, 500)
  }

  const changedFiles: SourceFilePayload[] = []
  const hashes: Record<string, string> = {}
  let totalBytes = 0

  for (const abs of files) {
    if (totalBytes >= MAX_TOTAL_BYTES) break

    const relPath = relative(slnDir, abs).replace(/\\/g, '/')
    if (isSkipped(relPath)) continue
    if (!SOURCE_EXTENSIONS.has(extOf(relPath))) continue

    let size: number
    try {
      size = (await stat(abs)).size
    } catch {
      continue
    }
    if (size > MAX_FILE_BYTES) continue

    let content: string
    try {
      content = await readFile(abs, 'utf-8')
    } catch {
      continue
    }
    if (Buffer.byteLength(content, 'utf-8') > MAX_FILE_BYTES) continue

    const hash = sha256(content)
    hashes[relPath] = hash
    if (prevHashes[relPath] === hash) continue // 未变更，跳过

    changedFiles.push({ relativePath: relPath, content, sha256: hash })
    totalBytes += Buffer.byteLength(content, 'utf-8')
  }

  return { solutionName, projectNames, changedFiles, hashes }
}
