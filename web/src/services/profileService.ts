/**
 * 账户资料服务：昵称校验、敏感词过滤、账户 ID 展示、settings 行保存。
 *
 * - 账户 ID：复用 settings 表自增主键 `id`（BIGINT 身份列，全局唯一、不可修改），
 *   展示时零填充为 9 位字符串；
 * - 昵称：1–20 字符、仅中英文数字下划线、允许重名（不建唯一约束）、敏感词拒绝；
 * - 保存：按行 `id` 更新（无则插入并返回新 id），替代直接 `upsert`（避免命中 owner_id
 *   唯一约束导致 23505）。
 */
import { cloud } from '@/lib/cloud'
import { unwrap } from '@/lib/unwrap'
import type { SettingsRow } from '@/lib/database.types'

/** 账户 ID 展示：BIGINT 零填充为 9 位数字。 */
export function formatAccountId(id: number): string {
  return String(id).padStart(9, '0')
}

/**
 * 敏感词库（命中即拒绝）。仅覆盖明显违规/违法词汇，可按需扩充；
 * 属于前端第一道过滤，线上二次校验与高危词复审需服务端能力配合（见设计文档）。
 */
const SENSITIVE_WORDS: string[] = [
  '赌博',
  '博彩',
  '毒品',
  '枪支',
  '诈骗',
  '色情',
  '嫖娼',
  '代开发票',
  '办证',
  '高利贷',
]

/** 是否命中敏感词。 */
export function hasSensitiveWord(input: string): boolean {
  return SENSITIVE_WORDS.some((w) => input.includes(w))
}

/** 敏感词脱敏：命中词替换为等长 `*`。 */
export function maskSensitiveWords(input: string): string {
  let out = input
  for (const w of SENSITIVE_WORDS) {
    if (out.includes(w)) {
      out = out.split(w).join('*'.repeat(Array.from(w).length))
    }
  }
  return out
}

/** 昵称校验：1–20 字符、中英文数字下划线、非空、无敏感词。返回错误文案（null 表示合法）。 */
export function validateNickname(name: string): string | null {
  const n = name.trim()
  if (!n) return '昵称不能为空'
  if (Array.from(n).length > 20) return '昵称不能超过 20 个字符'
  if (!/^[\u4e00-\u9fa5A-Za-z0-9_]+$/.test(n)) return '昵称仅支持中英文、数字和下划线'
  if (hasSensitiveWord(n)) return '昵称包含敏感词，请修改'
  return null
}

export const profileService = {
  /** 取当前用户 settings 行（可能为 null，表示尚未创建）。 */
  async getSettings(): Promise<SettingsRow | null> {
    const row = unwrap(
      await cloud.database.from('settings').select('*').limit(1).maybeSingle(),
    ) as SettingsRow | null
    return row
  },

  /**
   * 保存 settings 行：有 id 则更新，无则插入；返回行 id（用于后续更新与账户 ID 展示）。
   * 不传 owner_id / id，由后端 DEFAULT auth.uid() 与身份列自动填充。
   */
  async save(currentId: number | null, payload: Record<string, unknown>): Promise<number> {
    if (currentId) {
      unwrap(await cloud.database.from('settings').update(payload).eq('id', currentId).select())
      return currentId
    }
    const rows = unwrap(
      await cloud.database.from('settings').insert(payload).select(),
    ) as SettingsRow[] | null
    if (!rows || rows.length === 0) throw new Error('保存失败，请重试')
    return rows[0].id
  },
}
