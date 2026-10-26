import { Box, IconButton, Paper, SnackbarContent, Typography } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import { useNoticeStore } from '@/store/noticeStore'

/** 不同级别的底色（与 MUI 语义色一致）。 */
const SEVERITY_COLOR: Record<string, string> = {
  info: 'primary.main',
  success: 'success.main',
  warning: 'warning.main',
  error: 'error.main',
}

/**
 * 应用内提示宿主（全局 Snackbar 队列）。
 *
 * 挂在 Layout 内：既是通知通道降级后的可见出口（A6），
 * 也承载循环任务、记录已删除等轻量反馈。
 */
export default function NoticeHost() {
  const notices = useNoticeStore((s) => s.notices)
  const dismiss = useNoticeStore((s) => s.dismiss)

  if (notices.length === 0) return null

  return (
    <Box
      sx={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: (theme) => theme.zIndex.snackbar,
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        alignItems: 'center',
        pointerEvents: 'none',
        px: 2,
        width: '100%',
        maxWidth: 520,
      }}
    >
      {notices.map((notice) => (
        <Paper
          key={notice.id}
          elevation={6}
          sx={{ width: '100%', pointerEvents: 'auto', borderLeft: 4, borderColor: SEVERITY_COLOR[notice.severity] }}
        >
          <SnackbarContent
            sx={{ bgcolor: 'background.paper', color: 'text.primary' }}
            message={
              <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
                {notice.message}
              </Typography>
            }
            action={
              <IconButton size="small" aria-label="关闭提示" onClick={() => dismiss(notice.id)}>
                <CloseIcon fontSize="small" />
              </IconButton>
            }
          />
        </Paper>
      ))}
    </Box>
  )
}
