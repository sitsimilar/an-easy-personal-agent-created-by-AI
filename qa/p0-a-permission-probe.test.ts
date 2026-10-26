/**
 * P0-A 通知权限探测（`reminderService.probePermissionOnce`）· 回归测试。
 *
 * 背景：修 P2-1 时把调度器默认总开关改为「开」（对齐 DB `notify_enabled DEFAULT true`），
 * 副作用是「默认开 → Web 端从不经过 toggle → 永不请求通知权限」。工程师补了
 * `probePermissionOnce()`（每会话一次、仅 web 且 permission==='default' 时请求、不阻塞 tick），
 * 本文件独立验证这条补丁：
 * - 默认权限态下，第一次调度会请求权限；
 * - 同一会话第二次调度**不再**重复请求（不骚扰用户）；
 * - 探测是非阻塞的、且非 web 通道跳过（静态约束）。
 *
 * 限制说明：`permissionProbed` 是模块级「每会话一次」开关，同一测试进程内无法重置，
 * 因此行为断言只能做一次（放在本文件第一个调用 tick 的用例里），其余用静态约束补足。
 */
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { __queueDbResults, __resetDbCalls, __resetDbQueue, __setDbResult } from './mocks/cloud'
import type { RecordsRow } from '../web/src/lib/database.types'

const ROOT = typeof __dirname === 'string' ? path.resolve(__dirname, '..', '..') : process.cwd()

function at(hhmm: string, day = '2026-10-12'): number {
  return Date.parse(`${day}T${hhmm}:00+08:00`)
}

interface Env {
  readonly permissionRequests: number
}

/** 注入 web 通知通道（permission 默认未决），返回可观测的请求计数。 */
function installWebEnv(initialPermission: 'default' | 'granted' | 'denied'): Env {
  const map = new Map<string, string>()
  const state = { permission: initialPermission, requests: 0 }

  class FakeNotification {
    static get permission(): string {
      return state.permission
    }
    static async requestPermission(): Promise<string> {
      state.requests += 1
      return state.permission
    }
    onclick: (() => void) | null = null
    onclose: (() => void) | null = null
    constructor(public title: string, public options: Record<string, unknown>) {}
    close(): void {
      this.onclose?.()
    }
  }

  ;(globalThis as unknown as { window: unknown }).window = {
    setTimeout: () => 0,
    clearTimeout: () => undefined,
    setInterval: (fn: () => void, ms?: number) => globalThis.setInterval(fn, ms),
    clearInterval: (id: number) => globalThis.clearInterval(id),
    location: { search: '' },
    focus: () => undefined,
    Notification: FakeNotification,
  }
  ;(globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
  }

  return {
    get permissionRequests() {
      return state.requests
    },
  }
}

function clearEnv(): void {
  delete (globalThis as unknown as { window?: unknown }).window
  delete (globalThis as unknown as { localStorage?: unknown }).localStorage
}

function todoRow(id: number): RecordsRow {
  return {
    id,
    owner_id: 'u1',
    type: 'todo',
    title: '交周报',
    content: null,
    url: null,
    file_path: null,
    category: '工作',
    tags: [],
    summary: null,
    todo_status: 'pending',
    priority: 'high',
    remind_at: new Date(at('10:00')).toISOString(),
    recurrence: null,
    recurrence_parent_id: null,
    recurrence_next_id: null,
    link_meta: null,
    is_deleted: false,
    deleted_at: null,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
  } as RecordsRow
}

function settingsRow(): Record<string, unknown> {
  return {
    id: 1,
    owner_id: 'u1',
    notify_enabled: true,
    remind_lead_minutes: 0,
    quiet_hours_enabled: false,
    quiet_start: '22:00',
    quiet_end: '08:00',
  }
}

const realNow = Date.now
const realTz = process.env.TZ

let reminderService: typeof import('../web/src/services/reminderService')
let notification: typeof import('../web/src/services/notification')

beforeEach(async () => {
  process.env.TZ = 'Asia/Shanghai'
  __resetDbCalls()
  __resetDbQueue()
  __setDbResult({ data: [] })
  reminderService = await import('../web/src/services/reminderService')
  notification = await import('../web/src/services/notification')
  reminderService.invalidateSettingsCache()
  notification.__resetNotificationProviderForTest()
  clearEnv()
})

afterEach(() => {
  Date.now = realNow
  if (realTz === undefined) delete process.env.TZ
  else process.env.TZ = realTz
  clearEnv()
})

test('权限探测：默认权限态下第一次调度请求一次，同会话第二次不再请求', async () => {
  const env = installWebEnv('default')
  Date.now = () => at('10:00')

  __resetDbQueue()
  __queueDbResults([{ data: settingsRow() }, { data: [todoRow(901)] }])
  await reminderService.tickNow()

  assert.equal(env.permissionRequests, 1, '默认权限态下应请求一次通知权限')

  // 第二个 tick（另一条记录）：不应重复请求权限（否则每次 tick 都弹权限框）
  __resetDbQueue()
  __queueDbResults([{ data: settingsRow() }, { data: [todoRow(902)] }])
  Date.now = () => at('10:00') + 30_000
  await reminderService.tickNow()

  assert.equal(env.permissionRequests, 1, '每会话只请求一次')
})

/* ------------------------------ 静态约束 ------------------------------ */

test('权限探测实现约束：每会话一次 + 仅 web 且 permission===default + 不 await + 受总开关前置', () => {
  const src = readFileSync(path.join(ROOT, 'web/src/services/reminderService.ts'), 'utf8')

  assert.match(src, /let permissionProbed = false/)
  assert.match(src, /if \(permissionProbed\) return/, '必须每会话只探测一次')
  assert.match(src, /provider\.channel !== 'web'/, '非 web 通道（desktop/inapp）应跳过请求')
  assert.match(src, /webNotificationPermission\(\) !== 'default'/, '仅默认未决态才请求，避免打扰已授权/已拒绝用户')
  assert.match(src, /void provider\.requestPermission\(\)/, '必须 fire-and-forget，不得阻塞调度')
  assert.match(
    src,
    /if \(!settings\.notifyEnabled\) return[\s\S]{0,120}probePermissionOnce\(\)/,
    '总开关关闭时不得探测权限（要放在开关判断之后）',
  )
})

test('P2-1 回归：调度器默认总开关为「开」，与 DB 默认一致', () => {
  const src = readFileSync(path.join(ROOT, 'web/src/services/reminderService.ts'), 'utf8')
  const sql = readFileSync(path.join(ROOT, 'docs/db-setup.sql'), 'utf8')

  assert.match(src, /notifyEnabled: true/, '调度器默认值应为开')
  assert.match(sql, /notify_enabled\s+BOOLEAN\s+DEFAULT true/, 'DB 默认应为 true（两处必须一致）')
})
