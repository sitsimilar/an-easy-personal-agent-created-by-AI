/**
 * P0-A 通知通道（notification.ts）· 测试（QA 独立补充）。
 *
 * 覆盖 A6 的关键约定：通道择优 desktop > web > inapp；失败/权限被拒**必须**降级为
 * 应用内提示并返回 `ok: false`（不静默吞），Web 通知点击能回传 recordId。
 */
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

interface Notice {
  id: number
  message: string
  severity: string
}

type NotificationModule = typeof import('../web/src/services/notification')
type NoticeStoreModule = typeof import('../web/src/store/noticeStore')

let notification: NotificationModule
let noticeStore: NoticeStoreModule

const realTz = process.env.TZ

/** 最小 window 桩（不暴露 Notification / desktopBridge）。 */
function installWindow(extra: Record<string, unknown> = {}): void {
  ;(globalThis as unknown as { window: unknown }).window = {
    setTimeout: () => 0,
    clearTimeout: () => undefined,
    location: { search: '' },
    focus: () => undefined,
    ...extra,
  }
}

function clearEnv(): void {
  delete (globalThis as unknown as { window?: unknown }).window
  delete (globalThis as unknown as { Notification?: unknown }).Notification
}

function notices(): Notice[] {
  return noticeStore.useNoticeStore.getState().notices as Notice[]
}

beforeEach(async () => {
  process.env.TZ = 'Asia/Shanghai'
  notification = await import('../web/src/services/notification')
  noticeStore = await import('../web/src/store/noticeStore')
  noticeStore.useNoticeStore.getState().clear()
  notification.__resetNotificationProviderForTest()
  clearEnv()
})

afterEach(() => {
  clearEnv()
  if (realTz === undefined) delete process.env.TZ
  else process.env.TZ = realTz
})

test('无 window / 无任何通道 → inapp 通道且发送成功', async () => {
  const provider = notification.createNotificationProvider()

  assert.equal(provider.channel, 'inapp')
  const result = await provider.notify({ key: 'k1', recordId: 1, title: '待办提醒', body: '正文' })

  assert.equal(result.channel, 'inapp')
  assert.equal(result.ok, true)
  assert.equal(notices().length, 1, '应用内提示应可见')
  assert.match(notices()[0].message, /待办提醒/)
})

test('desktop 优先于 web：同时存在时选 desktop', async () => {
  const calls: string[] = []
  installWindow({
    desktopBridge: {
      notify: async () => {
        calls.push('desktop')
        return { ok: true }
      },
      onNotificationClicked: () => () => undefined,
    },
    Notification: class {
      static permission = 'granted'
    },
  })

  const provider = notification.createNotificationProvider()
  const result = await provider.notify({ key: 'k2', recordId: 2, title: 'T', body: 'B' })

  assert.equal(provider.channel, 'desktop')
  assert.equal(result.ok, true)
  assert.deepEqual(calls, ['desktop'])
})

test('desktop 通道报错 → 降级 inapp 且 ok:false reason=error（不静默吞）', async () => {
  installWindow({
    desktopBridge: {
      notify: async () => ({ ok: false, message: '系统不支持通知' }),
      onNotificationClicked: () => () => undefined,
    },
  })

  const provider = notification.createNotificationProvider()
  const result = await provider.notify({ key: 'k3', recordId: 3, title: 'T', body: 'B' })

  assert.equal(result.channel, 'inapp')
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'error')
  assert.equal(notices().length, 1)
  assert.match(notices()[0].message, /系统通知不可用/)
})

test('desktop 通道抛异常 → 降级 inapp，不向外抛', async () => {
  installWindow({
    desktopBridge: {
      notify: async () => {
        throw new Error('ipc broken')
      },
      onNotificationClicked: () => () => undefined,
    },
  })

  const provider = notification.createNotificationProvider()
  const result = await provider.notify({ key: 'k4', recordId: 4, title: 'T', body: 'B' })

  assert.equal(result.ok, false)
  assert.equal(result.reason, 'error')
})

test('web 通道：权限被拒 → 降级 inapp（permission-denied），不抛错', async () => {
  installWindow({
    Notification: class {
      static permission = 'denied'
      static requestPermission = async () => 'denied'
    },
    focus: () => undefined,
  })

  const provider = notification.createNotificationProvider()
  assert.equal(provider.channel, 'web')

  const result = await provider.notify({ key: 'k5', recordId: 5, title: 'T', body: 'B' })

  assert.equal(result.channel, 'inapp')
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'permission-denied')
  assert.match(notices()[0].message, /通知权限未开启/)
})

test('web 通道：权限已授予 → 创建通知实例；点击回传 recordId', async () => {
  const instances: Array<{ title: string; options: Record<string, unknown>; onclick?: () => void }> = []
  class FakeNotification {
    static permission = 'granted'
    static requestPermission = async () => 'granted'
    onclick: (() => void) | null = null
    onclose: (() => void) | null = null
    closed = false
    constructor(title: string, options: Record<string, unknown>) {
      this.title = title
      this.options = options
      instances.push(this as unknown as { title: string; options: Record<string, unknown>; onclick?: () => void })
    }
    title: string
    options: Record<string, unknown>
    close(): void {
      this.closed = true
      this.onclose?.()
    }
  }
  installWindow({ Notification: FakeNotification })

  const provider = notification.createNotificationProvider()
  const clicked: number[] = []
  const off = provider.onClick((id) => clicked.push(id))

  const result = await provider.notify({ key: 'k6', recordId: 6, title: '   ', body: '正文' })
  assert.equal(result.channel, 'web')
  assert.equal(result.ok, true)
  assert.equal(instances.length, 1)
  assert.equal(instances[0].title, '待办提醒', '标题为空应用「待办提醒」')
  assert.equal(instances[0].options.tag, 'k6', 'tag 应用去重键，避免同键堆叠')

  instances[0].onclick?.()
  assert.deepEqual(clicked, [6], '点击应回传 recordId')
  assert.equal(instances[0].onclick !== null, true)

  off()
  instances[0].onclick?.()
  assert.deepEqual(clicked, [6], '取消注册后不应再回调')
})

test('web 权限状态查询：无 Notification 构造器时视为 denied', () => {
  installWindow()
  assert.equal(notification.webNotificationPermission(), 'denied')
})

test('requestPermission：不支持时返回 denied，且异常也被吞掉', async () => {
  const provider = notification.createNotificationProvider()
  // inapp 通道直接 granted；web 通道在无构造器时 denied 由下面单独断言
  assert.equal(await provider.requestPermission(), 'granted')

  installWindow({
    Notification: class {
      static permission = 'default'
      static requestPermission = async () => {
        throw new Error('blocked by policy')
      }
    },
  })
  notification.__resetNotificationProviderForTest()
  const web = notification.createNotificationProvider()
  assert.equal(web.channel, 'web')
  assert.equal(await web.requestPermission(), 'denied')
})

test('desktop 通道的 requestPermission 恒为 granted（主进程直接创建通知）', async () => {
  installWindow({
    desktopBridge: { notify: async () => ({ ok: true }), onNotificationClicked: () => () => undefined },
  })
  notification.__resetNotificationProviderForTest()

  const provider = notification.createNotificationProvider()
  assert.equal(provider.channel, 'desktop')
  assert.equal(await provider.requestPermission(), 'granted')
  assert.equal(await provider.isAvailable(), true)
})

test('getNotificationProvider 单例复用（避免重复注册点击监听）', () => {
  installWindow()
  notification.__resetNotificationProviderForTest()

  const a = notification.getNotificationProvider()
  const b = notification.getNotificationProvider()
  assert.equal(a, b)
})
