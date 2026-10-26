import {
  Box,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  Typography,
} from '@mui/material'
import LightbulbIcon from '@mui/icons-material/Lightbulb'
import FolderIcon from '@mui/icons-material/Folder'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import LinkIcon from '@mui/icons-material/Link'
import RepeatIcon from '@mui/icons-material/Repeat'
import type { InfoRecord } from '@shared/types/domain'
import { categoryColor, tagColor } from '@shared/constants/categories'
import { describeRecurrence } from '@/lib/recurrence'
import { isHttpUrl, prettyHost } from '@/services/linkPreviewService'
import LinkCover from './LinkCover'

const TYPE_META: Record<string, { label: string; icon: React.ReactElement }> = {
  idea: { label: '想法', icon: <LightbulbIcon fontSize="small" /> },
  material: { label: '资料', icon: <FolderIcon fontSize="small" /> },
  todo: { label: '待办', icon: <CheckCircleIcon fontSize="small" /> },
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

interface RecordCardProps {
  record: InfoRecord
  onClick?: () => void
}

/** 记录卡片（循环标识、链接封面、分类标签、摘要、时间）。 */
export default function RecordCard({ record, onClick }: RecordCardProps) {
  const meta = TYPE_META[record.type] ?? TYPE_META.idea
  const recurrenceLabel = record.recurrence ? describeRecurrence(record.recurrence, record.remindAt) : ''
  const hostLabel = record.linkMeta?.site || prettyHost(record.url)

  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardActionArea onClick={onClick} sx={{ height: '100%' }}>
        <CardContent sx={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 1 }}>
          <LinkCover record={record} />
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Chip
              size="small"
              icon={meta.icon}
              label={meta.label}
              sx={{
                bgcolor: 'rgba(91,84,217,0.1)',
                color: 'primary.main',
                fontSize: 12,
                '& .MuiChip-icon': { color: 'primary.main' },
              }}
            />
            {record.type === 'todo' && record.todoStatus === 'done' && (
              <Chip size="small" label="已完成" color="success" variant="outlined" sx={{ fontSize: 12 }} />
            )}
            {recurrenceLabel && (
              <Chip
                size="small"
                icon={<RepeatIcon fontSize="small" />}
                label={recurrenceLabel}
                variant="outlined"
                sx={{ fontSize: 11, '& .MuiChip-icon': { fontSize: 14 } }}
              />
            )}
            {record.url && (
              <Box component="span" sx={{ color: 'text.secondary', display: 'inline-flex' }}>
                <LinkIcon fontSize="small" />
              </Box>
            )}
            <Box sx={{ flex: 1 }} />
            <Typography variant="caption" color="text.secondary">
              {formatTime(record.createdAt)}
            </Typography>
          </Box>

          <Typography variant="subtitle1" fontWeight={600} sx={{ lineHeight: 1.3 }}>
            {record.title || '（无标题）'}
          </Typography>

          {record.summary && (
            <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.5 }}>
              {record.summary.length > 90 ? `${record.summary.slice(0, 90)}…` : record.summary}
            </Typography>
          )}
          {!record.summary && record.content && (
            <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.5 }}>
              {record.content.length > 90 ? `${record.content.slice(0, 90)}…` : record.content}
            </Typography>
          )}

          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 'auto' }}>
            {record.category && (
              <Chip
                size="small"
                label={record.category}
                sx={{
                  fontSize: 11,
                  bgcolor: `${categoryColor(record.category)}22`,
                  color: categoryColor(record.category),
                }}
              />
            )}
            {record.tags.slice(0, 3).map((tag) => (
              <Chip
                key={tag}
                size="small"
                label={tag}
                variant="outlined"
                sx={{ fontSize: 11, color: tagColor(tag), borderColor: `${tagColor(tag)}55` }}
              />
            ))}
            {record.type === 'todo' && record.priority && (
              <Chip
                size="small"
                label={record.priority === 'high' ? '高优先级' : record.priority === 'medium' ? '中优先级' : '低优先级'}
                color={record.priority === 'high' ? 'error' : record.priority === 'medium' ? 'warning' : 'default'}
                variant="outlined"
                sx={{ fontSize: 11 }}
              />
            )}
            {isHttpUrl(record.url) && hostLabel && (
              <Chip
                size="small"
                icon={<LinkIcon fontSize="small" />}
                label={hostLabel}
                variant="outlined"
                sx={{ fontSize: 11, maxWidth: 180, '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' } }}
              />
            )}
          </Box>
        </CardContent>
      </CardActionArea>
    </Card>
  )
}
