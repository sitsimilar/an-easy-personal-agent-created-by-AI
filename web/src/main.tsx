import React from 'react'
import ReactDOM from 'react-dom/client'
import { ThemeProvider } from '@mui/material/styles'
import CssBaseline from '@mui/material/CssBaseline'
import App from './App'
import theme from './theme'
import './index.css'
import { cloud } from './lib/cloud'
import { authService } from './services/authService'
import { initCrossWindowAuthSync } from './services/authSync'
import { useAuthStore } from './store/authStore'
import { setUnwrapAuthHook } from './lib/unwrap'
import { onServiceError } from './services/authExpired'

/**
 * 启动引导：
 * 1. 无条件先执行微信登录回调处理（早于路由守卫）；
 * 2. 恢复会话；
 * 3. 订阅登录态变化。
 */
/** 启动超时上限（毫秒）。 */
const BOOT_TIMEOUT_MS = 10_000

async function bootstrap(): Promise<void> {
  // 钩子无网络依赖，尽早注册，避免启动卡顿时登录态回调/401 拦截失效
  authService.onAuthStateChange((_event, session) => {
    useAuthStore.getState().setSession(session)
  })
  // 跨窗口登录态同步：主窗口登录后，悬浮窗据此更新本地会话（含登出）。
  initCrossWindowAuthSync()
  setUnwrapAuthHook(onServiceError)

  const work = (async () => {
    // 1. 微信 Web 登录回调（必须最先执行）
    try {
      const { data: session, error } = await cloud.auth.handleWechatWebCallback()
      if (error) {
        // 回调失败不应导致整个启动崩溃，仅记录告警
        console.warn('[auth] 微信登录回调处理失败')
      }
      if (session) {
        // 成功后清理 URL 中的 code/state，避免刷新重放一次性 code
        window.history.replaceState(null, '', window.location.pathname)
        useAuthStore.getState().setSession(session)
      }
    } catch {
      console.warn('[auth] 微信登录回调处理异常')
    }

    // 2. 恢复会话
    let session: Awaited<ReturnType<typeof authService.getSession>> = null
    try {
      session = await authService.getSession()
      useAuthStore.getState().setSession(session)
    } catch {
      useAuthStore.getState().setSession(null)
    }

    // 3. 启动恢复：会话存在时恢复 enabled 插件（失败不阻断启动）
    if (session) {
      try {
        const { usePluginStore } = await import('./store/pluginStore')
        await usePluginStore.getState().restore()
      } catch {
        console.warn('[plugins] 启动恢复插件失败（不阻断启动）')
      }
    }

    useAuthStore.getState().setInitialized(true)
  })()

  // 3. 超时兜底：网络/会话卡住时给出可读错误 + 重试入口，而非无限「正在加载…」
  const timeout = new Promise<void>((resolve) => {
    setTimeout(() => {
      if (!useAuthStore.getState().initialized) {
        useAuthStore.getState().setBootError('启动超时，请检查网络后重试')
      }
      resolve()
    }, BOOT_TIMEOUT_MS)
  })

  await Promise.race([work, timeout])
}

bootstrap()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  </React.StrictMode>,
)
