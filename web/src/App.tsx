import { useEffect, useMemo, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { useAuthStore } from './store/authStore'
import Layout from './components/Layout'
import BootScreen from './components/BootScreen'
import UpdateDialog from './components/UpdateDialog'
import CompanionPanel from './components/CompanionPanel'
import LoginPage from './pages/LoginPage'
import HomePage from './pages/HomePage'
import RecordsPage from './pages/RecordsPage'
import TodoPage from './pages/TodoPage'
import CalendarPage from './pages/CalendarPage'
import MindTreePage from './pages/MindTreePage'
import ReviewPage from './pages/ReviewPage'
import SettingsPage from './pages/SettingsPage'
import RecyclePage from './pages/RecyclePage'
import DevToolsPage from './pages/DevToolsPage'
import { warmup } from './services/aiService'
import { checkForUpdate, type CheckResult } from './services/updateService'
import { UPDATE_CHECK_INTERVAL_MS } from '@shared/config/version'

/** 是否处于桌面悬浮窗 companion 模式。 */
function isCompanionMode(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('mode') === 'companion'
  } catch {
    return false
  }
}

/** 是否处于桌面主窗口模式（Electron 加载 ?desktop=1）。 */
function isDesktopMainMode(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('desktop') === '1'
  } catch {
    return false
  }
}

/** 路由守卫：未初始化时展示 loading，未登录时跳转登录页。 */
function RequireAuth({ children }: { children: React.ReactElement }) {
  const session = useAuthStore((s) => s.session)
  const initialized = useAuthStore((s) => s.initialized)

  if (!initialized) {
    return <BootScreen />
  }
  if (!session) {
    return <Navigate to="/login" replace />
  }
  return children
}

export default function App() {
  const companion = useMemo(() => isCompanionMode(), [])
  const desktopMain = useMemo(() => isDesktopMainMode(), [])
  const [updateResult, setUpdateResult] = useState<CheckResult | null>(null)

  // 预热模型列表缓存（失败静默）：缩短首次 AI 调用延迟
  useEffect(() => {
    warmup()
  }, [])

  // 自动检查更新：启动时一次 + 运行期间定期检查（仅在新版本时弹窗，失败静默）
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      const r = await checkForUpdate()
      if (!cancelled && r.hasUpdate) setUpdateResult(r)
    }
    run()
    const timer = setInterval(run, UPDATE_CHECK_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  // 桌面悬浮窗：渲染紧凑的 CompanionPanel（同一登录态与数据）
  const content = companion ? (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="*"
          element={
            <RequireAuth>
              <CompanionPanel />
            </RequireAuth>
          }
        />
      </Routes>
    </BrowserRouter>
  ) : (
    // Web 主站：左侧导航 + 顶栏 + 内容区
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            <RequireAuth>
              <Layout desktopMain={desktopMain} />
            </RequireAuth>
          }
        >
          <Route index path="/" element={<HomePage />} />
          <Route path="/records" element={<RecordsPage />} />
          <Route path="/todo" element={<TodoPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/mindtree" element={<MindTreePage />} />
          <Route path="/review" element={<ReviewPage />} />
          <Route path="/tools" element={<DevToolsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/recycle" element={<RecyclePage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )

  return (
    <>
      {content}
      <UpdateDialog result={updateResult} onClose={() => setUpdateResult(null)} />
    </>
  )
}
