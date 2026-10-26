/**
 * P0-A 提醒调度器（reminderService）· 集成测试（QA 独立补充）。
 *
 * 用假的 `window` / `localStorage` 注入浏览器环境，配合 qa/mocks/cloud.ts 提供云端数据，
 * 直接驱动 `tickNow()` 验证 A1/A3/A4/A5/A6 的**调度行为**（不是纯函数，而是真实判定链路）：
 * - 总开关关闭 → 不发通知、也不写去重键；
 * - 到点 → 经 desktop 通道发一次，标题/正文符合 PRD；
 * - 同一 (记录, remind_at) 第二次 tick 不再发（去重键落 localStorage，跨刷新可用）；
 * - 免打扰 23:00 不发、08:00 补发一次；
 * - 超过 12h 丢弃且不重复轰炸；
 * - 提前量 10 分钟生效；桌面通道失败降级为应用内提示且不抛错。
 *
 * 注意：`firedInMemory` 是模块级状态，故每个用例使用**不同的记录 id** 以互不串扰。
 */
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  __dbCalls,
  __queueDbResults,
  __resetDbCalls,
  __resetDbQueue,
  __setDbResult,
} from './mocks/cloud'
import type { RecordsRow } from '../web/src/lib/database.types'

const FIRED_KEY = 'personal-agent.reminder.fired.v1'

/** 东八区墙钟 → epoch ms。 */
function at(hhmm: string, day = '2026-10-12'): number {
  return Date.parse(`${day}T${hhmm}:00+08:00`)
}

/** 记录 remind_at 的 ISO 形态（去重键的一部分）。 */
function iso(hhmm: string, day = '2026-10-12'): string {
  return new Date(at(hhmm, day)).toISOString()
}

/* ------------------------------ 环境注入 ------------------------------ */

interface Sent {
  title: string
  body: string
  recordId: number
  key: string
}

interface Harness {
  sent: Sent[]
  firedKeys: () => string[]
  setBridgeResult: (ok: boolean) => void
}

interface FakeWindow {
  setTimeout: (fn: () => void, ms?: number) => number
  clearTimeout: (id: number) => void
  setInterval: (fn: () => void, ms?: number) => number
  clearInterval: (id: number) => void
  location: { search: string }
  desktopBridge?: { notify: (payload: Sent) => Promise<{ ok: boolean; message?: string }>; onNotificationClicked: () => () => void }
}

function makeLocalStorage(): { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void } {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
  }
}

function installEnv(): Harness {
  const sent: Sent[] = []
  let bridgeOk = true
  const store = makeLocalStorage()

  const windowStub: FakeWindow = {
    // 应用内提示的自动消失定时器不参与断言：用空实现避免挂住事件循环
    setTimeout: () => 0,
    clearTimeout: () => undefined,
    setInterval: (fn, ms) => globalThis.setInterval(fn, ms) as unknown as number,
    clearInterval: (id) => globalThis.clearInterval(id),
    location: { search: '' },
    desktopBridge: {
      notify: async (payload) => {
        if (bridgeOk) sent.push(payload)
        return bridgeOk ? { ok: true } : { ok: false, message: '系统不支持通知' }
      },
      onNotificationClicked: () => () => undefined,
    },
  }

  ;(globalThis as unknown as { window: unknown }).window = windowStub
  ;(globalThis as unknown as { localStorage: unknown }).localStorage = store

  return {
    sent,
    firedKeys: () => {
      const value = store.getItem(FIRED_KEY)
      return value ? Object.keys(JSON.parse(value) as Record<string, number>) : []
    },
    setBridgeResult: (ok) => {
      bridgeOk = ok
    },
  }
}

function clearEnv(): void {
  delete (globalThis as unknown as { window?: unknown }).window
  delete (globalThis as unknown as { localStorage?: unknown }).localStorage
}

/* ------------------------------ 数据构造 ------------------------------ */

function settingsRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    owner_id: 'u1',
    notify_enabled: true,
    remind_lead_minutes: 0,
    quiet_hours_enabled: false,
    quiet_start: '22:00',
    quiet_end: '08:00',
    ...over,
  }
}

