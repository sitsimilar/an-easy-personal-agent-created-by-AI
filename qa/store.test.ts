/**
 * desktop/src/main/store.ts 单元测试（electron 已 mock）
 * 覆盖：JSON 持久化读写 roundtrip、文件不存在返回默认值、损坏 JSON 容错。
 */
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// 触发 mock：esbuild --alias:electron=./qa/mocks/electron.ts
import { JsonStore } from '../desktop/src/main/store'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'qa-store-'))
  process.env.QA_STORE_DIR = dir
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  delete process.env.QA_STORE_DIR
})

test('roundtrip：set/patch 写盘后新实例读回一致', () => {
  const s = new JsonStore()
  s.set('vsPath', 'C:\\Program Files\\Microsoft Visual Studio\\devenv.exe')
  s.patch({
    codeUploadEnabled: false,
    floatPosition: { x: 100, y: 200, width: 320, height: 480 },
    cache: { 'MySolution.sln': { 'Proj1/Program.cs': 'abc123' } },
  })
  s.flushSync() // 写盘已防抖，需 flush 后再读回

  const reloaded = new JsonStore()
  assert.equal(reloaded.get('vsPath'), 'C:\\Program Files\\Microsoft Visual Studio\\devenv.exe')
  assert.equal(reloaded.get('codeUploadEnabled'), false)
  assert.deepEqual(reloaded.get('floatPosition'), { x: 100, y: 200, width: 320, height: 480 })
  assert.deepEqual(reloaded.get('cache'), { 'MySolution.sln': { 'Proj1/Program.cs': 'abc123' } })
})

test('未覆盖字段回落到默认值（roundtrip 后读回默认字段）', () => {
  const s = new JsonStore()
  s.set('vsPath', 'C:\\vs.exe')
  s.flushSync()
  const reloaded = new JsonStore()
  // 未显式设置的字段保持默认
  assert.equal(reloaded.get('notifyEnabled'), true)
  assert.equal(reloaded.get('listening'), true)
  assert.equal(reloaded.get('collapsed'), false)
  assert.deepEqual(reloaded.get('cache'), {})
  assert.deepEqual(reloaded.get('floatPosition'), {})
})

test('文件不存在：返回默认值', () => {
  const s = new JsonStore()
  assert.equal(s.get('vsPath'), '')
  assert.equal(s.get('codeUploadEnabled'), true)
  assert.equal(s.get('floatWindowEnabled'), true)
  assert.equal(s.get('notifyEnabled'), true)
  assert.equal(s.get('listening'), true)
  assert.equal(s.get('collapsed'), false)
  assert.deepEqual(s.get('floatPosition'), {})
  assert.deepEqual(s.get('cache'), {})
})

test('新增字段默认值（mainWindowPosition/mainWindowMaximized/selectionShortcut）', () => {
  const s = new JsonStore()
  assert.deepEqual(s.get('mainWindowPosition'), {})
  assert.equal(s.get('mainWindowMaximized'), false)
  assert.equal(s.get('selectionShortcut'), 'CommandOrControl+Shift+A')
})

test('autoCollapseEnabled 默认 true 且 roundtrip 可写', () => {
  const s = new JsonStore()
  assert.equal(s.get('autoCollapseEnabled'), true)
  s.set('autoCollapseEnabled', false)
  s.flushSync()
  const reloaded = new JsonStore()
  assert.equal(reloaded.get('autoCollapseEnabled'), false)
})

test('新增字段 roundtrip：写后读回一致', () => {
  const s = new JsonStore()
  s.patch({
    mainWindowPosition: { x: 120, y: 80, width: 1100, height: 720 },
    mainWindowMaximized: true,
    selectionShortcut: 'CommandOrControl+Shift+X',
  })
  s.flushSync()
  const reloaded = new JsonStore()
  assert.deepEqual(reloaded.get('mainWindowPosition'), { x: 120, y: 80, width: 1100, height: 720 })
  assert.equal(reloaded.get('mainWindowMaximized'), true)
  assert.equal(reloaded.get('selectionShortcut'), 'CommandOrControl+Shift+X')
})

test('损坏 JSON：容错返回默认值（不抛错）', () => {
  writeFileSync(join(dir, 'preferences.json'), '{"vsPath": 未闭合', 'utf-8')
  const s = new JsonStore()
  assert.equal(s.get('vsPath'), '')
  assert.equal(s.get('codeUploadEnabled'), true)
})

test('部分字段缺失的合法 JSON：缺失字段回落默认', () => {
  // 用 JSON.stringify 生成合法 JSON，避免手写转义出错
  writeFileSync(join(dir, 'preferences.json'), JSON.stringify({ vsPath: 'C:\\vs.exe' }), 'utf-8')
  const s = new JsonStore()
  assert.equal(s.get('vsPath'), 'C:\\vs.exe')
  assert.equal(s.get('codeUploadEnabled'), true) // 默认
  assert.deepEqual(s.get('cache'), {}) // 默认
})

test('非对象 JSON（如数组/字符串）：容错返回默认值', () => {
  writeFileSync(join(dir, 'preferences.json'), '[1,2,3]', 'utf-8')
  const s = new JsonStore()
  assert.equal(s.get('vsPath'), '')
  assert.equal(s.get('codeUploadEnabled'), true)
})
