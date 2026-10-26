/**
 * 通知通道抽象（P0-A）。
 *
 * 三个通道按优先级择优：desktop（Electron 原生）> web（浏览器 Notification）> inapp（应用内）。
 * 关键约定：桌面失败或 Web 权限被拒**必须**降级到 inapp 并返回 `ok: false`，
 * 不允许静默吞掉（A6「不报错、不阻塞」且用户可感知）。
 */

import { pushNotice } from '@/store/noticeStore'

export type NotifyChannel = 'desktop' | 'web' | 'inapp'

/** 通知载荷（桌面端经 IPC 传给主进程）。 */
export interface NotifyPayload {
  /** 去重键（`记录id|remind_at`），回传给点击事件便于溯源。 */
  key: string
  recordId: number
  title: string
  body: string
}

/** 通知结果。 */
export interface NotifyResult {
  channel: NotifyChannel
  ok: boolean
  reason?: 'permission-denied' | 'unsupported' | 'error'
}

/** 通知通道接口。 */
export interface NotificationProvider {
  readonly channel: NotifyChannel
  isAvailable(): Promise<boolean>
  requestPermission(): Promise<'granted' | 'denied' | 'default'>
  notify(p: NotifyPayload): Promise<NotifyResult>
  /** 注册点击回调（recordId 定位记录），返回取消注册函数。 */
  onClick(cb: (recordId: number) => void): () => void
}

/** 应用内提示文案：标题 + 正文，避免丢失上下文。 */
function inAppMessage(p: NotifyPayload): string {
  const title = p.title?.trim() || '待办提醒'
  const body = p.body?.trim()
  return body ? `${title}：${body}` : title
}

/* ------------------------------- inapp ------------------------------- */

const inAppClickHandlers = new Set<(recordId: number) => void>()

const inAppProvider: NotificationProvider = {
  channel: 'inapp',
  async isAvailable(): Promise<boolean> {
    return true
  },
  async requestPermission(): Promise<'granted' | 'denied' | 'default'> {
    return 'granted'
  },
  async notify(p: NotifyPayload): Promise<NotifyResult> {
    pushNotice(inAppMessage(p), 'info')
    return { channel: 'inapp', ok: true }
  },
  onClick(cb) {
    inAppClickHandlers.add(cb)
    return () => inAppClickHandlers.delete(cb)
  },
}

/** 降级到应用内提示并显式标记失败原因。 */
function degrade(p: NotifyPayload, reason: 'permission-denied' | 'unsupported' | 'error'): NotifyResult {
  pushNotice(
    reason === 'permission-denied'
      ? `通知权限未开启，已降级为应用内提示：${inAppMessage(p)}`
      : `系统通知不可用，已降级为应用内提示：${inAppMessage(p)}`,
    'warning',
  )
  return { channel: 'inapp', ok: false, reason }
}

/* ------------------------------- desktop ------------------------------- */

function desktopBridge(): Window['desktopBridge'] | undefined {
  if (typeof window === 'undefined') return undefined
  return window.desktopBridge
}

const desktopProvider: NotificationProvider = {
  channel: 'desktop',
  async isAvailable(): Promise<boolean> {
    const bridge = desktopBridge()
    return typeof bridge?.notify === 'function'
  },
  async requestPermission(): Promise<'granted' | 'denied' | 'default'> {
    // 桌面端通知由主进程直接创建，无需用户授权
    return 'granted'
  },
  async notify(p: NotifyPayload): Promise<NotifyResult> {
    const bridge = desktopBridge()
    if (!bridge || typeof bridge.notify !== 'function') return degrade(p, 'unsupported')
    try {
      const res = await bridge.notify(p)
      if (res && res.ok) return { channel: 'desktop', ok: true }
      return degrade(p, 'error')
    } catch {
      return degrade(p, 'error')
    }
  },
  onClick(cb) {
    const bridge = desktopBridge()
    if (!bridge || typeof bridge.onNotificationClicked !== 'function') return () => undefined
    return bridge.onNotificationClicked((payload) => cb(payload.recordId))
  },
}

/* -------------------------------- web -------------------------------- */

/** 持有 Notification 实例引用，防被 GC 后点击事件失效。 */
const webNotifications = new Set<Notification>()
const webClickHandlers = new Set<(recordId: number) => void>()

function webNotificationCtor(): typeof Notification | null {
  if (typeof window === 'undefined') return null
  const ctor = (window as unknown as { Notification?: typeof Notification }).Notification
  return typeof ctor === 'function' ? ctor : null
}

/** 浏览器通知权限（不支持时视为 denied）。 */
export function webNotificationPermission(): 'granted' | 'denied' | 'default' {
  const ctor = webNotificationCtor()
  if (!ctor) return 'denied'
  const permission = ctor.permission
  if (permission === 'granted' || permission === 'denied' || permission === 'default') return permission
  return 'default'
}

const webProvider: NotificationProvider = {
  channel: 'web',
  async isAvailable(): Promise<boolean> {
    return webNotificationCtor() !== null
  },
  async requestPermission(): Promise<'granted' | 'denied' | 'default'> {
    const ctor = webNotificationCtor()
    if (!ctor) return 'denied'
    try {
      const result = await ctor.requestPermission()
      return result === 'granted' || result === 'denied' ? result : 'default'
    } catch {
      return 'denied'
    }
  },
  async notify(p: NotifyPayload): Promise<NotifyResult> {
    const ctor = webNotificationCtor()
    if (!ctor) return degrade(p, 'unsupported')
    if (webNotificationPermission() !== 'granted') return degrade(p, 'permission-denied')
    try {
      const notification = new ctor(p.title?.trim() || '待办提醒', {
        body: p.body ?? '',
        tag: p.key,
      })
      webNotifications.add(notification)
      notification.onclick = () => {
        for (const handler of webClickHandlers) handler(p.recordId)
        try {
          window.focus()
        } catch {
          /* 部分浏览器禁止 focus，忽略 */
        }
        notification.close()
      }
      notification.onclose = () => webNotifications.delete(notification)
      return { channel: 'web', ok: true }
    } catch {
      return degrade(p, 'error')
    }
  },
  onClick(cb) {
    webClickHandlers.add(cb)
    return () => webClickHandlers.delete(cb)
  },
}

/* ------------------------------- factory ------------------------------- */

/** 择优创建通道：desktop > web > inapp（每次调用返回新实例，内部状态为模块级）。 */
export function createNotificationProvider(): NotificationProvider {
  const bridge = desktopBridge()
  if (typeof bridge?.notify === 'function') return desktopProvider
  if (webNotificationCtor()) return webProvider
  return inAppProvider
}

let cachedProvider: NotificationProvider | null = null

/** 进程内单例（避免重复注册点击监听）。 */
export function getNotificationProvider(): NotificationProvider {
  if (!cachedProvider) cachedProvider = createNotificationProvider()
  return cachedProvider
}

/** 供单测/热更新重置（不影响生产逻辑）。 */
export function __resetNotificationProviderForTest(): void {
  cachedProvider = null
  webNotifications.clear()
  webClickHandlers.clear()
  inAppClickHandlers.clear()
}
