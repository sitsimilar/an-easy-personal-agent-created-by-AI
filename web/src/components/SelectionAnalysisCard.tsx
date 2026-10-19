import { useState } from 'react'
import {
  Box,
  Card,
  Collapse,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import type { SelectionAnalysisResult, SelectionIssue, SelectionIssueCategory } from '@shared/types/domain'

const CATEGORY_META: Record<SelectionIssueCategory, { label: string; color: 'error' | 'warning' | 'info' }> = {
  syntax: { label: '语法错误', color: 'error' },
  defect: { label: '潜在缺陷', color: 'warning' },
  style: { label: '风格与规范建议', color: 'info' },
}

const ORDER: SelectionIssueCategory[] = ['syntax', 'defect', 'style']

interface SelectionAnalysisCardProps {
  result: SelectionAnalysisResult
  onClose?: () => void
}

/** 选区分析结果卡：按语法错误/潜在缺陷/风格规范三类分组展示。 */
export default function SelectionAnalysisCard({ result, onClose }: SelectionAnalysisCardProps) {
  const [expanded, setExpanded] = useState<SelectionIssueCategory | null>('syntax')

  const grouped = (category: SelectionIssueCategory): SelectionIssue[] =>
    result.issues.filter((it) => it.category === category)

  return (
    <Card
      variant="outlined"
      sx={{
        p: 1.5,
        maxHeight: 340,
        overflowY: 'auto',
        overscrollBehavior: 'contain',
      }}
    >
      <Stack spacing={1}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Typography variant="subtitle2" fontWeight={600} sx={{ flex: 1 }}>
            选区分析
          </Typography>
          {onClose && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ cursor: 'pointer' }}
              onClick={onClose}
            >
              关闭
            </Typography>
          )}
        </Stack>

        <Typography variant="body2" color="text.secondary">
          {result.summary}
        </Typography>

        {result.issues.length === 0 && (
          <Typography variant="caption" color="text.secondary">
            未发现需要修改的问题
          </Typography>
        )}

        {ORDER.map((category) => {
          const items = grouped(category)
          if (items.length === 0) return null
          const meta = CATEGORY_META[category]
          const open = expanded === category
          return (
            <Box key={category}>
              <ListItemButton
                dense
                onClick={() => setExpanded((v) => (v === category ? null : category))}
                sx={{ borderRadius: 1, px: 1 }}
              >
                <ListItemText
                  primary={`${meta.label}（${items.length}）`}
                  primaryTypographyProps={{ variant: 'caption', fontWeight: 600, color: `${meta.color}.main` }}
                />
                {open ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
              </ListItemButton>
              <Collapse in={open} timeout="auto" unmountOnExit>
                <List dense disablePadding>
                  {items.map((issue, idx) => (
                    <ListItemText
                      key={idx}
                      sx={{ pl: 1, mb: 0.5, borderLeft: '3px solid', borderColor: `${meta.color}.main`, ml: 1 }}
                      primary={
                        <Typography variant="caption" fontWeight={600}>
                          {issue.title}
                          {issue.line ? `（第 ${issue.line} 行）` : ''}
                        </Typography>
                      }
                      secondary={
                        <Box component="span">
                          <Typography variant="caption" color="text.secondary" component="span">
                            {issue.description}
                          </Typography>
                          <Typography variant="caption" color={`${meta.color}.main`} component="span" display="block">
                            建议：{issue.suggestion}
                          </Typography>
                          {issue.snippet && (
                            <Typography
                              variant="caption"
                              component="span"
                              sx={{ fontFamily: 'monospace', bgcolor: 'grey.100', px: 0.5, borderRadius: 0.5 }}
                            >
                              {issue.snippet}
                            </Typography>
                          )}
                        </Box>
                      }
                    />
                  ))}
                </List>
              </Collapse>
            </Box>
          )
        })}
      </Stack>
    </Card>
  )
}
