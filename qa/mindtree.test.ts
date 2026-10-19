/**
 * web/src/components/mindtree/dimensions.ts 单元测试（节点/维度纯逻辑）。
 * 覆盖：5 维度模板、压感归一化与线宽、节点工厂、维度标签/配色、
 *       generateMindTree AI 链路、extractCompletedDimensions 流式容错解析。
 * 运行方式：node qa/run-tests.mjs（esbuild bundle 后 node:test）。
 *
 * 说明：文档级持久化（loadDoc/saveDoc/clearDoc/createDoc）已迁至
 *       web/src/services/mindforest-store.ts，由 qa/mindforest-store.test.ts 覆盖。
 */
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { __setCloudMock, __resetCloudMock } from './mocks/cloud'
import { aiService, clearMindTreeCache } from '../web/src/services/aiService'
import { extractCompletedDimensions } from '../web/src/services/mindtree-parse'
import { MIND_TREE_SYSTEM_PROMPT } from '../shared/constants/prompts'
import {
  DIMENSION_META,
  DIMENSION_ORDER,
  createNode,
  dimensionColor,
  dimensionLabel,
  fallbackDimensions,
  normalizePressure,
  strokeWidth,
} from '../web/src/components/mindtree/dimensions'

/* ------------------------------------------------------------------ *
 * aiService.generateMindTree（cloud.llm 已 mock）—— AI 生成主链路
 * ------------------------------------------------------------------ */

let mtCaptured: Record<string, unknown> | null = null
let mtChatCalls = 0

function streamOfText(text: string): AsyncIterable<unknown> {
  return (async function* () {
    for (const ch of text) yield { choices: [{ delta: { content: ch } }] }
  })()
}

function setMindTreeRaw(raw: string): void {
  ;(globalThis as Record<string, unknown>).__mindTreeRaw = raw
}

beforeEach(() => {
  __resetCloudMock()
  clearMindTreeCache()
  mtCaptured = null
  mtChatCalls = 0
  setMindTreeRaw('')
  __setCloudMock({
    modelsList: () => [{ id: 'mt-model', disabled: false }],
    chatCreate: (args) => {
      mtCaptured = args as Record<string, unknown>
      mtChatCalls += 1
      return streamOfText((globalThis as Record<string, unknown>).__mindTreeRaw as string)
    },
  })
})

test('DIMENSION_ORDER / DIMENSION_META：5 个维度 key 齐全且与共享类型一致', () => {
  assert.deepEqual(DIMENSION_ORDER, ['concept', 'premise', 'feasibility', 'counter', 'action'])
  assert.deepEqual(Object.keys(DIMENSION_META).sort(), [...DIMENSION_ORDER].sort())
  for (const key of DIMENSION_ORDER) {
    assert.ok(DIMENSION_META[key].label.length > 0, `${key} 缺少 label`)
    assert.ok(DIMENSION_META[key].colorPath.length > 0, `${key} 缺少 colorPath`)
  }
})

test('fallbackDimensions：固定 5 维度、每维 3 条引导问题、主题嵌入文案', () => {
  const dims = fallbackDimensions('要不要做独立产品')
  assert.equal(dims.length, 5)
  assert.deepEqual(
    dims.map((d) => d.key),
    DIMENSION_ORDER,
  )
  for (const d of dims) {
    assert.equal(d.questions.length, 3, `${d.key} 应有 3 个问题`)
    assert.ok(d.label.length > 0)
    assert.ok(
      d.questions.some((q) => q.includes('要不要做独立产品')),
      `${d.key} 的问题未嵌入主题`,
    )
  }
  assert.deepEqual(
    dims.map((d) => d.label),
    DIMENSION_ORDER.map((k) => DIMENSION_META[k].label),
  )
})

test('fallbackDimensions：空白主题回退默认文案并 trim', () => {
  const dims = fallbackDimensions('   ')
  assert.equal(dims.length, 5)
  assert.ok(dims[0].questions[0].includes('这个主题'))
  const trimmed = fallbackDimensions('  边缘计算  ')
  assert.ok(trimmed[0].questions[0].includes('「边缘计算」'))
  assert.ok(!trimmed[0].questions[0].includes('  '))
})

