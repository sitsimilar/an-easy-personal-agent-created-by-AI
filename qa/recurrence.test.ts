/**
 * web/src/lib/recurrence.ts 单元测试（P0-B B1–B4 边界）。
 *
 * 所有断言都通过「平移轴墙钟」比较，时区显式注入（东八区 +480），
 * 与运行机器时区无关。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeNext, describeRecurrence, normalizeRecurrenceRule } from '../web/src/lib/recurrence'
import type { RecurrenceRule } from '../shared/types/domain'

const TZ = 480

/** 把 ISO 转成东八区墙钟字段，便于断言「时分不变」。 */
function wall(iso: string, tz = TZ): { key: string; hour: number; minute: number; dow: number } {
  const d = new Date(Date.parse(iso) + tz * 60_000)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return {
    key: `${y}-${m}-${day}`,
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    dow: d.getUTCDay(),
  }
}

const rule = (over: Partial<RecurrenceRule> & Pick<RecurrenceRule, 'freq'>): RecurrenceRule => ({
  interval: 1,
  endDate: null,
  ...over,
})

test('B1 每天：下一期 = 原提醒时间 + 1 天，时分不变', () => {
  const r = computeNext(rule({ freq: 'daily' }), {
    remindAt: '2026-10-12T10:00:00+08:00',
    nowIso: '2026-10-12T10:05:00+08:00',
    tzOffsetMinutes: TZ,
  })
  assert.equal(r.ruleEnded, false)
  const w = wall(r.nextRemindIso as string)
  assert.equal(w.key, '2026-10-13')
  assert.equal(w.hour, 10)
  assert.equal(w.minute, 0)
})

test('每天间隔 2：跳过一天', () => {
  const r = computeNext(rule({ freq: 'daily', interval: 2 }), {
    remindAt: '2026-10-12T23:30:00+08:00',
    nowIso: '2026-10-12T23:35:00+08:00',
    tzOffsetMinutes: TZ,
  })
  const w = wall(r.nextRemindIso as string)
  assert.equal(w.key, '2026-10-14')
  assert.equal(w.hour, 23)
  assert.equal(w.minute, 30)
})

test('B2 每周一、三：周一完成 → 周三；周三完成 → 下周一（跨周）', () => {
  const weekly = rule({ freq: 'weekly', weekdays: [1, 3] })

  const fromMonday = computeNext(weekly, {
    remindAt: '2026-10-12T09:00:00+08:00', // 周一
    nowIso: '2026-10-12T09:10:00+08:00',
    tzOffsetMinutes: TZ,
  })
  assert.equal(wall(fromMonday.nextRemindIso as string).key, '2026-10-14') // 周三
  assert.equal(wall(fromMonday.nextRemindIso as string).dow, 3)

  const fromWednesday = computeNext(weekly, {
    remindAt: '2026-10-14T09:00:00+08:00', // 周三
    nowIso: '2026-10-14T09:10:00+08:00',
    tzOffsetMinutes: TZ,
  })
  assert.equal(wall(fromWednesday.nextRemindIso as string).key, '2026-10-19') // 下周一
  assert.equal(wall(fromWednesday.nextRemindIso as string).dow, 1)
})

test('每周间隔 2：下一期跳到两周后同一星期', () => {
  const r = computeNext(rule({ freq: 'weekly', interval: 2, weekdays: [1] }), {
    remindAt: '2026-10-12T09:00:00+08:00', // 周一
    nowIso: '2026-10-12T09:10:00+08:00',
    tzOffsetMinutes: TZ,
  })
  assert.equal(wall(r.nextRemindIso as string).key, '2026-10-26')
  assert.equal(wall(r.nextRemindIso as string).dow, 1)
})

test('每周未选周几：按基准日的星期推进', () => {
  const r = computeNext(rule({ freq: 'weekly', weekdays: [] }), {
    remindAt: '2026-10-14T09:00:00+08:00', // 周三
    nowIso: '2026-10-14T09:10:00+08:00',
    tzOffsetMinutes: TZ,
  })
  assert.equal(wall(r.nextRemindIso as string).key, '2026-10-21')
  assert.equal(wall(r.nextRemindIso as string).dow, 3)
})

