/**
 * 提醒调度器（P0-A，渲染层单例）。
 *
 * 生命周期：应用启动（Layout 挂载）→ start()；卸载 → stop()。
 * 触发点：30s 轮询 / 启动立即一次 / 页面重新可见 / 设置保存后立即一次。
 *
 * 去重：localStorage 键 `记录id|remind_at`（A4），配合内存锁避免同一 tick 重复。
 * 窗口隐藏时仍生效：桌面端 `backgroundThrottling: false` 保证渲染定时器不被降频。
 */

import { recordService } from '@/services/recordService'
import {
  getNotificationProvider,
  webNotificationPermission,
  type NotificationProvider,
} from '@/services/notification'
import { dedupeKey, pruneFired, resolveFireAt, shouldFire, STALE_MS, type FiredStore } from '@/lib/reminder-schedule'
import { profileService } from '@/services/profileService'
import type { InfoRecord, Priority } from '@shared/types/domain'

/** 轮询周期：30s（满足 A5「08:00–08:05 内补发」的 ±60s 精度要求）。 */
const TICK_MS = 30_000
/** settings 缓存有效期（保存设置时显式失效）。 */
const SETTINGS_TTL_MS = 5 * 60 * 1000
/** 去重存储键。 */
export const FIRED_STORAGE_KEY = 'personal-agent.reminder.fired.v1'

/** 提醒相关设置（从 settings 行映射）。 */
export interface ReminderSettings {
  notifyEnabled: boolean
  remindLeadMinutes: number
  quietHoursEnabled: boolean
  quietStart: string
  quietEnd: string
}

/**
 * 默认值（用于账号尚无 settings 行 / 读取失败时）。
 *
 * 总开关默认开启，与数据库 `settings.notify_enabled BOOLEAN DEFAULT true` 对齐：
 * 设置页在没有行时也显示「开」，避免出现「界面显示已开、调度器却按关静默」的不一致。
 * 提前量 0 + 免打扰关，与 2.11.0 行为一致。
 */
export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  notifyEnabled: true,
  remindLeadMinutes: 0,
  quietHoursEnabled: false,
  quietStart: '22:00',
  quietEnd: '08:00',
}

const PRIORITY_LABEL: Record<Priority, string> = { high: '高优先级', medium: '中优先级', low: '低优先级' }

let tickTimer: number | null = null
let ticking = false
let settingsCache: { value: ReminderSettings; ts: number } | null = null
/** 内存已弹集合（同一进程内的快速兜底）。 */
const firedInMemory = new Map<string, number>()
let visibilityBound = false

/** 读取去重存储（解析失败视为空）。 */
function loadFired(): FiredStore {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(FIRED_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const store: FiredStore = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value)) store[key] = value
    }
    return store
  } catch {
    return {}
  }
}

/** 写去重存储（隐私模式/配额超限时静默，仍有内存锁兜底）。 */
function saveFired(store: FiredStore): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(FIRED_STORAGE_KEY, JSON.stringify(store))
  } catch {
    /* 忽略写入失败 */
  }
}

/** 该键是否已弹过。 */
function isFired(key: string): boolean {
  if (firedInMemory.has(key)) return true
  const store = loadFired()
  const ts = store[key]
  if (typeof ts === 'number') {
    firedInMemory.set(key, ts)
    return true
  }
  return false
}

/**
 * 抢占去重键（写后读校验）。
 * @returns true 表示本次抢到，可以发通知；false 表示已被（本窗口/其它窗口）抢先。
 */
function claim(key: string): boolean {
  if (firedInMemory.has(key)) return false
  const now = Date.now()
  const store = loadFired()
  if (typeof store[key] === 'number') {
    firedInMemory.set(key, store[key])
    return false
  }
  store[key] = now
  firedInMemory.set(key, now)
  const pruned = pruneFired(store, now)
  saveFired(pruned)
  const after = loadFired()
  return typeof after[key] === 'number'
}

/** 从云端读取提醒设置（缓存 5 分钟）。 */
export async function getReminderSettings(force = false): Promise<ReminderSettings> {
  const now = Date.now()
  if (!force && settingsCache && now - settingsCache.ts < SETTINGS_TTL_MS) return settingsCache.value
  try {
    const row = await profileService.getSettings()
    const value: ReminderSettings = row
      ? {
          notifyEnabled: row.notify_enabled ?? false,
          remindLeadMinutes: Number.isFinite(row.remind_lead_minutes) ? Number(row.remind_lead_minutes) : 0,
          quietHoursEnabled: row.quiet_hours_enabled ?? false,
          quietStart: row.quiet_start || DEFAULT_REMINDER_SETTINGS.quietStart,
          quietEnd: row.quiet_end || DEFAULT_REMINDER_SETTINGS.quietEnd,
        }
      : { ...DEFAULT_REMINDER_SETTINGS }
    settingsCache = { value, ts: now }
    return value
  } catch {
    // 拉取失败：沿用缓存（若有）；无缓存时 fail-closed —— 读不到设置就不发，
    // 与设计 §8.3「取更不打扰策略」一致（默认值本身仍是「开」）；下个 tick 重试
    return settingsCache?.value ?? { ...DEFAULT_REMINDER_SETTINGS, notifyEnabled: false }
  }
}

