/**
 * web/src/services/aiService.ts 单元测试：classify / summarize 结构化解析与降级。
 * cloud.llm 已由 qa/mocks/cloud.ts 替换。
 */
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { __setCloudMock, __resetCloudMock } from './mocks/cloud'
import { aiService, clearMindTreeCache, clearSelectionCache } from '../web/src/services/aiService'

function streamOfText(text: string): AsyncIterable<unknown> {
  return (async function* () {
    for (const ch of text) yield { choices: [{ delta: { content: ch } }] }
  })()
}

let captured: Record<string, unknown> | null = null

beforeEach(() => {
  __resetCloudMock()
  clearMindTreeCache()
  clearSelectionCache()
  captured = null
  __setCloudMock({
    modelsList: () => [{ id: 'mock-model' }],
    chatCreate: (args) => {
      captured = args as Record<string, unknown>
      return streamOfText((globalThis as Record<string, unknown>).__raw as string)
    },
  })
})

test('classify：结构化解析 category/tags', async () => {
  ;(globalThis as Record<string, unknown>).__raw = JSON.stringify({ category: '技术/AI', tags: ['a', 'b'] })
  const r = await aiService.classify('一段内容')
  assert.equal(r.category, '技术/AI')
  assert.deepEqual(r.tags, ['a', 'b'])
})

test('classify：输出非 JSON 时回退默认分类', async () => {
  ;(globalThis as Record<string, unknown>).__raw = '不是 JSON'
  const r = await aiService.classify('内容')
  assert.equal(r.category, '其他')
  assert.deepEqual(r.tags, [])
})

test('classify：LLM 硬契约（system/stream/动态模型）', async () => {
  ;(globalThis as Record<string, unknown>).__raw = '{"category":"其他","tags":[]}'
  await aiService.classify('内容')
  const messages = captured!.messages as Array<{ role: string; content: string }>
  assert.equal(messages[0].role, 'system')
  assert.equal(messages[1].role, 'user')
  assert.equal(captured!.stream, true)
  assert.equal(captured!.model, 'mock-model')
})

test('summarize：返回纯文本摘要', async () => {
  ;(globalThis as Record<string, unknown>).__raw = '这是一句摘要'
  const s = await aiService.summarize('内容')
  assert.equal(s, '这是一句摘要')
})

test('summarize：空输出回退「暂无摘要」', async () => {
  ;(globalThis as Record<string, unknown>).__raw = ''
  const s = await aiService.summarize('内容')
  assert.equal(s, '暂无摘要')
})
