/**
 * web/src/services/mindforest-cloud.ts 纯函数单元测试（云端同步合并策略）。
 * 覆盖：isEmptyForestStore / latestUpdatedAt / mergeForestStores 的「最近写入优先」与
 * 「本地空 → 云端 vs 主动清空」判定。
 * 运行方式：node qa/run-tests.mjs（esbuild bundle 后 node:test）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTree } from '../web/src/services/mindforest-store'
import {
  isEmptyForestStore,
  latestUpdatedAt,
  mergeForestStores,
} from '../web/src/services/mindforest-cloud'
import type { MindForestStore, MindTree } from '../shared/types/domain'

/** 构造带指定 id/name/updatedAt 的树（便于稳定比较时间戳）。 */
function treeAt(id: string, name: string, updatedAt: string): MindTree {
  const t = createTree(name)
  t.id = id
  t.createdAt = updatedAt
  t.updatedAt = updatedAt
  return t
}

function store(trees: MindTree[]): MindForestStore {
  return { version: 1, trees, forests: [], crossLinks: [] }
}

const EMPTY: MindForestStore = { version: 1, trees: [], forests: [], crossLinks: [] }

test('isEmptyForestStore：空文档判定', () => {
  assert.equal(isEmptyForestStore(EMPTY), true)
  assert.equal(isEmptyForestStore(store([treeAt('a', 'A', '2026-01-01T00:00:00.000Z')])), false)
})

test('latestUpdatedAt：取树/树林/交叉链接时间戳最大值', () => {
  const a = treeAt('a', 'A', '2026-01-01T00:00:00.000Z')
  const b = treeAt('b', 'B', '2026-03-01T00:00:00.000Z')
  assert.equal(latestUpdatedAt(store([a, b])), '2026-03-01T00:00:00.000Z')
  assert.equal(latestUpdatedAt(EMPTY), '')
})

test('mergeForestStores：云端空、本地非空 → 本地（推云）', () => {
  const local = store([treeAt('a', 'A', '2026-01-01T00:00:00.000Z')])
  const r = mergeForestStores(local, EMPTY, false)
  assert.equal(r.source, 'local')
  assert.equal(r.store, local)
})

test('mergeForestStores：本地空、云端非空、未同步过（新设备/清缓存）→ 云端', () => {
  const cloud = store([treeAt('a', 'A', '2026-01-01T00:00:00.000Z')])
  const r = mergeForestStores(EMPTY, cloud, false)
  assert.equal(r.source, 'cloud')
  assert.equal(r.store, cloud)
})

test('mergeForestStores：本地空、云端非空、已同步过（用户主动清空）→ 本地（推空，避免云端复活）', () => {
  const cloud = store([treeAt('a', 'A', '2026-01-01T00:00:00.000Z')])
  const r = mergeForestStores(EMPTY, cloud, true)
  assert.equal(r.source, 'local')
  assert.equal(r.store, EMPTY)
})

test('mergeForestStores：双方空 → 本地', () => {
  const r = mergeForestStores(EMPTY, EMPTY, false)
  assert.equal(r.source, 'local')
  assert.equal(r.store, EMPTY)
})

test('mergeForestStores：双方非空 → 最近写入优先', () => {
  const newerCloud = store([treeAt('a', 'A', '2026-05-01T00:00:00.000Z')])
  const olderLocal = store([treeAt('b', 'B', '2026-01-01T00:00:00.000Z')])
  assert.equal(mergeForestStores(olderLocal, newerCloud, true).source, 'cloud')

  const newerLocal = store([treeAt('c', 'C', '2026-06-01T00:00:00.000Z')])
  const olderCloud = store([treeAt('d', 'D', '2026-02-01T00:00:00.000Z')])
  assert.equal(mergeForestStores(newerLocal, olderCloud, true).source, 'local')
})

test('mergeForestStores：双方非空、时间戳相同/云端不可比较 → 偏本地（避免覆盖当前会话）', () => {
  const same = '2026-01-01T00:00:00.000Z'
  const local = store([treeAt('a', 'A', same)])
  const cloud = store([treeAt('b', 'B', same)])
  assert.equal(mergeForestStores(local, cloud, true).source, 'local')
})
