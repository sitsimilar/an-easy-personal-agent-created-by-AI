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
import type { CheatCategory, CheatEntry } from '@shared/types/domain'
import { CHEAT_CATEGORY_META, CHEAT_ENTRIES } from '@shared/constants/cheatsheet'
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

type CategoryFilter = 'all' | CheatCategory

/** 搜索结果分页大小（首屏 DOM 节点上限）。 */
const PAGE_SIZE = 30

/**
 * 计算让聚焦条目可见所需的最小分页数量。
 * 聚焦（如悬浮窗知识点跳转）会清空筛选，若目标索引超出当前分页需同步放大，否则滚动不到。
 */
function requiredVisible(focusId: string | null | undefined): number {
  if (!focusId) return PAGE_SIZE
  const idx = CHEAT_ENTRIES.findIndex((e) => e.id === focusId)
  return idx >= 0 ? Math.max(PAGE_SIZE, idx + 1) : PAGE_SIZE
}

interface CheatSheetPanelProps {
  /** 需要聚焦（展开并滚动到）的条目 id。 */
  focusId?: string | null
}

interface CheatEntryCardProps {
  entry: CheatEntry
  /** 是否展开详情。 */
  open: boolean
  /** 是否处于「已复制」反馈态。 */
  copied: boolean
  onToggle: () => void
  onCopy: () => void
}

/**
 * 速查条目卡片。
 * memo + 自定义比较：onToggle/onCopy/ref 均为父组件内联引用（每次渲染都是新引用，
 * 默认浅比较恒不相等会使 memo 失效），故仅比较条目数据与展示态，
 * 使搜索输入/加载更多等父组件重渲染时跳过未变化卡片的重渲染。
 */
const CheatEntryCard = memo(forwardRef<HTMLDivElement, CheatEntryCardProps>(function CheatEntryCard(
  { entry, open, copied, onToggle, onCopy },
  ref,
) {
  const meta = CHEAT_CATEGORY_META[entry.category]
  return (
    <Card
      variant="outlined"
      sx={{
        p: 1,
        transition: 'box-shadow .15s ease',
        '&:hover': { boxShadow: 2 },
      }}
      ref={ref}
    >
      <Stack spacing={0.5}>
        {/* 头部：名称 + 类别 + 复制 */}
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

        {/* 用途说明（始终显示） */}
        <Typography variant="caption" color="text.secondary">
          {entry.description}
        </Typography>

        {/* 展开详情 */}
        <Collapse in={open} timeout="auto" unmountOnExit>
          <Stack spacing={0.5} sx={{ pt: 0.5 }}>
            <CodeBlock label="语法" text={entry.syntax} onCopy={copyText} />
            <CodeBlock label="示例" text={entry.example} onCopy={copyText} />
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
  // 忽略内联回调与 ref 的引用变化，仅比较条目数据与展示态
  (prev, next) =>
    prev.entry.id === next.entry.id &&
    prev.open === next.open &&
    prev.copied === next.copied,
)

/** 速查库面板：关键字/运算符/函数/语法结构，支持分类、实时搜索、点击复制、分页浏览。 */
export default function CheatSheetPanel({ focusId }: CheatSheetPanelProps) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<CategoryFilter>('all')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [visible, setVisible] = useState(PAGE_SIZE)
  const entryRefs = useRef<Record<string, HTMLElement | null>>({})

  // 聚焦指定条目：清空筛选使其可见，展开并滚动到该条目
  useEffect(() => {
    if (!focusId) return
    setQuery('')
    setCategory('all')
    setExpanded(focusId)
    const timer = window.setTimeout(() => {
      entryRefs.current[focusId]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 80)
    return () => window.clearTimeout(timer)
  }, [focusId])

  const entries = useMemo(() => {
    const q = query.trim().toLowerCase()
    return CHEAT_ENTRIES.filter((e) => {
      if (category !== 'all' && e.category !== category) return false
      if (!q) return true
      if (e.name.toLowerCase().includes(q)) return true
      if (e.description.toLowerCase().includes(q)) return true
      return (e.tags ?? []).some((t) => t.toLowerCase().includes(q))
    })
  }, [query, category])

  // 筛选条件变化时重置分页；存在聚焦目标（或其变化）时保证目标条目已渲染
  useEffect(() => {
    setVisible(requiredVisible(focusId))
  }, [query, category, focusId])

  const shown = entries.slice(0, visible)
  const remaining = entries.length - shown.length

  const onCopy = async (e: CheatEntry) => {
    const ok = await copyText(e.syntax)
    if (ok) {
      setCopied(e.id)
      window.setTimeout(() => setCopied(null), 1200)
    }
  }

  const categoryChips: Array<{ key: CategoryFilter; label: string }> = [
    { key: 'all', label: '全部' },
    { key: 'keyword', label: '关键字' },
    { key: 'operator', label: '运算符' },
    { key: 'function', label: '函数' },
    { key: 'syntax', label: '语法结构' },
  ]

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {/* 搜索框 */}
      <TextField
        size="small"
        fullWidth
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="搜索关键字 / 运算符 / 函数…"
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

      {/* 类别筛选 */}
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

      {/* 条目列表（分页渲染，降低首屏 DOM 节点数） */}
      {entries.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 3 }}>
          未找到匹配的条目
        </Typography>
      ) : (
        <>
          {shown.map((e) => (
            <CheatEntryCard
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
function CodeBlock({ label, text, onCopy }: { label: string; text: string; onCopy: (t: string) => Promise<boolean> }) {
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
