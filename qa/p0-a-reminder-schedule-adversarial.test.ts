/**
 * P0-A 提醒判定纯函数 · 对抗性测试（QA 独立补充，A3/A4/A5 边界）。
 *
 * 与工程师用例的差异：这里专门打**边界值本身**（22:00 整、08:00 整、21:59、07:59、
 * 恰好 12h / 12h+1ms、start===end、非跨零点区间），并验证「补发时刻」与「去重键」的稳定性。
 * 时区一律显式注入（东八区 = 480），与运行机器时区无关。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  dedupeKey,
  formatHhMm,
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
const QUIET = { start: '22:00', end: '08:00' }

/** 东八区墙钟 → epoch ms（避免依赖机器时区）。 */
function at(hhmm: string, day = '2026-10-12'): number {
  return Date.parse(`${day}T${hhmm}:00+08:00`)
}

/* --------------------------- 免打扰边界（A5） --------------------------- */

test('A5 边界：22:00 整命中免打扰，21:59 不命中', () => {
  assert.equal(isInQuietHours(22 * 60, QUIET.start, QUIET.end), true, '22:00 应命中')
  assert.equal(isInQuietHours(22 * 60 - 1, QUIET.start, QUIET.end), false, '21:59 不应命中')
})

test('A5 边界：08:00 整不命中（结束点开区间），07:59 命中', () => {
  assert.equal(isInQuietHours(8 * 60, QUIET.start, QUIET.end), false, '08:00 应已解除')
  assert.equal(isInQuietHours(8 * 60 - 1, QUIET.start, QUIET.end), true, '07:59 仍应命中')
})

test('start === end：视为不启用（任何时刻都不命中）', () => {
  for (const minute of [0, 8 * 60, 12 * 60, 22 * 60, 23 * 60 + 59]) {
    assert.equal(isInQuietHours(minute, '22:00', '22:00'), false, `${formatHhMm(minute)} 不应命中`)
  }
})

test('非跨零点区间：12:00–14:00 的边界与补发时刻', () => {
  const quiet = { start: '12:00', end: '14:00' }
  assert.equal(isInQuietHours(12 * 60, quiet.start, quiet.end), true)
  assert.equal(isInQuietHours(14 * 60, quiet.start, quiet.end), false)
  assert.equal(quietReleaseAt(at('13:00'), quiet, TZ), at('14:00'), '同日 14:00 补发')
  assert.equal(quietReleaseAt(at('14:00'), quiet, TZ), at('14:00'), '恰好结束点原样返回')
})

/* ------------------------- 跨零点补发时刻（A5） ------------------------- */

test('A5 跨零点补发：23:00 的提醒 release 到次日 08:00', () => {
  const fireAt = at('23:00')
  assert.equal(quietReleaseAt(fireAt, QUIET, TZ), at('08:00', '2026-10-13'))
})

test('A5 跨零点补发：07:30 的提醒 release 到当日 08:00', () => {
  const fireAt = at('07:30', '2026-10-13')
  assert.equal(quietReleaseAt(fireAt, QUIET, TZ), at('08:00', '2026-10-13'))
})

test('A5 跨零点补发：22:00 与 00:00 精确边界的 release 归属正确', () => {
  assert.equal(quietReleaseAt(at('22:00'), QUIET, TZ), at('08:00', '2026-10-13'), '22:00 → 次日 08:00')
  assert.equal(quietReleaseAt(at('00:00', '2026-10-13'), QUIET, TZ), at('08:00', '2026-10-13'), '00:00 → 当日 08:00')
})

test('A5 跨零点补发：08:00 与 21:59 不在时段内，原样返回', () => {
  assert.equal(quietReleaseAt(at('08:00'), QUIET, TZ), at('08:00'))
  assert.equal(quietReleaseAt(at('21:59'), QUIET, TZ), at('21:59'))
})

test('shouldFire：23:00 命中的 defer.atMs 等于次日 08:00（与 quietReleaseAt 一致）', () => {
  const fireAt = at('23:00')
  const r = shouldFire({ fireAtMs: fireAt, nowMs: fireAt + MIN, quiet: QUIET, quietEnabled: true, tzOffsetMinutes: TZ })
  assert.equal(r.action, 'defer')
  assert.equal(r.atMs, at('08:00', '2026-10-13'))
})

/* --------------------------- 12h 丢弃边界（A5） --------------------------- */

test('A5 12h 边界：恰好 12h 触发（PRD 口径为「超过 12h」才丢）', () => {
  const fireAt = at('10:00')
  const r = shouldFire({
    fireAtMs: fireAt,
    nowMs: fireAt + STALE_MS,
    quiet: QUIET,
    quietEnabled: false,
    tzOffsetMinutes: TZ,
  })
  assert.equal(r.action, 'fire', '恰好 12h 应补发')
  assert.equal(r.atMs, fireAt)
})

