import { useEffect, useRef } from 'react'
import { Box } from '@mui/material'
import { MONO_FONT } from '@/theme'

interface CodeEditorProps {
  code: string
  onChange: (code: string) => void
  /** 断点行号（1-based）。 */
  breakpoints: number[]
  onToggleBreakpoint: (line: number) => void
  /** 当前执行行（来自 gdb *stopped.frame.line），高亮 + 滚动到可见。 */
  currentLine?: number
  readOnly?: boolean
}

const LINE_HEIGHT = 20
const GUTTER_WIDTH = 44

/**
 * 自研「gutter 行号 + textarea」代码编辑器（零依赖）。
 * 左侧行号/断点列，右侧 textarea；固定行高、等宽字体、共享纵向滚动。
 */
export default function CodeEditor({
  code,
  onChange,
  breakpoints,
  onToggleBreakpoint,
  currentLine,
  readOnly,
}: CodeEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const gutterRef = useRef<HTMLDivElement | null>(null)
  const lines = code.split('\n')

  const syncGutter = () => {
    if (gutterRef.current && textareaRef.current) {
      gutterRef.current.scrollTop = textareaRef.current.scrollTop
    }
  }

  // 当前行变化时滚动到可见区域（并同步 gutter）
  useEffect(() => {
    if (currentLine == null || !textareaRef.current) return
    const top = (currentLine - 1) * LINE_HEIGHT
    const target = Math.max(0, top - 120)
    textareaRef.current.scrollTop = target
    if (gutterRef.current) gutterRef.current.scrollTop = target
  }, [currentLine])

  return (
    <Box
      sx={{
        display: 'flex',
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
        overflow: 'hidden',
        bgcolor: '#1e1e2e',
      }}
    >
      <Box
        ref={gutterRef}
        sx={{
          width: GUTTER_WIDTH,
          flex: 'none',
          overflow: 'hidden',
          bgcolor: 'rgba(0,0,0,0.28)',
          color: '#6c7086',
          fontFamily: MONO_FONT,
          fontSize: 12,
          lineHeight: `${LINE_HEIGHT}px`,
          pt: 1,
          userSelect: 'none',
        }}
      >
        {lines.map((_, i) => {
          const lineNo = i + 1
          const hasBp = breakpoints.includes(lineNo)
          const isCurrent = currentLine === lineNo
          return (
            <Box
              key={lineNo}
              onClick={() => onToggleBreakpoint(lineNo)}
              title={hasBp ? '点击取消断点' : '点击设置断点'}
              sx={{
                height: LINE_HEIGHT,
                display: 'flex',
                alignItems: 'center',
                px: 0.5,
                cursor: 'pointer',
                bgcolor: isCurrent ? 'rgba(250, 204, 21, 0.18)' : 'transparent',
                '&:hover': { bgcolor: 'rgba(255,255,255,0.07)' },
              }}
            >
              <Box
                sx={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  flex: 'none',
                  bgcolor: hasBp ? '#f87171' : 'transparent',
                  border: hasBp ? 'none' : '1px solid rgba(255,255,255,0.18)',
                  mr: 0.5,
                }}
              />
              <Box
                component="span"
                sx={{
                  textAlign: 'right',
                  flex: 1,
                  fontSize: 11,
                  color: isCurrent ? '#facc15' : '#6c7086',
                }}
              >
                {lineNo}
              </Box>
            </Box>
          )
        })}
      </Box>

      <Box
        component="textarea"
        ref={textareaRef}
        value={code}
        onChange={(e) => onChange(e.target.value)}
        onScroll={syncGutter}
        readOnly={readOnly}
        spellCheck={false}
        wrap="off"
        sx={{
          flex: 1,
          minHeight: 220,
          maxHeight: 420,
          p: 1,
          bgcolor: '#1e1e2e',
          color: '#cdd6f4',
          border: 0,
          outline: 'none',
          resize: 'vertical',
          fontFamily: MONO_FONT,
          fontSize: 12,
          lineHeight: `${LINE_HEIGHT}px`,
          whiteSpace: 'pre',
          overflowX: 'auto',
          '&::-webkit-scrollbar': { height: 8, width: 8 },
          '&::-webkit-scrollbar-thumb': { background: 'rgba(255,255,255,0.18)', borderRadius: 4 },
        }}
      />
    </Box>
  )
}