function todoRow(over: Partial<RecordsRow> = {}): RecordsRow {
  return {
    id: 42,
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
    remind_at: iso('10:00'),
    recurrence: null,
    recurrence_parent_id: null,
    recurrence_next_id: null,
    link_meta: null,
    is_deleted: false,
    deleted_at: null,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
    ...over,
  } as RecordsRow
}

/* --------------------------- 模块加载与时钟控制 --------------------------- */

const realNow = Date.now
const realTz = process.env.TZ

let reminderService: typeof import('../web/src/services/reminderService')
let notification: typeof import('../web/src/services/notification')

function setNow(ms: number): void {
  Date.now = () => ms
}

beforeEach(async () => {
  process.env.TZ = 'Asia/Shanghai'
  __resetDbCalls()
  __resetDbQueue()
  __setDbResult({ data: [] })
  reminderService = await import('../web/src/services/reminderService')
  notification = await import('../web/src/services/notification')
  reminderService.invalidateSettingsCache()
  notification.__resetNotificationProviderForTest()
})

afterEach(() => {
  Date.now = realNow
  if (realTz === undefined) delete process.env.TZ
  else process.env.TZ = realTz
  clearEnv()
})

/** 预置「设置行 + 候选记录」，跑一次 tick（会重置设置缓存以保证每次都读设置）。 */
async function runTick(settings: Record<string, unknown>, records: RecordsRow[], nowMs: number): Promise<Harness> {
  __resetDbCalls()
  __resetDbQueue()
  reminderService.invalidateSettingsCache()
  const env = installEnv()
  __queueDbResults([{ data: settings }, { data: records }])
  setNow(nowMs)
  await reminderService.tickNow()
  return env
}

/** 在已有环境上再跑一个 tick（沿用同一个 localStorage，验证去重/补发；设置缓存显式失效）。 */
async function tickAgain(
  env: Harness,
  settings: Record<string, unknown>,
  records: RecordsRow[],
  nowMs: number,
): Promise<void> {
  __resetDbQueue()
  reminderService.invalidateSettingsCache()
  __queueDbResults([{ data: settings }, { data: records }])
  setNow(nowMs)
  await reminderService.tickNow()
  void env
}

/* --------------------------------- 用例 --------------------------------- */

test('A1 到点触发：desktop 通道发 1 次，标题=记录标题，正文含分类/优先级', async () => {
  const env = await runTick(settingsRow(), [todoRow({ id: 42 })], at('10:00'))

  assert.equal(env.sent.length, 1, '应发且仅发一次通知')
  assert.equal(env.sent[0].title, '交周报')
  assert.match(env.sent[0].body, /工作/)
  assert.match(env.sent[0].body, /高优先级/)
  assert.equal(env.sent[0].recordId, 42, '点击后要能定位记录')
  assert.equal(env.sent[0].key, `42|${iso('10:00')}`)
})

test('A1 未到点不发；到点后下一个 tick 才发', async () => {
  const env = await runTick(settingsRow(), [todoRow({ id: 43 })], at('09:59') + 59_000)
  assert.equal(env.sent.length, 0, '未到点不应发')

  await tickAgain(env, settingsRow(), [todoRow({ id: 43 })], at('10:00'))
  assert.equal(env.sent.length, 1, '到点应发')
})

test('A4 去重：同一 (记录, remind_at) 第二个 tick 不再发，且键写入 localStorage', async () => {
  const env = await runTick(settingsRow(), [todoRow({ id: 44 })], at('10:00'))
  assert.equal(env.sent.length, 1)
  assert.deepEqual(env.firedKeys(), [`44|${iso('10:00')}`], '去重键必须落 localStorage（跨刷新可用）')

  await tickAgain(env, settingsRow(), [todoRow({ id: 44 })], at('10:00') + 30_000)
  assert.equal(env.sent.length, 1, '不得重复弹')
})

test('A4 改 remind_at 后允许再弹一次（新键）', async () => {
  const env = await runTick(settingsRow(), [todoRow({ id: 45 })], at('10:00'))
  assert.equal(env.sent.length, 1)

  await tickAgain(env, settingsRow(), [todoRow({ id: 45, remind_at: iso('11:00') })], at('11:00'))
  assert.equal(env.sent.length, 2, '新 remind_at = 新去重键，应再弹一次')
  assert.equal(env.firedKeys().length, 2)
})

