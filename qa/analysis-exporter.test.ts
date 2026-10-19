import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { exportAnalysis, exportBaseDir, slugOf } from '../desktop/src/main/analysis-exporter'
import type { AnalysisExportPayload } from '../desktop/src/shared/ipc-contract'

test('slugOf 返回 16 位十六进制且同输入稳定', () => {
  const path = 'C:\\repo\\MySolution\\MySolution.sln'
  const slug = slugOf(path)
  assert.match(slug, /^[0-9a-f]{16}$/)
  assert.equal(slug, slugOf(path))
  assert.notEqual(slug, slugOf('C:\\repo\\Other\\Other.sln'))
})

test('exportAnalysis 产出三份文件并更新 index', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pa-export-'))
  const prevLocal = process.env.LOCALAPPDATA
  process.env.LOCALAPPDATA = dir
  try {
    const payload: AnalysisExportPayload = {
      solutionName: 'MySolution',
      solutionPath: 'C:\\repo\\MySolution\\MySolution.sln',
      projectName: 'MyProject',
      summary: '发现 2 个可优化项',
      issues: [
        {
          severity: 'warning',
          title: '未处理异常',
          description: '方法可能抛出未处理异常',
          suggestion: '增加 try/catch',
          file: 'MyProject/Service.cs',
          line: 42,
        },
      ],
      status: 'done',
      analyzedAt: '2025-01-01T10:00:00.000Z',
      issueCount: 2,
    }

    exportAnalysis(payload)

    const base = exportBaseDir()
    assert.equal(base, join(dir, 'PersonalAgent'))

    const slug = slugOf(payload.solutionPath)
    assert.ok(existsSync(join(base, 'index.json')), 'index.json 应存在')
    assert.ok(existsSync(join(base, 'latest-analysis.json')), 'latest-analysis.json 应存在')
    assert.ok(existsSync(join(base, 'analyses', `${slug}.json`)), 'analyses/<slug>.json 应存在')

    const index = JSON.parse(readFileSync(join(base, 'index.json'), 'utf-8'))
    assert.equal(index.version, 1)
    assert.ok(index.solutions[payload.solutionPath], 'index 应包含该 solutionPath')
    assert.equal(index.solutions[payload.solutionPath].solutionName, 'MySolution')
    assert.equal(index.solutions[payload.solutionPath].file, `${slug}.json`)

    const result = JSON.parse(readFileSync(join(base, 'analyses', `${slug}.json`), 'utf-8'))
    assert.equal(result.schemaVersion, 1)
    assert.equal(result.issueCount, 2)
    assert.equal(result.issues.length, 1)
    assert.equal(result.issues[0].severity, 'warning')
    assert.equal(result.issues[0].file, 'MyProject/Service.cs')

    // 再次导出另一解决方案，index 应累计两条
    exportAnalysis({ ...payload, solutionPath: 'C:\\repo\\Other\\Other.sln', solutionName: 'Other' })
    const index2 = JSON.parse(readFileSync(join(base, 'index.json'), 'utf-8'))
    assert.equal(Object.keys(index2.solutions).length, 2)
  } finally {
    if (prevLocal === undefined) delete process.env.LOCALAPPDATA
    else process.env.LOCALAPPDATA = prevLocal
    rmSync(dir, { recursive: true, force: true })
  }
})

test('exportBaseDir：LOCALAPPDATA 缺失时回退 %TEMP%\\PersonalAgent（单层）', () => {
  const prevLocal = process.env.LOCALAPPDATA
  const prevTemp = process.env.TEMP
  delete process.env.LOCALAPPDATA
  process.env.TEMP = 'C:\\Users\\t\\AppData\\Local\\Temp'
  try {
    // 设计 §1.3：缺失 LOCALAPPDATA 时回退 %TEMP%\PersonalAgent（单层 PersonalAgent）
    assert.equal(exportBaseDir(), join('C:\\Users\\t\\AppData\\Local\\Temp', 'PersonalAgent'))
  } finally {
    if (prevLocal === undefined) delete process.env.LOCALAPPDATA
    else process.env.LOCALAPPDATA = prevLocal
    if (prevTemp === undefined) delete process.env.TEMP
    else process.env.TEMP = prevTemp
  }
})

test('exportAnalysis 导出失败不抛异常', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pa-export-fail-'))
  const blocker = join(dir, 'blocker.txt')
  writeFileSync(blocker, 'x')
  const prevLocal = process.env.LOCALAPPDATA
  // 指向一个普通文件，join 后 mkdirSync 必然失败
  process.env.LOCALAPPDATA = blocker
  try {
    assert.doesNotThrow(() =>
      exportAnalysis({
        solutionName: 'S',
        solutionPath: 'C:\\s.sln',
        summary: '',
        issues: [],
        status: 'done',
        analyzedAt: '2025-01-01T00:00:00.000Z',
        issueCount: 0,
      }),
    )
  } finally {
    if (prevLocal === undefined) delete process.env.LOCALAPPDATA
    else process.env.LOCALAPPDATA = prevLocal
    rmSync(dir, { recursive: true, force: true })
  }
})
