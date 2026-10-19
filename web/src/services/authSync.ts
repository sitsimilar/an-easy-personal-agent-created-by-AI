/**
 * 跨窗口 / 跨标签登录态同步。
 *
 * 背景：云 SDK 的 `onAuthStateChange` 只通知「同一窗口内」的订阅者，没有
 * storage 事件 / BroadcastChannel 的跨窗口广播。主窗口与悬浮窗是两个
 * BrowserWindow（共用默认 session、同源），登录态写入同一份 localStorage
 * （key 前缀 `workbuddy-cloud.session.`，见 SDK session-store.ts 的
 * STORAGE_KEY_PREFIX），但悬浮窗不会因此收到任何回调，导致「主界面登录后
 * 悬浮窗仍停留在登录页」。
 *
 * 本模块监听 `storage` 事件：当会话 key 变化（登录 / 登出 / 清除）时，
 * 重新读取会话并同步到全局 store，从而让两个窗口保持一致的登录态。
 * 同时覆盖浏览器多标签页场景（标签 A 登录，标签 B 同步）。
 */
import { useAuthStore } from '@/store/authStore'
import { authService } from './authService'

/** 云 SDK 会话存储 key 前缀（与 SDK session-store.ts 的 STORAGE_KEY_PREFIX 一致）。 */
const SESSION_KEY_PREFIX = 'workbuddy-cloud.session.'

/**
 * 注册跨窗口登录态同步。返回取消订阅函数。
 * 应在应用启动引导阶段（bootstrap）调用一次。
 */
export function initCrossWindowAuthSync(): () => void {
  const onStorage = (e: StorageEvent): void => {
    // e.key === null 表示 localStorage.clear()；否则仅关心会话 key 的变化。
    if (e.key !== null && !e.key.startsWith(SESSION_KEY_PREFIX)) return
    // 重读会话并同步；失败静默（保持现状，下次变化会再触发）。
    authService
      .getSession()
      .then((session) => useAuthStore.getState().setSession(session))
      .catch(() => undefined)
  }
  window.addEventListener('storage', onStorage)
  return () => window.removeEventListener('storage', onStorage)
}
