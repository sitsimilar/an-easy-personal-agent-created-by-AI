/**
 * web/src/services/aiService.ts 的 P1 AI 方法测试（cloud.llm 已 mock）。
 * 覆盖：generateReview / extractKeyPoints / organizeTodos 的结构化解析、截断、降级、LLM 约束。
 */
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { __setCloudMock, __resetCloudMock } from './mocks/cloud'
import { aiService } from '../web/src/services/aiService'
import {
  EXTRACT_KEY_POINTS_SYSTEM_PROMPT,
  ORGANIZE_TODOS_SYSTEM_PROMPT,
  REVIEW_SYSTEM_PROMPT,
} from '../shared/constants/prompts'
import type { InfoRecord } from '../shared/types/domain'

let capturedArgs: Record<string, unknown> | null = null

function streamOfText(text: string): AsyncIterable<unknown> {
  return (async function* () {
    for (const ch of text) yield { choices: [{ delta: { content: ch } }] }
  })()
}

function setRaw(raw: string): void {
  ;(globalThis as unknown as { __p1Raw: string }).__p1Raw = raw
}

beforeEach(() => {
  __resetCloudMock()
  capturedArgs = null
  setRaw('')
  __setCloudMock({
    modelsList: () => [{ id: 'p1-model', disabled: false }],
    chatCreate: (args) => {
      capturedArgs = args as Record<string, unknown>
      const raw = (globalThis as unknown as { __p1Raw: string }).__p1Raw
      return streamOfText(raw)
    },
  })
})

function makeRecord(over: Partial<InfoRecord> = {}): InfoRecord {
  return {
    id: 1,
    type: 'idea',
    title: 't',
    content: 'c',
    tags: [],
    isDeleted: false,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...over,
  }
}

function capturedMessages(): Array<{ role: string; content: string }> {
  return capturedArgs!.messages as Array<{ role: string; content: string }>
}

/* ------------------------------------------------------------------ *
 * generateReview
 * ------------------------------------------------------------------ */

test('generateReview：结构化解析 summary + actions', async () => {
  setRaw(
    '{"summary":"本阶段推进了A","actions":[{"title":"跟进A","detail":"d","priority":"high"},{"title":"整理B","priority":"low"}]}',
  )
  const r = await aiService.generateReview([makeRecord()])
  assert.equal(r.summary, '本阶段推进了A')
  assert.equal(r.actions.length, 2)
  assert.equal(r.actions[0].title, '跟进A')
  assert.equal(r.actions[0].priority, 'high')
})

test('generateReview：messages[0]=system、stream=true、模型动态取', async () => {
  setRaw('{"summary":"s","actions":[]}')
  await aiService.generateReview([makeRecord()])
  const m = capturedMessages()
  assert.equal(m[0].role, 'system')
  assert.equal(m[0].content, REVIEW_SYSTEM_PROMPT)
  assert.equal(capturedArgs!.stream, true)
  assert.equal(capturedArgs!.model, 'p1-model')
})

test('generateReview：actions 截断到 ≤8', async () => {
  const actions = Array.from({ length: 12 }, (_, i) => `{"title":"a${i}"}`).join(',')
  setRaw(`{"summary":"s","actions":[${actions}]}`)
  const r = await aiService.generateReview([makeRecord()])
  assert.equal(r.actions.length, 8)
})

test('generateReview：过滤无 title 的 action 元素', async () => {
  setRaw('{"summary":"s","actions":[{"detail":"无title"},null,{"title":"ok"}]}')
  const r = await aiService.generateReview([makeRecord()])
  assert.equal(r.actions.length, 1)
  assert.equal(r.actions[0].title, 'ok')
})

test('generateReview：解析失败降级为纯文本 summary + 空 actions', async () => {
  setRaw('这是一段非 JSON 文本')
  const r = await aiService.generateReview([makeRecord()])
  assert.equal(r.summary, '这是一段非 JSON 文本')
  assert.deepEqual(r.actions, [])
})

test('generateReview：空输出 summary 兜底为「未能生成回顾」', async () => {
  setRaw('')
  const r = await aiService.generateReview([makeRecord()])
  assert.equal(r.summary, '未能生成回顾')
  assert.deepEqual(r.actions, [])
})

test('generateReview：输入文本截断到 30000 字符', async () => {
  setRaw('{"summary":"s","actions":[]}')
  const records = Array.from({ length: 70 }, (_, i) =>
    makeRecord({ id: i + 1, type: 'idea', title: `t${i}`, content: 'x'.repeat(500) }),
  )
  await aiService.generateReview(records)
  assert.equal(capturedMessages()[1].content.length, 30000)
})

/* ------------------------------------------------------------------ *
 * extractKeyPoints
 * ------------------------------------------------------------------ */

