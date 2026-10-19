import { useCallback, useRef, useState } from 'react'
import {
  Box,
  Button,
  Card,
  CardContent,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import CodeIcon from '@mui/icons-material/Code'
import MenuBookIcon from '@mui/icons-material/MenuBook'
import TerminalIcon from '@mui/icons-material/Terminal'
import UploadIcon from '@mui/icons-material/Upload'
import { useSearchParams } from 'react-router-dom'
import type { SelectionAnalysisResult } from '@shared/types/domain'
import { aiService } from '@/services/aiService'
import { friendlyError } from '@/lib/unwrap'
import SelectionAnalysisCard from '@/components/SelectionAnalysisCard'
import CheatSheetPanel from '@/components/CheatSheetPanel'
import CppCheatSheetPanel from '@/components/CppCheatSheetPanel'
import CodeGenPanel from '@/components/CodeGenPanel'
import IdePanel from '@/components/IdePanel'
import ScreenshotPanel from '@/components/ScreenshotPanel'
import PageHeader from '@/components/PageHeader'

/** 读取选区（仅桌面环境可用）。 */
function SelectionSection() {
  const bridge = typeof window !== 'undefined' ? window.desktopBridge : undefined
  const [selection, setSelection] = useState<SelectionAnalysisResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const selectionKey = useRef<string | null>(null)

  const read = useCallback(async () => {
    if (!bridge || loading) return
    setLoading(true)
    setError('')
    try {
      const result = await bridge.readSelection?.()
      if (!result) return
      if (result.status !== 'ok') {
        setError(result.message ?? '读取选区失败')
        return
      }
      if (!result.text || !result.capturedAt) return
      if (selectionKey.current === result.capturedAt) return
      selectionKey.current = result.capturedAt
      const analyzed = await aiService.analyzeSelection(result.text)
      setSelection(analyzed)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge])

  if (!bridge) {
    return (
      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" gutterBottom>
            读取选区
          </Typography>
          <Typography variant="body2" color="text.secondary">
            需在桌面伴侣程序中使用（浏览器环境无法读取剪贴板选区）。
          </Typography>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="subtitle2" gutterBottom>
          读取选区
        </Typography>
        <Button
          size="small"
          variant="outlined"
          startIcon={<ContentCopyIcon />}
          onClick={read}
          disabled={loading}
        >
          {loading ? '选区分析中…' : '读取选区'}
        </Button>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          复制文本后点击上方按钮，或按 Ctrl+Shift+A
        </Typography>
        {error && (
          <Typography variant="caption" color="error" display="block">
            {error}
          </Typography>
        )}
        {selection && <SelectionAnalysisCard result={selection} onClose={() => setSelection(null)} />}
      </CardContent>
    </Card>
  )
}

/** 工具箱二级条目。 */
interface ToolItem {
  id: string
  label: string
  icon: React.ReactNode
  node: React.ReactNode
}

/** 工具箱一级分类。 */
interface ToolGroup {
  title: string
  icon: React.ReactNode
  items: ToolItem[]
}

/** 分类目录配置（单一来源）：一级分类 + 二级条目，覆盖全部功能区。 */
const TOOL_GROUPS: ToolGroup[] = [
  {
    title: '代码辅助',
    icon: <CodeIcon fontSize="small" />,
    items: [
      { id: 'selection', label: '读取选区', icon: <ContentCopyIcon fontSize="small" />, node: <SelectionSection /> },
      { id: 'codegen', label: '代码生成', icon: <CodeIcon fontSize="small" />, node: <CodeGenPanel /> },
      { id: 'ide', label: 'IDE 模式', icon: <TerminalIcon fontSize="small" />, node: <IdePanel /> },
    ],
  },
  {
    title: '速查参考',
    icon: <MenuBookIcon fontSize="small" />,
    items: [
      { id: 'cheatsheet-cs', label: 'C# 速查库', icon: <MenuBookIcon fontSize="small" />, node: <CheatSheetPanel /> },
      { id: 'cheatsheet-cpp', label: 'C++ 速查库', icon: <MenuBookIcon fontSize="small" />, node: <CppCheatSheetPanel /> },
    ],
  },
  {
    title: '识别提取',
    icon: <UploadIcon fontSize="small" />,
    items: [
      { id: 'screenshot', label: '截图识别', icon: <UploadIcon fontSize="small" />, node: <ScreenshotPanel /> },
    ],
  },
]

/** 全量扁平工具表（id → item），用于深链与回退定位。 */
const ALL_TOOLS: ToolItem[] = TOOL_GROUPS.flatMap((g) => g.items)

/** 开发者工具箱：左侧分类目录 + 右侧功能面板，点击目录切换功能区。 */
export default function DevToolsPage() {
  const [searchParams, setSearchParams] = useSearchParams()

  const initialId = searchParams.get('tool')
  const initialIndex = initialId ? ALL_TOOLS.findIndex((t) => t.id === initialId) : -1
  const [activeId, setActiveId] = useState<string>(initialIndex >= 0 ? initialId! : ALL_TOOLS[0].id)

  const activeTool = ALL_TOOLS.find((t) => t.id === activeId) ?? ALL_TOOLS[0]

  const selectTool = (id: string) => {
    setActiveId(id)
    // 深链：写入 ?tool= 便于刷新/分享/历史返回
    setSearchParams({ tool: id }, { replace: false })
  }

  return (
    <Box sx={{ p: 3, maxWidth: 1100, mx: 'auto' }}>
      <PageHeader title="开发者工具箱" subtitle="按分类目录快速定位常用工具" />

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="flex-start">
        {/* 左侧分类目录 */}
        <Box sx={{ width: { xs: '100%', md: 220 }, flexShrink: 0 }}>
          <List component="nav" sx={{ p: 0 }}>
            {TOOL_GROUPS.map((group) => (
              <Box key={group.title} sx={{ mb: 1 }}>
                <Stack direction="row" alignItems="center" spacing={0.5} sx={{ px: 1.5, pt: 1, pb: 0.5 }}>
                  {group.icon}
                  <Typography
                    variant="overline"
                    sx={{ color: 'text.disabled', fontSize: 11, fontWeight: 600, letterSpacing: 0.5, lineHeight: 1.5 }}
                  >
                    {group.title}
                  </Typography>
                </Stack>
                {group.items.map((item) => (
                  <ListItemButton
                    key={item.id}
                    selected={activeId === item.id}
                    onClick={() => selectTool(item.id)}
                    aria-current={activeId === item.id ? 'page' : undefined}
                    sx={{ borderRadius: 2, mb: 0.25, pl: 2 }}
                  >
                    <ListItemIcon sx={{ minWidth: 30 }}>{item.icon}</ListItemIcon>
                    <ListItemText primary={item.label} primaryTypographyProps={{ fontSize: 13.5 }} />
                  </ListItemButton>
                ))}
              </Box>
            ))}
          </List>
        </Box>

        {/* 右侧功能面板（以 tool id 为 key 触发切换转场） */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box key={activeTool.id} className="panel-in">
            {activeTool.node}
          </Box>
        </Box>
      </Stack>
    </Box>
  )
}
