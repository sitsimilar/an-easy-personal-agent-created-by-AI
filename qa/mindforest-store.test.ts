/**
 * web/src/services/mindforest-store.ts 单元测试（纯逻辑 + localStorage 持久化）。
 * 覆盖：迁移/校验/级联/交叉判定/去重/CRUD。
 * 运行方式：node qa/run-tests.mjs（esbuild bundle 后 node:test）。
 */
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createNode } from '../web/src/components/mindtree/dimensions'
import {
  MIND_FOREST_STORAGE_KEY,
  addSuggestedCrossLinks,
  addTreeToForest,
  confirmCrossLink,
  confirmedLinksOf,
  createForest,
  createTree,
  crossNodeKeysOf,
  crossPartnersOf,
  deleteForest,
  deleteTree,
  emptyForestStore,
  ignoreCrossLink,
  isCrossNode,
  loadForestStore,
  pruneNodeCrossLinks,
  removeTreeFromForest,
  renameForest,
  renameTree,
  saveForestStore,
  upsertTree,
  validateForestStore,
} from '../web/src/services/mindforest-store'
import type { MindForestStore, MindTree } from '../shared/types/domain'

const LEGACY_KEY = 'personal-agent.mindtree.v1'

/** 最小 localStorage 存根。 */
class LocalStorageStub {
  private map = new Map<string, string>()
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value))
  }
  removeItem(key: string): void {
    this.map.delete(key)
  }
}

let storage: LocalStorageStub

beforeEach(() => {
  storage = new LocalStorageStub()
  ;(globalThis as Record<string, unknown>).localStorage = storage
})

afterEach(() => {
  delete (globalThis as Record<string, unknown>).localStorage
})

/** 构造两棵带子节点的树，用于交叉/级联测试。 */
function twoTrees(): MindTree[] {
  const a = createTree('要不要做副业')
  a.root.children = [createNode('核心概念有哪些'), createNode('最大的风险是什么')]
  const b = createTree('时间管理')
  b.root.children = [createNode('如何用最小成本验证方向'), createNode('本周能完成哪一小步')]
  return [a, b]
}

/* ------------------------------------------------------------------ *
 * 工厂 / CRUD
 * ------------------------------------------------------------------ */

test('emptyForestStore：version=1 且三数组为空', () => {
  const s = emptyForestStore()
  assert.equal(s.version, 1)
  assert.deepEqual(s.trees, [])
  assert.deepEqual(s.forests, [])
  assert.deepEqual(s.crossLinks, [])
})

test('createTree：name 即根节点文本，时间戳为 ISO', () => {
  const t = createTree('  独立产品  ')
  assert.equal(t.name, '独立产品')
  assert.equal(t.root.text, '独立产品')
  assert.ok(t.id.length > 0)
  assert.ok(!Number.isNaN(Date.parse(t.createdAt)))
  assert.equal(t.createdAt, t.updatedAt)
})

test('createForest / renameForest / addTreeToForest / removeTreeFromForest', () => {
  const [a, b] = twoTrees()
  let s: MindForestStore = { version: 1, trees: [a, b], forests: [], crossLinks: [] }
  const f = createForest('工作流', [a.id])
  s = { ...s, forests: [f] }
  assert.deepEqual(s.forests[0].treeIds, [a.id])

  s = renameForest(s, f.id, ' 新名字 ')
  assert.equal(s.forests[0].name, '新名字')

  s = addTreeToForest(s, f.id, b.id)
  assert.deepEqual(s.forests[0].treeIds, [a.id, b.id])

  s = removeTreeFromForest(s, f.id, b.id)
  assert.deepEqual(s.forests[0].treeIds, [a.id])
})

