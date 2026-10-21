import { forwardRef, memo, useEffect, useMemo, useRef, useState } from 'react'
import {
  Box,
  Button,
  Card,
  Chip,
  Collapse,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import SearchIcon from '@mui/icons-material/Search'
import type { CppCheatCategory, CppCheatEntry } from '@shared/types/domain'
import { CPP_CHEAT_CATEGORY_META, CPP_CHEAT_ENTRIES } from '@shared/constants/cpp-cheatsheet'
import { MONO_FONT } from '@/theme'

/** 复制文本到剪贴板（优先 navigator.clipboard，失败回退 execCommand）。 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* 继续回退 */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

type CategoryFilter = 'all' | CppCheatCategory

/** 搜索结果分页大小（首屏 DOM 节点上限）。 */
const PAGE_SIZE = 30

interface CppCheatEntryCardProps {
  entry: CppCheatEntry
  open: boolean
  copied: boolean
  onToggle: () => void
  onCopy: () => void
}

/** C++ 速查条目卡片。memo + 自定义比较（忽略内联回调引用，仅比较数据与展示态）。 */
const CppCheatEntryCard = memo(
  forwardRef<HTMLDivElement, CppCheatEntryCardProps>(function CppCheatEntryCard(
    { entry, open, copied, onToggle, onCopy },
    ref,
  ) {
    const meta = CPP_CHEAT_CATEGORY_META[entry.category]
    return (
      <Card
        variant="outlined"
        sx={{ p: 1, transition: 'box-shadow .15s ease', '&:hover': { boxShadow: 2 } }}
        ref={ref}
      >
        <Stack spacing={0.5}>
          <Stack direction="row" alignItems="center" spacing={0.5}>
            <Typography
              variant="body2"
              fontWeight={600}
              sx={{
                flex: 1,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontFamily: MONO_FONT,
                cursor: 'pointer',
              }}
              onClick={onToggle}
            >
              {entry.name}
            </Typography>
            <Chip size="small" label={meta.label} sx={{ fontSize: 10, height: 18 }} />
            <IconButton size="small" aria-label="复制" onClick={onCopy}>
              {copied ? (
                <Typography variant="caption" color="success.main">
                  已复制
                </Typography>
              ) : (
                <ContentCopyIcon sx={{ fontSize: 15 }} />
              )}
            </IconButton>
            <IconButton size="small" onClick={onToggle}>
              {open ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
            </IconButton>
          </Stack>

          <Typography variant="caption" color="text.secondary">
            {entry.description}
          </Typography>

          <Collapse in={open} timeout="auto" unmountOnExit>
            <Stack spacing={0.5} sx={{ pt: 0.5 }}>
              <CppCodeBlock label="语法" text={entry.syntax} onCopy={copyText} />
              <CppCodeBlock label="示例" text={entry.example} onCopy={copyText} />
              {entry.notes && (
                <Typography variant="caption" sx={{ color: 'warning.dark' }}>
                  ⚠ {entry.notes}
                </Typography>
              )}
            </Stack>
          </Collapse>
        </Stack>
      </Card>
    )
  }),
  (prev, next) =>
    prev.entry.id === next.entry.id && prev.open === next.open && prev.copied === next.copied,
)

/** C++ 速查库面板：覆盖基础语法到现代 C++，支持分类、搜索、复制、分页与条目定位。 */
interface CppCheatSheetPanelProps {
  /** 外部请求定位到某个条目（如代码生成点击知识点跳转）。 */
  focusEntryId?: string | null
  /** 定位处理完成后回调（用于清空 focusEntryId，避免重复触发）。 */
  onFocusConsumed?: () => void
}

export default function CppCheatSheetPanel({ focusEntryId, onFocusConsumed }: CppCheatSheetPanelProps) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<CategoryFilter>('all')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [visible, setVisible] = useState(PAGE_SIZE)
  const entryRefs = useRef<Record<string, HTMLElement | null>>({})

  const entries = useMemo(() => {
    const q = query.trim().toLowerCase()
    return CPP_CHEAT_ENTRIES.filter((e) => {
      if (category !== 'all' && e.category !== category) return false
      if (!q) return true
      if (e.name.toLowerCase().includes(q)) return true
      if (e.description.toLowerCase().includes(q)) return true
      return (e.tags ?? []).some((t) => t.toLowerCase().includes(q))
    })
  }, [query, category])

  useEffect(() => {
    setVisible(PAGE_SIZE)
  }, [query, category])

  // 外部定位：清过滤 → 展开 → 滚动到目标条目
  useEffect(() => {
    if (!focusEntryId) return
    const idx = CPP_CHEAT_ENTRIES.findIndex((e) => e.id === focusEntryId)
    if (idx < 0) return
    setQuery('')
    setCategory('all')
    setVisible((v) => Math.max(v, idx + 1))
    setExpanded(focusEntryId)
    const timer = window.setTimeout(() => {
      entryRefs.current[focusEntryId]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      onFocusConsumed?.()
    }, 150)
    return () => window.clearTimeout(timer)
  }, [focusEntryId, onFocusConsumed])

  const shown = entries.slice(0, visible)
  const remaining = entries.length - shown.length

  const onCopy = async (e: CppCheatEntry) => {
    const ok = await copyText(e.syntax)
    if (ok) {
      setCopied(e.id)
      window.setTimeout(() => setCopied(null), 1200)
    }
  }

  const categoryChips: Array<{ key: CategoryFilter; label: string }> = [
    { key: 'all', label: '全部' },
    ...(Object.entries(CPP_CHEAT_CATEGORY_META) as Array<[CppCheatCategory, { label: string }]>).map(
      ([key, meta]) => ({ key, label: meta.label }),
    ),
  ]

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <TextField
        size="small"
        fullWidth
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="搜索语法 / 标准库 / 算法 / 陷阱…"
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon fontSize="small" />
            </InputAdornment>
          ),
          endAdornment: query ? (
            <InputAdornment position="end">
              <IconButton size="small" onClick={() => setQuery('')}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </InputAdornment>
          ) : undefined,
        }}
      />

      <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
        {categoryChips.map((c) => (
          <Chip
            key={c.key}
            size="small"
            label={c.label}
            variant={category === c.key ? 'filled' : 'outlined'}
            color={category === c.key ? 'primary' : 'default'}
            onClick={() => setCategory(c.key)}
            sx={{ fontSize: 11, height: 24 }}
          />
        ))}
      </Stack>

      {entries.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 3 }}>
          未找到匹配的条目
        </Typography>
      ) : (
        <>
          {shown.map((e) => (
            <CppCheatEntryCard
              key={e.id}
              ref={(el) => {
                entryRefs.current[e.id] = el
              }}
              entry={e}
              open={expanded === e.id}
              copied={copied === e.id}
              onToggle={() => setExpanded(expanded === e.id ? null : e.id)}
              onCopy={() => void onCopy(e)}
            />
          ))}
          {remaining > 0 && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 1 }}>
              <Button size="small" variant="outlined" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
                加载更多（剩余 {remaining} 条）
              </Button>
            </Box>
          )}
        </>
      )}
    </Box>
  )
}

/** 代码块（等宽字体，点击复制）。 */
function CppCodeBlock({
  label,
  text,
  onCopy,
}: {
  label: string
  text: string
  onCopy: (t: string) => Promise<boolean>
}) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    const ok = await onCopy(text)
    if (ok) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    }
  }
  return (
    <Box>
      <Typography variant="caption" color="primary.main" fontWeight={600}>
        {label}
      </Typography>
      <Typography
        variant="caption"
        component="pre"
        onClick={copy}
        sx={{
          m: 0,
          mt: 0.25,
          p: 0.75,
          bgcolor: 'grey.100',
          borderRadius: 0.5,
          fontFamily: MONO_FONT,
          fontSize: 11,
          lineHeight: 1.4,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          cursor: 'pointer',
          '&:hover': { bgcolor: 'grey.200' },
        }}
      >
        {text}
      </Typography>
      {copied && (
        <Typography variant="caption" color="success.main">
          已复制
        </Typography>
      )}
    </Box>
  )
}