test('normalizePressure：有限正值 clamp 到 [0.05,1]，异常值取 0.5', () => {
  assert.equal(normalizePressure(0.5), 0.5)
  assert.equal(normalizePressure(1), 1)
  assert.equal(normalizePressure(1.8), 1, '超上限 clamp 到 1')
  assert.equal(normalizePressure(0.02), 0.05, '低于下限 clamp 到 0.05')
  assert.equal(normalizePressure(0), 0.5, '0 视为无压感设备，取默认')
  assert.equal(normalizePressure(-1), 0.5, '负值取默认')
  assert.equal(normalizePressure(Number.NaN), 0.5, 'NaN 取默认')
  assert.equal(normalizePressure(Number.POSITIVE_INFINITY), 0.5, 'Infinity 取默认')
})

test('strokeWidth：1 + pressure * 4，范围约 1~5px', () => {
  assert.equal(strokeWidth(0), 1)
  assert.equal(strokeWidth(0.05), 1.2)
  assert.equal(strokeWidth(0.5), 3)
  assert.equal(strokeWidth(1), 5)
})

test('createNode：默认字段完整，id 唯一', () => {
  const a = createNode('想法 A')
  const b = createNode('想法 B', '核心概念')
  assert.equal(a.text, '想法 A')
  assert.equal(a.dimension, undefined)
  assert.equal(a.collapsed, false)
  assert.equal(a.loading, false)
  assert.deepEqual(a.children, [])
  assert.ok(a.id.length > 0)
  assert.equal(b.dimension, '核心概念')
  assert.notEqual(a.id, b.id, '两次创建的节点 id 必须不同')
})

test('dimensionLabel：内置元数据优先，缺失回退 AI label，再回退 key', () => {
  assert.equal(dimensionLabel('concept'), '核心概念')
  assert.equal(dimensionLabel('unknown', 'AI 起的名字'), 'AI 起的名字')
  assert.equal(dimensionLabel('unknown', '   '), 'unknown', '空白 label 视为缺失')
  assert.equal(dimensionLabel('unknown'), 'unknown')
})

test('dimensionColor：已知 key 取主题对应色，未知 key 回落 divider', () => {
  const theme = {
    palette: {
      primary: { main: '#p' },
      info: { main: '#i' },
      success: { main: '#s' },
      error: { main: '#e' },
      warning: { main: '#w' },
      divider: '#d',
    },
  } as unknown as Parameters<typeof dimensionColor>[1]
  assert.equal(dimensionColor('concept', theme), '#p')
  assert.equal(dimensionColor('premise', theme), '#i')
  assert.equal(dimensionColor('feasibility', theme), '#s')
  assert.equal(dimensionColor('counter', theme), '#e')
  assert.equal(dimensionColor('action', theme), '#w')
  assert.equal(dimensionColor('mystery', theme), '#d')
})

test('generateMindTree：结构化解析 5 维度，非法维度被过滤、问题截断到 ≤3', async () => {
  setMindTreeRaw(
    JSON.stringify({
      dimensions: [
        { key: 'concept', label: '核心概念', questions: ['q1', 'q2', 'q3', 'q4', 'q5'] },
        { key: 'premise', label: '前提与假设', questions: ['p1', 'p2'] },
        { key: 'feasibility', label: '可行性与风险', questions: ['f1'] },
        { key: 'counter', label: '反面观点', questions: ['c1'] },
        { key: 'action', label: '下一步行动', questions: ['a1'] },
        { key: '', label: '空 key', questions: ['x'] },
        { key: 'bad', label: '', questions: ['x'] },
        { key: 'bad2', label: '无问题', questions: [] },
        { key: 'bad3', label: '问题非字符串', questions: [1, 'ok'] },
      ],
    }),
  )
  const r = await aiService.generateMindTree('要不要做独立产品')
  assert.deepEqual(
    r.dimensions.map((d) => d.key),
    ['concept', 'premise', 'feasibility', 'counter', 'action', 'bad3'],
    'key/label 非空且 questions 为数组的维度保留，仅空 key/空 label/空问题的维度被过滤',
  )
  assert.equal(r.dimensions[0].questions.length, 3, '每维度问题截断到 3 条（v2.6.0 prompt 收敛为 2~3）')
  assert.deepEqual(r.dimensions[2].questions, ['f1'])
  assert.deepEqual(r.dimensions[5].questions, ['ok'], '非字符串问题被剔除，有效问题保留')
  assert.ok(
    r.dimensions.every((d) => d.questions.every((q) => typeof q === 'string' && q.trim().length > 0)),
    '问题必须是非空字符串',
  )
})

