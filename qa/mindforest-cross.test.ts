/**
 * web/src/services/mindforest-cross.ts 单元测试（纯函数）。
 * 覆盖：展平编号 / prompt 构造 / 抽样截断 / 解析容错与去重。
 * 运行方式：node qa/run-tests.mjs（esbuild bundle 后 node:test）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createNode } from '../web/src/components/mindtree/dimensions'
import { createTree } from '../web/src/services/mindforest-store'
import {
  buildCrossUserPrompt,
  flattenForestNodes,
  parseCrossLinkSuggestions,
  sampleNodes,
} from '../web/src/services/mindforest-cross'
import type { MindTree } from '../shared/types/domain'

/** 构造两棵带子节点的树。 */
function twoTrees(): MindTree[] {
  const a = createTree('要不要做副业')
  a.root.children = [createNode('核心概念有哪些'), createNode('最大的风险是什么')]
  const b = createTree('时间管理')
  b.root.children = [createNode('如何用最小成本验证方向')]
  return [a, b]
}

test('flattenForestNodes：前序含根、编号稳定、label 截断到 80 字', () => {
  const [a, b] = twoTrees()
  const flat = flattenForestNodes([a, b])
  assert.equal(flat.length, 5, '2 根 + 3 子')
  assert.deepEqual(
    flat.map((n) => `t${n.treeIndex}-n${n.nodeIndex}`),
    ['t0-n0', 't0-n1', 't0-n2', 't1-n0', 't1-n1'],
  )
  assert.equal(flat[0].treeId, a.id)
  assert.equal(flat[0].nodeId, a.root.id)
  assert.equal(flat[3].treeId, b.id)
  assert.equal(flat[3].nodeId, b.root.id)

  const long = createTree('主题')
  long.root.children = [createNode('长'.repeat(200))]
  const flatLong = flattenForestNodes([long])
  assert.equal(flatLong[1].label.length, 81, '80 字 + 省略号')
  assert.ok(flatLong[1].label.endsWith('…'))
})

test('buildCrossUserPrompt：按树分组输出编号清单', () => {
  const [a, b] = twoTrees()
  const flat = flattenForestNodes([a, b])
  const text = buildCrossUserPrompt([a, b], flat)
  assert.ok(text.includes('树林中的节点清单'))
  assert.ok(text.includes(`t0: 树「${a.name}」`))
  assert.ok(text.includes(`t1: 树「${b.name}」`))
  assert.ok(text.includes('t0-n0: 要不要做副业'))
  assert.ok(text.includes('t1-n0: 时间管理'))
  assert.ok(text.includes('t1-n1: 如何用最小成本验证方向'))
})

test('sampleNodes：未超上限原样返回，超上限均匀抽样到 ≤max', () => {
  const trees: MindTree[] = []
  for (let i = 0; i < 3; i++) {
    const t = createTree(`树${i}`)
    t.root.children = Array.from({ length: 10 }, (_, k) => createNode(`n${i}-${k}`))
    trees.push(t)
  }
  const flat = flattenForestNodes(trees)
  assert.equal(flat.length, 33, '3 根 + 30 子')
  assert.equal(sampleNodes(flat, 200), flat)

  const sampled = sampleNodes(flat, 5)
  assert.equal(sampled.length, 5)
  assert.ok(sampled[0].nodeIndex === 0)
})

test('parseCrossLinkSuggestions：合法编号映射为 treeId/nodeId', () => {
  const [a, b] = twoTrees()
  const flat = flattenForestNodes([a, b])
  const raw = JSON.stringify([
    { a: 't0-n1', b: 't1-n0', reason: '都关乎验证方向' },
    { a: 't0-n2', b: 't1-n1', reason: '风险与小步验证' },
  ])
  const out = parseCrossLinkSuggestions(raw, flat)
  assert.equal(out.length, 2)
  assert.equal(out[0].a.treeId, a.id)
  assert.equal(out[0].a.nodeId, a.root.children[0].id)
  assert.equal(out[0].b.treeId, b.id)
  assert.equal(out[0].b.nodeId, b.root.id)
  assert.equal(out[0].reason, '都关乎验证方向')
})

test('parseCrossLinkSuggestions：丢弃同树端点、未知/越界编号', () => {
  const [a, b] = twoTrees()
  const flat = flattenForestNodes([a, b])
  const raw = JSON.stringify([
    { a: 't0-n0', b: 't0-n1', reason: '同树' }, // 同树 → 丢弃
    { a: 't0-n0', b: 't9-n9', reason: '越界' }, // 越界 → 丢弃
    { a: 't0-n0', b: 't1-n0', reason: '合法' },
    { a: 'bad', b: 't1-n0', reason: '非法编号' }, // 非法 → 丢弃
  ])
  const out = parseCrossLinkSuggestions(raw, flat)
  assert.equal(out.length, 1)
  assert.equal(out[0].reason, '合法')
})

test('parseCrossLinkSuggestions：markdown 围栏/杂文本容错', () => {
  const [a, b] = twoTrees()
  const flat = flattenForestNodes([a, b])
  const raw = '好的，结果如下：\n```json\n[{"a":"t0-n0","b":"t1-n0","reason":"关联"}]\n```\n以上。'
  const out = parseCrossLinkSuggestions(raw, flat)
  assert.equal(out.length, 1)
  assert.equal(out[0].reason, '关联')
})

test('parseCrossLinkSuggestions：无序对去重（同对只保留一条）', () => {
  const [a, b] = twoTrees()
  const flat = flattenForestNodes([a, b])
  const raw = JSON.stringify([
    { a: 't0-n0', b: 't1-n0', reason: '第一条' },
    { a: 't1-n0', b: 't0-n0', reason: '反向重复' },
  ])
  const out = parseCrossLinkSuggestions(raw, flat)
  assert.equal(out.length, 1)
  assert.equal(out[0].reason, '第一条')
})

test('parseCrossLinkSuggestions：非法/空输入降级空数组且不抛异常', () => {
  const flat = flattenForestNodes(twoTrees())
  assert.deepEqual(parseCrossLinkSuggestions('', flat), [])
  assert.deepEqual(parseCrossLinkSuggestions('完全不是 JSON', flat), [])
  assert.deepEqual(parseCrossLinkSuggestions('{"a":1}', flat), [])
  assert.doesNotThrow(() => parseCrossLinkSuggestions('{截断', flat))
})
