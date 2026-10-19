import { Box, Typography } from '@mui/material'
import type { ReactNode } from 'react'

interface PageHeaderProps {
  title: string
  subtitle?: string
  /** 页头右侧操作区（切换按钮/动作按钮等）。 */
  action?: ReactNode
}

/** 统一内容区页头：标题 + 副标题 + 右侧操作。 */
export default function PageHeader({ title, subtitle, action }: PageHeaderProps) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, mb: 2 }}>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="h6" fontWeight={700}>
          {title}
        </Typography>
        {subtitle && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            {subtitle}
          </Typography>
        )}
      </Box>
      {action && <Box sx={{ flex: 'none', display: 'flex', alignItems: 'center' }}>{action}</Box>}
    </Box>
  )
}
