/**
 * 待办循环规则纯函数（P0-B）。
 *
 * 设计要点（见 docs/p0-2026-10/DESIGN-P0.md §3.2）：
 * - 所有「墙钟」运算统一在平移时间轴上做：`shifted = t + tzOffsetMinutes * 60000`，
 *   再用 UTC getter 读写年月日时分，最后平移回来。中国无 DST，不会漂移；
 *   注入 `tzOffsetMinutes` 也让单测与机器时区解耦。
 * - 不引入任何日期库（零新增依赖）。
 * - 每次推进都从「基准时间」（上一期的 remind_at 或完成时刻）出发计算，
 *   daily / weekly / monthly 三条分支互不复用，避免相互干扰。
 */

import type { RecurrenceFreq, RecurrenceRule } from '@shared/types/domain'

const MS_PER_DAY = 86_400_000
const MS_PER_MINUTE = 60_000
/** 周分支遍历上限（约 7.7 年，足够覆盖任何实际使用场景，防死循环）。 */
const WEEK_SCAN_LIMIT = 400
/** 月分支遍历上限（20 年，同上）。 */
const MONTH_SCAN_LIMIT = 240

/** 循环推进入参。 */
export interface ComputeNextInput {
  /** 基准提醒时间（ISO）；null 表示无提醒时间。 */
  remindAt: string | null
  /** 完成时刻（ISO）；remindAt 为 null 时作为基准。 */
  nowIso: string
  /** 东八区 = 480（即 -getTimezoneOffset()）；默认取运行时。 */
  tzOffsetMinutes?: number
}

/** 循环推进结果。 */
export interface ComputeNextResult {
  /** 下一期提醒时间（ISO）；null 表示无提醒时间。 */
  nextRemindIso: string | null
  /** 规则是否已结束（超过 endDate）。 */
  ruleEnded: boolean
}

/** 当前运行时相对 UTC 的分钟偏移（东八区 = 480）。 */
export function localTzOffsetMinutes(date: Date = new Date()): number {
  return -date.getTimezoneOffset()
}

/** 把 ISO 字符串解析为毫秒；非法返回 null。 */
function parseIso(value: string | null | undefined): number | null {
  if (!value) return null
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : ms
}

/** 平移轴上的「本地日」字符串（YYYY-MM-DD，可直接字典序比较）。 */
function shiftedDayKey(shiftedMs: number): string {
  const d = new Date(shiftedMs)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 某年某月的天数（monthIndex 从 0 开始）。 */
function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
}

/** 间隔归一（非整数/越界回落到 1..99）。 */
function normalizeInterval(interval: unknown): number {
  const n = typeof interval === 'number' && Number.isFinite(interval) ? Math.floor(interval) : 1
  return Math.min(Math.max(n, 1), 99)
}

/** 周几归一：仅 0..6 的整数，升序去重。 */
function normalizeWeekdays(weekdays: unknown): number[] {
  if (!Array.isArray(weekdays)) return []
  const set = new Set<number>()
  for (const item of weekdays) {
    const n = typeof item === 'number' ? Math.floor(item) : Number.NaN
    if (Number.isInteger(n) && n >= 0 && n <= 6) set.add(n)
  }
  return [...set].sort((a, b) => a - b)
}

/** endDate 归一：合法的 'YYYY-MM-DD' 才保留。 */
function normalizeEndDate(endDate: unknown): string | null {
  if (typeof endDate !== 'string') return null
  const trimmed = endDate.trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null
}

/**
 * 锚定日号归一（1–31 整数）；非法/缺省返回 null。
 * 缺省时 `advanceMonthly` 回退到基准日号，保证旧数据行为不变。
 */
export function normalizeAnchorDay(value: unknown): number | null {
  const n = typeof value === 'number' ? Math.floor(value) : Number.NaN
  if (!Number.isInteger(n) || n < 1 || n > 31) return null
  return n
}

/**
 * 归一化任意来源（JSONB 脏数据 / 表单）的循环规则。
 * 非法结构返回 null（视为「不循环」），保证不会因脏数据抛错。
 */
