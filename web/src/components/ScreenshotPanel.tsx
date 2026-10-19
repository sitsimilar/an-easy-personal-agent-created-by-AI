import { useRef, useState } from 'react'
import { Box, Button, Stack, TextField, Typography } from '@mui/material'
import UploadIcon from '@mui/icons-material/Upload'
import { aiService } from '@/services/aiService'
import { friendlyError } from '@/lib/unwrap'

/** 截图识别：上传截图 + 上下文 → AI 识别内容并推测需求。 */
export default function ScreenshotPanel() {
  const [image, setImage] = useState<string | null>(null)
  const [imageSize, setImageSize] = useState(0)
  const [context, setContext] = useState('')
  const [result, setResult] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement | null>(null)

  const onFile = (file: File) => {
    if (!file.type.startsWith('image/')) return
    if (file.size > 10 * 1024 * 1024) {
      setError('截图文件不能超过 10MB')
      return
    }
    setError('')
    const reader = new FileReader()
    reader.onload = () => {
      setImage(reader.result as string)
      setImageSize(file.size)
      setResult('')
    }
    reader.readAsDataURL(file)
  }

  const analyze = async () => {
    if (!image || analyzing) return
    setAnalyzing(true)
    setError('')
    setResult('')
    try {
      const r = await aiService.analyzeScreenshot(image, context)
      setResult(r)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setAnalyzing(false)
    }
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onFile(f)
          e.target.value = ''
        }}
      />
      <Button
        size="small"
        variant="outlined"
        startIcon={<UploadIcon />}
        onClick={() => fileRef.current?.click()}
        className="companion-no-drag"
      >
        {image ? '更换截图' : '上传截图'}
      </Button>

      {image && (
        <Box
          component="img"
          src={image}
          alt="截图预览"
          sx={{ maxWidth: '100%', maxHeight: 200, objectFit: 'contain', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}
        />
      )}

      <TextField
        size="small"
        fullWidth
        value={context}
        onChange={(e) => setContext(e.target.value)}
        placeholder="补充上下文（可选），如：这段代码报错了 / 这是一个登录页面"
      />

      <Button
        size="small"
        variant="contained"
        onClick={analyze}
        disabled={!image || analyzing}
        className="companion-no-drag"
      >
        {analyzing ? '识别中…' : '识别截图'}
      </Button>

      {error && (
        <Typography variant="caption" color="error">
          {error}
        </Typography>
      )}

      {result && (
        <Typography
          variant="body2"
          sx={{ whiteSpace: 'pre-wrap', bgcolor: 'grey.50', p: 1, borderRadius: 1 }}
        >
          {result}
        </Typography>
      )}
    </Box>
  )
}
