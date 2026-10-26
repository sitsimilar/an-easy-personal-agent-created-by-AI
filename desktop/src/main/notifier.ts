import { Notification } from 'electron'
import { IPC, type NotifyClickedPayload, type NotifyPayload } from '../shared/ipc-contract'
import { getMainWindow, showMainWindow } from './main-window'

/** 入参上限（防超长文案撑爆通知中心）。 */
const TITLE_MAX = 200
const BODY_MAX = 500
/** 记录 id 上限（BIGINT 安全整数范围内的合理上界）。 */
const RECORD_ID_MAX = 9_007_199_254_740_991

/** 持有通知实例引用：避免 GC 回收后 click 事件丢失（Electron 已知行为）。 */
const alive = new Set<Notification>()

/**
 * 校验并归一化通知入参。
 *
 * @returns 合法载荷；非法返回 null（调用方回中文错误）
 */
export function sanitizeNotifyPayload(input: unknown): NotifyPayload | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Record<string, unknown>
  const key = typeof raw.key === 'string' ? raw.key.trim() : ''
  const title = typeof raw.title === 'string' ? raw.title.trim() : ''
  const body = typeof raw.body === 'string' ? raw.body.trim() : ''
  const recordId = typeof raw.recordId === 'number' ? raw.recordId : Number.NaN

  if (!key || key.length > 400) return null
  if (!title || title.length > TITLE_MAX) return null
  if (body.length > BODY_MAX) return null
  if (!Number.isInteger(recordId) || recordId <= 0 || recordId > RECORD_ID_MAX) return null

  return { key, recordId, title, body }
}

/** 把通知点击事件推给渲染进程（主窗口存在且未销毁时）。 */
function sendClicked(payload: NotifyClickedPayload): void {
  const win = getMainWindow()
  if (!win || win.isDestroyed()) return
  win.webContents.send(IPC.evtNotifyClicked, payload)
}

/**
 * 弹出系统通知（主进程）。
 *
 * - 点击：主窗口前置（托盘/最小化恢复）并回传 `recordId`；
 * - 关闭/点击后从引用集合移除，避免泄漏。
 */
export function showSystemNotification(input: unknown): { ok: boolean; message?: string } {
  const payload = sanitizeNotifyPayload(input)
  if (!payload) return { ok: false, message: '通知参数不合法' }

  if (!Notification.isSupported()) {
    return { ok: false, message: '当前系统不支持通知' }
  }

  try {
    const notification = new Notification({ title: payload.title, body: payload.body })
    alive.add(notification)

    notification.on('click', () => {
      showMainWindow()
      sendClicked({ key: payload.key, recordId: payload.recordId })
      alive.delete(notification)
    })
    notification.on('close', () => {
      alive.delete(notification)
    })

    notification.show()
    return { ok: true }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : '通知发送失败' }
  }
}

/** 供单测/退出清理（并非必需，保留可观测性）。 */
export function clearAliveNotifications(): void {
  alive.clear()
}
