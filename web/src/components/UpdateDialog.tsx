import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Typography,
} from '@mui/material'
import type { CheckResult } from '@/services/updateService'

interface UpdateDialogProps {
  result: CheckResult | null
  onClose: () => void
}

/** 新版本提示弹窗。 */
export default function UpdateDialog({ result, onClose }: UpdateDialogProps) {
  if (!result || !result.hasUpdate) return null
  const { latestVersion, currentVersion, info } = result

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>发现新版本</DialogTitle>
      <DialogContent>
        <DialogContentText>
          当前版本 v{currentVersion}，最新版本 v{latestVersion}。
        </DialogContentText>
        {info?.notes && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5, whiteSpace: 'pre-wrap' }}>
            {info.notes}
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>稍后再说</Button>
        <Button
          variant="contained"
          href={info?.url ?? '#'}
          target="_blank"
          rel="noreferrer"
          onClick={onClose}
        >
          前往更新
        </Button>
      </DialogActions>
    </Dialog>
  )
}
