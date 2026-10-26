/**
 * 待办循环完成业务闭环（P0-B）。
 *
 * 顺序（任一步失败都不留「完成了但没有下一期」的半成品）：
 *   1. 条件更新置 done（`todo_status='pending'` 作为乐观锁）→ 影响 0 行即视为重复触发；
 *   2. 纯函数计算下一期；
 *   3. 规则结束 → 提示「循环已结束」，不新建；
 *   4. 新建下一期 pending（复制内容字段 + 续期 remind_at + 继承根规则 + 记父级）；
 *   5. 回写原记录 recurrence_next_id（失败重试 1 次，不改变已完成状态）。
 *
 * 幂等唯一保证是第 1 步的「条件更新 + returning」：并发/重试时只会有一次拿到 1 行。
 */

import { cloud } from '@/lib/cloud'
import { unwrap } from '@/lib/unwrap'
import { computeNext } from '@/lib/recurrence'
import { recordService } from '@/services/recordService'
import type { RecordsRow } from '@/lib/database.types'
import type { InfoRecord } from '@shared/types/domain'

/** 完成待办的结果。 */
export interface CompleteTodoResult {
  /** true 表示该待办已被处理（并发双击/接口重试），本次未做任何写入。 */
  duplicated?: boolean
  /** true 表示循环已结束（超过结束日期），未生成下一期。 */
  ended?: boolean
  /** 新生成的下一期记录。 */
  next?: InfoRecord
  /** true 表示下一期已生成但追溯字段回写失败（不影响数据正确性）。 */
  writeBackFailed?: boolean
}

/** 失败提示（中文、可重试，避免暴露后端细节）。 */
const ERROR_CREATE_NEXT = '生成下一期失败，请重试'

/** 条件更新：仅当仍为 pending 时置为 done，返回是否真正更新到 1 行。 */
async function markDoneConditionally(id: number, nowIso: string): Promise<boolean> {
  const { data, error } = await cloud.database
    .from('records')
    .update({ todo_status: 'done', updated_at: nowIso })
    .eq('id', id)
    .eq('todo_status', 'pending')
    .select()
  const rows = unwrap({ data, error }) as RecordsRow[] | null
  return Array.isArray(rows) && rows.length > 0
}

/** 补偿：把原记录恢复为待完成（新建下一期失败时调用）。 */
async function restorePending(id: number, nowIso: string): Promise<void> {
  try {
    await cloud.database
      .from('records')
      .update({ todo_status: 'pending', updated_at: nowIso })
      .eq('id', id)
  } catch {
    /* 补偿失败不覆盖主错误：用户可再次点击完成（条件更新会重新生效） */
  }
}

/** 回写下一期 id（失败重试 1 次）。返回是否最终写入成功。 */
async function writeBackNextId(id: number, nextId: number, nowIso: string): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { data, error } = await cloud.database
        .from('records')
        .update({ recurrence_next_id: nextId, updated_at: nowIso })
        .eq('id', id)
        .select()
      unwrap({ data, error })
      return true
    } catch {
      /* 第一次失败后重试一次 */
    }
  }
  return false
}

/**
 * 完成一条待办；带循环规则时自动生成下一期。
 *
 * @param record 当前待办（来自列表/详情，须含最新 recurrence 与 remindAt）
 * @returns duplicated / ended / next 三种结果之一
 */
export async function completeTodoWithRecurrence(record: InfoRecord): Promise<CompleteTodoResult> {
  const nowIso = new Date().toISOString()

  // 第一步：条件更新（幂等唯一保证）
  const updated = await markDoneConditionally(record.id, nowIso)
  if (!updated) return { duplicated: true }

  // 无循环规则：与 2.11.0 行为一致，仅置 done
  if (!record.recurrence) return {}

  // 第二步：纯函数推进
  const { nextRemindIso, ruleEnded } = computeNext(record.recurrence, {
    remindAt: record.remindAt ?? null,
    nowIso,
  })

  if (ruleEnded) return { ended: true }

  // 第三步：新建下一期（复制内容字段，仅续期提醒时间）
  let created: InfoRecord
  try {
    created = await recordService.createRecord({
      type: 'todo',
      title: record.title,
      content: record.content,
      url: record.url ?? null,
      filePath: record.filePath ?? null,
      category: record.category ?? null,
      tags: record.tags ?? [],
      todoStatus: 'pending',
      priority: record.priority ?? null,
      remindAt: nextRemindIso,
      recurrence: record.recurrence,
      recurrenceParentId: record.recurrenceParentId ?? record.id,
    })
  } catch {
    // 补偿：恢复为待完成，避免「已完成但没有下一期」的半成品
    await restorePending(record.id, new Date().toISOString())
    throw new Error(ERROR_CREATE_NEXT)
  }

  // 第四步：回写原记录的下一期 id（失败重试 1 次，不影响下一期本身）
  const writeBackFailed = !(await writeBackNextId(record.id, created.id, new Date().toISOString()))
  return writeBackFailed ? { next: created, writeBackFailed: true } : { next: created }
}

/** service 单例（与项目其它 service 风格一致）。 */
export const recurrenceService = {
  completeTodoWithRecurrence,
}