test('extractKeyPoints：数组解析返回 point 列表', async () => {
  setRaw('[{"point":"要点1","detail":"d1"},{"point":"要点2"}]')
  const r = await aiService.extractKeyPoints('长文内容')
  assert.equal(r.length, 2)
  assert.equal(r[0].point, '要点1')
  assert.equal(r[1].point, '要点2')
})

test('extractKeyPoints：messages[0]=system、stream=true、模型动态取', async () => {
  setRaw('[]')
  await aiService.extractKeyPoints('x')
  const m = capturedMessages()
  assert.equal(m[0].role, 'system')
  assert.equal(m[0].content, EXTRACT_KEY_POINTS_SYSTEM_PROMPT)
  assert.equal(capturedArgs!.stream, true)
  assert.equal(capturedArgs!.model, 'p1-model')
})

test('extractKeyPoints：过滤非 point 元素', async () => {
  setRaw('[{"point":"p1"},{"detail":"无point"},null,{"point":"p3"}]')
  const r = await aiService.extractKeyPoints('x')
  assert.deepEqual(r.map((k) => k.point), ['p1', 'p3'])
})

test('extractKeyPoints：截断到 ≤10', async () => {
  const pts = Array.from({ length: 15 }, (_, i) => `{"point":"p${i}"}`).join(',')
  setRaw(`[${pts}]`)
  const r = await aiService.extractKeyPoints('x')
  assert.equal(r.length, 10)
})

test('extractKeyPoints：输入截断到 30000 字符', async () => {
  setRaw('[]')
  await aiService.extractKeyPoints('x'.repeat(40000))
  assert.equal(capturedMessages()[1].content.length, 30000)
})

test('extractKeyPoints：非数组/空输出降级为空数组', async () => {
  setRaw('{"point":"不是数组"}')
  assert.deepEqual(await aiService.extractKeyPoints('x'), [])
  setRaw('')
  assert.deepEqual(await aiService.extractKeyPoints('x'), [])
  setRaw('纯文本非JSON')
  assert.deepEqual(await aiService.extractKeyPoints('x'), [])
})

/* ------------------------------------------------------------------ *
 * organizeTodos
 * ------------------------------------------------------------------ */

test('organizeTodos：解析 summary/mergeGroups/ordered', async () => {
  setRaw(
    '{"summary":"发现2组重复","mergeGroups":[{"keep":"k1","merge":["m1","m2"]}],"ordered":[{"title":"t1","priority":"high"},{"title":"t2","priority":"low"}]}',
  )
  const r = await aiService.organizeTodos([makeRecord({ type: 'todo', title: 't1' })])
  assert.equal(r.summary, '发现2组重复')
  assert.equal(r.mergeGroups.length, 1)
  assert.equal(r.mergeGroups[0].keep, 'k1')
  assert.deepEqual(r.mergeGroups[0].merge, ['m1', 'm2'])
  assert.equal(r.ordered.length, 2)
  assert.equal(r.ordered[0].priority, 'high')
})

test('organizeTodos：messages[0]=system、stream=true、模型动态取', async () => {
  setRaw('{"summary":"s","mergeGroups":[],"ordered":[]}')
  await aiService.organizeTodos([makeRecord()])
  const m = capturedMessages()
  assert.equal(m[0].role, 'system')
  assert.equal(m[0].content, ORGANIZE_TODOS_SYSTEM_PROMPT)
  assert.equal(capturedArgs!.stream, true)
  assert.equal(capturedArgs!.model, 'p1-model')
})

test('organizeTodos：ordered 截断到 ≤50', async () => {
  const items = Array.from({ length: 55 }, (_, i) => `{"title":"t${i}","priority":"medium"}`).join(',')
  setRaw(`{"summary":"s","mergeGroups":[],"ordered":[${items}]}`)
  const r = await aiService.organizeTodos([makeRecord()])
  assert.equal(r.ordered.length, 50)
})

test('organizeTodos：过滤无 title 的 ordered 与无 keep 的 mergeGroup', async () => {
  setRaw(
    '{"summary":"s","mergeGroups":[{"keep":"k1"},{"merge":["noKeep"]}],"ordered":[{"title":"ok","priority":"high"},{"priority":"high"}]}',
  )
  const r = await aiService.organizeTodos([makeRecord()])
  assert.equal(r.mergeGroups.length, 1) // 仅 keep 项保留
  assert.equal(r.ordered.length, 1)
  assert.equal(r.ordered[0].title, 'ok')
})

test('organizeTodos：解析失败降级兜底', async () => {
  setRaw('纯文本非JSON')
  const r = await aiService.organizeTodos([makeRecord()])
  assert.deepEqual(r, { summary: '未能整理待办', mergeGroups: [], ordered: [] })
})

test('organizeTodos：summary 缺省时为空串', async () => {
  setRaw('{"mergeGroups":[],"ordered":[]}')
  const r = await aiService.organizeTodos([makeRecord()])
  assert.equal(r.summary, '')
})
