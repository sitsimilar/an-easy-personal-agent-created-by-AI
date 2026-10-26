import { create } from 'zustand'

/** 应用内提示级别（与 MUI Alert severity 对齐）。 */
export type NoticeSeverity = 'info' | 'success' | 'warning' | 'error'

/** 一条应用内提示。 */
export interface NoticeItem {
  id: number
  message: string
  severity: NoticeSeverity
}

interface NoticeState {
  notices: NoticeItem[]
  push: (message: string, severity?: NoticeSeverity) => number
  dismiss: (id: number) => void
  clear: () => void
}

/** 自动消失时长（ms）。 */
const AUTO_DISMISS_MS = 6_000

let seq = 0

/**
 * 应用内提示队列（Zustand 单例）。
 *
 * 用途：① 通知通道降级（桌面失败 / Web 权限被拒）时的可见提示；
 * ② 循环任务状态、记录已被删除等轻量操作反馈复用同一队列。
 */
export const useNoticeStore = create<NoticeState>((set, get) => ({
  notices: [],

  push: (message, severity = 'info') => {
    const text = (message ?? '').trim()
    if (!text) return -1
    const id = ++seq
    set({ notices: [...get().notices, { id, message: text, severity }] })
    if (typeof window !== 'undefined') {
      window.setTimeout(() => {
        // 超时后若仍存在则移除（用户已手动关闭时是无害的空操作）
        if (get().notices.some((n) => n.id === id)) {
          set({ notices: get().notices.filter((n) => n.id !== id) })
        }
      }, AUTO_DISMISS_MS)
    }
    return id
  },

  dismiss: (id) => set({ notices: get().notices.filter((n) => n.id !== id) }),
  clear: () => set({ notices: [] }),
}))

/** 组件外推送提示（service 层使用）。 */
export function pushNotice(message: string, severity: NoticeSeverity = 'info'): number {
  return useNoticeStore.getState().push(message, severity)
}