export function normalizeRecurrenceRule(rule: unknown): RecurrenceRule | null {
  if (!rule || typeof rule !== 'object') return null
  const raw = rule as {
    freq?: unknown
    interval?: unknown
    weekdays?: unknown
    anchorDay?: unknown
    endDate?: unknown
  }
  const freq = raw.freq
  const validFreq: RecurrenceFreq[] = ['daily', 'weekly', 'monthly']
  if (typeof freq !== 'string' || !validFreq.includes(freq as RecurrenceFreq)) return null

  const normalized: RecurrenceRule = {
    freq: freq as RecurrenceFreq,
    interval: normalizeInterval(raw.interval),
    endDate: normalizeEndDate(raw.endDate),
  }
  if (normalized.freq === 'weekly') {
    const weekdays = normalizeWeekdays(raw.weekdays)
    // weekly 未选周几时由 computeNext 用基准日的星期兜底；此处保留空数组语义
    normalized.weekdays = weekdays
  }
  // 仅在合法时保留，避免给旧数据/非 monthly 规则增加无意义字段
  const anchorDay = normalizeAnchorDay(raw.anchorDay)
  if (anchorDay !== null) normalized.anchorDay = anchorDay
  return normalized
}

/** 循环规则是否等价于「不重复」。 */
export function isRecurrenceEmpty(rule: RecurrenceRule | null | undefined): boolean {
  return !rule || !rule.freq
}

/**
 * 计算下一期提醒时间。
 *
 * - `remindAt` 为空：`nextRemindIso = null`，仅按 `nowIso` 判断 endDate（上层仍会新建记录）。
 * - 下一期的本地日 > endDate → `ruleEnded = true`，`nextRemindIso = null`；
 *   等于 endDate 时仍然生成（B4）。
 */
export function computeNext(rule: RecurrenceRule, input: ComputeNextInput): ComputeNextResult {
  const tz = typeof input.tzOffsetMinutes === 'number' ? input.tzOffsetMinutes : localTzOffsetMinutes()
  const remindMs = parseIso(input.remindAt)
  const nowMs = parseIso(input.nowIso) ?? Date.now()
  const baseMs = remindMs ?? nowMs
  const shiftedBase = baseMs + tz * MS_PER_MINUTE
  const endDate = normalizeEndDate(rule.endDate)

  // 无提醒时间：不推进时间轴，只判断规则是否已过期
  if (remindMs === null) {
    const ended = endDate !== null && shiftedDayKey(shiftedBase) > endDate
    return { nextRemindIso: null, ruleEnded: ended }
  }

  const interval = normalizeInterval(rule.interval)
  const shiftedNext = advance(
    rule.freq,
    interval,
    rule.weekdays,
    normalizeAnchorDay(rule.anchorDay),
    shiftedBase,
  )

  if (shiftedNext === null) {
    // 无法推进（理论上不会发生）：按结束处理，避免上层死循环
    return { nextRemindIso: null, ruleEnded: true }
  }

  if (endDate !== null && shiftedDayKey(shiftedNext) > endDate) {
    return { nextRemindIso: null, ruleEnded: true }
  }

  return { nextRemindIso: new Date(shiftedNext - tz * MS_PER_MINUTE).toISOString(), ruleEnded: false }
}

/** 按频率推进平移轴上的时间；无法推进返回 null。 */
function advance(
  freq: RecurrenceFreq,
  interval: number,
  weekdays: number[] | undefined,
  anchorDay: number | null,
  shiftedBase: number,
): number | null {
  if (freq === 'daily') return advanceDaily(interval, shiftedBase)
  if (freq === 'weekly') return advanceWeekly(interval, weekdays, shiftedBase)
  return advanceMonthly(interval, anchorDay, shiftedBase)
}

/** 每天：保留时分，直接加 N 天。 */
function advanceDaily(interval: number, shiftedBase: number): number {
  return shiftedBase + interval * MS_PER_DAY
}

