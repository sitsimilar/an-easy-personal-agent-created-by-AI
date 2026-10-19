/**
 * shared/utils/llm.ts 单元测试
 * 覆盖：collectStream() 与 parseJsonLoose() 的纯逻辑行为。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collectStream, parseJsonLoose } from '../shared/utils/llm'

/** 便捷构造异步迭代器（模拟 SDK 流式响应）。 */
async function* streamOf(...chunks: unknown[]): AsyncIterable<unknown> {
  for (const c of chunks) yield c
}

/* ------------------------------------------------------------------ *
 * collectStream
 * ------------------------------------------------------------------ */

test('collectStream：跨 chunk 累积 delta.content', async () => {
  const s = streamOf(
    { choices: [{ delta: { content: '你' } }] },
    { choices: [{ delta: { content: '好' } }] },
    { choices: [{ delta: { content: '！' } }] },
  )
  const out = await collectStream(s)
  assert.equal(out, '你好！')
})

test('collectStream：跳过空字符串 delta', async () => {
  const s = streamOf(
    { choices: [{ delta: { content: 'a' } }] },
    { choices: [{ delta: { content: '' } }] },
    { choices: [{ delta: { content: 'b' } }] },
  )
  assert.equal(await collectStream(s), 'ab')
})

test('collectStream：跳过仅含 role 的帧（无 content）', async () => {
  const s = streamOf(
    { choices: [{ delta: { role: 'assistant', content: '' } }] },
    { choices: [{ delta: { role: 'assistant' } }] },
    { choices: [{ delta: { content: 'x' } }] },
  )
  assert.equal(await collectStream(s), 'x')
})

test('collectStream：跳过 content 为 null 的帧', async () => {
  const s = streamOf(
    { choices: [{ delta: { content: null } }] },
    { choices: [{ delta: { content: 'ok' } }] },
  )
  assert.equal(await collectStream(s), 'ok')
})

test('collectStream：跳过无 choices 的帧', async () => {
  const s = streamOf({}, { choices: [] }, { choices: [{ delta: { content: 'z' } }] })
  assert.equal(await collectStream(s), 'z')
})

test('collectStream：空流返回空串', async () => {
  assert.equal(await collectStream(streamOf()), '')
})

test('collectStream：onDelta 按顺序收到每个非空增量', async () => {
  const seen: string[] = []
  const s = streamOf(
    { choices: [{ delta: { content: '1' } }] },
    { choices: [{ delta: { content: '' } }] },
    { choices: [{ delta: { content: '2' } }] },
  )
  const out = await collectStream(s, (t) => seen.push(t))
  assert.equal(out, '12')
  assert.deepEqual(seen, ['1', '2'])
})

/* ------------------------------------------------------------------ *
 * parseJsonLoose
 * ------------------------------------------------------------------ */

test('parseJsonLoose：直接解析对象', () => {
  assert.deepEqual(parseJsonLoose('{"a":1,"b":"x"}'), { a: 1, b: 'x' })
})

test('parseJsonLoose：直接解析数组', () => {
  assert.deepEqual(parseJsonLoose('[1,2,3]'), [1, 2, 3])
})

test('parseJsonLoose：剥离 ```json 围栏', () => {
  const input = '```json\n{"category":"技术/AI"}\n```'
  assert.deepEqual(parseJsonLoose(input), { category: '技术/AI' })
})

test('parseJsonLoose：剥离无语言标识围栏', () => {
  const input = '```\n[{"a":1}]\n```'
  assert.deepEqual(parseJsonLoose(input), [{ a: 1 }])
})

test('parseJsonLoose：剥离大写 JSON 围栏', () => {
  const input = '```JSON\n{"ok":true}\n```'
  assert.deepEqual(parseJsonLoose(input), { ok: true })
})

test('parseJsonLoose：截取前后杂文本中的对象', () => {
  const input = '好的，结果如下：\n{"a":1}\n以上就是全部内容。'
  assert.deepEqual(parseJsonLoose(input), { a: 1 })
})

test('parseJsonLoose：截取首个对象（忽略更靠后的对象）', () => {
  const input = '前缀 {"first":1} 中间 {"second":2}'
  assert.deepEqual(parseJsonLoose(input), { first: 1 })
})

test('parseJsonLoose：截取首个数组（含前后文本）', () => {
  const input = '结果是 [{"x":1},{"x":2}] 结束'
  assert.deepEqual(parseJsonLoose(input), [{ x: 1 }, { x: 2 }])
})

test('parseJsonLoose：对象与数组同时出现时取更靠前者', () => {
  const input = '[1] {"a":2}'
  assert.deepEqual(parseJsonLoose(input), [1])
})

test('parseJsonLoose：正确处理嵌套对象', () => {
  assert.deepEqual(parseJsonLoose('{"a":{"b":{"c":3}}}'), { a: { b: { c: 3 } } })
})

test('parseJsonLoose：字符串值内含有花括号与引号', () => {
  assert.deepEqual(parseJsonLoose('{"a":"b}c\\\"d"}'), { a: 'b}c"d' })
})

test('parseJsonLoose：对象内嵌套数组', () => {
  assert.deepEqual(parseJsonLoose('{"items":[1,2,{"n":3}]}'), { items: [1, 2, { n: 3 }] })
})

test('parseJsonLoose：数组内嵌套对象', () => {
  assert.deepEqual(parseJsonLoose('[{"a":1},{"a":2}]'), [{ a: 1 }, { a: 2 }])
})

test('parseJsonLoose：非法 JSON 返回 null', () => {
  assert.equal(parseJsonLoose('{bad json}'), null)
})

test('parseJsonLoose：空串返回 null', () => {
  assert.equal(parseJsonLoose(''), null)
})

test('parseJsonLoose：仅空白返回 null', () => {
  assert.equal(parseJsonLoose('   \n\t '), null)
})

test('parseJsonLoose：无任何花括号/方括号返回 null', () => {
  assert.equal(parseJsonLoose('没有任何结构化内容'), null)
})

test('parseJsonLoose：括号不闭合返回 null', () => {
  assert.equal(parseJsonLoose('{"a":1'), null)
})

test('parseJsonLoose：尾部多余逗号（非法）返回 null', () => {
  assert.equal(parseJsonLoose('{"a":1,}'), null)
})

test('parseJsonLoose：围栏之后还有额外内容仍取围栏内 JSON', () => {
  const input = '```json\n{"a":1}\n``` 之后 {"b":2}'
  // 围栏内的 {"a":1} 应被优先解析
  assert.deepEqual(parseJsonLoose(input), { a: 1 })
})
