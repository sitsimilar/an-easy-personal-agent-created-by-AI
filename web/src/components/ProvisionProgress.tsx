import { Alert, Box, LinearProgress, Typography } from '@mui/material'

/** 一键部署状态（与 CppPhase 正交）。 */
export type ProvisionState =
  | { phase: 'idle' }
  | { phase: 'running'; percent: number; message?: string }
  | { phase: 'done' }
  | { phase: 'failed'; message: string }

export default function ProvisionProgress({
  state,
  onRetry,
}: {
  state: ProvisionState
  onRetry: () => void
}) {
  if (state.phase === 'idle') return null

  if (state.phase === 'done') {
    return (
      <Alert severity="success" sx={{ py: 0 }}>
        MinGW 部署完成，工具链已刷新。
      </Alert>
    )
  }

  if (state.phase === 'failed') {
    return (
      <Alert
        severity="error"
        sx={{ py: 0 }}
        action={
          <Box
            component="span"
            onClick={onRetry}
            sx={{ cursor: 'pointer', textDecoration: 'underline', fontSize: 12 }}
          >
            重试
          </Box>
        }
      >
        {state.message}
      </Alert>
    )
  }

  const determinate = state.percent >= 0
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      <LinearProgress
        variant={determinate ? 'determinate' : 'indeterminate'}
        value={determinate ? Math.min(100, state.percent) : undefined}
      />
      <Typography variant="caption" color="text.secondary">
        {state.message ?? '正在部署 MinGW…'}
      </Typography>
    </Box>
  )
}
