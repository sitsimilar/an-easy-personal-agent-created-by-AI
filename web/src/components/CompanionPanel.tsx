import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import {
  Box,
  Button,
  Chip,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import CloseIcon from '@mui/icons-material/Close'
import CloseFullscreenIcon from '@mui/icons-material/CloseFullscreen'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit'
import FullscreenIcon from '@mui/icons-material/Fullscreen'
import MinimizeIcon from '@mui/icons-material/Minimize'
import MenuBookIcon from '@mui/icons-material/MenuBook'
import CodeIcon from '@mui/icons-material/Code'
import OpenInFullIcon from '@mui/icons-material/OpenInFull'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import type { DesktopStatus, FloatingWindowStatePayload, SelectionReadResult, VsStartedPayload } from '@shared/types/ipc'
import type { RecordType, SelectionAnalysisResult } from '@shared/types/domain'
import { aiService } from '@/services/aiService'
import { recordService } from '@/services/recordService'
import { friendlyError } from '@/lib/unwrap'
import SelectionAnalysisCard from './SelectionAnalysisCard'
import CheatSheetPanel from './CheatSheetPanel'
import CodeGenPanel from './CodeGenPanel'
import ContextMenu from './ContextMenu'

const INITIAL_STATUS: DesktopStatus = {
  listening: false,
  vsRunning: false,
  vsInstalled: null,
  currentSolution: null,
  analyzing: false,
  codeUploadEnabled: true,
  windowVisible: true,
  lastAnalysisAt: null,
  lastIssueCount: null,
  lastTriggerReason: null,
}

/** 桌面悬浮窗（companion 模式）—— 检测 window.desktopBridge 以隐藏桌面专属能力。 */
export default function CompanionPanel() {
  const [status, setStatus] = useState<DesktopStatus>(INITIAL_STATUS)
  const [floatingState, setFloatingState] = useState<FloatingWindowStatePayload>({
    scale: 'small',
    docked: false,
    fullscreen: false,
  })
  const [quickType, setQuickType] = useState<RecordType>('idea')
  const [quickText, setQuickText] = useState('')
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [selection, setSelection] = useState<SelectionAnalysisResult | null>(null)
  const [selectionLoading, setSelectionLoading] = useState(false)
  const [showCheat, setShowCheat] = useState(false)
  const [showCodeGen, setShowCodeGen] = useState(false)
  const [cheatFocusId, setCheatFocusId] = useState<string | null>(null)

  /** 打开速查库并聚焦到指定条目（供代码生成的知识点跳转）。 */
  const openCheatEntry = (id: string) => {
    setShowCheat(true)
    setCheatFocusId(id)
  }
  const bridge = typeof window !== 'undefined' ? window.desktopBridge : undefined
  const selectionKey = useRef<string | null>(null)
  const toastTimer = useRef<number | null>(null)

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), 3000)
  }, [])

  // 卸载时清理 toast 定时器
  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current)
    }
  }, [])

  /** VS 启动 → 分析变更文件 → 回传分析结果（成功/失败都回传以复位 analyzing）。 */
  const handleVsStarted = useCallback(
    async (payload: VsStartedPayload) => {
      if (!bridge) return
      const files = payload.changedFiles ?? []
      if (files.length === 0) return // 无变更文件（隐私关闭/无变更），主进程已复位
      try {
        const result = await aiService.analyzeChangedFiles(files)
        bridge.notifyAnalysisDone({
          analysisId: Date.now(),
          status: 'done',
          issueCount: result.issues.length,
          solutionName: payload.solutionName,
          solutionPath: payload.solutionPath,
          summary: result.summary,
          issues: result.issues,
          analyzedAt: new Date().toISOString(),
        })
        showToast(`分析完成：${result.issues.length} 个建议`)
      } catch (err) {
        bridge.notifyAnalysisDone({
          analysisId: Date.now(),
          status: 'failed',
          issueCount: 0,
          message: friendlyError(err),
          solutionName: payload.solutionName,
          solutionPath: payload.solutionPath,
          analyzedAt: new Date().toISOString(),
        })
        showToast(friendlyError(err))
      }
    },
    [bridge, showToast],
  )

  // 拉取桌面状态并订阅变化
  useEffect(() => {
    if (!bridge) return
    bridge.getStatus().then(setStatus).catch(() => undefined)
    const offStatus = bridge.onStatusChanged(setStatus)
    const offSelection = bridge.onSelectionRead((result: SelectionReadResult) => {
      void handleSelection(result)
    })
    const offVsStarted = bridge.onVsStarted((payload: VsStartedPayload) => {
      void handleVsStarted(payload)
    })
    const offFloatingState = bridge.onFloatingWindowStateChanged((s) => {
      setFloatingState(s)
    })
    return () => {
      offStatus()
      offSelection()
      offVsStarted()
      offFloatingState()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, handleVsStarted])

  // F11 快捷键：全屏/退出全屏
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F11') {
        e.preventDefault()
        void bridge?.floatingWindowControl('fullscreen-toggle')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [bridge])

  const handleSelection = useCallback(async (result: SelectionReadResult) => {
    if (result.status !== 'ok') {
      showToast(result.message ?? '读取选区失败')
      return
    }
    if (!result.text || !result.capturedAt) return
    if (selectionKey.current === result.capturedAt) return
    selectionKey.current = result.capturedAt

    setSelectionLoading(true)
    setSelection(null)
    try {
      const analyzed = await aiService.analyzeSelection(result.text)
      setSelection(analyzed)
      showToast('选区分析完成')
    } catch (err) {
      showToast(friendlyError(err))
    } finally {
      setSelectionLoading(false)
    }
  }, [])

  const readSelectionNow = async () => {
    if (!bridge) return
    try {
      const result = await bridge.readSelection()
      if (result) await handleSelection(result)
    } catch (err) {
      showToast(friendlyError(err))
    }
  }

  const saveQuick = async () => {
    const text = quickText.trim()
    if (!text) return
    setSaving(true)
    try {
      const created = await recordService.createRecord({
        type: quickType,
        title: text.slice(0, 40),
        content: text,
        todoStatus: quickType === 'todo' ? 'pending' : null,
        priority: quickType === 'todo' ? 'medium' : null,
      })
      aiService.enrichRecord(created).catch(() => undefined)
      setQuickText('')
      showToast('已保存')
    } catch (err) {
      showToast(friendlyError(err))
    } finally {
      setSaving(false)
    }
  }

  const handleContextMenu = (e: MouseEvent<HTMLElement>) => {
    // 桌面悬浮窗由 Electron 原生菜单接管，避免双菜单
    if (bridge) return
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }

  if (!bridge) {
    // 浏览器直开 companion 地址时的兜底提示
    return (
      <Box sx={{ p: 4, textAlign: 'center' }}>
        <Typography variant="h6">桌面伴侣悬浮窗</Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          请在桌面伴侣程序中打开此页面。
        </Typography>
      </Box>
    )
  }

  const statusChip = (() => {
    if (status.analyzing) return { label: '分析中…', color: 'warning' as const }
    if (status.vsRunning) return { label: '已监听 VS', color: 'success' as const }
    if (status.vsInstalled === false) return { label: '未检测到 VS', color: 'default' as const }
    if (status.listening) return { label: '监听中', color: 'success' as const }
    return { label: '已暂停', color: 'default' as const }
  })()

  return (
    <Box
      onContextMenu={handleContextMenu}
      sx={{
        width: '100%',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* 顶部拖拽区 */}
      <Box
        className="companion-drag"
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          px: 1,
          py: 0.5,
          borderBottom: '1px solid',
          borderColor: 'divider',
          bgcolor: 'rgba(91,84,217,0.06)',
        }}
      >
        <Typography variant="subtitle2" fontWeight={700} noWrap sx={{ flex: 1, pl: 0.5 }}>
          个人信息管家
        </Typography>
        <Chip size="small" label={statusChip.label} color={statusChip.color} sx={{ fontSize: 10, height: 20 }} />
        <Box className="companion-no-drag" sx={{ display: 'flex', ml: 0.5 }}>
          <IconButton
            size="small"
            aria-label="全屏"
            title="全屏/退出全屏（F11）"
            onClick={() => void bridge.floatingWindowControl('fullscreen-toggle')}
            sx={{
              width: 26,
              height: 26,
              borderRadius: 0.5,
              color: 'text.secondary',
              '&:hover': { bgcolor: 'action.hover' },
              '&:active': { bgcolor: 'rgba(0,0,0,0.16)' },
            }}
          >
            {floatingState.fullscreen ? (
              <FullscreenExitIcon sx={{ fontSize: 16 }} />
            ) : (
              <FullscreenIcon sx={{ fontSize: 16 }} />
            )}
          </IconButton>
          <IconButton
            size="small"
            aria-label="缩放"
            onClick={() => void bridge.floatingWindowControl('scale-toggle')}
            sx={{
              width: 26,
              height: 26,
              borderRadius: 0.5,
              color: 'text.secondary',
              '&:hover': { bgcolor: 'action.hover' },
              '&:active': { bgcolor: 'rgba(0,0,0,0.16)' },
            }}
          >
            {floatingState.scale === 'large' ? (
              <CloseFullscreenIcon sx={{ fontSize: 16 }} />
            ) : (
              <OpenInFullIcon sx={{ fontSize: 16 }} />
            )}
          </IconButton>
          <IconButton
            size="small"
            aria-label="最小化"
            onClick={() => void bridge.floatingWindowControl('minimize')}
            sx={{
              width: 26,
              height: 26,
              borderRadius: 0.5,
              color: 'text.secondary',
              '&:hover': { bgcolor: 'action.hover' },
              '&:active': { bgcolor: 'rgba(0,0,0,0.16)' },
            }}
          >
            <MinimizeIcon sx={{ fontSize: 16 }} />
          </IconButton>
          <IconButton
            size="small"
            aria-label="关闭"
            onClick={() => void bridge.floatingWindowControl('close')}
            sx={{
              width: 26,
              height: 26,
              borderRadius: 0.5,
              color: 'text.secondary',
              '&:hover': { bgcolor: 'error.main', color: '#fff' },
              '&:active': { bgcolor: 'error.dark', color: '#fff' },
            }}
          >
            <CloseIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Box>
      </Box>

      <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1.5, flex: 1, minHeight: 0, overflow: 'auto' }}>
          {/* 快速记录 */}
          <Stack direction="row" spacing={0.5}>
            <Button
              size="small"
              variant={quickType === 'idea' ? 'contained' : 'outlined'}
              onClick={() => setQuickType('idea')}
            >
              想法
            </Button>
            <Button
              size="small"
              variant={quickType === 'todo' ? 'contained' : 'outlined'}
              onClick={() => setQuickType('todo')}
            >
              待办
            </Button>
          </Stack>
          <Stack direction="row" spacing={1}>
            <TextField
              size="small"
              fullWidth
              value={quickText}
              onChange={(e) => setQuickText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveQuick()
              }}
              placeholder={quickType === 'idea' ? '记一个想法…' : '记一个待办…'}
            />
            <IconButton color="primary" onClick={saveQuick} disabled={saving} className="companion-no-drag">
              <AddIcon />
            </IconButton>
          </Stack>

          {/* 选区分析 */}
          <Button
            size="small"
            variant="outlined"
            startIcon={<ContentCopyIcon />}
            onClick={readSelectionNow}
            disabled={selectionLoading}
            className="companion-no-drag"
          >
            {selectionLoading ? '选区分析中…' : '读取选区'}
          </Button>
          <Typography variant="caption" color="text.secondary" sx={{ mt: -0.5 }}>
            复制文本后按 Ctrl+Shift+A，或点「读取选区」
          </Typography>
          {selection && <SelectionAnalysisCard result={selection} onClose={() => setSelection(null)} />}

          {/* 代码生成 */}
          <Button
            size="small"
            variant={showCodeGen ? 'contained' : 'outlined'}
            startIcon={<CodeIcon />}
            onClick={() => setShowCodeGen((v) => !v)}
            className="companion-no-drag"
          >
            代码生成
          </Button>
          {showCodeGen && <CodeGenPanel onOpenEntry={openCheatEntry} />}

          {/* 速查库 */}
          <Button
            size="small"
            variant={showCheat ? 'contained' : 'outlined'}
            startIcon={<MenuBookIcon />}
            onClick={() => setShowCheat((v) => !v)}
            className="companion-no-drag"
          >
            速查库
          </Button>
          {showCheat && <CheatSheetPanel focusId={cheatFocusId} />}

          {/* 底部操作 */}
          <Button
            size="small"
            startIcon={<OpenInNewIcon />}
            onClick={() => bridge.openMainApp()}
            className="companion-no-drag"
          >
            打开主界面
          </Button>
      </Box>

      {toast && (
        <Box sx={{ position: 'absolute', bottom: 12, left: 0, right: 0, textAlign: 'center' }}>
          <Chip label={toast} color="primary" />
        </Box>
      )}

      <ContextMenu
        open={!!contextMenu}
        x={contextMenu?.x ?? 0}
        y={contextMenu?.y ?? 0}
        onClose={() => setContextMenu(null)}
      />
    </Box>
  )
}
