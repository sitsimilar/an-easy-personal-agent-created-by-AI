/**
 * 提醒调度判定纯函数（P0-A）。
 *
 * 全部无副作用、无 DOM 依赖：时间一律以 epoch 毫秒传入，时区通过
 * `tzOffsetMinutes` 显式注入（东八区 = 480），单测不依赖机器时区。
 *
 * 语义约定：
 * - `fire`  → 本刻立即通知；
 * - `defer` → 命中免打扰，等到 `atMs`（免打扰结束时刻）再发，**不写去重键**；
 * - `drop`  → 丢弃本刻（已弹过 / 超过 12h / 尚未到点），调用方按需写去重键。
 */

/** 免打扰时段（本地墙钟 HH:mm，允许跨零点）。 */
export interface QuietHours {
  start: string
  end: string
}

/** 单次判定入参。 */
export interface ShouldFireInput {
  /** 提醒应触发时刻（remind_at − 提前量），epoch ms。 */
  fireAtMs: number
  /** 当前时刻，epoch ms。 */
  nowMs: number
  quiet: QuietHours
  quietEnabled: boolean
  /** 已触发时刻（来自去重存储）；有值即视为已弹过。 */
  firedAtMs?: number | null
  /** 时区偏移（分钟），默认取运行时。 */
  tzOffsetMinutes?: number
}

/** 单次判定结果。 */
export interface ShouldFireResult {
  action: 'fire' | 'defer' | 'drop'
  /** defer 时为免打扰结束时刻；其余为 fireAtMs。 */
  atMs: number
}

/** 超过该时长的晚到提醒直接丢弃（不堆积轰炸）。 */
export const STALE_MS = 12 * 60 * 60 * 1000
/** 去重键保留时长（超过即清理）。 */
export const FIRED_KEEP_MS = 30 * 24 * 60 * 60 * 1000
const MS_PER_DAY = 86_400_000

/** 当前运行时相对 UTC 的分钟偏移（东八区 = 480）。 */
export function localTzOffsetMinutes(date: Date = new Date()): number {
  return -date.getTimezoneOffset()
}

/** 'HH:mm' → 一天中的分钟数；非法返回 null。 */
export function parseHhMm(value: string): number | null {
  if (typeof value !== 'string') return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!m) return null
  const hour = Number(m[1])
  const minute = Number(m[2])
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return hour * 60 + minute
}

/** 分钟数 → 'HH:mm'。 */
export function formatHhMm(minuteOfDay: number): string {
  const safe = Math.min(Math.max(Math.floor(minuteOfDay), 0), 24 * 60 - 1)
  const hour = Math.floor(safe / 60)
  const minute = safe % 60
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/** epoch ms → 指定时区下一天中的分钟数。 */
export function minuteOfDayOf(ms: number, tzOffsetMinutes?: number): number {
  const tz = typeof tzOffsetMinutes === 'number' ? tzOffsetMinutes : localTzOffsetMinutes()
  const d = new Date(ms + tz * 60_000)
  return d.getUTCHours() * 60 + d.getUTCMinutes()
}

/**
 * 是否处于免打扰时段。
 * 支持跨零点（start > end）；`start === end` 视为时段为空，返回 false。
 */
export function isInQuietHours(minuteOfDay: number, start: string, end: string): boolean {
  const s = parseHhMm(start)
  const e = parseHhMm(end)
  if (s === null || e === null) return false
  if (s === e) return false
  const m = Math.min(Math.max(Math.floor(minuteOfDay), 0), 24 * 60 - 1)
  if (s < e) return m >= s && m < e
  // 跨零点：22:00–08:00 → [22:00, 24:00) ∪ [00:00, 08:00)
  return m >= s || m < e
}

/** 提醒实际触发时刻 = remind_at − 提前量；非法输入返回 NaN。 */
export function resolveFireAt(remindAtIso: string, leadMinutes: number): number {
  const ms = Date.parse(remindAtIso)
  if (Number.isNaN(ms)) return Number.NaN
  const lead = Number.isFinite(leadMinutes) ? Math.max(0, Math.floor(leadMinutes)) : 0
  return ms - lead * 60_000
}

/**
 * 命中免打扰时，返回「免打扰结束」的绝对时刻（跨零点正确）。
 * 未命中则原样返回 fireAtMs。
 */
export function quietReleaseAt(fireAtMs: number, quiet: QuietHours, tzOffsetMinutes?: number): number {
  if (!Number.isFinite(fireAtMs)) return fireAtMs
  const tz = typeof tzOffsetMinutes === 'number' ? tzOffsetMinutes : localTzOffsetMinutes()
  if (!isInQuietHours(minuteOfDayOf(fireAtMs, tz), quiet.start, quiet.end)) return fireAtMs

  const endMin = parseHhMm(quiet.end)
  if (endMin === null) return fireAtMs

  const shifted = fireAtMs + tz * 60_000
  const wall = new Date(shifted)
  const dayStart = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate())
  let release = dayStart + endMin * 60_000
  while (release <= shifted) release += MS_PER_DAY
  return release - tz * 60_000
}

/** 单条提醒的判定。 */
export function shouldFire(input: ShouldFireInput): ShouldFireResult {
  const { fireAtMs, nowMs, quiet, quietEnabled, firedAtMs } = input
  if (!Number.isFinite(fireAtMs) || !Number.isFinite(nowMs)) {
    return { action: 'drop', atMs: nowMs }
  }
  if (firedAtMs !== undefined && firedAtMs !== null) {
    return { action: 'drop', atMs: fireAtMs }
  }
  if (nowMs < fireAtMs) {
    return { action: 'drop', atMs: fireAtMs }
  }
  if (nowMs - fireAtMs > STALE_MS) {
    return { action: 'drop', atMs: fireAtMs }
  }
  if (quietEnabled && isInQuietHours(minuteOfDayOf(nowMs, input.tzOffsetMinutes), quiet.start, quiet.end)) {
    return { action: 'defer', atMs: quietReleaseAt(fireAtMs, quiet, input.tzOffsetMinutes) }
  }
  return { action: 'fire', atMs: fireAtMs }
}

/** 去重键：同一条记录的同一次 remind_at 只弹一次。 */
export function dedupeKey(recordId: number, remindAt: string): string {
  return `${recordId}|${remindAt}`
}

/** 去重存储（键 → 首次弹出的 epoch ms）。 */
export type FiredStore = Record<string, number>

/** 清理过期去重键（默认保留 30 天；非法键一并清理）。 */
export function pruneFired(store: FiredStore, nowMs: number, keepMs: number = FIRED_KEEP_MS): FiredStore {
  const next: FiredStore = {}
  for (const [key, ts] of Object.entries(store)) {
    if (!Number.isFinite(ts)) continue
    const sep = key.indexOf('|')
    if (sep <= 0) continue
    const iso = key.slice(sep + 1)
    if (Number.isNaN(Date.parse(iso))) continue
    if (nowMs - ts > keepMs) continue
    next[key] = ts
  }
  return next
}
