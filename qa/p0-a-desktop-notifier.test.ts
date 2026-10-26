/**
 * P0-A 桌面主进程通知（desktop/src/main/notifier.ts）· 测试（QA 独立补充）。
 *
 * 覆盖 A1/A2 的**主进程侧**可自动化部分：
 * - 入参校验（非法载荷不得进入系统通知中心）；
 * - `Notification.isSupported()` 为 false 时返回中文失败原因（不静默）；
 * - 创建通知 → show()；点击 → 窗口前置 + 回传 `desktop:notify-clicked`（含 recordId）。
 *
 * 说明：真实的 Windows 通知中心条目仍需打包实机验证，本文件只验证代码链路与载荷。
 */
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { BrowserWindow, Notification, __resetElectronMock } from './mocks/electron'
import { sanitizeNotifyPayload, showSystemNotification, clearAliveNotifications } from '../desktop/src/main/notifier'
import { createMainWindow, getMainWindow } from '../desktop/src/main/main-window'
import { IPC } from '../desktop/src/shared/ipc-contract'

const payload = { key: '42|2026-10-12T02:00:00.000Z', recordId: 42, title: '交周报', body: '工作 · 高优先级' }

beforeEach(() => {
  __resetElectronMock()
  clearAliveNotifications()
  BrowserWindow.instances.length = 0
})

/* ------------------------------ 入参校验 ------------------------------ */

test('sanitizeNotifyPayload：合法载荷原样通过（trim 后）', () => {
  const result = sanitizeNotifyPayload({ ...payload, title: '  交周报  ' })

  assert.deepEqual(result, { ...payload, title: '交周报' })
})

test('sanitizeNotifyPayload：非法载荷一律拒绝', () => {
  const cases: unknown[] = [
    null,
    undefined,
    'string',
    { ...payload, key: '' },
    { ...payload, title: '' },
    { ...payload, title: 'x'.repeat(201) },
    { ...payload, body: 'x'.repeat(501) },
    { ...payload, recordId: 0 },
    { ...payload, recordId: -1 },
    { ...payload, recordId: 1.5 },
    { ...payload, recordId: Number.NaN },
    { ...payload, recordId: '42' },
    { ...payload, key: undefined },
  ]

  for (const input of cases) {
    assert.equal(sanitizeNotifyPayload(input), null, `应拒绝：${JSON.stringify(input)?.slice(0, 60)}`)
  }
})

/* --------------------------- 系统通知发送 --------------------------- */

test('showSystemNotification：系统不支持通知 → ok:false + 中文原因', () => {
  Notification.supported = false

  const result = showSystemNotification(payload)

  assert.equal(result.ok, false)
  assert.equal(result.message, '当前系统不支持通知')
  assert.equal(Notification.instances.length, 0, '不支持时不应创建通知实例')
})

test('showSystemNotification：非法载荷 → ok:false + 中文原因', () => {
  const result = showSystemNotification({ ...payload, recordId: 0 })

  assert.equal(result.ok, false)
  assert.equal(result.message, '通知参数不合法')
  assert.equal(Notification.instances.length, 0)
})

test('showSystemNotification：创建并显示通知，标题/正文正确', () => {
  const result = showSystemNotification(payload)

  assert.deepEqual(result, { ok: true })
  assert.equal(Notification.instances.length, 1)
  assert.equal(Notification.instances[0].title, '交周报')
  assert.equal(Notification.instances[0].body, '工作 · 高优先级')
  assert.equal(Notification.instances[0].shown, true, '必须调用 show()')
})

test('A2 点击通知：窗口前置并向渲染进程回传 recordId', () => {
  createMainWindow()
  const win = getMainWindow()
  assert.ok(win, '主窗口应已创建')
  win.hide() // 模拟最小化/隐藏到托盘
  assert.equal(win.isVisible(), false)

  showSystemNotification(payload)
  assert.equal(Notification.instances.length, 1)

  Notification.instances[0].__emit('click')

  assert.equal(win.isVisible(), true, '点击后窗口应被前置/恢复')
  assert.deepEqual(win.webContents.lastSend, {
    channel: IPC.evtNotifyClicked,
    payload: { key: payload.key, recordId: 42 },
  })
})

test('通知关闭事件：清理引用不抛错（避免 GC 后点击失效/泄漏）', () => {
  showSystemNotification(payload)

  assert.doesNotThrow(() => Notification.instances[0].__emit('close'))
})

test('重复点击同一通知：不抛错（窗口状态任意都不崩）', () => {
  createMainWindow()
  showSystemNotification(payload)

  assert.doesNotThrow(() => {
    Notification.instances[0].__emit('click')
    Notification.instances[0].__emit('click')
  })
})
