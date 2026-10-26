/**
 * P0-B 循环推进纯函数 · 对抗性测试（QA 独立补充）。
 *
 * 与工程师用例的差异：专门覆盖 daily interval=3、weekly 多选 + interval=2 的跳周、
 * monthly 锚定日 31 的完整链条（1/31 → 2/28 → 3/31）、周二完成（完成日不在 weekdays 内）、
 * endDate 等值/超出的双向边界，以及「脏规则直接喂给 computeNext 不抛错」。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeNext, describeRecurrence, normalizeRecurrenceRule } from '../web/src/lib/recurrence'
import type { RecurrenceRule } from '../shared/types/domain'

const TZ = 480
const DAY = 86_400_000

/** 东八区墙钟 → {day: 'YYYY-MM-DD', hm: 'HH:mm', dow} */
function wallOf(iso: string): { day: string; hm: string; dow: number } {
  const d = new Date(Date.parse(iso) + TZ * 60_000)
  const day = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  const hm = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
  return { day, hm, dow: d.getUTCDay() }
}

const rule = (over: Partial<RecurrenceRule> & Pick<RecurrenceRule, 'freq'>): RecurrenceRule => ({
  interval: 1,
  endDate: null,
  ...over,
})

/** 跑一次 computeNext，返回墙钟结果。 */
function next(ruleInput: RecurrenceRule, remindAt: string | null, nowIso = remindAt ?? '2026-10-12T10:00:00+08:00') {
  return computeNext(ruleInput, { remindAt, nowIso, tzOffsetMinutes: TZ })
}

/* --------------------------------- daily --------------------------------- */

test('daily interval=3：保留时分并跨月（10-31 → 11-03）', () => {
  const r = next(rule({ freq: 'daily', interval: 3 }), '2026-10-31T07:15:00+08:00')
  assert.equal(r.ruleEnded, false)
  const w = wallOf(r.nextRemindIso as string)
  assert.equal(w.day, '2026-11-03')
  assert.equal(w.hm, '07:15', '时分必须保留')
})

test('daily interval=3：跨年保持墙钟（12-31 → 01-03）', () => {
  const r = next(rule({ freq: 'daily', interval: 3 }), '2026-12-31T23:45:00+08:00')
  const w = wallOf(r.nextRemindIso as string)
  assert.equal(w.day, '2027-01-03')
  assert.equal(w.hm, '23:45')
})

/* -------------------------------- weekly -------------------------------- */

test('weekly [1,3] interval=2：周三完成 → 跳过一周后的周一（跨两周）', () => {
  // 2026-10-14 是周三；interval=2 → 只允许「本周、week+2 …」参与，week+1 被跳过
  const r = next(rule({ freq: 'weekly', interval: 2, weekdays: [1, 3] }), '2026-10-14T09:00:00+08:00')
  const w = wallOf(r.nextRemindIso as string)
  assert.equal(w.day, '2026-10-26', '应为两周后的周一')
  assert.equal(w.dow, 1)
  assert.equal(w.hm, '09:00')
})

test('weekly [1,3]：完成日不在选中周几（周二）→ 本周周三', () => {
  const r = next(rule({ freq: 'weekly', weekdays: [1, 3] }), '2026-10-13T09:00:00+08:00') // 周二
  const w = wallOf(r.nextRemindIso as string)
  assert.equal(w.day, '2026-10-14')
  assert.equal(w.dow, 3)
})

test('weekly [1,3]：周日完成 → 下周一（跨周边界）', () => {
  const r = next(rule({ freq: 'weekly', weekdays: [1, 3] }), '2026-10-18T09:00:00+08:00') // 周日
  assert.equal(wallOf(r.nextRemindIso as string).day, '2026-10-19')
})

test('weekly 单选 [1] interval=1：连续三周递推不漂移', () => {
  let remindAt = '2026-10-12T09:00:00+08:00' // 周一
  const days: string[] = []
  for (let i = 0; i < 3; i++) {
    const r = next(rule({ freq: 'weekly', weekdays: [1] }), remindAt)
    remindAt = r.nextRemindIso as string
    days.push(wallOf(remindAt).day)
  }
  assert.deepEqual(days, ['2026-10-19', '2026-10-26', '2026-11-02'])
  assert.equal(wallOf(remindAt).hm, '09:00', '三次递推后时分仍不变')
})