test('B3 每月 31 日：短月夹取到月末', () => {
  const monthly = rule({ freq: 'monthly' })
  const feb = computeNext(monthly, {
    remindAt: '2026-01-31T08:00:00+08:00',
    nowIso: '2026-01-31T08:05:00+08:00',
    tzOffsetMinutes: TZ,
  })
  assert.equal(wall(feb.nextRemindIso as string).key, '2026-02-28')

  const apr = computeNext(monthly, {
    remindAt: '2026-03-31T08:00:00+08:00',
    nowIso: '2026-03-31T08:05:00+08:00',
    tzOffsetMinutes: TZ,
  })
  assert.equal(wall(apr.nextRemindIso as string).key, '2026-04-30')
})

test('B3 每两月 31 日：按两月推进并夹取', () => {
  const r = computeNext(rule({ freq: 'monthly', interval: 2 }), {
    remindAt: '2026-01-31T08:00:00+08:00',
    nowIso: '2026-01-31T08:05:00+08:00',
    tzOffsetMinutes: TZ,
  })
  assert.equal(wall(r.nextRemindIso as string).key, '2026-03-31')
})

test('B3 闰年 2 月：1 月 31 日的下一期取 2 月 29 日', () => {
  const r = computeNext(rule({ freq: 'monthly' }), {
    remindAt: '2028-01-31T08:00:00+08:00',
    nowIso: '2028-01-31T08:05:00+08:00',
    tzOffsetMinutes: TZ,
  })
  assert.equal(wall(r.nextRemindIso as string).key, '2028-02-29')
})

test('B3 锚定日 31：2 月夹取到 28 日后，下一期回到 31 日（不漂移）', () => {
  const monthly = rule({ freq: 'monthly', anchorDay: 31 })

  const feb = computeNext(monthly, {
    remindAt: '2026-01-31T08:00:00+08:00',
    nowIso: '2026-01-31T08:05:00+08:00',
    tzOffsetMinutes: TZ,
  })
  assert.equal(wall(feb.nextRemindIso as string).key, '2026-02-28')

  // 以夹取后的 2/28 为基准继续推进，锚定日仍是 31 → 3/31
  const mar = computeNext(monthly, {
    remindAt: '2026-02-28T08:00:00+08:00',
    nowIso: '2026-02-28T08:05:00+08:00',
    tzOffsetMinutes: TZ,
  })
  assert.equal(wall(mar.nextRemindIso as string).key, '2026-03-31')
})

test('B3 锚定日 31 + 间隔 2 个月：2026-01-31 → 2026-03-31', () => {
  const r = computeNext(rule({ freq: 'monthly', interval: 2, anchorDay: 31 }), {
    remindAt: '2026-01-31T08:00:00+08:00',
    nowIso: '2026-01-31T08:05:00+08:00',
    tzOffsetMinutes: TZ,
  })
  assert.equal(wall(r.nextRemindIso as string).key, '2026-03-31')
})

test('B3 锚定日缺省：回退当前日号（旧数据兼容）', () => {
  const r = computeNext(rule({ freq: 'monthly' }), {
    remindAt: '2026-02-28T08:00:00+08:00',
    nowIso: '2026-02-28T08:05:00+08:00',
    tzOffsetMinutes: TZ,
  })
  assert.equal(wall(r.nextRemindIso as string).key, '2026-03-28')
})

test('B4 结束日期：等于当日仍生成，超过则 ruleEnded', () => {
  const daily = rule({ freq: 'daily', endDate: '2026-12-31' })

  const equalDay = computeNext(daily, {
    remindAt: '2026-12-30T10:00:00+08:00',
    nowIso: '2026-12-30T10:05:00+08:00',
    tzOffsetMinutes: TZ,
  })
  assert.equal(equalDay.ruleEnded, false)
  assert.equal(wall(equalDay.nextRemindIso as string).key, '2026-12-31')

  const beyond = computeNext(daily, {
    remindAt: '2026-12-31T10:00:00+08:00',
    nowIso: '2026-12-31T10:05:00+08:00',
    tzOffsetMinutes: TZ,
  })
  assert.equal(beyond.ruleEnded, true)
  assert.equal(beyond.nextRemindIso, null)
})