test('A6 总开关关闭：不发通知，也不写去重键（重开后仍可补发）', async () => {
  const env = await runTick(settingsRow({ notify_enabled: false }), [todoRow({ id: 46 })], at('10:00'))

  assert.equal(env.sent.length, 0, '关闭总开关不得发通知')
  assert.deepEqual(env.firedKeys(), [], '关闭态不应占用去重键')
})

test('A6 总开关关闭时不做提醒查询（省流量、避免误判）', async () => {
  await runTick(settingsRow({ notify_enabled: false }), [todoRow({ id: 47 })], at('10:00'))

  assert.ok(!__dbCalls.some((c) => c.startsWith('gte(remind_at')), '关闭态不应发起提醒候选查询')
})

test('A5 免打扰：23:00 不发；次日 08:00 补发一次', async () => {
  const quiet = settingsRow({ quiet_hours_enabled: true })
  const nightTodo = todoRow({ id: 48, remind_at: iso('23:00') })

  const env = await runTick(quiet, [nightTodo], at('23:00'))
  assert.equal(env.sent.length, 0, '免打扰时段内不得弹通知')
  assert.deepEqual(env.firedKeys(), [], 'defer 不应写去重键（否则不会补发）')

  await tickAgain(env, quiet, [nightTodo], at('08:00', '2026-10-13'))
  assert.equal(env.sent.length, 1, '免打扰结束后第一个调度周期应补发一次')
})

test('A5 免打扰关闭：夜间 23:00 立即发', async () => {
  const env = await runTick(
    settingsRow({ quiet_hours_enabled: false }),
    [todoRow({ id: 49, remind_at: iso('23:00') })],
    at('23:00'),
  )

  assert.equal(env.sent.length, 1)
})

test('A5 超过 12h：丢弃且写键（不堆积轰炸），后续 tick 不再尝试', async () => {
  const stale = todoRow({ id: 77, remind_at: iso('10:00', '2026-10-11') })

  const env = await runTick(settingsRow(), [stale], at('23:00', '2026-10-12')) // 37h 前
  assert.equal(env.sent.length, 0, '超过 12h 不应补发')
  assert.equal(env.firedKeys().length, 1, '应写入去重键避免反复判定')

  await tickAgain(env, settingsRow(), [stale], at('23:00', '2026-10-12'))
  assert.equal(env.sent.length, 0)
})

test('A3 提前量 10 分钟：09:49 不发，09:50 发', async () => {
  const lead = settingsRow({ remind_lead_minutes: 10 })

  const env = await runTick(lead, [todoRow({ id: 50 })], at('09:49'))
  assert.equal(env.sent.length, 0, '09:49 未到 09:50')

  await tickAgain(env, lead, [todoRow({ id: 50 })], at('09:50'))
  assert.equal(env.sent.length, 1, '09:50 应触发')
})

test('标题为空时用「待办提醒」兜底（PRD 文案）', async () => {
  const env = await runTick(settingsRow(), [todoRow({ id: 51, title: '   ' })], at('10:00'))

  assert.equal(env.sent.length, 1)
  assert.equal(env.sent[0].title, '待办提醒')
})

test('A6 桌面通道失败：降级为应用内提示，不抛错', async () => {
  const env = await runTick(settingsRow(), [todoRow({ id: 52 })], at('10:00'))
  assert.equal(env.sent.length, 1, '先验证正常路径')

  env.setBridgeResult(false)
  __resetDbQueue()
  __queueDbResults([{ data: [todoRow({ id: 53 })] }])
  setNow(at('10:00'))
  await assert.doesNotReject(() => reminderService.tickNow(), '通道失败不得向外抛错')
  assert.equal(env.sent.length, 1, '失败的那次不记为已发送')
})

test('调度器静默容错：云端查询抛错不影响后续（不向外抛）', async () => {
  installEnv()
  __resetDbQueue()
  __queueDbResults([{ data: null, error: new Error('cloud down') }])
  reminderService.invalidateSettingsCache()
  setNow(at('10:00'))

  await assert.doesNotReject(() => reminderService.tickNow())
})