/* -------------------------------- monthly -------------------------------- */

test('monthly anchorDay=31：1/31 → 2/28 → 3/31（独立链条，不漂移）', () => {
  const monthly = rule({ freq: 'monthly', anchorDay: 31 })
  const feb = next(monthly, '2026-01-31T08:00:00+08:00')
  assert.equal(wallOf(feb.nextRemindIso as string).day, '2026-02-28')
  const mar = next(monthly, feb.nextRemindIso as string)
  assert.equal(wallOf(mar.nextRemindIso as string).day, '2026-03-31', '夹取后必须回到 31 日')
  const apr = next(monthly, mar.nextRemindIso as string)
  assert.equal(wallOf(apr.nextRemindIso as string).day, '2026-04-30', '4 月夹取到月末')
})

test('monthly anchorDay=31 interval=2：1/31 → 3/31 → 5/31', () => {
  const monthly = rule({ freq: 'monthly', interval: 2, anchorDay: 31 })
  const mar = next(monthly, '2026-01-31T08:00:00+08:00')
  assert.equal(wallOf(mar.nextRemindIso as string).day, '2026-03-31')
  const may = next(monthly, mar.nextRemindIso as string)
  assert.equal(wallOf(may.nextRemindIso as string).day, '2026-05-31')
})

test('monthly 无锚定日（旧数据）：按基准日号推进，2/28 → 3/28', () => {
  const r = next(rule({ freq: 'monthly' }), '2026-02-28T08:00:00+08:00')
  assert.equal(wallOf(r.nextRemindIso as string).day, '2026-03-28')
})

/* ------------------------------- endDate ------------------------------- */

test('B4 endDate：下一期恰好等于 endDate 仍生成', () => {
  const r = next(rule({ freq: 'daily', endDate: '2026-11-01' }), '2026-10-31T10:00:00+08:00')
  assert.equal(r.ruleEnded, false)
  assert.equal(wallOf(r.nextRemindIso as string).day, '2026-11-01')
})

test('B4 endDate：下一期晚于 endDate 一天 → ruleEnded 且不返回时间', () => {
  const r = next(rule({ freq: 'daily', endDate: '2026-10-31' }), '2026-10-31T10:00:00+08:00')
  assert.equal(r.ruleEnded, true)
  assert.equal(r.nextRemindIso, null)
})

test('B4 endDate + weekly：跨周后超过结束日 → ended', () => {
  // 2026-10-14 周三，规则 [1] → 下一期 10-19 周一，超过 endDate 2026-10-18
  const r = next(rule({ freq: 'weekly', weekdays: [1], endDate: '2026-10-18' }), '2026-10-14T09:00:00+08:00')
  assert.equal(r.ruleEnded, true)
  assert.equal(r.nextRemindIso, null)
})

/* ------------------------- remindAt = null（无提醒） ------------------------- */

test('remindAt=null：不推进时间（nextRemindIso=null），endDate 等于当日不算结束', () => {
  const equalDay = computeNext(rule({ freq: 'daily', endDate: '2026-10-12' }), {
    remindAt: null,
    nowIso: '2026-10-12T10:00:00+08:00',
    tzOffsetMinutes: TZ,
  })
  assert.equal(equalDay.nextRemindIso, null)
  assert.equal(equalDay.ruleEnded, false, '等于当日不应结束')

  const beyond = computeNext(rule({ freq: 'daily', endDate: '2026-10-11' }), {
    remindAt: null,
    nowIso: '2026-10-12T10:00:00+08:00',
    tzOffsetMinutes: TZ,
  })
  assert.equal(beyond.ruleEnded, true, '晚于当日应结束')
})

test('remindAt 非法字符串：按「无提醒时间」处理不抛错', () => {
  const r = computeNext(rule({ freq: 'daily' }), {
    remindAt: 'not-a-date',
    nowIso: '2026-10-12T10:00:00+08:00',
    tzOffsetMinutes: TZ,
  })
  assert.equal(r.nextRemindIso, null)
  assert.equal(r.ruleEnded, false)
})

/* ------------------------------ 脏规则容错 ------------------------------ */

