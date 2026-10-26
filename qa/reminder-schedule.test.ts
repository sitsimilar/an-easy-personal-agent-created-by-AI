/**
 * web/src/lib/reminder-schedule.ts 单元测试（P0-A A3/A4/A5 边界）。
 * 时区一律显式注入（东八区 = 480），与运行机器时区无关。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  dedupeKey,
  isInQuietHours,
  minuteOfDayOf,
  parseHhMm,
  pruneFired,
  quietReleaseAt,
  resolveFireAt,
  shouldFire,
  STALE_MS,
} from '../web/src/lib/reminder-schedule'

const TZ = 480
const MIN = 60_000

test('isInQuietHours：跨零点 22:00–08:00', () => {
  const start = '22:00'
  const end = '08:00'
  assert.equal(isInQuietHours(23 * 60, start, end), true) // 23:00
  assert.equal(isInQuietHours(7 * 60 + 30, start, end), true) // 07:30
  assert.equal(isInQuietHours(0, start, end), true) // 00:00
  assert.equal(isInQuietHours(8 * 60, start, end), false) // 08:00（结束点不算）
  assert.equal(isInQuietHours(21 * 60 + 59, start, end), false) // 21:59
  assert.equal(isInQuietHours(12 * 60, start, end), false)
})

test('isInQuietHours：普通区间与空区间', () => {
  assert.equal(isInQuietHours(13 * 60, '12:00', '14:00'), true)
  assert.equal(isInQuietHours(14 * 60, '12:00', '14:00'), false)
  assert.equal(isInQuietHours(12 * 60, '12:00', '12:00'), false) // start === end → 空
  assert.equal(isInQuietHours(12 * 60, 'bad', '14:00'), false) // 非法输入不生效
})

test('parseHhMm：合法与非法', () => {
  assert.equal(parseHhMm('08:05'), 8 * 60 + 5)
  assert.equal(parseHhMm('23:59'), 23 * 60 + 59)
  assert.equal(parseHhMm('24:00'), null)
  assert.equal(parseHhMm('8:5'), null)
  assert.equal(parseHhMm(''), null)
})

test('A3 提前量：fireAt = remind_at − 10 分钟，墙钟 09:50', () => {
  const remindAt = '2026-10-12T10:00:00+08:00'
  const fireAt = resolveFireAt(remindAt, 10)
  assert.equal(fireAt, Date.parse(remindAt) - 10 * MIN)
  assert.equal(minuteOfDayOf(fireAt, TZ), 9 * 60 + 50)
  // 提前量 0 → 正好等于 remind_at
  assert.equal(resolveFireAt(remindAt, 0), Date.parse(remindAt))
})

test('A5 quietReleaseAt：23:00 与 07:30 都补发到次日/当日 08:00', () => {
  const quiet = { start: '22:00', end: '08:00' }

  const late = Date.parse('2026-10-12T23:00:00+08:00')
  const lateRelease = quietReleaseAt(late, quiet, TZ)
  assert.equal(lateRelease, Date.parse('2026-10-13T08:00:00+08:00'))

  const early = Date.parse('2026-10-13T07:30:00+08:00')
  const earlyRelease = quietReleaseAt(early, quiet, TZ)
  assert.equal(earlyRelease, Date.parse('2026-10-13T08:00:00+08:00'))

  // 不在免打扰时段 → 原样返回
  const noon = Date.parse('2026-10-12T12:00:00+08:00')
  assert.equal(quietReleaseAt(noon, quiet, TZ), noon)
})

test('shouldFire：到点且不在免打扰 → fire', () => {
  const fireAtMs = Date.parse('2026-10-12T10:00:00+08:00')
  const r = shouldFire({
    fireAtMs,
    nowMs: fireAtMs + 5_000,
    quiet: { start: '22:00', end: '08:00' },
    quietEnabled: true,
    tzOffsetMinutes: TZ,
  })
  assert.deepEqual(r, { action: 'fire', atMs: fireAtMs })
})

test('A5 shouldFire：命中免打扰 → defer 到结束时刻且不丢', () => {
  const fireAtMs = Date.parse('2026-10-12T23:00:00+08:00')
  const r = shouldFire({
    fireAtMs,
    nowMs: fireAtMs + 10_000,
    quiet: { start: '22:00', end: '08:00' },
    quietEnabled: true,
    tzOffsetMinutes: TZ,
  })
  assert.equal(r.action, 'defer')
  assert.equal(r.atMs, Date.parse('2026-10-13T08:00:00+08:00'))

  // 08:00 那个 tick：已过免打扰 → fire（补发）
  const releaseTick = shouldFire({
    fireAtMs,
    nowMs: Date.parse('2026-10-13T08:00:20+08:00'),
    quiet: { start: '22:00', end: '08:00' },
    quietEnabled: true,
    tzOffsetMinutes: TZ,
  })
  assert.equal(releaseTick.action, 'fire')
})

test('免打扰关闭：夜间同样立即 fire', () => {
  const fireAtMs = Date.parse('2026-10-12T23:00:00+08:00')
  const r = shouldFire({
    fireAtMs,
    nowMs: fireAtMs,
    quiet: { start: '22:00', end: '08:00' },
    quietEnabled: false,
    tzOffsetMinutes: TZ,
  })
  assert.equal(r.action, 'fire')
})

test('超过 12 小时未补发 → drop，不堆积', () => {
  const fireAtMs = Date.parse('2026-10-11T10:00:00+08:00')
  const r = shouldFire({
    fireAtMs,
    nowMs: fireAtMs + STALE_MS + 1,
    quiet: { start: '22:00', end: '08:00' },
    quietEnabled: false,
    tzOffsetMinutes: TZ,
  })
  assert.equal(r.action, 'drop')

  // 恰好 12 小时内仍可补发
  const stillFresh = shouldFire({
    fireAtMs,
    nowMs: fireAtMs + STALE_MS - 1,
    quiet: { start: '22:00', end: '08:00' },
    quietEnabled: false,
    tzOffsetMinutes: TZ,
  })
  assert.equal(stillFresh.action, 'fire')
})

test('A4 已弹过（firedAtMs 有值）→ drop；未到点也 drop', () => {
  const fireAtMs = Date.parse('2026-10-12T10:00:00+08:00')

  const fired = shouldFire({
    fireAtMs,
    nowMs: fireAtMs + 1_000,
    quiet: { start: '22:00', end: '08:00' },
    quietEnabled: false,
    firedAtMs: fireAtMs,
    tzOffsetMinutes: TZ,
  })
  assert.equal(fired.action, 'drop')

  const early = shouldFire({
    fireAtMs,
    nowMs: fireAtMs - 60_000,
    quiet: { start: '22:00', end: '08:00' },
    quietEnabled: false,
    tzOffsetMinutes: TZ,
  })
  assert.equal(early.action, 'drop')
})

test('时区参数化：同一绝对时刻在不同时区得到不同的免打扰判定', () => {
  const fireAtMs = Date.parse('2026-10-12T15:00:00.000Z') // +08 = 23:00，UTC = 15:00
  const base = {
    fireAtMs,
    nowMs: fireAtMs,
    quiet: { start: '22:00', end: '08:00' },
    quietEnabled: true,
  }
  assert.equal(shouldFire({ ...base, tzOffsetMinutes: 480 }).action, 'defer')
  assert.equal(shouldFire({ ...base, tzOffsetMinutes: 0 }).action, 'fire')
})

test('dedupeKey：记录 id + remind_at', () => {
  assert.equal(dedupeKey(7, '2026-10-12T02:00:00.000Z'), '7|2026-10-12T02:00:00.000Z')
})

test('pruneFired：清理过期与非法键', () => {
  const now = Date.parse('2026-10-20T00:00:00+08:00')
  const store = {
    '1|2026-10-19T10:00:00+08:00': now - 1000,
    '2|2026-01-01T10:00:00+08:00': now - 100 * 86_400_000,
    'badkey': now,
  }
  const pruned = pruneFired(store, now)
  assert.deepEqual(Object.keys(pruned), ['1|2026-10-19T10:00:00+08:00'])
})