test('generateMindTree：同输入二次调用命中缓存，不再调 LLM', async () => {
  setMindTreeRaw('{"dimensions":[{"key":"concept","label":"核心概念","questions":["q1","q2"]}]}')
  const first = await aiService.generateMindTree('缓存主题')
  assert.equal(mtChatCalls, 1)
  setMindTreeRaw('{"dimensions":[{"key":"counter","label":"反面观点","questions":["另一份"]}]}')
  const second = await aiService.generateMindTree('缓存主题')
  assert.equal(mtChatCalls, 1, '命中缓存不应再次调用 LLM')
  assert.deepEqual(second, first)
  clearMindTreeCache()
  await aiService.generateMindTree('缓存主题')
  assert.equal(mtChatCalls, 2, 'clearMindTreeCache 后重新调用 LLM')
})

test('generateMindTree：缓存命中时 onPartial 立即回调全量维度', async () => {
  setMindTreeRaw('{"dimensions":[{"key":"concept","label":"核心概念","questions":["q1"]}]}')
  await aiService.generateMindTree('回调主题')
  const seen: string[][] = []
  await aiService.generateMindTree('回调主题', {
    onPartial: (dims) => seen.push(dims.map((d) => d.key)),
  })
  assert.deepEqual(seen, [['concept']], '缓存命中也应通过 onPartial 回放全量结果')
})

test('generateMindTree：LLM 硬契约 —— messages[0]=system、stream=true、模型动态获取', async () => {
  setMindTreeRaw('{"dimensions":[{"key":"concept","label":"核心概念","questions":["q"]}]}')
  await aiService.generateMindTree('主题')
  const messages = mtCaptured!.messages as Array<{ role: string; content: string }>
  assert.equal(messages[0].role, 'system')
  assert.equal(messages[0].content, MIND_TREE_SYSTEM_PROMPT)
  assert.equal(messages[1].role, 'user')
  assert.equal(mtCaptured!.stream, true)
  assert.equal(mtCaptured!.model, 'mt-model', '模型 id 来自 models.list()，不写死')
})

test('generateMindTree：用户输入截断到 4000 字', async () => {
  setMindTreeRaw('{"dimensions":[{"key":"concept","label":"核心概念","questions":["q"]}]}')
  await aiService.generateMindTree('题'.repeat(5000))
  const messages = mtCaptured!.messages as Array<{ role: string; content: string }>
  assert.equal(messages[1].content.length, 4000)
})

test('generateMindTree：AI 输出无有效维度 → 抛中文错误（页面据此降级内置模板）', async () => {
  setMindTreeRaw('{"dimensions":[]}')
  await assert.rejects(
    () => aiService.generateMindTree('主题'),
    /未能生成有效的思维分支/,
    '空维度应抛错，交由页面 catch 走 fallbackDimensions',
  )
  setMindTreeRaw('完全不是 JSON')
  await assert.rejects(() => aiService.generateMindTree('主题'), /未能生成有效的思维分支|思维/)
})

/* ------------------------------------------------------------------ *
 * extractCompletedDimensions（mindtree-parse.ts）—— 流式增量容错解析
 * ------------------------------------------------------------------ */