test('deleteForest：只删组群与它的 crossLinks，不删树', () => {
  const [a, b] = twoTrees()
  const f = createForest('f', [a.id, b.id])
  let s: MindForestStore = {
    version: 1,
    trees: [a, b],
    forests: [f],
    crossLinks: [
      {
        id: 'l1',
        forestId: f.id,
        a: { treeId: a.id, nodeId: a.root.id },
        b: { treeId: b.id, nodeId: b.root.id },
        status: 'confirmed',
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    ],
  }
  s = deleteForest(s, f.id)
  assert.equal(s.forests.length, 0)
  assert.equal(s.crossLinks.length, 0)
  assert.equal(s.trees.length, 2, '树不被删除')
})

/* ------------------------------------------------------------------ *
 * 迁移 / 校验 / 加载
 * ------------------------------------------------------------------ */

test('loadForestStore：legacy 单树迁移为 trees[0]（topic → name），并保留 legacy 备份', () => {
  const legacy = {
    id: 'd1',
    topic: '旧主题',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
    root: { id: 'r', text: '旧主题', collapsed: false, loading: true, children: [] },
  }
  storage.setItem(LEGACY_KEY, JSON.stringify(legacy))
  const s = loadForestStore()
  assert.equal(s.trees.length, 1)
  assert.equal(s.trees[0].id, 'd1')
  assert.equal(s.trees[0].name, '旧主题', 'topic → name')
  assert.equal(s.trees[0].root.loading, false, 'root 归一化 loading 复位')
  // 写回新键 + 保留 legacy
  assert.ok(storage.getItem(MIND_FOREST_STORAGE_KEY))
  assert.ok(storage.getItem(LEGACY_KEY), 'legacy 保留作备份')
})

test('loadForestStore：无数据返回空 store', () => {
  const s = loadForestStore()
  assert.equal(s.version, 1)
  assert.deepEqual(s.trees, [])
  assert.deepEqual(s.forests, [])
  assert.deepEqual(s.crossLinks, [])
})

test('loadForestStore：新键优先于 legacy（不重复迁移）', () => {
  storage.setItem(
    MIND_FOREST_STORAGE_KEY,
    JSON.stringify({ version: 1, trees: [], forests: [], crossLinks: [] }),
  )
  storage.setItem(
    LEGACY_KEY,
    JSON.stringify({ id: 'x', topic: '不该出现', root: { id: 'r', text: 't' } }),
  )
  const s = loadForestStore()
  assert.equal(s.trees.length, 0, '新键存在时忽略 legacy')
})

test('loadForestStore：新键非法 → 备份到 .bak 并回空（legacy 仍可迁移）', () => {
  storage.setItem(MIND_FOREST_STORAGE_KEY, '{坏 JSON')
  storage.setItem(
    LEGACY_KEY,
    JSON.stringify({ id: 'd1', topic: '迁移主题', root: { id: 'r', text: '迁移主题' } }),
  )
  const s = loadForestStore()
  assert.equal(s.trees.length, 1)
  assert.equal(s.trees[0].name, '迁移主题')
  assert.ok(storage.getItem(`${MIND_FOREST_STORAGE_KEY}.bak`), '非法数据已备份')
})

test('validateForestStore：过滤同树/悬挂树/悬挂节点/非法 status/引用已删森林的链接', () => {
  const [a, b] = twoTrees()
  const c = createTree('第三棵')
  const f = createForest('f', [a.id, b.id])
  const input: unknown = {
    version: 1,
    trees: [a, b],
    forests: [f],
    crossLinks: [
      // 合法
      { id: 'ok', forestId: f.id, a: { treeId: a.id, nodeId: a.root.id }, b: { treeId: b.id, nodeId: b.root.id }, status: 'confirmed', createdAt: 'x' },
      // 同树
      { id: 'same', forestId: f.id, a: { treeId: a.id, nodeId: a.root.id }, b: { treeId: a.id, nodeId: a.root.children[0].id }, status: 'confirmed', createdAt: 'x' },
      // 引用已删树
      { id: 'gone', forestId: f.id, a: { treeId: a.id, nodeId: a.root.id }, b: { treeId: 'nope', nodeId: 'x' }, status: 'confirmed', createdAt: 'x' },
      // 引用已删节点
      { id: 'goneNode', forestId: f.id, a: { treeId: a.id, nodeId: 'no-node' }, b: { treeId: b.id, nodeId: b.root.id }, status: 'confirmed', createdAt: 'x' },
      // 非法 status
      { id: 'badStatus', forestId: f.id, a: { treeId: a.id, nodeId: a.root.id }, b: { treeId: b.id, nodeId: b.root.id }, status: 'weird', createdAt: 'x' },
      // 引用已删森林
      { id: 'goneForest', forestId: 'no-forest', a: { treeId: a.id, nodeId: a.root.id }, b: { treeId: b.id, nodeId: b.root.id }, status: 'confirmed', createdAt: 'x' },
    ],
  }
  const out = validateForestStore(input)
  assert.ok(out)
  assert.equal(out.crossLinks.length, 1, '仅保留合法链接')
  assert.equal(out.crossLinks[0].id, 'ok')
  // forests 过滤不存在的 treeId
  assert.deepEqual(out.forests[0].treeIds, [a.id, b.id])
  assert.equal(out.trees.length, 2)
  // 第三棵树 c 未在 input.trees 中，不产生副作用
  assert.ok(c)
})

test('validateForestStore：version 非 1 / 三数组缺失 → null', () => {
  assert.equal(validateForestStore(null), null)
  assert.equal(validateForestStore({ version: 2, trees: [], forests: [], crossLinks: [] }), null)
  assert.equal(validateForestStore({ version: 1, trees: 'x', forests: [], crossLinks: [] }), null)
  assert.equal(validateForestStore({ version: 1, trees: [], forests: [], crossLinks: 'x' }), null)
  assert.equal(validateForestStore({ version: 1, trees: [{}], forests: [], crossLinks: [] }), null)
})

test('saveForestStore：写失败静默不抛', () => {
  storage.setItem = () => {
    throw new Error('QuotaExceeded')
  }
  assert.doesNotThrow(() => saveForestStore(emptyForestStore()))
})

test('无 localStorage 环境：load/save 安全降级不抛', () => {
  delete (globalThis as Record<string, unknown>).localStorage
  assert.deepEqual(loadForestStore().trees, [])
  assert.doesNotThrow(() => saveForestStore(emptyForestStore()))
})

/* ------------------------------------------------------------------ *
 * 级联
 * ------------------------------------------------------------------ */

test('deleteTree：清理 forests.treeIds + 该树 crossLinks + 空森林', () => {
  const [a, b] = twoTrees()
  const f = createForest('f', [a.id, b.id])
  let s: MindForestStore = {
    version: 1,
    trees: [a, b],
    forests: [f],
    crossLinks: [
      { id: 'l1', forestId: f.id, a: { treeId: a.id, nodeId: a.root.id }, b: { treeId: b.id, nodeId: b.root.id }, status: 'confirmed', createdAt: 'x' },
    ],
  }
  s = deleteTree(s, a.id)
  assert.equal(s.trees.length, 1)
  assert.deepEqual(s.forests[0].treeIds, [b.id], '森林移除被删树')
  assert.equal(s.crossLinks.length, 0, '引用被删树的交叉链接被清理')
})

test('deleteTree：森林变空则删森林', () => {
  const a = createTree('唯一')
  const f = createForest('f', [a.id])
  let s: MindForestStore = { version: 1, trees: [a], forests: [f], crossLinks: [] }
  s = deleteTree(s, a.id)
  assert.equal(s.forests.length, 0)
})

test('removeTreeFromForest：级联删除该森林下引用该树的 crossLinks', () => {
  const [a, b] = twoTrees()
  const f = createForest('f', [a.id, b.id])
  let s: MindForestStore = {
    version: 1,
    trees: [a, b],
    forests: [f],
    crossLinks: [
      { id: 'l1', forestId: f.id, a: { treeId: a.id, nodeId: a.root.id }, b: { treeId: b.id, nodeId: b.root.id }, status: 'confirmed', createdAt: 'x' },
    ],
  }
  s = removeTreeFromForest(s, f.id, a.id)
  assert.deepEqual(s.forests[0].treeIds, [b.id])
  assert.equal(s.crossLinks.length, 0)
})

test('pruneNodeCrossLinks：删除节点时清理引用该节点的交叉链接', () => {
  const [a, b] = twoTrees()
  const f = createForest('f', [a.id, b.id])
  const nodeA = a.root.children[0]
  let s: MindForestStore = {
    version: 1,
    trees: [a, b],
    forests: [f],
    crossLinks: [
      { id: 'l1', forestId: f.id, a: { treeId: a.id, nodeId: nodeA.id }, b: { treeId: b.id, nodeId: b.root.id }, status: 'confirmed', createdAt: 'x' },
      { id: 'l2', forestId: f.id, a: { treeId: a.id, nodeId: a.root.children[1].id }, b: { treeId: b.id, nodeId: b.root.id }, status: 'confirmed', createdAt: 'x' },
    ],
  }
  s = pruneNodeCrossLinks(s, a.id, nodeA.id)
  assert.equal(s.crossLinks.length, 1)
  assert.equal(s.crossLinks[0].id, 'l2')
})

/* ------------------------------------------------------------------ *
 * 交叉判定
 * ------------------------------------------------------------------ */

test('isCrossNode：仅 confirmed 生效，suggested 不算交叉', () => {
  const [a, b] = twoTrees()
  const f = createForest('f', [a.id, b.id])
  let s: MindForestStore = {
    version: 1,
    trees: [a, b],
    forests: [f],
    crossLinks: [
      { id: 'sg', forestId: f.id, a: { treeId: a.id, nodeId: a.root.id }, b: { treeId: b.id, nodeId: b.root.id }, status: 'suggested', createdAt: 'x' },
    ],
  }
  assert.equal(isCrossNode(s, f.id, a.id, a.root.id), false, 'suggested 不生效')
  s = confirmCrossLink(s, 'sg')
  assert.equal(isCrossNode(s, f.id, a.id, a.root.id), true)
  assert.equal(isCrossNode(s, f.id, b.id, b.root.id), true)
  assert.equal(isCrossNode(s, f.id, a.id, a.root.children[0].id), false)
})

test('crossPartnersOf：反查树名/节点文本/理由；伙伴节点已删则跳过', () => {
  const [a, b] = twoTrees()
  const f = createForest('f', [a.id, b.id])
  const aChild = a.root.children[0]
  let s: MindForestStore = {
    version: 1,
    trees: [a, b],
    forests: [f],
    crossLinks: [
      { id: 'l1', forestId: f.id, a: { treeId: a.id, nodeId: aChild.id }, b: { treeId: b.id, nodeId: b.root.id }, status: 'confirmed', reason: '相关', createdAt: 'x' },
    ],
  }
  const partners = crossPartnersOf(s, f.id, a.id, aChild.id)
  assert.equal(partners.length, 1)
  assert.equal(partners[0].treeName, b.name)
  assert.equal(partners[0].nodeText, b.root.text)
  assert.equal(partners[0].reason, '相关')

  // 删除伙伴节点后：store 级联已清链接（双保险：反查不到跳过）
  s = pruneNodeCrossLinks(s, b.id, b.root.id)
  assert.equal(crossPartnersOf(s, f.id, a.id, aChild.id).length, 0)
})

test('crossNodeKeysOf：返回 `treeId/nodeId` 集合', () => {
  const [a, b] = twoTrees()
  const f = createForest('f', [a.id, b.id])
  const s: MindForestStore = {
    version: 1,
    trees: [a, b],
    forests: [f],
    crossLinks: [
      { id: 'l1', forestId: f.id, a: { treeId: a.id, nodeId: a.root.id }, b: { treeId: b.id, nodeId: b.root.id }, status: 'confirmed', createdAt: 'x' },
    ],
  }
  const keys = crossNodeKeysOf(s, f.id)
  assert.equal(keys.size, 2)
  assert.ok(keys.has(`${a.id}/${a.root.id}`))
  assert.ok(keys.has(`${b.id}/${b.root.id}`))
})

/* ------------------------------------------------------------------ *
 * 去重 / 确认 / 忽略
 * ------------------------------------------------------------------ */

test('addSuggestedCrossLinks：无序对去重、跳过同树端点、不重复插入', () => {
  const [a, b] = twoTrees()
  const f = createForest('f', [a.id, b.id])
  let s: MindForestStore = { version: 1, trees: [a, b], forests: [f], crossLinks: [] }
  s = addSuggestedCrossLinks(s, f.id, [
    { a: { treeId: a.id, nodeId: a.root.id }, b: { treeId: b.id, nodeId: b.root.id }, reason: 'r1' },
    // 反向无序对 → 去重
    { a: { treeId: b.id, nodeId: b.root.id }, b: { treeId: a.id, nodeId: a.root.id }, reason: 'r2' },
    // 同树 → 跳过
    { a: { treeId: a.id, nodeId: a.root.id }, b: { treeId: a.id, nodeId: a.root.children[0].id }, reason: 'r3' },
  ])
  assert.equal(s.crossLinks.length, 1)
  assert.equal(s.crossLinks[0].status, 'suggested')
  assert.equal(s.crossLinks[0].reason, 'r1')

  // 再次加入同对不重复
  s = addSuggestedCrossLinks(s, f.id, [
    { a: { treeId: a.id, nodeId: a.root.id }, b: { treeId: b.id, nodeId: b.root.id }, reason: 'r4' },
  ])
  assert.equal(s.crossLinks.length, 1)
})

test('confirmCrossLink / ignoreCrossLink：状态流转与删除', () => {
  const [a, b] = twoTrees()
  const f = createForest('f', [a.id, b.id])
  let s: MindForestStore = {
    version: 1,
    trees: [a, b],
    forests: [f],
    crossLinks: [
      { id: 'l1', forestId: f.id, a: { treeId: a.id, nodeId: a.root.id }, b: { treeId: b.id, nodeId: b.root.id }, status: 'suggested', createdAt: 'x' },
    ],
  }
  assert.equal(confirmedLinksOf(s, f.id).length, 0)
  s = confirmCrossLink(s, 'l1')
  assert.equal(s.crossLinks[0].status, 'confirmed')
  assert.equal(confirmedLinksOf(s, f.id).length, 1)
  s = ignoreCrossLink(s, 'l1')
  assert.equal(s.crossLinks.length, 0)
})

test('upsertTree / renameTree：更新 name 与 root，未命中追加', () => {
  const a = createTree('旧名')
  let s: MindForestStore = { version: 1, trees: [a], forests: [], crossLinks: [] }
  s = renameTree(s, a.id, ' 新名 ')
  assert.equal(s.trees[0].name, '新名')

  const updated = { ...s.trees[0], root: { ...s.trees[0].root, text: '改根' } }
  s = upsertTree(s, updated)
  assert.equal(s.trees[0].root.text, '改根')

  const extra = createTree('追加')
  s = upsertTree(s, extra)
  assert.equal(s.trees.length, 2)
})

test('根节点手动添加思考点：空树根可追加无维度节点并持久化（handleAdd 数据效果）', () => {
  const tree = createTree('要不要养猫')
  assert.equal(tree.root.children.length, 0) // 新建空树根无子节点

  // 模拟 MindTreePage.handleAdd 对根节点的数据效果：追加一个手输思考点（不带 dimension）
  const added = createNode('养猫需要每天铲屎')
  assert.equal(added.text, '养猫需要每天铲屎')
  assert.equal(added.dimension, undefined) // 手动节点无维度，走中性展示

  const updated: MindTree = { ...tree, root: { ...tree.root, children: [...tree.root.children, added] } }
  const s = upsertTree({ version: 1, trees: [tree], forests: [], crossLinks: [] }, updated)
  assert.equal(s.trees[0].root.children.length, 1)
  assert.equal(s.trees[0].root.children[0].text, '养猫需要每天铲屎')
  assert.equal(s.trees[0].root.children[0].dimension, undefined)

  // 持久化往返：save → load 后手动节点仍在
  saveForestStore(s)
  const loaded = loadForestStore()
  assert.equal(loaded.trees[0].root.children.length, 1)
  assert.equal(loaded.trees[0].root.children[0].text, '养猫需要每天铲屎')
})
