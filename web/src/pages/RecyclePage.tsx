import { useEffect, useState } from 'react'
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  List,
  ListItem,
  ListItemText,
  Typography,
} from '@mui/material'
import RestoreIcon from '@mui/icons-material/Restore'
import DeleteForeverIcon from '@mui/icons-material/DeleteForever'
import RefreshIcon from '@mui/icons-material/Refresh'
import type { InfoRecord } from '@shared/types/domain'
import { recordService } from '@/services/recordService'
import { friendlyError } from '@/lib/unwrap'

const RECYCLE_DAYS = 30

function daysLeft(iso: string | null | undefined): number {
  if (!iso) return 0
  const deleted = new Date(iso).getTime()
  if (Number.isNaN(deleted)) return 0
  const left = RECYCLE_DAYS - (Date.now() - deleted) / (24 * 60 * 60 * 1000)
  return Math.max(0, Math.ceil(left))
}

/** 回收站（30 天内可恢复）。 */
export default function RecyclePage() {
  const [records, setRecords] = useState<InfoRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await recordService.listRecords({ isDeleted: true, pageSize: 200 })
      setRecords(res.records)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const restore = async (id: number) => {
    try {
      await recordService.restore(id)
      load()
    } catch (err) {
      setError(friendlyError(err))
    }
  }

  const purge = async (r: InfoRecord) => {
    if (!window.confirm('彻底删除后不可恢复，确定继续吗？')) return
    try {
      await recordService.hardDelete(r.id)
      load()
    } catch (err) {
      setError(friendlyError(err))
    }
  }

  return (
    <Box sx={{ p: 3, maxWidth: 760, mx: 'auto' }}>
      <Typography variant="h6" fontWeight={700} gutterBottom>
        回收站
      </Typography>
      <Typography variant="body2" color="text.secondary" gutterBottom>
        删除的记录会在此保留 {RECYCLE_DAYS} 天，到期后可彻底删除。
      </Typography>
      {error && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <Typography color="error" sx={{ flex: 1 }}>{error}</Typography>
          <Button size="small" startIcon={<RefreshIcon />} onClick={load}>
            重试
          </Button>
        </Box>
      )}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      ) : records.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 8, color: 'text.secondary' }}>
          <Typography>回收站为空</Typography>
        </Box>
      ) : (
        <List>
          {records.map((r) => (
            <ListItem
              key={r.id}
              divider
              secondaryAction={
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Button size="small" startIcon={<RestoreIcon />} onClick={() => restore(r.id)}>
                    恢复
                  </Button>
                  <Button size="small" color="error" startIcon={<DeleteForeverIcon />} onClick={() => purge(r)}>
                    彻底删除
                  </Button>
                </Box>
              }
            >
              <ListItemText
                primary={r.title || '（无标题）'}
                secondary={
                  <Box component="span" sx={{ display: 'flex', gap: 1, mt: 0.5 }}>
                    <Chip size="small" label={r.type === 'idea' ? '想法' : r.type === 'material' ? '资料' : '待办'} sx={{ fontSize: 11 }} />
                    <Typography variant="caption" color="text.secondary">
                      删除于 {r.deletedAt ? new Date(r.deletedAt).toLocaleString('zh-CN') : '-'}（剩 {daysLeft(r.deletedAt)} 天）
                    </Typography>
                  </Box>
                }
              />
            </ListItem>
          ))}
        </List>
      )}
    </Box>
  )
}
