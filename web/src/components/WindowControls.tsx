import { IconButton, type SxProps, type Theme } from '@mui/material'
import MinimizeIcon from '@mui/icons-material/Minimize'
import CropSquareIcon from '@mui/icons-material/CropSquare'
import FilterNoneIcon from '@mui/icons-material/FilterNone'
import CloseIcon from '@mui/icons-material/Close'
import type { DesktopBridge, WindowControlAction } from '@shared/types/ipc'

interface WindowControlsProps {
  maximized: boolean
  bridge: DesktopBridge
}

const buttonSx: SxProps<Theme> = {
  width: 46,
  height: 36,
  borderRadius: 0,
  color: 'text.secondary',
  '&:hover': { bgcolor: 'action.hover' },
  '&:active': { bgcolor: 'rgba(0,0,0,0.16)' },
}

const closeSx: SxProps<Theme> = {
  ...buttonSx,
  '&:hover': { bgcolor: 'error.main', color: '#fff' },
  '&:active': { bgcolor: 'error.dark', color: '#fff' },
}

/** 标题栏窗口控制按钮（最小化 / 最大化-还原 / 关闭）。 */
export default function WindowControls({ maximized, bridge }: WindowControlsProps) {
  const act = (action: WindowControlAction) => {
    void bridge.windowControl?.(action)
  }

  return (
    <>
      <IconButton size="small" sx={buttonSx} onClick={() => act('minimize')} aria-label="最小化">
        <MinimizeIcon fontSize="small" />
      </IconButton>
      <IconButton
        size="small"
        sx={buttonSx}
        onClick={() => act('maximize-toggle')}
        aria-label={maximized ? '还原' : '最大化'}
      >
        {maximized ? <FilterNoneIcon fontSize="small" /> : <CropSquareIcon fontSize="small" />}
      </IconButton>
      <IconButton size="small" sx={closeSx} onClick={() => act('close')} aria-label="关闭">
        <CloseIcon fontSize="small" />
      </IconButton>
    </>
  )
}
