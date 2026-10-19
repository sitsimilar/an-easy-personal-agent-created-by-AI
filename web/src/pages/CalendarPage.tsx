import { useEffect, useMemo, useState } from 'react'
import {
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import AddIcon from '@mui/icons-material/Add'
import RefreshIcon from '@mui/icons-material/Refresh'
import type { InfoRecord } from '@shared/types/domain'
import { recordService } from '@/services/recordService'
import { friendlyError } from '@/lib/unwrap'
import { categoryColor } from '@shared/constants/categories'
import RecordDetail from '@/components/RecordDetail'
import RecordCreateDialog from '@/components/RecordCreateDialog'
import PageHeader from '@/components/PageHeader'

type ViewMode = 'month' | 'week'

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

/** 周一作为一周起点。 */
function mondayOf(d: Date): Date {
  const x = startOfDay(d)
  const dow = (x.getDay() + 6) % 7
  return addDays(x, -dow)
}

/** 记录创建时间的本地日期 key（用于按天聚合）。 */
function recordDayKey(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : dateKey(d)
}

interface DayRecords {
  byDay: Map<string, InfoRecord[]>
}

/** 日历页：月/周视图 + 点击日期查看/创建当天记录事项。 */
export default function CalendarPage() {
  const [viewMode, setViewMode] = useState<ViewMode>('month')
  const [anchor, setAnchor] = useState<Date>(() => startOfDay(new Date()))
  const [data, setData] = useState<DayRecords>({ byDay: new Map() })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [detail, setDetail] = useState<InfoRecord | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  // 视图时间范围（月 = 当月整月；周 = 本周一 ~ 周日）
  const range = useMemo((): [Date, Date] => {
    if (viewMode === 'month') {
      const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
      const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)
      return [startOfDay(first), startOfDay(addDays(last, 1))]
    }
    const mon = mondayOf(anchor)
    return [mon, startOfDay(addDays(mon, 7))]
  }, [viewMode, anchor])

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const [start, end] = range
      const rows = await recordService.listByRange(start.toISOString(), end.toISOString(), 1000)
      const byDay = new Map<string, InfoRecord[]>()
      for (const r of rows) {
        const k = recordDayKey(r.createdAt)
        if (!k) continue
        const arr = byDay.get(k) ?? []
        arr.push(r)
        byDay.set(k, arr)
      }
      setData({ byDay })
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range])

  const shift = (delta: number) => {
    if (viewMode === 'month') {
      setAnchor((a) => new Date(a.getFullYear(), a.getMonth() + delta, 1))
    } else {
      setAnchor((a) => addDays(a, delta * 7))
    }
  }

  const title = viewMode === 'month' ? `${anchor.getFullYear()} 年 ${anchor.getMonth() + 1} 月` : '本周'

  const selectedRecords = selectedDay ? data.byDay.get(selectedDay) ?? [] : []

  // 月视图网格：当月 1 号是周几（周一起），前补空白格
  const monthCells = useMemo(() => {
    if (viewMode !== 'month') return []
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
    const daysInMonth = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate()
    const leading = (first.getDay() + 6) % 7 // 周一 = 0
    const cells: Array<Date | null> = []
    for (let i = 0; i < leading; i++) cells.push(null)
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(anchor.getFullYear(), anchor.getMonth(), d))
    return cells
  }, [viewMode, anchor])

  const weekDays = useMemo(() => {
    if (viewMode !== 'week') return []
    const mon = mondayOf(anchor)
    return Array.from({ length: 7 }, (_, i) => addDays(mon, i))
  }, [viewMode, anchor])

  const isToday = (d: Date) => dateKey(d) === dateKey(new Date())

  const renderDayChip = (d: Date) => {
    const key = dateKey(d)
    const count = data.byDay.get(key)?.length ?? 0
    return (
      <Chip
        size="small"
        label={count > 0 ? `${count} 条` : ''}
        sx={{ height: 16, fontSize: 10, visibility: count > 0 ? 'visible' : 'hidden' }}
      />
    )
  }

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader
        title="日历"
        subtitle="按日期查看与创建记录事项"
        action={
          <ToggleButtonGroup
            size="small"
            exclusive
            value={viewMode}
            onChange={(_e, v) => v && setViewMode(v)}
          >
            <ToggleButton value="month">月视图</ToggleButton>
            <ToggleButton value="week">周视图</ToggleButton>
          </ToggleButtonGroup>
        }
      />

      {/* 标题栏：前后切换 */}
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
        <IconButton size="small" onClick={() => shift(-1)}>
          <ChevronLeftIcon />
        </IconButton>
        <Typography variant="subtitle1" fontWeight={600} sx={{ minWidth: 120, textAlign: 'center' }}>
          {title}
        </Typography>
        <IconButton size="small" onClick={() => shift(1)}>
          <ChevronRightIcon />
        </IconButton>
        <Button size="small" onClick={() => setAnchor(startOfDay(new Date()))}>
          今天
        </Button>
        <Box sx={{ flex: 1 }} />
        {error && (
          <>
            <Typography variant="caption" color="error">{error}</Typography>
            <IconButton size="small" onClick={load} title="重试">
              <RefreshIcon fontSize="small" />
            </IconButton>
          </>
        )}
      </Stack>

      {/* 星期表头 */}
      <Grid container columns={7} sx={{ mb: 0.5 }}>
        {WEEKDAYS.map((w) => (
          <Grid item xs={1} key={w}>
            <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center', display: 'block' }}>
              {w}
            </Typography>
          </Grid>
        ))}
      </Grid>

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
          <CircularProgress size={22} />
        </Box>
      )}

      {viewMode === 'month' ? (
        <Box sx={{ overflowX: 'auto' }}>
          <Box sx={{ minWidth: 640 }}>
          <Grid container columns={7} spacing={0.5}>
          {monthCells.map((d, i) => (
            <Grid item xs={1} key={i}>
              {d ? (
                <Card
                  variant="outlined"
                  onClick={() => setSelectedDay(dateKey(d))}
                  sx={{
                    minHeight: 64,
                    p: 0.75,
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 0.25,
                    bgcolor: isToday(d) ? 'rgba(91,84,217,0.08)' : undefined,
                    borderColor: isToday(d) ? 'primary.main' : undefined,
                    '&:hover': { boxShadow: 2 },
                  }}
                >
                  <Typography variant="caption" fontWeight={isToday(d) ? 700 : 400}>
                    {d.getDate()}
                  </Typography>
                  {renderDayChip(d)}
                </Card>
              ) : (
                <Box sx={{ minHeight: 64 }} />
              )}
            </Grid>
          ))}
        </Grid>
          </Box>
        </Box>
      ) : (
        <Stack spacing={0.5}>
          {weekDays.map((d) => {
            const key = dateKey(d)
            const recs = data.byDay.get(key) ?? []
            return (
              <Card
                key={key}
                variant="outlined"
                onClick={() => setSelectedDay(key)}
                sx={{ cursor: 'pointer', '&:hover': { boxShadow: 2 } }}
              >
                <Stack direction="row" spacing={1} sx={{ p: 1 }}>
                  <Stack
                    alignItems="center"
                    sx={{
                      width: 44,
                      borderRadius: 2,
                      bgcolor: isToday(d) ? 'primary.main' : 'action.hover',
                      color: isToday(d) ? '#fff' : 'text.primary',
                      py: 0.5,
                    }}
                  >
                    <Typography variant="caption">周{WEEKDAYS[(d.getDay() + 6) % 7]}</Typography>
                    <Typography variant="h6" fontWeight={700}>{d.getDate()}</Typography>
                  </Stack>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    {recs.length === 0 ? (
                      <Typography variant="caption" color="text.secondary">
                        暂无记录
                      </Typography>
                    ) : (
                      recs.slice(0, 4).map((r) => (
                        <Typography key={r.id} variant="body2" noWrap>
                          {r.title || '（无标题）'}
                        </Typography>
                      ))
                    )}
                    {recs.length > 4 && (
                      <Typography variant="caption" color="text.secondary">
                        还有 {recs.length - 4} 条…
                      </Typography>
                    )}
                  </Box>
                </Stack>
              </Card>
            )
          })}
        </Stack>
      )}

      {/* 当天记录 Dialog */}
      <Dialog open={!!selectedDay} onClose={() => setSelectedDay(null)} fullWidth maxWidth="sm">
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box sx={{ flex: 1 }}>{selectedDay} 的记录事项</Box>
          <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}>
            添加事项
          </Button>
        </DialogTitle>
        <DialogContent dividers>
          {loading ? (
            <Typography variant="body2" color="text.secondary">加载中…</Typography>
          ) : selectedRecords.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              当天暂无记录，点击「添加事项」创建
            </Typography>
          ) : (
            <List dense disablePadding>
              {selectedRecords.map((r) => (
                <ListItemButton key={r.id} onClick={() => setDetail(r)} sx={{ borderRadius: 1 }}>
                  <ListItemText
                    primary={r.title || '（无标题）'}
                    secondary={
                      r.category
                        ? `${r.type === 'todo' ? '待办' : r.type === 'material' ? '资料' : '想法'} · ${r.category}`
                        : r.type === 'todo' ? '待办' : r.type === 'material' ? '资料' : '想法'
                    }
                  />
                  {r.category && (
                    <Box
                      sx={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        bgcolor: categoryColor(r.category),
                        flexShrink: 0,
                      }}
                    />
                  )}
                </ListItemButton>
              ))}
            </List>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSelectedDay(null)}>关闭</Button>
        </DialogActions>
      </Dialog>

      {/* 详情 */}
      <RecordDetail
        record={detail}
        open={!!detail}
        onClose={() => setDetail(null)}
        onChanged={load}
        onDeleted={load}
        onOpenRecord={setDetail}
      />

      {/* 创建（预填提醒日期为选中日期 09:00） */}
      <RecordCreateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false)
          load()
        }}
        defaultType="todo"
        defaultRemindAt={selectedDay ? `${selectedDay}T09:00` : undefined}
      />
    </Box>
  )
}
