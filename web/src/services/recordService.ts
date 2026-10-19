import { cloud } from '@/lib/cloud'
import { unwrap } from '@/lib/unwrap'
import type { RecordsRow } from '@/lib/database.types'
import type {
  InfoRecord,
  RecordCreateInput,
  RecordListFilter,
  RecordListResult,
  RecordType,
  RelateResultItem,
  TodoStatus,
} from '@shared/types/domain'

/** 记录查询相关上限集中配置。 */
const LIMITS = {
  search: 50,
  searchCandidates: 20,
  listByRange: 200,
  streakSample: 500,
  relatedTargets: 500,
} as const

/** 数据库行（snake_case）→ 领域类型（camelCase）。 */
export function mapRecord(row: RecordsRow): InfoRecord {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    content: row.content,
    url: row.url,
    filePath: row.file_path,
    category: row.category,
    tags: Array.isArray(row.tags) ? row.tags : [],
    summary: row.summary,
    todoStatus: row.todo_status,
    priority: row.priority,
    remindAt: row.remind_at,
    isDeleted: row.is_deleted,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** 转义 ilike 通配符与 PostgREST 过滤结构字符，防止用户输入注入/破坏查询。 */
function escapeLike(s: string): string {
  return s.replace(/[%_\\,()"]/g, '\\$&')
}

/** 构造 tags 数组 contains 过滤片段（tags.cs.{kw}）；关键词含数组字面量特殊字符时返回 null（跳过 tags 命中）。 */
function csTagFilter(kw: string): string | null {
  if (!kw || /[{}",\\]/.test(kw)) return null
  return `tags.cs.{${kw}}`
}

/** 解包并返回非空行数组；空结果抛统一中文错误。 */
function unwrapRows(result: { data: unknown; error: unknown }, msg = '无权限或记录不存在'): RecordsRow[] {
  const rows = unwrap(result) as RecordsRow[] | null
  if (!rows || rows.length === 0) throw new Error(msg)
  return rows
}

/** 应用关键词过滤（title/content 模糊匹配 + tags 数组 contains，均已转义）。 */
function applyKeyword<Q extends { or(filter: string): Q }>(query: Q, kw: string): Q {
  const esc = escapeLike(kw)
  const base = `title.ilike.%${esc}%,content.ilike.%${esc}%`
  const tags = csTagFilter(kw)
  return query.or(tags ? `${base},${tags}` : base)
}

/** 本地日期 key（避免 UTC toISOString 时区偏移导致跨天）。 */
function localDayKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 连续记录天数（从今天或昨天起，往前数有记录的天数）。 */
function computeStreak(createdAts: string[]): number {
  const days = new Set<string>()
  for (const iso of createdAts) {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) continue
    days.add(localDayKey(d))
  }
  const cursor = new Date()
  cursor.setHours(0, 0, 0, 0)
  if (!days.has(localDayKey(cursor))) cursor.setDate(cursor.getDate() - 1)
  let streak = 0
  while (days.has(localDayKey(cursor))) {
    streak++
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

/** 领域字段 → snake_case 数据库字段。 */
function toSnake(input: RecordUpdateInput): Record<string, unknown> {
  const fields: Record<string, unknown> = {}
  if (input.type !== undefined) fields.type = input.type
  if (input.title !== undefined) fields.title = input.title
  if (input.content !== undefined) fields.content = input.content
  if (input.url !== undefined) fields.url = input.url
  if (input.filePath !== undefined) fields.file_path = input.filePath
  if (input.category !== undefined) fields.category = input.category
  if (input.tags !== undefined) fields.tags = input.tags
  if (input.summary !== undefined) fields.summary = input.summary
  if (input.todoStatus !== undefined) fields.todo_status = input.todoStatus
  if (input.priority !== undefined) fields.priority = input.priority
  if (input.remindAt !== undefined) fields.remind_at = input.remindAt
  return fields
}

export const recordService = {
  /** 新建记录（owner_id 由数据库 DEFAULT auth.uid() 填充，前端不发送）。 */
  async createRecord(input: RecordCreateInput): Promise<InfoRecord> {
    const { data, error } = await cloud.database
      .from('records')
      .insert({
        type: input.type,
        title: input.title ?? '',
        content: input.content ?? '',
        url: input.url ?? null,
        file_path: input.filePath ?? null,
        category: input.category ?? null,
        tags: input.tags ?? [],
        todo_status: input.todoStatus ?? null,
        priority: input.priority ?? null,
        remind_at: input.remindAt ?? null,
      })
      .select()
    return mapRecord(unwrapRows({ data, error })[0])
  },

  /** 分页列表（支持类型/分类/关键词/回收站筛选）。 */
  async listRecords(filter: RecordListFilter = {}): Promise<RecordListResult> {
    const page = filter.page ?? 1
    const pageSize = filter.pageSize ?? 20
    const from = (page - 1) * pageSize
    const to = from + pageSize - 1

    let query = cloud.database
      .from('records')
      .select('*', { count: 'exact' })
      .eq('is_deleted', filter.isDeleted ?? false)

    if (filter.type) query = query.eq('type', filter.type)
    if (filter.category) query = query.eq('category', filter.category)
    if (filter.keyword && filter.keyword.trim()) {
      query = applyKeyword(query, filter.keyword.trim())
    }
    query = query.order('created_at', { ascending: false }).range(from, to)

    const { data, error, count } = await query
    const rows = (unwrap({ data, error }) as RecordsRow[] | null) ?? []
    return { records: rows.map(mapRecord), total: count ?? 0 }
  },

  /** 导航徽标计数（全部/想法/资料/待办未完成）。 */
  async counts(): Promise<{ all: number; idea: number; material: number; todoPending: number }> {
    const countOf = async (type?: RecordType, todoPending?: boolean): Promise<number> => {
      let query = cloud.database.from('records').select('id', { count: 'exact' }).eq('is_deleted', false)
      if (type) query = query.eq('type', type)
      if (todoPending) query = query.eq('todo_status', 'pending')
      const { count } = await query
      return count ?? 0
    }
    const [all, idea, material, todoPending] = await Promise.all([
      countOf(),
      countOf('idea'),
      countOf('material'),
      countOf('todo', true),
    ])
    return { all, idea, material, todoPending }
  },

  /** 首页统计卡：本周新增 / 待办未完成 / 连续记录天数。 */
  async stats(): Promise<{ weekNew: number; todoPending: number; streak: number }> {
    const now = new Date()
    const weekStart = new Date(now)
    weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7))
    weekStart.setHours(0, 0, 0, 0)

    const [weekNew, todoPending] = await Promise.all([
      (async () => {
        const { count } = await cloud.database
          .from('records')
          .select('id', { count: 'exact' })
          .eq('is_deleted', false)
          .gte('created_at', weekStart.toISOString())
        return count ?? 0
      })(),
      (async () => {
        const { count } = await cloud.database
          .from('records')
          .select('id', { count: 'exact' })
          .eq('is_deleted', false)
          .eq('type', 'todo')
          .eq('todo_status', 'pending')
        return count ?? 0
      })(),
    ])

    // 连续记录：拉取最近 500 条创建时间，按本地日期计算连续天数
    const { data, error } = await cloud.database
      .from('records')
      .select('created_at')
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })
      .limit(LIMITS.streakSample)
    const rows = (unwrap({ data, error }) as Array<{ created_at: string }> | null) ?? []
    const streak = computeStreak(rows.map((r) => r.created_at))

    return { weekNew, todoPending, streak }
  },

  /** 关键词检索（title/content 模糊匹配 + tags 数组 contains，单查询）。 */
  async search(keyword: string, filter: { type?: RecordType; category?: string } = {}): Promise<InfoRecord[]> {
    const kw = keyword.trim()
    let query = cloud.database.from('records').select('*').eq('is_deleted', false)
    if (filter.type) query = query.eq('type', filter.type)
    if (filter.category) query = query.eq('category', filter.category)
    if (kw) query = applyKeyword(query, kw)
    query = query.order('created_at', { ascending: false }).limit(LIMITS.search)
    const { data, error } = await query
    return ((unwrap({ data, error }) as RecordsRow[] | null) ?? []).map(mapRecord)
  },

  /** 按创建时间区间拉取记录（回顾用，未删除）。 */
  async listByRange(startIso: string, endIso: string, limit: number = LIMITS.listByRange): Promise<InfoRecord[]> {
    const { data, error } = await cloud.database
      .from('records')
      .select('*')
      .eq('is_deleted', false)
      .gte('created_at', startIso)
      .lte('created_at', endIso)
      .order('created_at', { ascending: false })
      .limit(limit)
    const rows = (unwrap({ data, error }) as RecordsRow[] | null) ?? []
    return rows.map(mapRecord)
  },

  /** 单条记录（不存在返回 null）。 */
  async getRecord(id: number): Promise<InfoRecord | null> {
    const { data, error } = await cloud.database
      .from('records')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    const row = unwrap({ data, error }) as RecordsRow | null
    return row ? mapRecord(row) : null
  },

  /** 更新记录（UI 编辑）。 */
  async updateRecord(id: number, input: RecordUpdateInput): Promise<InfoRecord> {
    const fields = toSnake(input)
    const { data, error } = await cloud.database
      .from('records')
      .update(fields)
      .eq('id', id)
      .select()
    return mapRecord(unwrapRows({ data, error })[0])
  },

  /** 底层补丁（snake_case 字段，供 aiService 回写分类/摘要等）。 */
  async patchRecord(id: number, fields: Record<string, unknown>): Promise<InfoRecord> {
    const { data, error } = await cloud.database
      .from('records')
      .update(fields)
      .eq('id', id)
      .select()
    return mapRecord(unwrapRows({ data, error })[0])
  },

  /** 软删除（进回收站）。 */
  async softDelete(id: number): Promise<void> {
    const { data, error } = await cloud.database
      .from('records')
      .update({ is_deleted: true, deleted_at: new Date().toISOString() })
      .eq('id', id)
      .select()
    unwrapRows({ data, error })
  },

  /** 恢复（移出回收站）。 */
  async restore(id: number): Promise<void> {
    const { data, error } = await cloud.database
      .from('records')
      .update({ is_deleted: false, deleted_at: null })
      .eq('id', id)
      .select()
    unwrapRows({ data, error })
  },

  /** 彻底删除（物理删除）。 */
  async hardDelete(id: number): Promise<void> {
    const { data, error } = await cloud.database
      .from('records')
      .delete()
      .eq('id', id)
      .select()
    unwrapRows({ data, error })
  },

  /** 切换待办状态。 */
  async updateTodoStatus(id: number, status: TodoStatus): Promise<InfoRecord> {
    const { data, error } = await cloud.database
      .from('records')
      .update({ todo_status: status })
      .eq('id', id)
      .select()
    return mapRecord(unwrapRows({ data, error })[0])
  },

  /** 检索候选记录（用于智能关联召回；title/content + tags 单查询）。 */
  async searchCandidates(keyword: string, k = LIMITS.searchCandidates, excludeId?: number): Promise<InfoRecord[]> {
    const kw = keyword.trim()
    let query = cloud.database.from('records').select('*').eq('is_deleted', false)
    if (excludeId !== undefined) query = query.neq('id', excludeId)
    if (kw) query = applyKeyword(query, kw)
    query = query.order('created_at', { ascending: false }).limit(k)
    const { data, error } = await query
    return ((unwrap({ data, error }) as RecordsRow[] | null) ?? []).map(mapRecord)
  },

  /** 保存关联关系（去重 upsert，按 owner_id+source_id+target_id 唯一约束）。 */
  async saveLinks(sourceId: number, items: RelateResultItem[]): Promise<void> {
    if (items.length === 0) return
    const rows = items.map((it) => ({
      source_id: sourceId,
      target_id: it.targetId,
      score: it.score,
      reason: it.reason ?? null,
    }))
    const { error } = await cloud.database
      .from('record_links')
      .upsert(rows, { onConflict: 'owner_id,source_id,target_id' })
    if (error) throw error
  },

  /** 查询某条记录的关联记录（含目标记录详情）。 */
  async listRelated(
    sourceId: number,
  ): Promise<Array<{ record: InfoRecord; score: number; reason: string | null }>> {
    const { data, error } = await cloud.database
      .from('record_links')
      .select('id, score, reason, target_id')
      .eq('source_id', sourceId)
      .order('score', { ascending: false })
    const links = (unwrap({ data, error }) as Array<{
      id: number
      score: number
      reason: string | null
      target_id: number
    }> | null) ?? []

    if (links.length === 0) return []

    const targetIds = links.map((l) => l.target_id).slice(0, LIMITS.relatedTargets)
    const { data: recData, error: recError } = await cloud.database
      .from('records')
      .select('*')
      .eq('is_deleted', false)
      .in('id', targetIds)
    const rows = (unwrap({ data: recData, error: recError }) as RecordsRow[] | null) ?? []
    const byId = new Map(rows.map((r) => [r.id, r]))

    const result: Array<{ record: InfoRecord; score: number; reason: string | null }> = []
    for (const link of links) {
      const row = byId.get(link.target_id)
      if (row) result.push({ record: mapRecord(row), score: link.score, reason: link.reason })
    }
    return result
  },
}

/** UI 编辑补丁（领域字段，camelCase）。 */
export interface RecordUpdateInput extends Partial<RecordCreateInput> {
  summary?: string | null
}