/** 每周：以「基准日所在周的周日」为锚，只在 weekIdx % interval === 0 的周内取日期。 */
function advanceWeekly(interval: number, weekdays: number[] | undefined, shiftedBase: number): number | null {
  const wall = new Date(shiftedBase)
  const dayStart = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate())
  const timeOfDay = shiftedBase - dayStart
  const baseDow = wall.getUTCDay()
  const weekStart = dayStart - baseDow * MS_PER_DAY
  // 先归一再判空：`[9, -1]` 这类全非法数组应回退基准日星期，而不是判为「无法推进」
  const picked = normalizeWeekdays(weekdays)
  const selected = picked.length > 0 ? picked : [baseDow]

  for (let weekIdx = 0; weekIdx <= WEEK_SCAN_LIMIT; weekIdx++) {
    if (weekIdx % interval !== 0) continue
    for (const dow of selected) {
      const candidate = weekStart + weekIdx * 7 * MS_PER_DAY + dow * MS_PER_DAY + timeOfDay
      if (candidate > shiftedBase) return candidate
    }
  }
  return null
}

/**
 * 每月：目标日 = 锚定日号（无锚定取基准日号），短月夹取到当月最后一天；
 * 月份按 interval 递增。锚定日号保证「每月 31 日」在 2 月夹取后仍回到 31 日，
 * 不会逐月漂移（旧数据无 anchorDay 时退化为按基准日号推进）。
 */
function advanceMonthly(interval: number, anchorDay: number | null, shiftedBase: number): number | null {
  const wall = new Date(shiftedBase)
  const year = wall.getUTCFullYear()
  const monthIndex = wall.getUTCMonth()
  const baseDay = wall.getUTCDate()
  const dayStart = Date.UTC(year, monthIndex, baseDay)
  const timeOfDay = shiftedBase - dayStart
  const targetDay = anchorDay ?? baseDay

  for (let step = 1; step <= MONTH_SCAN_LIMIT; step++) {
    const offset = step * interval
    const totalMonth = monthIndex + offset
    const targetYear = year + Math.floor(totalMonth / 12)
    const targetMonth = ((totalMonth % 12) + 12) % 12
    const day = Math.min(targetDay, daysInMonth(targetYear, targetMonth))
    const candidate = Date.UTC(targetYear, targetMonth, day) + timeOfDay
    if (candidate > shiftedBase) return candidate
  }
  return null
}

/** 周几中文标签（0=周日）。 */
const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']

/**
 * 生成循环规则的中文描述：`每天` / `每 2 天` / `每周一、三` / `每月最后一天`。
 *
 * @param rule 循环规则
 * @param remindAt 可选，基准提醒时间；monthly 时用于展示「每月 N 日 / 每月最后一天」。
 */
export function describeRecurrence(
  rule: RecurrenceRule | null | undefined,
  remindAt?: string | null,
): string {
  const normalized = normalizeRecurrenceRule(rule)
  if (!normalized) return ''
  const interval = normalizeInterval(normalized.interval)

  if (normalized.freq === 'daily') {
    return interval === 1 ? '每天' : `每 ${interval} 天`
  }

  if (normalized.freq === 'weekly') {
    const weekdays = normalized.weekdays ?? []
    const suffix = weekdays.length > 0 ? weekdays.map((d) => WEEKDAY_LABELS[d]).join('、') : ''
    const prefix = interval === 1 ? '每周' : `每 ${interval} 周`
    return suffix ? `${prefix}${suffix}` : prefix
  }

  // monthly
  const dayOfMonth = normalizeAnchorDay(normalized.anchorDay) ?? readDayOfMonth(remindAt)
  const prefix = interval === 1 ? '每月' : `每 ${interval} 个月`
  if (dayOfMonth === null) return prefix
  if (dayOfMonth === 31) return `${prefix}最后一天`
  if (dayOfMonth === 30) return `${prefix} 30 日（2 月取月末）`
  return `${prefix} ${dayOfMonth} 日`
}

/** 读取 ISO 的「本地日号」；非法返回 null。 */
function readDayOfMonth(iso: string | null | undefined): number | null {
  const ms = parseIso(iso)
  if (ms === null) return null
  const d = new Date(ms)
  return d.getDate()
}

/**
 * 取 remind_at（或今天）对应的星期，供「重复」控件默认选中（0=周日）。
 * 非法/空输入回落为今天。
 */
export function defaultWeekday(remindAt?: string | null): number {
  const ms = parseIso(remindAt)
  const d = ms === null ? new Date() : new Date(ms)
  return d.getDay()
}
