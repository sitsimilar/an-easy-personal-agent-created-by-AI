/**
 * 会话失效处理：识别 401/凭证过期 → 清会话（触发 RequireAuth 跳登录）并记录回跳路径。
 * 登录成功后由 LoginPage 消费回跳路径，回到原操作页面。
 */
import { useAuthStore } from '@/store/authStore'
import { isAuthExpired } from '@/lib/unwrap'

const REDIRECT_KEY = 'personal-agent.redirect-after-login'

/** 会话失效：记录回跳路径 + 清会话（RequireAuth 自动跳 /login）。 */
export function reportAuthExpired(): void {
  if (!useAuthStore.getState().session) return // 已登出，避免重复
  try {
    sessionStorage.setItem(REDIRECT_KEY, window.location.pathname + window.location.search)
  } catch {
    /* 忽略（隐私模式等） */
  }
  useAuthStore.getState().setSession(null)
}

/** 登录成功后消费回跳路径（一次性）。 */
export function consumeRedirect(): string | null {
  try {
    const v = sessionStorage.getItem(REDIRECT_KEY)
    if (v) sessionStorage.removeItem(REDIRECT_KEY)
    return v
  } catch {
    return null
  }
}

/** 服务层统一错误钩子：识别到会话失效即触发跳登录。 */
export function onServiceError(err: unknown): void {
  if (isAuthExpired(err)) reportAuthExpired()
}
