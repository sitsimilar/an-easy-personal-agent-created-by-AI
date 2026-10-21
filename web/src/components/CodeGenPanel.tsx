import { useState } from 'react'
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import { CPP_CHEAT_CATEGORY_META, matchCppKnowledgePoints } from '@shared/constants/cpp-cheatsheet'
import { aiService } from '@/services/aiService'
import { friendlyError } from '@/lib/unwrap'
import { useDevToolsStore } from '@/store/devToolsStore'
import { MONO_FONT } from '@/theme'

interface CodeGenPanelProps {
  /** 点击知识点时跳转速查库详情。 */
  onOpenEntry?: (id: string) => void
}

/** 自然语言需求 → 生成完整 C++ 代码 + 关联知识点（结果持久化，切换界面不丢失）。 */
export default function CodeGenPanel({ onOpenEntry }: CodeGenPanelProps) {
  const codeGenResult = useDevToolsStore((s) => s.codeGenResult)
  const setCodeGenResult = useDevToolsStore((s) => s.setCodeGenResult)

  // 输入框本地态（生成后随结果一并持久化）；生成代码与知识点从 store 恢复
  const [requirement, setRequirement] = useState(codeGenResult?.requirement ?? '')
  const [streamCode, setStreamCode] = useState('')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const code = codeGenResult?.code ?? ''
  const points = codeGenResult?.points ?? []

  const generate = async () => {
    const req = requirement.trim()
    if (!req || generating) return
    setGenerating(true)
    setError('')
    setStreamCode('')
    setCodeGenResult(null)
    try {
      const c = await aiService.generateCode(req, {
        onDelta: (t) => setStreamCode((prev) => prev + t),
      })
      setStreamCode('')
      setCodeGenResult({ requirement: req, code: c, points: matchCppKnowledgePoints(c) })
    } catch (err) {
      setError(friendlyError(err))
      setStreamCode('')
    } finally {
      setGenerating(false)
    }
  }

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      /* 忽略 */
    }
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <TextField
        size="small"
        fullWidth
        multiline
        minRows={2}
        maxRows={4}
        value={requirement}
        onChange={(e) => setRequirement(e.target.value)}
        placeholder="用自然语言描述需求，例如：读取一个文本文件并逐行打印，或对一组整数排序并去重"
      />
      <Button
        size="small"
        variant="contained"
        startIcon={generating ? <CircularProgress size={14} color="inherit" /> : <AutoAwesomeIcon />}
        onClick={generate}
        disabled={generating || !requirement.trim()}
        className="companion-no-drag"
      >
        {generating ? '生成中…' : '生成代码'}
      </Button>

      {error && (
        <Typography variant="caption" color="error">
          {error}
        </Typography>
      )}

      {generating && streamCode && (
        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
            生成中（实时预览）…
          </Typography>
          <Typography
            component="pre"
            sx={{
              m: 0,
              p: 1,
              bgcolor: 'grey.100',
              borderRadius: 1,
              fontFamily: MONO_FONT,
              fontSize: 11,
              lineHeight: 1.4,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              maxHeight: 240,
              overflowY: 'auto',
            }}
          >
            {streamCode}
          </Typography>
        </Box>
      )}

      {code && (
        <>
          <Box>
            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <Typography variant="caption" color="text.secondary">
                生成结果（可直接复制运行）
              </Typography>
              <Button size="small" startIcon={<ContentCopyIcon />} onClick={copyCode}>
                {copied ? '已复制' : '复制代码'}
              </Button>
            </Stack>
            <Typography
              component="pre"
              sx={{
                m: 0,
                mt: 0.5,
                p: 1,
                bgcolor: 'grey.100',
                borderRadius: 1,
                fontFamily: MONO_FONT,
                fontSize: 11,
                lineHeight: 1.4,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                maxHeight: 240,
                overflowY: 'auto',
              }}
            >
              {code}
            </Typography>
          </Box>

          {points.length > 0 && (
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                涉及的知识点（点击查看速查库详情）
              </Typography>
              <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                {points.map((p) => (
                  <Chip
                    key={p.id}
                    size="small"
                    label={`${CPP_CHEAT_CATEGORY_META[p.category].label}·${p.name}`}
                    onClick={() => onOpenEntry?.(p.id)}
                    sx={{ fontSize: 11, height: 22, cursor: 'pointer' }}
                  />
                ))}
              </Stack>
            </Box>
          )}
        </>
      )}
    </Box>
  )
}