test('remindAt 为空：nextRemindIso 为 null，仅按 nowIso 判 endDate', () => {
  const noEnd = computeNext(rule({ freq: 'daily' }), {
    remindAt: null,
    nowIso: '2026-10-12T10:00:00+08:00',
    tzOffsetMinutes: TZ,
  })
  assert.equal(noEnd.nextRemindIso, null)
  assert.equal(noEnd.ruleEnded, false)

  const ended = computeNext(rule({ freq: 'daily', endDate: '2026-10-11' }), {
    remindAt: null,
    nowIso: '2026-10-12T10:00:00+08:00',
    tzOffsetMinutes: TZ,
  })
  assert.equal(ended.nextRemindIso, null)
  assert.equal(ended.ruleEnded, true)
})

test('时区参数化：同一 ISO 在不同 tz 下推进一天，墙钟时分各自保持', () => {
  const remindAt = '2026-10-12T10:00:00+08:00'
  const nowIso = '2026-10-12T10:05:00+08:00'

  /** 基线在该 tz 下的墙钟时分；下一期必须与之一致。 */
  const assertKeepsWallClock = (tz: number) => {
    const base = wall(remindAt, tz)
    const next = computeNext(rule({ freq: 'daily' }), { remindAt, nowIso, tzOffsetMinutes: tz })
    const w = wall(next.nextRemindIso as string, tz)
    assert.equal(w.hour, base.hour, `tz=${tz} 应保持小时`)
    assert.equal(w.minute, base.minute, `tz=${tz} 应保持分钟`)
    // 绝对时刻都等于「原 + 24h」
    assert.equal(Date.parse(next.nextRemindIso as string) - Date.parse(remindAt), 86_400_000)
  }

  assertKeepsWallClock(480)
  assertKeepsWallClock(-300)
  assertKeepsWallClock(0)
})

test('describeRecurrence：中文描述覆盖日/周/月', () => {
  assert.equal(describeRecurrence(rule({ freq: 'daily' })), '每天')
  assert.equal(describeRecurrence(rule({ freq: 'daily', interval: 2 })), '每 2 天')
  assert.equal(describeRecurrence(rule({ freq: 'weekly', weekdays: [1, 3] })), '每周一、三')
  assert.equal(describeRecurrence(rule({ freq: 'weekly', interval: 2, weekdays: [2, 5] })), '每 2 周二、五')
  assert.equal(describeRecurrence(rule({ freq: 'monthly' }), '2026-01-31T10:00:00+08:00'), '每月最后一天')
  assert.equal(describeRecurrence(rule({ freq: 'monthly', interval: 2 }), '2026-01-15T10:00:00+08:00'), '每 2 个月 15 日')
  assert.equal(describeRecurrence(null), '')
})

test('describeRecurrence：monthly 优先使用锚定日', () => {
  assert.equal(describeRecurrence(rule({ freq: 'monthly', anchorDay: 31 })), '每月最后一天')
  assert.equal(describeRecurrence(rule({ freq: 'monthly', anchorDay: 15 }), '2026-01-31T10:00:00+08:00'), '每月 15 日')
})

test('normalizeRecurrenceRule：anchorDay 归一（1–31 整数，非法丢弃）', () => {
  assert.equal(normalizeRecurrenceRule({ freq: 'monthly', anchorDay: 31 })?.anchorDay, 31)
  assert.equal(normalizeRecurrenceRule({ freq: 'monthly', anchorDay: 15.7 })?.anchorDay, 15)
  assert.equal(normalizeRecurrenceRule({ freq: 'monthly', anchorDay: 0 })?.anchorDay, undefined)
  assert.equal(normalizeRecurrenceRule({ freq: 'monthly', anchorDay: 32 })?.anchorDay, undefined)
  assert.equal(normalizeRecurrenceRule({ freq: 'monthly', anchorDay: '31' })?.anchorDay, undefined)
  assert.equal(normalizeRecurrenceRule({ freq: 'monthly' })?.anchorDay, undefined)
})

test('normalizeRecurrenceRule：脏数据归一为 null 或合法规则', () => {
  assert.equal(normalizeRecurrenceRule(null), null)
  assert.equal(normalizeRecurrenceRule('x'), null)
  assert.equal(normalizeRecurrenceRule({ freq: 'yearly' }), null)
  assert.deepEqual(normalizeRecurrenceRule({ freq: 'daily', interval: 0 }), {
    freq: 'daily',
    interval: 1,
    endDate: null,
  })
  assert.deepEqual(normalizeRecurrenceRule({ freq: 'weekly', interval: 200, weekdays: [3, 1, 1, 9, 'x'] }), {
    freq: 'weekly',
    interval: 99,
    endDate: null,
    weekdays: [1, 3],
  })
})
