/**
 * web/src/store/recordStore.ts 竞态回归测试：快速连续 load 时旧慢请求不覆盖新结果。
 * cloud.database 已 mock（同批微任务内两个 load 的 dbResult 快照不同）。
 */
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { __setDbResult, __resetDbCalls } from './mocks/cloud'
import { useRecordStore } from '../web/src/store/recordStore'
import type { RecordsRow } from '../web/src/lib/database.types'

function makeRow(id: number): RecordsRow {
  return {
    id,
    owner_id: 'u1',
    type: 'idea',
    title: `标题${id}`,
    content: '',
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
  }
}

beforeEach(() => {
  __resetDbCalls()
  useRecordStore.setState({ records: [], total: 0, filter: { page: 1, pageSize: 20, isDeleted: false } })
})

test('load 竞态：后发请求结果胜出，旧请求不覆盖', async () => {
  // 第一次 load 捕获旧快照（标题旧），第二次 load 捕获新快照（标题新）
  __setDbResult({ data: [makeRow(1)], error: undefined })
  const p1 = useRecordStore.getState().load()
  __setDbResult({ data: [makeRow(2)], error: undefined })
  const p2 = useRecordStore.getState().load()

  await Promise.all([p1, p2])

  const records = useRecordStore.getState().records
  assert.equal(records.length, 1)
  assert.equal(records[0].id, 2, '最新一次请求（id=2）应胜出，旧请求（id=1）不得覆盖')
})
