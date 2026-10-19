/**
 * web/src/services/aiService.ts 的 analyzeSelection 解析逻辑测试。
 * 通过 esbuild --alias:@/lib/cloud=./qa/mocks/cloud.ts 替换云单例，
 * 让真实 collectStream + parseJsonLoose 参与运行，验证结构化解析与降级。
 */
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { __setCloudMock, __resetCloudMock } from './mocks/cloud'
import { aiService, clearSelectionCache } from '../web/src/services/aiService'
import { ANALYZE_SELECTION_SYSTEM_PROMPT } from '../shared/constants/prompts'

let capturedArgs: Record<string, unknown> | null = null

/** 将文本拆成逐字符 delta，模拟流式响应。 */
function streamOfText(text: string): AsyncIterable<unknown> {
  return (async function* () {
    for (const ch of text) {
      yield { choices: [{ delta: { content: ch } }] }
    }
  })()
}

beforeEach(() => {
  __resetCloudMock()
  clearSelectionCache()
  capturedArgs = null
  __setCloudMock({
    modelsList: () => [{ id: 'sel-model', disabled: false }],
    chatCreate: (args) => {
      capturedArgs = args as Record<string, unknown>
      return (globalThis as unknown as { __selRaw: string }).__selRaw
        ? streamOfText((globalThis as unknown as { __selRaw: string }).__selRaw)
        : (async function* () {})()
    },
  })
})

function setRaw(raw: string): void {
  ;(globalThis as unknown as { __selRaw: string }).__selRaw = raw
}

test('analyzeSelection：结构化解析成功，返回 summary + issues', async () => {
  setRaw('{"summary":"总体尚可","issues":[{"category":"syntax","title":"缺分号","description":"d","suggestion":"补分号","line":3}]}')
  const r = await aiService.analyzeSelection('const a = 1')
  assert.equal(r.summary, '总体尚可')
  assert.equal(r.issues.length, 1)
  assert.equal(r.issues[0].category, 'syntax')
  assert.equal(r.issues[0].title, '缺分号')
})

test('analyzeSelection：messages[0]=system、stream=true、模型动态取', async () => {
  setRaw('{"summary":"s","issues":[]}')
  await aiService.analyzeSelection('code')
  assert.ok(capturedArgs)
  const messages = capturedArgs.messages as Array<{ role: string; content: string }>
  assert.equal(messages[0].role, 'system')
  assert.equal(messages[0].content, ANALYZE_SELECTION_SYSTEM_PROMPT)
  assert.equal(capturedArgs.stream, true)
  assert.equal(capturedArgs.model, 'sel-model') // 来自 models.list() 动态取值，非写死
})

test('analyzeSelection：issues 超过 20 条时截断', async () => {
  const issues = Array.from({ length: 35 }, (_, i) => `{"category":"style","title":"t${i}","description":"d","suggestion":"s"}`).join(',')
  setRaw(`{"summary":"多","issues":[${issues}]}`)
  const r = await aiService.analyzeSelection('code')
  assert.equal(r.issues.length, 20)
})

test('analyzeSelection：user content 截断到 16000 字符', async () => {
  setRaw('{"summary":"s","issues":[]}')
  await aiService.analyzeSelection('x'.repeat(30000))
  const messages = capturedArgs!.messages as Array<{ role: string; content: string }>
  assert.equal(messages[1].content.length, 16000)
})

test('analyzeSelection：解析失败时降级为原文 summary + 空 issues', async () => {
  setRaw('这是一段非 JSON 的纯文本输出')
  const r = await aiService.analyzeSelection('code')
  assert.equal(r.summary, '这是一段非 JSON 的纯文本输出')
  assert.deepEqual(r.issues, [])
})

test('analyzeSelection：空输出时 summary 兜底为中文提示', async () => {
  setRaw('')
  const r = await aiService.analyzeSelection('code')
  assert.equal(r.summary, '未能解析分析结果')
  assert.deepEqual(r.issues, [])
})

test('analyzeSelection：summary 缺省时兜底为「分析完成」', async () => {
  setRaw('{"issues":[]}')
  const r = await aiService.analyzeSelection('code')
  assert.equal(r.summary, '分析完成')
  assert.deepEqual(r.issues, [])
})

test('analyzeSelection：LLM 调用抛错时向上抛出（不静默）', async () => {
  __setCloudMock({
    chatCreate: () => {
      throw new Error('boom')
    },
  })
  await assert.rejects(() => aiService.analyzeSelection('code'), /boom/)
})
