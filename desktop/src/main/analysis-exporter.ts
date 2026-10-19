import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import type { AnalysisExportPayload, CodeIssue } from '../shared/ipc-contract'
import { store } from './store'

export type { AnalysisExportPayload, CodeIssue }

export interface IndexEntry {
  solutionName: string
  file: string
  analyzedAt: string
}

interface IndexFile {
  version: number
  solutions: Record<string, IndexEntry>
}

/** 导出目录基址：%LOCALAPPDATA%\PersonalAgent\（缺失时回退 %TEMP%\PersonalAgent）。 */
export function exportBaseDir(): string {
  const custom = store.get('exportDir').trim()
  if (custom) return custom
  const base = process.env.LOCALAPPDATA || (process.env.TEMP ?? '.')
  return join(base, 'PersonalAgent')
}

/** 由 solutionPath 生成 16 位十六进制文件名 slug（sha1 前 16 字符）。 */
export function slugOf(solutionPath: string): string {
  return createHash('sha1').update(solutionPath).digest('hex').slice(0, 16)
}

/** 读取索引（不存在/损坏时返回空索引）。 */
export function readIndex(dir: string): IndexFile {
  try {
    const raw = readFileSync(join(dir, 'index.json'), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<IndexFile>
    return { version: 1, solutions: parsed?.solutions ?? {} }
  } catch {
    return { version: 1, solutions: {} }
  }
}

/**
 * 将分析结果落盘：
 *   - analyses\<slug>.json（每解决方案最新，覆盖写）
 *   - latest-analysis.json（最近一次副本）
 *   - index.json（solutionPath → 文件 + 元信息）
 * 导出失败不阻塞分析主流程（仅影响 VSIX 展示）。
 */
export function exportAnalysis(payload: AnalysisExportPayload): void {
  try {
    const dir = exportBaseDir()
    const analysesDir = join(dir, 'analyses')
    mkdirSync(analysesDir, { recursive: true })

    const slug = slugOf(payload.solutionPath)
    const fileName = `${slug}.json`
    const body = JSON.stringify({ schemaVersion: 1, ...payload }, null, 2)

    writeFileSync(join(analysesDir, fileName), body, 'utf-8')
    writeFileSync(join(dir, 'latest-analysis.json'), body, 'utf-8')

    const index = readIndex(dir)
    index.solutions[payload.solutionPath] = {
      solutionName: payload.solutionName,
      file: fileName,
      analyzedAt: payload.analyzedAt,
    }
    writeFileSync(join(dir, 'index.json'), JSON.stringify({ version: 1, solutions: index.solutions }, null, 2), 'utf-8')
  } catch {
    /* 导出失败不阻塞分析主流程 */
  }
}
