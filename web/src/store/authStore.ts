import { create } from 'zustand'
import type { CloudSession } from '@tencent-ai/workbuddy-cloud-sdk'

interface AuthState {
  session: CloudSession | null
  initialized: boolean
  /** 启动引导失败/超时的可读文案（null 表示无错误）。 */
  bootError: string | null
  setSession: (session: CloudSession | null) => void
  setInitialized: (initialized: boolean) => void
  setBootError: (bootError: string | null) => void
  clear: () => void
}

/** 登录态全局 store（session/user + 启动错误）。 */
export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  initialized: false,
  bootError: null,
  setSession: (session) => set({ session }),
  setInitialized: (initialized) => set({ initialized }),
  setBootError: (bootError) => set({ bootError }),
  clear: () => set({ session: null }),
}))

/** 便捷选择器：当前用户。 */
export function useCurrentUser() {
  return useAuthStore((s) => s.session?.user ?? null)
}
