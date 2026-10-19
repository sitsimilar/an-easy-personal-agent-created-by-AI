/**
 * web/src/services/recordService.ts 单元测试（CRUD / search / stats / counts / saveLinks）。
 * cloud.database 已由 qa/mocks/cloud.ts 替换。
 */
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { __setDbResult, __resetDbCalls, __dbCalls } from './mocks/cloud'
import { recordService } from '../web/src/services/recordService'
import type { RecordsRow } from '../web/src/lib/database.types'

function makeRow(over: Partial<RecordsRow> = {}): RecordsRow {
  return {
    id: 1,
    owner_id: 'u1',
    type: 'idea',
    title: '标题',
    content: '内容',
    url: null,
    file_path: null,
    category: null,
    tags: [],
    summary: null,
    todo_status: null,
    priority: null,
    remind_at: null,
    is_deleted: false,
    deleted_at: null,
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
    ...over,
  }
}

beforeEach(() => {
  __resetDbCalls()
})

test('createRecord：插入后返回 camelCase 映射的 InfoRecord', async () => {
  __setDbResult({ data: [makeRow({ id: 7, title: '新想法' })] })
  const r = await recordService.createRecord({ type: 'idea', title: '新想法', content: 'c' })
  assert.equal(r.id, 7)
  assert.equal(r.title, '新想法')
  assert.equal(r.isDeleted, false)
})

test('updateRecord / patchRecord：更新后返回映射结果', async () => {
  __setDbResult({ data: [makeRow({ id: 3, title: '改后' })] })
  const u = await recordService.updateRecord(3, { title: '改后' })
  assert.equal(u.title, '改后')

  __setDbResult({ data: [makeRow({ id: 3, summary: '摘要' })] })
  const p = await recordService.patchRecord(3, { summary: '摘要' })
  assert.equal(p.summary, '摘要')
})

test('softDelete / restore / hardDelete：成功不抛错', async () => {
  __setDbResult({ data: [makeRow()] })
  await recordService.softDelete(1)
  __setDbResult({ data: [makeRow()] })
  await recordService.restore(1)
  __setDbResult({ data: [makeRow()] })
  await recordService.hardDelete(1)
  assert.ok(true)
})

test('updateTodoStatus：切换待办状态', async () => {
  __setDbResult({ data: [makeRow({ type: 'todo', todo_status: 'done' })] })
  const r = await recordService.updateTodoStatus(1, 'done')
  assert.equal(r.todoStatus, 'done')
})

test('getRecord：命中返回记录、未命中返回 null', async () => {
  __setDbResult({ data: makeRow({ id: 9 }) })
  const hit = await recordService.getRecord(9)
  assert.equal(hit?.id, 9)

  __setDbResult({ data: null })
  const miss = await recordService.getRecord(999)
  assert.equal(miss, null)
})

test('search：关键词转义 ilike 通配符并纳入 tags.cs 命中', async () => {
  __setDbResult({ data: [makeRow({ id: 1 }), makeRow({ id: 2 })] })
  await recordService.search('a%b_c')
  const calls = __dbCalls.join('|')
  assert.ok(calls.includes('title.ilike.%a\\%b\\_c%'), 'ilike 通配符 % / _ 应被转义')
  assert.ok(calls.includes('tags.cs.{a%b_c}'), 'tags 检索应使用 PostgREST cs 数组命中')
})

test('search：关键词单查询返回映射结果', async () => {
  __setDbResult({ data: [makeRow({ id: 1 }), makeRow({ id: 2 })] })
  const r = await recordService.search('kw')
  assert.equal(r.length, 2)
  assert.ok(__dbCalls.some((c) => c.includes('tags.cs.{kw}')), '主搜索关键词应覆盖 tags')
})

test('listRecords：关键词过滤包含 tags.cs 命中（主搜索框覆盖标签）', async () => {
  __setDbResult({ data: [makeRow({ id: 9 })], error: undefined, count: 1 } as never)
  const res = await recordService.listRecords({ keyword: '标签词', page: 1, pageSize: 20 })
  assert.equal(res.records.length, 1)
  assert.equal(res.records[0].id, 9)
  assert.equal(res.total, 1)
  assert.ok(__dbCalls.some((c) => c.includes('tags.cs.{标签词}')), 'listRecords 关键词应覆盖 tags 并保持 count')
})

test('counts：四路计数返回', async () => {
  __setDbResult({ data: [], error: undefined, count: 5 } as never)
  const c = await recordService.counts()
  assert.deepEqual(c, { all: 5, idea: 5, material: 5, todoPending: 5 })
})

test('saveLinks：非空写入（upsert 去重），空数组短路', async () => {
  __setDbResult({ data: [], error: undefined })
  await recordService.saveLinks(1, [{ targetId: 2, score: 0.9, reason: 'r' }])
  assert.ok(__dbCalls.some((c) => c === 'upsert'))

  __resetDbCalls()
  await recordService.saveLinks(1, [])
  assert.ok(!__dbCalls.includes('upsert'), '空 items 不应发起写入')
})

test('listRelated：无关联返回空数组', async () => {
  __setDbResult({ data: [] })
  const r = await recordService.listRelated(1)
  assert.deepEqual(r, [])
})
