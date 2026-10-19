/**
 * web/src/services/recordService.ts 的 listByRange 测试（cloud.database 已 mock）。
 * 覆盖：查询链 from/select/eq/gte/lte/order/limit 的顺序与参数、结果 mapRecord。
 */
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { __setDbResult, __resetDbCalls, __dbCalls } from './mocks/cloud'
import { recordService } from '../web/src/services/recordService'

const ROW = {
  id: 1,
  type: 'idea',
  title: '标题',
  content: '正文',
  url: null,
  file_path: null,
  category: '技术/AI',
  tags: ['a'],
  summary: null,
  todo_status: null,
  priority: null,
  remind_at: null,
  is_deleted: false,
  deleted_at: null,
  created_at: '2024-01-15T00:00:00Z',
  updated_at: '2024-01-15T00:00:00Z',
}

beforeEach(() => {
  __resetDbCalls()
  __setDbResult({ data: [ROW] })
})

test('listByRange：查询链顺序与参数正确', async () => {
  const rows = await recordService.listByRange('2024-01-01T00:00:00Z', '2024-01-31T23:59:59Z', 200)
  assert.deepEqual(__dbCalls, [
    'from(records)',
    'select(*)',
    'eq(is_deleted,false)',
    'gte(created_at,"2024-01-01T00:00:00Z")',
    'lte(created_at,"2024-01-31T23:59:59Z")',
    'order(created_at,asc:false)',
    'limit(200)',
  ])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].title, '标题')
  assert.equal(rows[0].category, '技术/AI')
})

test('listByRange：结果经 mapRecord 做 snake_case→camelCase 映射', async () => {
  __setDbResult({
    data: [
      {
        id: 2,
        type: 'todo',
        title: '待办标题',
        content: '',
        url: null,
        file_path: 'materials/x.pdf',
        category: null,
        tags: null, // 兼容 tags 为 null
        summary: '摘要',
        todo_status: 'pending',
        priority: 'high',
        remind_at: '2024-01-16T08:00:00Z',
        is_deleted: false,
        deleted_at: null,
        created_at: '2024-01-16T00:00:00Z',
        updated_at: '2024-01-16T00:00:00Z',
      },
    ],
  })
  const rows = await recordService.listByRange('2024-01-01T00:00:00Z', '2024-02-01T00:00:00Z', 50)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].filePath, 'materials/x.pdf')
  assert.equal(rows[0].todoStatus, 'pending')
  assert.equal(rows[0].priority, 'high')
  assert.deepEqual(rows[0].tags, []) // null → []
})

test('listByRange：默认 limit 为 200', async () => {
  await recordService.listByRange('2024-01-01T00:00:00Z', '2024-02-01T00:00:00Z')
  assert.ok(__dbCalls.includes('limit(200)'))
})

test('listByRange：空结果返回空数组', async () => {
  __setDbResult({ data: null })
  const rows = await recordService.listByRange('2024-01-01T00:00:00Z', '2024-02-01T00:00:00Z')
  assert.deepEqual(rows, [])
})

test('listByRange：error 时抛错（unwrap）', async () => {
  __setDbResult({ data: null, error: new Error('boom') })
  await assert.rejects(() => recordService.listByRange('2024-01-01T00:00:00Z', '2024-02-01T00:00:00Z'), /boom/)
})
