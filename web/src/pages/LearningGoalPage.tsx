import { Box, Button, Typography } from '@mui/material'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import PageHeader from '@/components/PageHeader'

/**
 * 学习目标：单一入口页。
 * 学习目标管理台本体部署在资料库空间，三张数据表（目标/打卡记录/周复盘）走线上读写。
 * 这里只保留一个「打开管理台」按钮，点击在新窗口打开，避免重复入口。
 */
const LEARNING_GOAL_PUBLISH_URL = 'https://workbuddy.link/p/rKnqUNYStrnTP0n8SokMDb'

export default function LearningGoalPage() {
  return (
    <Box sx={{ p: 3, maxWidth: 860, mx: 'auto' }}>
      <PageHeader
        title="学习目标"
        subtitle="管理有终点、有总量的学习目标：每日打卡、连续天数、预计完成日与每周复盘（数据存于资料库，多端同步）"
      />
      <Box sx={{ textAlign: 'center', py: 10 }}>
        <Button
          variant="contained"
          size="large"
          startIcon={<OpenInNewIcon />}
          href={LEARNING_GOAL_PUBLISH_URL}
          target="_blank"
          rel="noreferrer"
        >
          打开学习目标管理台
        </Button>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          点击后在新窗口打开管理台，数据在线存储、多端双向同步。
        </Typography>
      </Box>
    </Box>
  )
}
