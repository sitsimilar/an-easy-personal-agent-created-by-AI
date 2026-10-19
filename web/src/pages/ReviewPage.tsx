import { useState } from 'react'
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  List,
  ListItem,
  ListItemText,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import AddTaskIcon from '@mui/icons-material/AddTask'
import type { ActionItem, ReviewResult } from '@shared/types/domain'
import { recordService } from '@/services/recordService'
import { aiService } from '@/services/aiService'
import { friendlyError } from '@/lib/unwrap'

type Range = 'week' | 'month' | 'custom'

const priorityLabel: Record<string, string> = {
  high: '高',
  medium: '中',
  low: '低',
}

const priorityColor: Record<string, 'error' | 'warning' | 'default'> = {
  high: 'error',
  medium: 'warning',
  low: 'default',
}

function startOfWeek(d: Date): Date {
  const diff = (d.getDay() + 6) % 7 // 距周一的天数
  const monday = new Date(d)
  monday.setDate(d.getDate() - diff)
  monday.setHours(0, 0, 0, 0)
  return monday
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function dateToIso(dateStr: string, endOfDay: boolean): string {
  // 显式用本地年月日分量构造，避免字符串解析时区歧义；再转 UTC 供 created_at 比较
  const [y, m, d] = dateStr.split('-').map((n) => Number.parseInt(n, 10))
  if (!y || !m || !d) return ''
  const date = new Date(y, m - 1, d, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

/** 回顾页：阶段总结 + 后续行动建议（R-15/R-16 合并）。 */
export default function ReviewPage() {
  const [range, setRange] = useState<Range>('week')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<ReviewResult | null>(null)
  const [empty, setEmpty] = useState(false)
  const [converted, setConverted] = useState<Set<number>>(new Set())
  const [toast, setToast] = useState('')

  const showToast = (msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(''), 3000)
  }

  const computeRange = (): { start: Date; end: Date } => {
    const now = new Date()
    if (range === 'week') return { start: startOfWeek(now), end: now }
    if (range === 'month') return { start: startOfMonth(now), end: now }
    const start = dateToIso(customStart, false)
    const end = dateToIso(customEnd, true)
    if (!start || !end || new Date(start) > new Date(end)) {
      return { start: startOfMonth(now), end: now }
    }
    return { start: new Date(start), end: new Date(end) }
  }

  const generate = async () => {
    setLoading(true)
    setError('')
    setEmpty(false)
    setResult(null)
    setConverted(new Set())
    try {
      const { start, end } = computeRange()
      if (start > end) {
        setError('开始日期不能晚于结束日期，请调整区间')
        return
      }
      const records = await recordService.listByRange(start.toISOString(), end.toISOString())
      if (records.length === 0) {
        setEmpty(true)
        return
      }
      const review = await aiService.generateReview(records)
      setResult(review)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setLoading(false)
    }
  }

  const convertToTodo = async (action: ActionItem, index: number) => {
    try {
      await recordService.createRecord({
        type: 'todo',
        title: action.title,
        content: action.detail ?? '',
        priority: action.priority ?? 'medium',
        todoStatus: 'pending',
      })
      setConverted((prev) => {
        const next = new Set(prev)
        next.add(index)
        return next
      })
      showToast('已添加待办')
    } catch (err) {
      setError(friendlyError(err))
    }
  }

  return (
    <Box sx={{ p: 3, maxWidth: 860, mx: 'auto' }}>
      <Typography variant="h6" fontWeight={700} gutterBottom>
        回顾
      </Typography>
      <Typography variant="body2" color="text.secondary" gutterBottom>
        对一段时间内的记录生成阶段总结与后续行动建议
      </Typography>

      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent>
          <Stack spacing={2}>
            <ToggleButtonGroup
              exclusive
              value={range}
              onChange={(_e, v) => {
                if (v) setRange(v as Range)
              }}
              size="small"
            >
              <ToggleButton value="week">本周</ToggleButton>
              <ToggleButton value="month">本月</ToggleButton>
              <ToggleButton value="custom">自定义</ToggleButton>
            </ToggleButtonGroup>

            {range === 'custom' && (
              <Stack direction="row" spacing={2}>
                <TextField
                  label="开始日期"
                  type="date"
                  size="small"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  InputLabelProps={{ shrink: true }}
                />
                <TextField
                  label="结束日期"
                  type="date"
                  size="small"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  InputLabelProps={{ shrink: true }}
                />
              </Stack>
            )}

            <Box>
              <Button
                variant="contained"
                startIcon={<AutoAwesomeIcon />}
                onClick={generate}
                disabled={loading || (range === 'custom' && (!customStart || !customEnd))}
              >
                {loading ? '生成中…' : '生成回顾'}
              </Button>
            </Box>
          </Stack>
        </CardContent>
      </Card>

      {error && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <Typography color="error" variant="body2" sx={{ flex: 1 }}>{error}</Typography>
          <Button size="small" variant="outlined" onClick={generate}>
            重试
          </Button>
        </Box>
      )}

      {empty && (
        <Box sx={{ textAlign: 'center', py: 6, color: 'text.secondary' }}>
          <Typography>该时间段暂无记录</Typography>
        </Box>
      )}

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      )}

      {result && !loading && (
        <>
          <Card variant="outlined" sx={{ mb: 2 }}>
            <CardContent>
              <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                阶段总结
              </Typography>
              <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.8 }}>
                {result.summary}
              </Typography>
            </CardContent>
          </Card>

          <Card variant="outlined">
            <CardContent>
              <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                后续行动建议
              </Typography>
              {result.actions.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  暂无行动建议
                </Typography>
              ) : (
                <List disablePadding>
                  {result.actions.map((action, index) => (
                    <Box key={index}>
                      <ListItem
                        disablePadding
                        secondaryAction={
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<AddTaskIcon />}
                            disabled={converted.has(index)}
                            onClick={() => convertToTodo(action, index)}
                          >
                            {converted.has(index) ? '已转待办' : '转待办'}
                          </Button>
                        }
                        sx={{ py: 1 }}
                      >
                        <ListItemText
                          primary={
                            <Stack direction="row" spacing={1} alignItems="center">
                              <Typography variant="body2" fontWeight={600}>
                                {action.title}
                              </Typography>
                              {action.priority && (
                                <Chip
                                  size="small"
                                  label={priorityLabel[action.priority] ?? action.priority}
                                  color={priorityColor[action.priority] ?? 'default'}
                                  variant="outlined"
                                  sx={{ fontSize: 10, height: 18 }}
                                />
                              )}
                            </Stack>
                          }
                          secondary={action.detail}
                          secondaryTypographyProps={{ variant: 'caption', color: 'text.secondary' }}
                        />
                      </ListItem>
                      {index < result.actions.length - 1 && <Divider />}
                    </Box>
                  ))}
                </List>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {toast && (
        <Box sx={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)' }}>
          <Chip label={toast} color="primary" />
        </Box>
      )}
    </Box>
  )
}