/** 通知正文：分类 / 优先级 / 提醒时间。 */function buildBody(record: InfoRecord): string {
  const parts: string[] = []
  if (record.category) parts.push(record.category)
  if (record.priority) parts.push(PRIORITY_LABEL[record.priority] ?? '')
  if (record.remindAt) {
    const d = new Date(record.remindAt)
    if (!Number.isNaN(d.getTime())) {
      parts.push(
        d.toLocaleString('zh-CN', {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }),
      )
    }
  }
  return parts.filter(Boolean).join(' · ') || '待办提醒'
}

/** 处理单条候选。 */
async function handleCandidate(
  record: InfoRecord,
  settings: ReminderSettings,
  provider: NotificationProvider,
  nowMs: number,
): Promise<void> {
  if (!record.remindAt) return
  const fireAtMs = resolveFireAt(record.remindAt, settings.remindLeadMinutes)
  if (Number.isNaN(fireAtMs)) return

  const key = dedupeKey(record.id, record.remindAt)
  if (isFired(key)) return
  // 未到点：本 tick 不处理（也不写键，等真正到点）
  if (nowMs < fireAtMs) return

  const decision = shouldFire({
    fireAtMs,
    nowMs,
    quiet: { start: settings.quietStart, end: settings.quietEnd },
    quietEnabled: settings.quietHoursEnabled,
  })

  // 免打扰：不写键，等到免打扰结束的那个 tick 再发
  if (decision.action === 'defer') return

  if (decision.action === 'drop') {
    // 只可能是「已弹过」或「超过 12h」：写键避免下个 tick 再判定
    claim(key)
    return
  }

  if (!claim(key)) return

  await provider.notify({
    key,
    recordId: record.id,
    title: record.title?.trim() || '待办提醒',
    body: buildBody(record),
  })
}

/** 每个会话只探测一次通知权限。 */
let permissionProbed = false

/**
 * 总开关默认开启（对齐 DB），因此 Web 端可能在用户从未点过开关时就需要权限：
 * 首次 tick 主动探测一次（仅当浏览器权限仍为 default），避免全部降级为应用内提示。
 * 桌面端由主进程直接创建通知，无需授权；探测失败静默忽略。
 */
function probePermissionOnce(): void {
  if (permissionProbed) return
  permissionProbed = true
  try {
    const provider = getNotificationProvider()
    if (provider.channel !== 'web') return
    if (webNotificationPermission() !== 'default') return
    void provider.requestPermission().catch(() => undefined)
  } catch {
    /* 权限探测失败不阻塞调度 */
  }
}

/**
 * 立即执行一次调度（启动 / 可见性变化 / 设置保存后 / 定时器）。
 * 并发保护：上一轮未结束时直接跳过。
 */
export async function tickNow(): Promise<void> {
  if (typeof window === 'undefined') return
  if (ticking) return
  ticking = true
  try {
    const settings = await getReminderSettings()
    // 总开关关闭：不发通知，也不写去重键（重开后 12h 内仍可补发）
    if (!settings.notifyEnabled) return

    probePermissionOnce()

    const nowMs = Date.now()
    const leadMs = Math.max(0, settings.remindLeadMinutes) * 60_000
    const fromIso = new Date(nowMs - STALE_MS - leadMs).toISOString()
    const toIso = new Date(nowMs + leadMs + 60_000).toISOString()

    const candidates = await recordService.listReminderCandidates(fromIso, toIso)
    if (candidates.length === 0) return

    const provider = getNotificationProvider()
    for (const record of candidates) {
      await handleCandidate(record, settings, provider, nowMs)
    }
  } catch {
    /* 调度异常静默，下一 tick 自动重试 */
  } finally {
    ticking = false
  }
}

/** 页面重新可见时补一次（浏览器会冻结后台标签页的定时器）。 */
let visibilityHandler: (() => void) | null = null

function bindVisibility(): void {
  if (visibilityBound || typeof document === 'undefined') return
  visibilityBound = true
  visibilityHandler = () => {
    if (document.visibilityState === 'visible') void tickNow()
  }
  document.addEventListener('visibilitychange', visibilityHandler)
}

/** 解绑可见性监听（卸载/登出时避免残留）。 */
function unbindVisibility(): void {
  if (!visibilityBound || typeof document === 'undefined') return
  if (visibilityHandler) document.removeEventListener('visibilitychange', visibilityHandler)
  visibilityHandler = null
  visibilityBound = false
}

/** 当总开关首次开启时请求通知权限（Web 需要；桌面直接 granted）。 */
export async function requestNotificationPermission(): Promise<'granted' | 'denied' | 'default'> {
  try {
    return await getNotificationProvider().requestPermission()
  } catch {
    return 'denied'
  }
}

/** 启动调度器（幂等）。 */
export function start(): void {
  if (typeof window === 'undefined') return
  bindVisibility()
  if (tickTimer !== null) return
  void tickNow()
  tickTimer = window.setInterval(() => {
    void tickNow()
  }, TICK_MS)
}

/** 停止调度器（幂等）。 */
export function stop(): void {
  unbindVisibility()
  if (tickTimer === null) return
  window.clearInterval(tickTimer)
  tickTimer = null
}

/** 设置保存后：让缓存失效并立即重算（开关/提前量/免打扰即时生效）。 */
export function onSettingsSaved(): void {
  settingsCache = null
  void tickNow()
}

/** 清空设置缓存（账号切换等场景）。 */
export function invalidateSettingsCache(): void {
  settingsCache = null
}

/** 调度器单例（与项目其它 service 风格一致）。 */
export const reminderService = {
  start,
  stop,
  tickNow,
  onSettingsSaved,
  getSettings: getReminderSettings,
  invalidateSettingsCache,
  requestPermission: requestNotificationPermission,
}