test('A5 12h 边界：12h + 1ms 丢弃', () => {
  const fireAt = at('10:00')
  const r = shouldFire({
    fireAtMs: fireAt,
    nowMs: fireAt + STALE_MS + 1,
    quiet: QUIET,
    quietEnabled: false,
    tzOffsetMinutes: TZ,
  })
  assert.equal(r.action, 'drop')
})

/* ----------------------------- 提前量（A3） ----------------------------- */

test('A3 提前量：remind_at=10:00、lead=10 → 09:50；lead=0 → 10:00', () => {
  const remindAt = '2026-10-12T10:00:00+08:00'
  const lead10 = resolveFireAt(remindAt, 10)
  assert.equal(lead10, at('09:50'))
  assert.equal(minuteOfDayOf(lead10, TZ), 9 * 60 + 50)

  const lead0 = resolveFireAt(remindAt, 0)
  assert.equal(lead0, at('10:00'))
  assert.equal(minuteOfDayOf(lead0, TZ), 10 * 60)
})

test('A3 提前量：负值/非数按 0 处理，非法 ISO 返回 NaN', () => {
  const remindAt = '2026-10-12T10:00:00+08:00'
  assert.equal(resolveFireAt(remindAt, -5), at('10:00'))
  assert.equal(resolveFireAt(remindAt, Number.NaN), at('10:00'))
  assert.ok(Number.isNaN(resolveFireAt('not-a-date', 10)))
})

test('A3 提前量边界：lead=10 时 09:49:59 不 fire，09:50 整 fire', () => {
  const fireAt = resolveFireAt('2026-10-12T10:00:00+08:00', 10)
  const base = { fireAtMs: fireAt, quiet: QUIET, quietEnabled: true, tzOffsetMinutes: TZ }
  assert.equal(shouldFire({ ...base, nowMs: fireAt - 1000 }).action, 'drop', '未到点应 drop')
  assert.equal(shouldFire({ ...base, nowMs: fireAt }).action, 'fire', '到点应 fire')
})

/* ------------------------------ 去重键（A4） ------------------------------ */

test('A4 去重键：同一记录同一 remind_at 稳定；不同 remind_at / 不同记录不同键', () => {
  const remindAt = '2026-10-12T02:00:00.000Z'
  assert.equal(dedupeKey(7, remindAt), dedupeKey(7, remindAt), '同输入必须稳定')
  assert.notEqual(dedupeKey(7, remindAt), dedupeKey(7, '2026-10-13T02:00:00.000Z'), '改时间应换键（允许再弹）')
  assert.notEqual(dedupeKey(7, remindAt), dedupeKey(8, remindAt), '不同记录应不同键')
})

test('A4 去重键：改提前量不换键（同记录同 remind_at 只弹一次）', () => {
  const remindAt = '2026-10-12T02:00:00.000Z'
  // 键只由 (记录 id, remind_at) 决定，与 lead 无关 → 这一条断言即 A3/A4 口径冲突的裁决依据
  assert.equal(dedupeKey(7, remindAt), `${7}|${remindAt}`)
})

test('A4 去重键可被 pruneFired 正确解析与保留', () => {
  const now = at('23:30', '2026-10-12')
  const key = dedupeKey(7, '2026-10-12T02:00:00.000Z')
  const pruned = pruneFired({ [key]: now - MIN }, now)
  assert.deepEqual(Object.keys(pruned), [key], '合法键 + 未过期应保留')
  const expired = pruneFired({ [key]: now - 31 * 24 * 60 * MIN }, now)
  assert.deepEqual(Object.keys(expired), [], '超过 30 天应清理')
})

/* ------------------------------ 其他不变量 ------------------------------ */

test('parseHhMm / formatHhMm 往返一致（00:00–23:59 抽样）', () => {
  for (const text of ['00:00', '07:59', '08:00', '12:00', '22:00', '23:59']) {
    const minute = parseHhMm(text)
    assert.equal(formatHhMm(minute as number), text, `${text} 往返应一致`)
  }
})

test('空免打扰时段字符串：不命中且补发原样返回（脏设置不炸调度）', () => {
  const quiet = { start: '', end: '' }
  assert.equal(isInQuietHours(23 * 60, quiet.start, quiet.end), false)
  const fireAt = at('23:00')
  assert.equal(quietReleaseAt(fireAt, quiet, TZ), fireAt)
  assert.equal(
    shouldFire({ fireAtMs: fireAt, nowMs: fireAt, quiet, quietEnabled: true, tzOffsetMinutes: TZ }).action,
    'fire',
  )
})