test('extractCompletedDimensions：完整 JSON 直接解析出全部维度', () => {
  const text = JSON.stringify({
    dimensions: [
      { key: 'concept', label: '核心概念', questions: ['q1', 'q2'] },
      { key: 'counter', label: '反面观点', questions: ['c1'] },
    ],
  })
  const dims = extractCompletedDimensions(text)
  assert.deepEqual(
    dims.map((d) => d.key),
    ['concept', 'counter'],
  )
  assert.deepEqual(dims[0].questions, ['q1', 'q2'])
})

test('extractCompletedDimensions：截断文本仅提取 questions 已闭合的维度', () => {
  const partial =
    '{"dimensions":[{"key":"concept","label":"核心概念","questions":["问题一","问题二"]},' +
    '{"key":"premise","label":"前提与假设","questions":["还没'
  const dims = extractCompletedDimensions(partial)
  assert.deepEqual(
    dims.map((d) => d.key),
    ['concept'],
    '仅第一个维度完整到达',
  )
  assert.deepEqual(dims[0].questions, ['问题一', '问题二'])
})

test('extractCompletedDimensions：非法/空输入降级为空数组且不抛异常', () => {
  assert.deepEqual(extractCompletedDimensions(''), [])
  assert.deepEqual(extractCompletedDimensions('   '), [])
  assert.deepEqual(extractCompletedDimensions('完全不是 JSON'), [])
  assert.deepEqual(extractCompletedDimensions('{"dimensions":[]}'), [])
  assert.deepEqual(extractCompletedDimensions('{"dimensions":[{"key":"","label":"x","questions":["q"]}]}'), [])
  assert.doesNotThrow(() => extractCompletedDimensions('{"dimensions":[{"key":"a","label":"b","quest'))
})

test('extractCompletedDimensions：key/label 顺序互换、问题含转义引号仍可解析', () => {
  const partial =
    '{"dimensions":[{"label":"核心概念","key":"concept","questions":["他说\\"你好\\"","第二问"]}]}'
  const dims = extractCompletedDimensions(partial)
  assert.equal(dims.length, 1)
  assert.equal(dims[0].key, 'concept')
  assert.equal(dims[0].label, '核心概念')
  assert.deepEqual(dims[0].questions, ['他说"你好"', '第二问'])
})

test('extractCompletedDimensions：空 questions / 非 dimensions 内容被过滤', () => {
  assert.deepEqual(
    extractCompletedDimensions('{"dimensions":[{"key":"a","label":"b","questions":[]}]}').map((d) => d.key),
    [],
  )
  assert.deepEqual(
    extractCompletedDimensions('{"dimensions":[{"key":"a","label":"b","questions":["  ",""]}]}').map((d) => d.key),
    [],
  )
  assert.deepEqual(extractCompletedDimensions('{"foo":1,"bar":[1,2]}'), [])
  assert.deepEqual(extractCompletedDimensions('{"dimensions":"not-array"}'), [])
  assert.deepEqual(extractCompletedDimensions('[]'), [])
  assert.deepEqual(extractCompletedDimensions('null'), [])
})

test('extractCompletedDimensions：中文引号/全角字符与反斜杠路径不抛错', () => {
  const partial =
    '{"dimensions":[{"key":"concept","label":"核心概念","questions":["他说「你好」","路径 C:\\\\tmp\\\\a.cpp 呢？"]}]}'
  const dims = extractCompletedDimensions(partial)
  assert.equal(dims.length, 1)
  assert.deepEqual(dims[0].questions, ['他说「你好」', '路径 C:\\tmp\\a.cpp 呢？'])
})

test('extractCompletedDimensions：中间维度未闭合时只取到最后一个完整维度', () => {
  const partial =
    '{"dimensions":[' +
    '{"key":"concept","label":"核心概念","questions":["q1"]},' +
    '{"key":"premise","label":"前提与假设","questions":["p1","p2"]},' +
    '{"key":"feasibility","label":"可行性与风险","questions":["还'
  const dims = extractCompletedDimensions(partial)
  assert.deepEqual(
    dims.map((d) => d.key),
    ['concept', 'premise'],
  )
  assert.deepEqual(dims[1].questions, ['p1', 'p2'])
})
