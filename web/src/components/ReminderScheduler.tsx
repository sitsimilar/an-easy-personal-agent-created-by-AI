import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getNotificationProvider } from '@/services/notification'
import { reminderService } from '@/services/reminderService'

/**
 * 提醒调度挂载点（无 UI）。
 *
 * - 挂载即启动 30s 调度，卸载即停止；
 * - 注册通知点击回调 → 跳转待办页并带上 `?record=<id>`（A2）。
 *   `?mode=companion`（悬浮窗）由 Layout 判断后不挂载，避免双窗口重复提醒。
 */
export default function ReminderScheduler() {
  const navigate = useNavigate()

  useEffect(() => {
    reminderService.start()
    const provider = getNotificationProvider()
    const off = provider.onClick((recordId) => {
      if (Number.isInteger(recordId) && recordId > 0) {
        navigate(`/todo?record=${recordId}`)
      }
    })
    return () => {
      off()
      reminderService.stop()
    }
  }, [navigate])

  return null
}
