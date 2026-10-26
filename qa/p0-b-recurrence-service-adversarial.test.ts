/**
 * P0-B 循环完成业务 · 对抗性测试（QA 独立补充）。
 *
 * 重点验证工程师用例没断言到的部分：
 * - insert 的**字段复制是否真的正确**（标题/内容/优先级/分类/标签/URL/状态/提醒时间/规则/父级）；
 * - 条件更新 0 行时**完全不产生写操作**（既没有 insert，也没有回写 update）；
 * - 规则结束后不留任何写入；
 * - insert 失败后的补偿是「恢复 pending」而不是别的字段。
 */
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  __dbCalls,
  __dbInserts,
  __dbUpdates,
  __queueDbResults,
  __resetDbCalls,
  __resetDbQueue,
  __resetDbWrites,
  __setDbResult,
} from './mocks/cloud'
import { completeTodoWithRecurrence } from '../web/src/services/recurrenceService'
import { computeNext } from '../web/src/lib/recurrence'
import type { InfoRecord } from '../shared/types/domain'

const TZ = 480

function makeRecord(over: Partial<InfoRecord> = {}): InfoRecord {
  return {
    id: 11,
    type: 'todo',
    title: '晨跑 5 公里',
    content: '慢跑 + 拉伸',
    url: 'https://example.com/run',
    filePath: null,
    category: '健康',
    tags: ['习惯', '运动'],
    summary: null,
    todoStatus: 'pending',
    priority: 'high',
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

/** 第一段查询（条件更新）返回 1 行的行数据。 */
const updatedRow = { data: [{}] }

beforeEach(() => {
  __resetDbCalls()
  __resetDbQueue()
  __resetDbWrites()
  __setDbResult({ data: [] })
})

test('B5 幂等：0 行时既不 insert 也不回写 next_id', async () => {
  __queueDbResults([{ data: [] }])

  const result = await completeTodoWithRecurrence(makeRecord())

  assert.equal(result.duplicated, true)
  assert.equal(result.next, undefined)
  assert.equal(__dbInserts.length, 0, '不应有 insert')
  assert.equal(__dbUpdates.length, 1, '只应有那一次「条件更新」（返回 0 行）')
  assert.equal(__dbUpdates[0]?.todo_status, 'done')
  assert.ok(!__dbCalls.some((c) => c.includes('recurrence_next_id')), '不应出现 next_id 回写')
})

test('B6 兼容：无 recurrence 只置 done，且不产生 insert/回写', async () => {
  __queueDbResults([updatedRow])

  const result = await completeTodoWithRecurrence(makeRecord({ recurrence: null }))

  assert.deepEqual(result, {})
  assert.equal(__dbInserts.length, 0)
  assert.equal(__dbUpdates.length, 1, '仅条件更新一次')
  assert.equal(__dbUpdates[0]?.todo_status, 'done')
})

test('B1 下一期字段复制：标题/内容/优先级/分类/标签/URL/状态/规则/父级全部正确', async () => {
  const record = makeRecord()
  __queueDbResults([updatedRow, { data: [{ id: 12 }] }, { data: [{}] }])

  const result = await completeTodoWithRecurrence(record)

  assert.equal(result.next?.id, 12)
  assert.equal(__dbInserts.length, 1, '必须恰好新建 1 条')

  const inserted = __dbInserts[0] as Record<string, unknown>
  assert.equal(inserted.type, 'todo')
  assert.equal(inserted.title, record.title)
  assert.equal(inserted.content, record.content)
  assert.equal(inserted.priority, record.priority)
  assert.equal(inserted.category, record.category)
  assert.deepEqual(inserted.tags, record.tags)
  assert.equal(inserted.url, record.url)
  assert.equal(inserted.file_path, null)
  assert.equal(inserted.todo_status, 'pending', '下一期必须是待完成')
  assert.deepEqual(inserted.recurrence, record.recurrence, '下一期共享循环规则')
  assert.equal(inserted.recurrence_parent_id, record.id, '根记录生成时父级指向自身')

  // remind_at 必须与纯函数算出的下一期严格一致（时分不变，+1 天）
  const expected = computeNext(record.recurrence as never, {
    remindAt: record.remindAt as string,
    nowIso: new Date().toISOString(),
    tzOffsetMinutes: TZ,
  })
  assert.equal(inserted.remind_at, expected.nextRemindIso)
  assert.equal(
    Date.parse(inserted.remind_at as string) - Date.parse(record.remindAt as string),
    86_400_000,
    '每天循环应 +24h',
  )
})

test('B1 回写：recurrence_next_id 写入新记录 id（且只写这一列 + updated_at）', async () => {
  __queueDbResults([updatedRow, { data: [{ id: 99 }] }, { data: [{}] }])

  await completeTodoWithRecurrence(makeRecord())

  const writeBack = __dbUpdates.find((u) => u.recurrence_next_id !== undefined)
  assert.ok(writeBack, '应有一次回写更新')
  assert.equal(writeBack?.recurrence_next_id, 99)
  assert.deepEqual(Object.keys(writeBack ?? {}).sort(), ['recurrence_next_id', 'updated_at'])
})

test('B5 重复触发保护：条件更新带 pending 乐观锁（0 行语义成立的前提）', async () => {
  __queueDbResults([{ data: [] }])

  await completeTodoWithRecurrence(makeRecord())

  assert.ok(__dbCalls.includes('eq(todo_status,"pending")'), '必须以 pending 作为乐观锁条件')
  assert.ok(__dbCalls.includes('eq(id,11)'), '必须限定目标记录 id')
})

test('B4 规则结束：只置 done，无 insert、无 next_id 回写', async () => {
  __queueDbResults([updatedRow])

  const result = await completeTodoWithRecurrence(
    makeRecord({
      remindAt: '2026-12-31T10:00:00+08:00',
      recurrence: { freq: 'daily', interval: 1, endDate: '2026-12-31' },
    }),
  )

  assert.equal(result.ended, true)
  assert.equal(result.next, undefined)
  assert.equal(__dbInserts.length, 0)
  assert.ok(!__dbCalls.some((c) => c.includes('recurrence_next_id')), '不应回写 next_id')
})

test('补偿路径：insert 失败 → 抛中文错误，且补偿写入的是 todo_status=pending', async () => {
  __queueDbResults([updatedRow, { data: null, error: new Error('boom') }, { data: [{}] }])

  await assert.rejects(() => completeTodoWithRecurrence(makeRecord()), /生成下一期失败，请重试/)

  const updates = __dbUpdates.map((u) => u.todo_status)
  assert.deepEqual(updates, ['done', 'pending'], '先置 done，失败后必须恢复 pending')
  assert.ok(!__dbCalls.some((c) => c.includes('recurrence_next_id')), '失败时不应回写 next_id')
})

test('无提醒时间的循环：下一期 remind_at 为 null，仍新建记录', async () => {
  __queueDbResults([updatedRow, { data: [{ id: 13 }] }, { data: [{}] }])

  const result = await completeTodoWithRecurrence(makeRecord({ remindAt: null }))

  assert.equal(result.next?.id, 13)
  const inserted = __dbInserts[0] as Record<string, unknown>
  assert.equal(inserted.remind_at, null, '无提醒时间时下一期也不应有提醒时间')
  assert.deepEqual(inserted.recurrence, { freq: 'daily', interval: 1, endDate: null })
})

test('子记录完成：父级保持根 id（不指向直接父级以外的值）', async () => {
  __queueDbResults([updatedRow, { data: [{ id: 14 }] }, { data: [{}] }])

  await completeTodoWithRecurrence(makeRecord({ id: 13, recurrenceParentId: 11 }))

  const inserted = __dbInserts[0] as Record<string, unknown>
  assert.equal(inserted.recurrence_parent_id, 11, '应继承根记录 id')
})
