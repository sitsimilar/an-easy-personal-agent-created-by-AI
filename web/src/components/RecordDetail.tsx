import { useEffect, useState } from 'react'
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import DeleteIcon from '@mui/icons-material/Delete'
import EditIcon from '@mui/icons-material/Edit'
import SaveIcon from '@mui/icons-material/Save'
import TipsAndUpdatesIcon from '@mui/icons-material/TipsAndUpdates'
import type { InfoRecord, KeyPoint } from '@shared/types/domain'
import { categoryColor, tagColor } from '@shared/constants/categories'
import { recordService } from '@/services/recordService'
import { aiService } from '@/services/aiService'
import { storageService } from '@/services/storageService'
import { friendlyError } from '@/lib/unwrap'
import RelatedRecords from './RelatedRecords'

interface RecordDetailProps {
  record: InfoRecord | null
  open: boolean
  onClose: () => void
  onChanged?: () => void
  onDeleted?: () => void
  /** 打开关联目标记录（替换当前详情）。 */
  onOpenRecord?: (record: InfoRecord) => void
}

export default function RecordDetail({ record, open, onClose, onChanged, onDeleted, onOpenRecord }: RecordDetailProps) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [summary, setSummary] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [signedUrl, setSignedUrl] = useState<string | null>(null)
  const [keyPoints, setKeyPoints] = useState<KeyPoint[]>([])
  const [keyPointsLoaded, setKeyPointsLoaded] = useState(false)
  const [extracting, setExtracting] = useState(false)

  useEffect(() => {
    if (record) {
      setTitle(record.title)
      setContent(record.content)
      setSummary(record.summary ?? '')
      setEditing(false)
      setError('')
      setKeyPoints([])
      setKeyPointsLoaded(false)
    }
    setSignedUrl(null)
    if (record?.filePath) {
      storageService
        .getSignedUrl(record.filePath)
        .then(setSignedUrl)
        .catch(() => setSignedUrl(null))
    }
  }, [record])

  if (!record) return null

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      await recordService.updateRecord(record.id, { title: title.trim(), content: content.trim() })
      setEditing(false)
      onChanged?.()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!window.confirm('确定删除这条记录吗？删除后可在回收站中恢复。')) return
    try {
      await recordService.softDelete(record.id)
      onDeleted?.()
      onClose()
    } catch (err) {
      setError(friendlyError(err))
    }
  }

  const regenerateSummary = async () => {
    setError('')
    try {
      const next = await aiService.summarize(`${record.title}\n${record.content}`)
      await recordService.patchRecord(record.id, { summary: next })
      setSummary(next) // 即时回写当前详情态，避免弹窗仍显示旧摘要
      onChanged?.()
    } catch (err) {
      setError(friendlyError(err))
    }
  }

  const extractKeyPoints = async () => {
    setExtracting(true)
    setError('')
    try {
      const points = await aiService.extractKeyPoints(`${record.title}\n${record.content}`)
      setKeyPoints(points)
      setKeyPointsLoaded(true)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setExtracting(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box sx={{ flex: 1 }}>
          {editing ? (
            <TextField
              size="small"
              fullWidth
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              label="标题"
            />
          ) : (
            <Typography variant="h6" fontWeight={700}>
              {record.title || '（无标题）'}
            </Typography>
          )}
        </Box>
        {editing ? (
          <Button variant="contained" startIcon={<SaveIcon />} onClick={save} disabled={saving}>
            保存
          </Button>
        ) : (
          <Tooltip title="编辑">
            <IconButton onClick={() => setEditing(true)}>
              <EditIcon />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title="删除">
          <IconButton onClick={remove}>
            <DeleteIcon color="error" />
          </IconButton>
        </Tooltip>
      </DialogTitle>

      <DialogContent dividers>
        <Stack spacing={2}>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {record.category && (
              <Chip
                size="small"
                label={record.category}
                sx={{ bgcolor: `${categoryColor(record.category)}22`, color: categoryColor(record.category) }}
              />
            )}
            {record.tags.map((tag) => (
              <Chip key={tag} size="small" label={tag} variant="outlined" sx={{ color: tagColor(tag) }} />
            ))}
          </Box>

          {summary && (
            <Box sx={{ bgcolor: 'rgba(91,84,217,0.06)', p: 1.5, borderRadius: 2 }}>
              <Typography variant="subtitle2" color="primary.main" gutterBottom>
                AI 摘要
              </Typography>
              <Typography variant="body2">{summary}</Typography>
            </Box>
          )}

          {editing ? (
            <TextField
              multiline
              minRows={6}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              label="正文"
            />
          ) : (
            <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>
              {record.content || '（无内容）'}
            </Typography>
          )}

          {record.url && (
            <Button
              variant="text"
              size="small"
              href={record.url}
              target="_blank"
              rel="noreferrer"
              sx={{ alignSelf: 'flex-start' }}
            >
              打开资料链接
            </Button>
          )}
          {record.filePath && signedUrl && (
            <Button
              variant="text"
              size="small"
              href={signedUrl}
              target="_blank"
              rel="noreferrer"
              sx={{ alignSelf: 'flex-start' }}
            >
              下载附件
            </Button>
          )}

          {!editing && (
            <Stack direction="row" spacing={1}>
              <Button variant="outlined" size="small" onClick={regenerateSummary}>
                重新生成摘要
              </Button>
              <Button
                variant="outlined"
                size="small"
                startIcon={<TipsAndUpdatesIcon />}
                onClick={extractKeyPoints}
                disabled={extracting}
              >
                {extracting ? '提取中…' : '提取重点'}
              </Button>
            </Stack>
          )}

          {!editing && keyPoints.length > 0 && (
            <Box sx={{ bgcolor: 'rgba(14,165,233,0.06)', p: 1.5, borderRadius: 2 }}>
              <Typography variant="subtitle2" color="secondary.main" gutterBottom>
                提取重点
              </Typography>
              <Stack spacing={1}>
                {keyPoints.map((k, i) => (
                  <Box key={i}>
                    <Typography variant="body2">• {k.point}</Typography>
                    {k.detail && (
                      <Typography variant="caption" color="text.secondary" sx={{ pl: 2 }}>
                        {k.detail}
                      </Typography>
                    )}
                  </Box>
                ))}
              </Stack>
            </Box>
          )}

          {!editing && keyPointsLoaded && keyPoints.length === 0 && !extracting && (
            <Typography variant="body2" color="text.secondary">
              未提取到明显要点
            </Typography>
          )}

          {error && <Typography color="error" variant="body2">{error}</Typography>}

          <RelatedRecords
            sourceId={record.id}
            onSelect={(r) => {
              if (onOpenRecord) onOpenRecord(r)
            }}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>关闭</Button>
      </DialogActions>
    </Dialog>
  )
}
