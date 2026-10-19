import { useEffect, useState } from 'react'
import {
  Box,
  Chip,
  CircularProgress,
  List,
  ListItemButton,
  ListItemText,
  Typography,
} from '@mui/material'
import type { InfoRecord } from '@shared/types/domain'
import { recordService } from '@/services/recordService'

interface RelatedItem {
  record: InfoRecord
  score: number
  reason: string | null
}

interface RelatedRecordsProps {
  sourceId: number
  onSelect?: (record: InfoRecord) => void
}

/** 智能关联记录列表。 */
export default function RelatedRecords({ sourceId, onSelect }: RelatedRecordsProps) {
  const [items, setItems] = useState<RelatedItem[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    recordService
      .listRelated(sourceId)
      .then((data) => {
        if (!cancelled) setItems(data)
      })
      .catch(() => {
        if (!cancelled) setItems([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [sourceId])

  if (loading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}>
        <CircularProgress size={16} />
        <Typography variant="body2" color="text.secondary">正在加载相关记录…</Typography>
      </Box>
    )
  }

  if (items.length === 0) {
    return <Typography variant="body2" color="text.secondary">暂无相关记录</Typography>
  }

  return (
    <Box>
      <Typography variant="subtitle2" gutterBottom>
        相关记录
      </Typography>
      <List dense disablePadding>
        {items.map((item) => (
          <ListItemButton
            key={item.record.id}
            onClick={() => onSelect?.(item.record)}
            sx={{ borderRadius: 2, mb: 0.5, alignItems: 'flex-start' }}
          >
            <ListItemText
              primary={item.record.title || '（无标题）'}
              secondary={
                <>
                  {item.reason && <span>{item.reason} · </span>}
                  <span>相关度 {Math.round(item.score * 100)}%</span>
                </>
              }
              primaryTypographyProps={{ variant: 'body2', fontWeight: 600 }}
              secondaryTypographyProps={{ variant: 'caption' }}
            />
            {item.record.category && (
              <Chip size="small" label={item.record.category} sx={{ fontSize: 11, ml: 1 }} />
            )}
          </ListItemButton>
        ))}
      </List>
    </Box>
  )
}