test('computeNext：interval=0 / 100 / 非数 归一后不抛错且行为可预期', () => {
  const remindAt = '2026-10-12T10:00:00+08:00'
  const daily = (interval: unknown) =>
    computeNext({ freq: 'daily', interval: interval as number, endDate: null }, {
      remindAt,
      nowIso: remindAt,
      tzOffsetMinutes: TZ,
    })

  assert.equal(wallOf(daily(0).nextRemindIso as string).day, '2026-10-13', 'interval=0 归一为 1')
  assert.equal(
    Date.parse(daily(100).nextRemindIso as string) - Date.parse(remindAt),
    99 * DAY,
    'interval=100 归一为上限 99',
  )
  assert.equal(wallOf(daily('x').nextRemindIso as string).day, '2026-10-13', '非数归一为 1')
})

test('computeNext：weekdays 含 9 / -1 / 非数 → 归一（normalizeRecurrenceRule）后按基准星期兜底', () => {
  // 生产链路的入参一定先经 normalizeRecurrenceRule（recordService.toRecurrence）：
  // 非法周几被过滤成 []，再由 advanceWeekly 用基准日的星期兜底。
  const normalized = normalizeRecurrenceRule({ freq: 'weekly', interval: 1, weekdays: [9, -1, 'x'] })
  assert.deepEqual(normalized?.weekdays, [], '非法周几应被全部过滤')

  const r = computeNext(normalized as RecurrenceRule, {
    remindAt: '2026-10-12T09:00:00+08:00', // 周一
    nowIso: '2026-10-12T09:00:00+08:00',
    tzOffsetMinutes: TZ,
  })
  assert.equal(r.ruleEnded, false)
  const w = wallOf(r.nextRemindIso as string)
  assert.equal(w.day, '2026-10-19', '空周几 → 回退基准日星期（周一）')
  assert.equal(w.dow, 1)
})

test('computeNext：未归一的全非法 weekdays 回退基准日星期（不判为规则结束）', () => {
  // 契约入参是「已归一」的规则；此处验证防御性：即便直接把 [9,-1] 脏数组喂进来，
  // advanceWeekly 也会「先归一再判空」，回退到基准日的星期，而不是返回 ruleEnded。
  const r = computeNext(
    { freq: 'weekly', interval: 1, weekdays: [9, -1] as number[], endDate: null },
    { remindAt: '2026-10-12T09:00:00+08:00', nowIso: '2026-10-12T09:00:00+08:00', tzOffsetMinutes: TZ },
  )
  assert.equal(typeof r.ruleEnded, 'boolean', '不得抛错')
  assert.equal(r.ruleEnded, false, '全非法周几应回退基准日星期，不视为结束')
  const w = wallOf(r.nextRemindIso as string)
  assert.equal(w.day, '2026-10-19', '周一 → 下周一')
  assert.equal(w.dow, 1)
})

test('computeNext：freq 非法不抛错（防御性，脏数据不炸渲染层）', () => {
  assert.doesNotThrow(() => {
    const r = computeNext(
      { freq: 'yearly' as unknown as 'daily', interval: 1, endDate: null },
      { remindAt: '2026-10-12T10:00:00+08:00', nowIso: '2026-10-12T10:00:00+08:00', tzOffsetMinutes: TZ },
    )
    assert.equal(typeof r.ruleEnded, 'boolean')
    assert.ok(r.nextRemindIso === null || typeof r.nextRemindIso === 'string')
  })
})

test('computeNext：endDate 脏值（非法格式）被忽略，规则继续推进', () => {
  const r = next(rule({ freq: 'daily', endDate: '2026/10/12' }), '2026-10-12T10:00:00+08:00')
  assert.equal(r.ruleEnded, false)
  assert.equal(wallOf(r.nextRemindIso as string).day, '2026-10-13')
})

test('normalizeRecurrenceRule：weekdays 含 9 / -1 被过滤（不抛错）', () => {
  const normalized = normalizeRecurrenceRule({ freq: 'weekly', weekdays: [9, -1, 0, 6, 3.7] })
  assert.deepEqual(normalized?.weekdays, [0, 3, 6])
})

test('describeRecurrence：脏规则返回空串或安全文案（不会抛错）', () => {
  assert.equal(describeRecurrence({ freq: 'yearly' } as unknown as RecurrenceRule), '')
  assert.equal(describeRecurrence(undefined), '')
  const weeklyNoDays = describeRecurrence(rule({ freq: 'weekly', weekdays: [] }))
  assert.equal(weeklyNoDays, '每周')
})
