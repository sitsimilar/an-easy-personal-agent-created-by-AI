import { useRef, useState } from 'react'
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
import LightbulbIcon from '@mui/icons-material/Lightbulb'
import FolderIcon from '@mui/icons-material/Folder'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import CloudUploadIcon from '@mui/icons-material/CloudUpload'
import type { Priority, RecordType } from '@shared/types/domain'
import { recordService } from '@/services/recordService'
import { aiService } from '@/services/aiService'
import { storageService } from '@/services/storageService'
import { friendlyError } from '@/lib/unwrap'

interface RecordCreateDialogProps {
  open: boolean
  onClose: () => void
  onCreated?: () => void
  defaultType?: RecordType
  /** 预填提醒时间（datetime-local 值），用于日历点击日期创建待办。 */
  defaultRemindAt?: string
}

export default function RecordCreateDialog({ open, onClose, onCreated, defaultType, defaultRemindAt }: RecordCreateDialogProps) {
  const [type, setType] = useState<RecordType>(defaultType ?? 'idea')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [url, setUrl] = useState('')
  const [priority, setPriority] = useState<Priority>('medium')
  const [remindAt, setRemindAt] = useState(defaultRemindAt ?? '')
  const [filePath, setFilePath] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    setType(defaultType ?? 'idea')
    setTitle('')
    setContent('')
    setUrl('')
    setPriority('medium')
    setRemindAt(defaultRemindAt ?? '')
    setFilePath(null)
    setFileName('')
    setError('')
  }

  const close = () => {
    reset()
    onClose()
  }

  const handleFile = async (file: File | undefined) => {
    if (!file) return
    setUploading(true)
    setError('')
    try {
      const path = await storageService.uploadMaterial(file)
      setFilePath(path)
      setFileName(file.name)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setUploading(false)
    }
  }

  const submit = async () => {
    if (type === 'material' && !title.trim() && !content.trim() && !url.trim() && !filePath) {
      setError('请填写标题、内容、链接或上传附件中的任意一项')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const created = await recordService.createRecord({
        type,
        title: title.trim(),
        content: content.trim(),
        url: type === 'material' && url.trim() ? url.trim() : null,
        filePath: type === 'material' ? filePath : null,
        todoStatus: type === 'todo' ? 'pending' : null,
        priority: type === 'todo' ? priority : null,
        remindAt: type === 'todo' && remindAt ? new Date(remindAt).toISOString() : null,
      })

      // 后台自动分类/总结/关联（不阻塞关闭弹窗）
      aiService.enrichRecord(created).catch(() => undefined)

      reset()
      onCreated?.()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="sm">
      <DialogTitle>快速记录</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <ToggleButtonGroup
            exclusive
            fullWidth
            value={type}
            onChange={(_e, v) => {
              if (v) setType(v as RecordType)
            }}
          >
            <ToggleButton value="idea">
              <LightbulbIcon fontSize="small" sx={{ mr: 0.5 }} />想法
            </ToggleButton>
            <ToggleButton value="material">
              <FolderIcon fontSize="small" sx={{ mr: 0.5 }} />资料
            </ToggleButton>
            <ToggleButton value="todo">
              <CheckCircleIcon fontSize="small" sx={{ mr: 0.5 }} />待办
            </ToggleButton>
          </ToggleButtonGroup>

          <TextField
            label="标题"
            fullWidth
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={type === 'idea' ? '一句话概括这个想法' : type === 'todo' ? '要做什么' : '资料标题'}
          />
          <TextField
            label="内容"
            fullWidth
            multiline
            minRows={3}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="详细内容（可选）"
          />

          {type === 'material' && (
            <>
              <TextField
                label="资料链接"
                fullWidth
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://..."
              />
              <Box>
                <input
                  ref={fileInputRef}
                  type="file"
                  hidden
                  onChange={(e) => handleFile(e.target.files?.[0])}
                />
                <Button
                  variant="outlined"
                  startIcon={<CloudUploadIcon />}
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploading ? '上传中…' : '上传附件'}
                </Button>
                {fileName && (
                  <Chip label={fileName} onDelete={() => { setFilePath(null); setFileName('') }} sx={{ ml: 1 }} />
                )}
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                  支持图片、PDF、常见文档，单文件不超过 50MB
                </Typography>
              </Box>
            </>
          )}

          {type === 'todo' && (
            <>
              <FormControl fullWidth>
                <InputLabel id="priority-label">优先级</InputLabel>
                <Select
                  labelId="priority-label"
                  label="优先级"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as Priority)}
                >
                  <MenuItem value="high">高</MenuItem>
                  <MenuItem value="medium">中</MenuItem>
                  <MenuItem value="low">低</MenuItem>
                </Select>
              </FormControl>
              <TextField
                label="提醒时间"
                type="datetime-local"
                fullWidth
                value={remindAt}
                onChange={(e) => setRemindAt(e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
            </>
          )}

          {error && <Typography color="error" variant="body2">{error}</Typography>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>取消</Button>
        <Button variant="contained" onClick={submit} disabled={submitting}>
          {submitting ? '保存中…' : '保存'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
