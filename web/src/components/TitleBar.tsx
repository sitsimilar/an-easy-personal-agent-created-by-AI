import { useEffect, useState } from 'react'
import { Box, Typography } from '@mui/material'
import WindowControls from './WindowControls'

export const TITLE_BAR_HEIGHT = 36

/** 桌面主窗口自定义标题栏（无系统标题栏时由 Web 渲染）。 */
export default function TitleBar() {
  const bridge = typeof window !== 'undefined' ? window.desktopBridge : undefined
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (!bridge) return
    return bridge.onWindowStateChanged?.((state) => setMaximized(state.isMaximized))
  }, [bridge])

  if (!bridge) return null

  return (
    <Box
      className="titlebar-drag"
      sx={{
        height: TITLE_BAR_HEIGHT,
        display: 'flex',
        alignItems: 'center',
        bgcolor: 'background.paper',
        borderBottom: '1px solid',
        borderColor: 'divider',
        pl: 1.5,
        userSelect: 'none',
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: (theme) => theme.zIndex.drawer + 2,
      }}
      onDoubleClick={() => void bridge.windowControl?.('maximize-toggle')}
    >
      <Typography variant="caption" fontWeight={600} color="text.secondary">
        个人信息管家
      </Typography>
      <Box sx={{ ml: 'auto' }} className="titlebar-no-drag">
        <WindowControls maximized={maximized} bridge={bridge} />
      </Box>
    </Box>
  )
}
