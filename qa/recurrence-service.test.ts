/**
 * web/src/services/recurrenceService.ts 单元测试（P0-B B5 幂等 / B6 兼容 / 补偿路径）。
 * cloud.database 由 qa/mocks/cloud.ts 替换，用 __queueDbResults 模拟多段查询。
 */
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { __dbCalls, __queueDbResults, __resetDbCalls, __resetDbQueue, __setDbResult } from './mocks/cloud'
import { completeTodoWithRecurrence } from '../web/src/services/recurrenceService'
import type { RecordsRow } from '../web/src/lib/database.types'
import type { InfoRecord } from '../shared/types/domain'

function makeRow(over: Partial<RecordsRow> = {}): RecordsRow {
  return {
    id: 1,
    owner_id: 'u1',
    type: 'todo',
    title: '每日复盘',
    content: '写三行',
    url: 'https://example.com/a',
    file_path: null,
    category: '工作',
    tags: ['习惯'],
    summary: null,
    todo_status: 'pending',
    priority: 'medium',
    remind_at: '2026-10-12T02:00:00.000Z',
    recurrence: { freq: 'daily', interval: 1, endDate: null },
    recurrence_parent_id: null,
    recurrence_next_id: null,
    link_meta: null,
    is_deleted: false,
    deleted_at: null,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
    ...over,
  }
}

function makeRecord(over: Partial<InfoRecord> = {}): InfoRecord {
  return {
    id: 1,
    type: 'todo',
    title: '每日复盘',
    content: '写三行',
    url: 'https://example.com/a',
    filePath: null,
    category: '工作',
    tags: ['习惯'],
    summary: null,
    todoStatus: 'pending',
    priority: 'medium',
    remindAt: '2026-10-12T02:00:00.000Z',
    recurrence: { freq: 'daily', interval: 1, endDate: null },
    recurrenceParentId: null,
    recurrenceNextId: null,
    linkMeta: null,
    isDeleted: false,
    deletedAt: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...over,
  }
}

beforeEach(() => {
  __resetDbCalls()
  __resetDbQueue()
  __setDbResult({ data: [] })
})

test('B5 幂等：条件更新返回 0 行 → duplicated，不新建任何记录', async () => {
  __queueDbResults([{ data: [] }]) // 条件更新 returns 0 行（已被处理）

  const result = await completeTodoWithRecurrence(makeRecord())
  assert.equal(result.duplicated, true)
  assert.equal(result.next, undefined)
  assert.ok(!__dbCalls.includes('insert'), '重复触发不应发起 insert')
  assert.ok(__dbCalls.some((c) => c === 'eq(todo_status,"pending")'), '应带 pending 乐观锁条件')
})

test('B1 正常推进：条件更新 1 行 → 生成下一期并回写 next_id', async () => {
  __queueDbResults([
    { data: [makeRow({ todo_status: 'done' })] }, // 条件更新成功
    { data: [makeRow({ id: 2, todo_status: 'pending' })] }, // insert 下一期
    { data: [makeRow({ id: 1, todo_status: 'done', recurrence_next_id: 2 })] }, // 回写 next_id
  ])

  const result = await completeTodoWithRecurrence(makeRecord())
  assert.equal(result.next?.id, 2)
  assert.equal(result.writeBackFailed, undefined)
  assert.ok(__dbCalls.includes('insert'), '应新建下一期')
  assert.ok(
    __dbCalls.some((c) => c.includes('recurrence_next_id')),
    '应发起 next_id 回写查询',
  )
})

test('B4 规则结束：不新建，返回 ended', async () => {
  __queueDbResults([{ data: [makeRow({ todo_status: 'done' })] }])

  const result = await completeTodoWithRecurrence(
    makeRecord({
      remindAt: '2026-12-31T10:00:00+08:00',
      recurrence: { freq: 'daily', interval: 1, endDate: '2026-12-30' },
    }),
  )
  assert.equal(result.ended, true)
  assert.ok(!__dbCalls.includes('insert'), '循环结束后不应新建')
})

test('B6 兼容：无循环规则只置 done，不新建', async () => {
  __queueDbResults([{ data: [makeRow({ todo_status: 'done' })] }])

  const result = await completeTodoWithRecurrence(makeRecord({ recurrence: null }))
  assert.deepEqual(result, {})
  assert.ok(!__dbCalls.includes('insert'), '无循环不应新建')
})

test('补偿：insert 失败 → 原记录恢复 pending 并抛中文可重试错误', async () => {
  __queueDbResults([
    { data: [makeRow({ todo_status: 'done' })] }, // 条件更新成功
    { data: null, error: new Error('insert boom') }, // insert 失败
    { data: [makeRow({ todo_status: 'pending' })] }, // 补偿恢复 pending
  ])

  await assert.rejects(() => completeTodoWithRecurrence(makeRecord()), /生成下一期失败，请重试/)
  // 两次 update：一次置 done、一次补偿恢复 pending
  const updateCount = __dbCalls.filter((c) => c.startsWith('update')).length
  assert.equal(updateCount, 2, '应有一次条件更新 + 一次补偿更新')
})

test('父级继承：子记录完成时把根 id 传给下一期', async () => {
  __queueDbResults([
    { data: [makeRow({ id: 5, recurrence_parent_id: 1, todo_status: 'done' })] },
    { data: [makeRow({ id: 6, recurrence_parent_id: 1 })] },
    { data: [makeRow({ id: 5, recurrence_next_id: 6 })] },
  ])

  const result = await completeTodoWithRecurrence(makeRecord({ id: 5, recurrenceParentId: 1 }))
  assert.equal(result.next?.recurrenceParentId, 1)
})

test('回写失败：重试 1 次后仍失败 → 返回 next + writeBackFailed，不抛错', async () => {
  __queueDbResults([
    { data: [makeRow({ todo_status: 'done' })] },
    { data: [makeRow({ id: 9 })] },
    { data: null, error: new Error('write boom') },
    { data: null, error: new Error('write boom again') },
  ])

  const result = await completeTodoWithRecurrence(makeRecord())
  assert.equal(result.next?.id, 9)
  assert.equal(result.writeBackFailed, true)
})
