import {
  Box,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import type { RecurrenceFreq, RecurrenceRule } from '@shared/types/domain'
import { defaultWeekday, normalizeRecurrenceRule } from '@/lib/recurrence'

interface RecurrenceFieldProps {
  /** 当前规则；null 表示不重复。 */
  value: RecurrenceRule | null
  onChange: (rule: RecurrenceRule | null) => void
  /** 提醒时间（ISO 或 datetime-local），用于 weekly 默认星期与 monthly 日号展示。 */
  remindAt?: string | null
  disabled?: boolean
}

type FreqValue = RecurrenceFreq | 'none'

/** 周几选项（0=周日）。 */
const WEEKDAY_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 1, label: '一' },
  { value: 2, label: '二' },
  { value: 3, label: '三' },
  { value: 4, label: '四' },
  { value: 5, label: '五' },
  { value: 6, label: '六' },
  { value: 0, label: '日' },
]

/** 频率下拉选项。 */
const FREQ_OPTIONS: Array<{ value: FreqValue; label: string }> = [
  { value: 'none', label: '不重复' },
  { value: 'daily', label: '每天' },
  { value: 'weekly', label: '每周' },
  { value: 'monthly', label: '每月' },
]

/** 从 remindAt（ISO 或 datetime-local）取本地日号，用于 monthly 文案与锚定日默认值。 */
function dayOfMonth(remindAt?: string | null): number | null {
  if (!remindAt) return null
  const ms = Date.parse(remindAt)
  if (Number.isNaN(ms)) return null
  return new Date(ms).getDate()
}

/**
 * 待办「重复」控件（P0-B）。
 *
 * 交互：频率（不重复/每天/每周/每月）→ 间隔 1–99 → 每周多选周几 → 结束日期。
 * 规则内部键为 camelCase，与 JSONB 存储一致；选择「不重复」时回调 null。
 */
export default function RecurrenceField({ value, onChange, remindAt, disabled }: RecurrenceFieldProps) {
  const rule = normalizeRecurrenceRule(value)
  const freq: FreqValue = rule ? rule.freq : 'none'
  const interval = rule?.interval ?? 1
  const weekdays = rule?.weekdays ?? []
  const endDate = rule?.endDate ?? ''
  /** 已填的锚定日号（仅 monthly 使用）。 */
  const anchorDay = rule?.anchorDay ?? null
  /** monthly 默认锚定日：优先 remindAt 的日号，无则今天。 */
  const defaultAnchorDay = () => dayOfMonth(remindAt) ?? new Date().getDate()

  /** 保证 monthly 规则落库时带上锚定日（旧数据编辑时顺带回填，避免继续漂移）。 */
  const ensureAnchor = (next: RecurrenceRule): RecurrenceRule => {
    if (next.freq !== 'monthly' || next.anchorDay != null) return next
    return { ...next, anchorDay: defaultAnchorDay() }
  }

  /** 非 monthly 只在已有锚定日时携带，避免给规则塞无意义字段。 */
  const anchorField = anchorDay != null ? { anchorDay } : {}

  const handleFreqChange = (next: FreqValue) => {
    if (next === 'none') {
      onChange(null)
      return
    }
    if (next === 'weekly') {
      // 默认取 remind_at 的星期；无 remind_at 取今天；不丢弃已填的锚定日
      const selected = weekdays.length > 0 ? weekdays : [defaultWeekday(remindAt)]
      onChange({ freq: 'weekly', interval, weekdays: selected, endDate: endDate || null, ...anchorField })
      return
    }
    if (next === 'monthly') {
      // 锚定日优先取提醒时间日号，无提醒时间取今天；已有锚定日则沿用
      onChange({ freq: 'monthly', interval, anchorDay: anchorDay ?? defaultAnchorDay(), endDate: endDate || null })
      return
    }
    onChange({ freq: next, interval, endDate: endDate || null, ...anchorField })
  }

  const handleIntervalChange = (raw: string) => {
    if (!rule) return
    const parsed = Number(raw)
    const next = Number.isFinite(parsed) ? Math.min(Math.max(Math.floor(parsed), 1), 99) : 1
    onChange(ensureAnchor({ ...rule, interval: next }))
  }

  const handleWeekdaysChange = (selected: number[]) => {
    if (!rule) return
    // 至少保留一个，避免规则退化为「没有任何日期」
    if (selected.length === 0) return
    const sorted = [...new Set(selected)].sort((a, b) => a - b)
    onChange({ ...rule, weekdays: sorted })
  }

  const handleEndDateChange = (raw: string) => {
    if (!rule) return
    onChange(ensureAnchor({ ...rule, endDate: raw ? raw : null }))
  }

  /** 展示用日号：优先锚定日，其次 remindAt 的日号。 */
  const displayDay = anchorDay ?? dayOfMonth(remindAt)
  const monthlyHint =
    displayDay === null ? '按提醒时间的日号推进' : displayDay === 31 ? '该月无 31 日时取当月最后一天' : `每月 ${displayDay} 日`

  return (
    <Box sx={{ border: '1px dashed', borderColor: 'divider', borderRadius: 2, p: 1.5 }}>
      <Stack spacing={1.5}>
        <Typography variant="subtitle2" color="text.secondary">
          重复
        </Typography>

        <Stack direction="row" spacing={1.5}>
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel id="recurrence-freq-label">频率</InputLabel>
            <Select
              labelId="recurrence-freq-label"
              label="频率"
              value={freq}
              disabled={disabled}
              onChange={(e) => handleFreqChange(e.target.value as FreqValue)}
            >
              {FREQ_OPTIONS.map((o) => (
                <MenuItem key={o.value} value={o.value}>
                  {o.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {rule && (
            <TextField
              size="small"
              type="number"
              label="间隔"
              value={interval}
              disabled={disabled}
              onChange={(e) => handleIntervalChange(e.target.value)}
              inputProps={{ min: 1, max: 99 }}
              helperText="1–99"
              sx={{ width: 110 }}
            />
          )}
        </Stack>

        {rule?.freq === 'weekly' && (
          <Box>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
              每周几（可多选）
            </Typography>
            <ToggleButtonGroup
              size="small"
              value={weekdays}
              onChange={(_e, next: number[]) => handleWeekdaysChange(next)}
              disabled={disabled}
              aria-label="每周重复的星期"
            >
              {WEEKDAY_OPTIONS.map((o) => (
                <ToggleButton key={o.value} value={o.value} sx={{ px: 1.25, py: 0.25 }}>
                  {o.label}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Box>
        )}

        {rule?.freq === 'monthly' && (
          <Typography variant="caption" color="text.secondary">
            {monthlyHint}
          </Typography>
        )}

        {rule && (
          <TextField
            size="small"
            type="date"
            label="结束日期（留空表示一直重复）"
            value={endDate}
            disabled={disabled}
            onChange={(e) => handleEndDateChange(e.target.value)}
            InputLabelProps={{ shrink: true }}
            sx={{ maxWidth: 260 }}
          />
        )}
      </Stack>
    </Box>
  )
}
