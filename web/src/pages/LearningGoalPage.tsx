import { Box, Button } from '@mui/material'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import PageHeader from '@/components/PageHeader'

/**
 * 学习目标管理台：内嵌资料库页面（在线存储 + 双向同步）。
 * 页面本体部署在资料库空间，三张数据表（目标/打卡记录/周复盘）均走线上读写。
 * 这里用 iframe 直接挂载已发布页面，避免在管家内重复实现数据层。
 */
const LEARNING_GOAL_PUBLISH_URL = 'https://workbuddy.link/p/rKnqUNYStrnTP0n8SokMDb'

const APP_BAR_HEIGHT = 64
const TITLE_BAR_HEIGHT = 36

export default function LearningGoalPage() {
  // 桌面主窗口会额外叠一层自绘标题栏（与 Layout 的 topOffset 对齐）
  const isDesktop =
    typeof window !== 'undefined' && Boolean((window as unknown as { desktopBridge?: unknown }).desktopBridge)
  const offset = APP_BAR_HEIGHT + (isDesktop ? TITLE_BAR_HEIGHT : 0)

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: `calc(100vh - ${offset}px)` }}>
      <Box sx={{ px: 3, pt: 2, pb: 1 }}>
        <PageHeader
          title="学习目标"
          subtitle="管理有终点、有总量的学习目标：每日打卡、连续天数、预计完成日与每周复盘（数据存于资料库，多端同步）"
          action={
            <Button
              variant="outlined"
              size="small"
              startIcon={<OpenInNewIcon />}
              href={LEARNING_GOAL_PUBLISH_URL}
              target="_blank"
              rel="noreferrer"
            >
              在新窗口打开
            </Button>
          }
        />
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, px: 3, pb: 3 }}>
        <Box
          component="iframe"
          src={LEARNING_GOAL_PUBLISH_URL}
          title="学习目标管理台"
          sx={{
            width: '100%',
            height: '100%',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 2,
            bgcolor: 'background.paper',
          }}
        />
      </Box>
    </Box>
  )
}
