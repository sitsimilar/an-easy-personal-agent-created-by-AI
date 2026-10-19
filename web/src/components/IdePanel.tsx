import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import BuildIcon from '@mui/icons-material/Build'
import BugReportIcon from '@mui/icons-material/BugReport'
import PauseIcon from '@mui/icons-material/Pause'
import StopIcon from '@mui/icons-material/Stop'
import SkipNextIcon from '@mui/icons-material/SkipNext'
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward'
import CloudDownloadIcon from '@mui/icons-material/CloudDownload'
import type { CppDebugAction, CppDebugEvent, DebugFrame, DebugVariable, ToolchainStatus } from '@shared/types/ipc'
import { friendlyError } from '@/lib/unwrap'
import { MONO_FONT } from '@/theme'
import CodeEditor from './CodeEditor'
import ToolchainStatusBar from './ToolchainStatusBar'
import ProvisionProgress, { type ProvisionState } from './ProvisionProgress'

const DEFAULT_JS_CODE = `// 在这里编写 JavaScript 代码，点击「运行」查看输出
const list = [1, 2, 3, 4, 5];
const doubled = list.map(x => x * 2);
console.log('原始列表:', list);
console.log('翻倍后:', doubled);
console.log('总和:', list.reduce((a, b) => a + b, 0));`

const DEFAULT_CPP_CODE = `#include <iostream>
#include <vector>

int main() {
    std::vector<int> nums = {1, 2, 3, 4, 5};
    int sum = 0;
    for (int n : nums) {
        sum += n;
    }
    std::cout << "Sum: " << sum << std::endl;
    return 0;
}`

type Lang = 'js' | 'cpp'
type CppPhase =
  | 'idle'
  | 'compiling'
  | 'compiled'
  | 'run-running'
  | 'debug-starting'
  | 'debug-running'
  | 'debug-paused'
  | 'debug-ended'

const PHASE_LABEL: Record<string, string> = {
  checking: '检测环境…',
  downloading: '下载中…',
  extracting: '解压中…',
  verifying: '校验中…',
}

/** 停止原因 → UI 阶段。 */
function phaseOfStopped(reason: string): 'debug-paused' | 'debug-ended' {
  if (reason === 'exited-normally' || reason === 'exited' || reason === 'exited-signalled') {
    return 'debug-ended'
  }
  return 'debug-paused'
}

const FALLBACK_TOOLCHAIN: ToolchainStatus = {
  gpp: { ok: false, error: '检测失败' },
  gdb: { ok: false, error: '检测失败' },
  cl: { ok: false, error: '检测失败' },
  cdb: { ok: false, error: '检测失败' },
  selection: { compiler: null, debugger: null, ready: false, canDebug: false, reason: '工具链检测失败' },
}

/** IDE 模式：JavaScript 沙箱运行 + C++ 本机编译/双后端真调试。 */
export default function IdePanel() {
  const bridge = typeof window !== 'undefined' ? window.desktopBridge : undefined

  const [lang, setLang] = useState<Lang>('js')
  const [jsCode, setJsCode] = useState(DEFAULT_JS_CODE)
  const [cppCode, setCppCode] = useState(DEFAULT_CPP_CODE)
  const [jsOutput, setJsOutput] = useState<string[]>([])
  const [jsRunning, setJsRunning] = useState(false)

  // C++ 状态
  const [toolchain, setToolchain] = useState<ToolchainStatus | null>(null)
  const [phase, setPhase] = useState<CppPhase>('idle')
  const [binaryPath, setBinaryPath] = useState<string | null>(null)
  const [sourcePath, setSourcePath] = useState<string | null>(null)
  const [breakpoints, setBreakpoints] = useState<number[]>([])
  const [output, setOutput] = useState<string[]>([])
  const [frames, setFrames] = useState<DebugFrame[]>([])
  const [variables, setVariables] = useState<DebugVariable[]>([])
  const [currentLine, setCurrentLine] = useState<number | null>(null)
  const [provision, setProvision] = useState<ProvisionState>({ phase: 'idle' })

  const outputRef = useRef<HTMLDivElement | null>(null)
  const debugActiveRef = useRef(false)

  const scrollOutput = () => {
    window.setTimeout(() => outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight }), 30)
  }

  /* ---------------- JS 运行 ---------------- */

  const runJs = () => {
    setJsRunning(true)
    const logs: string[] = []
    const push = (level: string) => (...args: unknown[]) => {
      logs.push(`[${level}] ` + args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '))
    }
    const fakeConsole = { log: push('log'), info: push('info'), warn: push('warn'), error: push('error'), debug: push('debug') }
    try {
      const fn = new Function('console', 'window', 'document', 'fetch', jsCode)
      fn(fakeConsole, undefined, undefined, undefined)
    } catch (err) {
      logs.push(`[错误] ${err instanceof Error ? err.message : String(err)}`)
    }
    if (logs.length === 0) logs.push('[info] （无输出）')
    setJsOutput(logs)
    setJsRunning(false)
  }

  /* ---------------- C++ 工具链检测 ---------------- */

  const refreshToolchain = useCallback(async () => {
    if (!bridge) return
    try {
      const tc = await bridge.cppDetect()
      setToolchain(tc)
    } catch {
      setToolchain(FALLBACK_TOOLCHAIN)
    }
  }, [bridge])

  useEffect(() => {
    if (lang !== 'cpp' || !bridge) return
    setToolchain(null)
    void refreshToolchain()
  }, [lang, bridge, refreshToolchain])

  /* ---------------- C++ 调试事件订阅 ---------------- */

  const handleDebugEvent = useCallback((evt: CppDebugEvent) => {
    switch (evt.type) {
      case 'output':
        setOutput((prev) => [...prev, `[${evt.stream}] ${evt.text}`])
        break
      case 'running':
        setPhase('debug-running')
        break
      case 'stopped': {
        const next = phaseOfStopped(evt.reason)
        setPhase(next)
        setCurrentLine(evt.frame?.line ?? null)
        if (next === 'debug-ended') debugActiveRef.current = false
        break
      }
      case 'frames':
        setFrames(evt.frames)
        break
      case 'variables':
        setVariables(evt.variables)
        break
      case 'ended':
        setPhase('debug-ended')
        debugActiveRef.current = false
        break
    }
  }, [])

  useEffect(() => {
    if (lang !== 'cpp' || !bridge) return
    return bridge.onCppDebug(handleDebugEvent)
  }, [lang, bridge, handleDebugEvent])

  /* ---------------- C++ 部署事件订阅 ---------------- */

  useEffect(() => {
    if (lang !== 'cpp' || !bridge) return
    return bridge.onCppProvision((evt) => {
      if (evt.type === 'phase') {
        if (evt.phase === 'done') setProvision({ phase: 'done' })
        else if (evt.phase === 'failed') setProvision({ phase: 'failed', message: evt.message ?? '部署失败' })
        else setProvision({ phase: 'running', percent: -1, message: evt.message ?? PHASE_LABEL[evt.phase] ?? '部署中…' })
      } else if (evt.type === 'progress') {
        setProvision({ phase: 'running', percent: evt.percent, message: `下载中… ${evt.percent >= 0 ? `${evt.percent}%` : ''}` })
      }
    })
  }, [lang, bridge])

  // 卸载时若仍在调试，通知主进程清理会话
  useEffect(() => {
    return () => {
      if (debugActiveRef.current) void bridge?.cppDebugStop()
    }
  }, [bridge])

  /* ---------------- C++ 控制 ---------------- */

  const compile = async () => {
    if (!bridge || lang !== 'cpp') return
    setPhase('compiling')
    setOutput([])
    setFrames([])
    setVariables([])
    setCurrentLine(null)
    setBinaryPath(null)
    setSourcePath(null)
    try {
      const r = await bridge.cppCompile(cppCode)
      if (r.ok) {
        setBinaryPath(r.binaryPath ?? null)
        setSourcePath(r.sourcePath ?? null)
        setPhase('compiled')
        if (r.output) setOutput([r.output])
      } else {
        setPhase('idle')
        if (r.output) setOutput([r.output])
      }
    } catch (err) {
      setPhase('idle')
      setOutput([`编译失败：${friendlyError(err)}`])
    }
  }

  const runCpp = async () => {
    if (!bridge || !binaryPath) return
    setPhase('run-running')
    try {
      const r = await bridge.cppRun(binaryPath)
      setPhase('compiled')
      setOutput((prev) => [
        ...prev,
        `[程序输出] ${r.output}`,
        r.timedOut ? '[提示] 运行超时（10s）已终止' : `[退出码] ${r.exitCode ?? ''}`,
      ])
    } catch (err) {
      setPhase('compiled')
      setOutput((prev) => [...prev, `[错误] ${friendlyError(err)}`])
    }
    scrollOutput()
  }

  const startDebug = async () => {
    if (!bridge || !binaryPath || !sourcePath) return
    setPhase('debug-starting')
    setFrames([])
    setVariables([])
    setCurrentLine(null)
    try {
      const r = await bridge.cppDebugStart({ binaryPath, sourcePath, breakpoints })
      if (!r.ok) {
        setPhase('compiled')
        setOutput((prev) => [...prev, `[调试] ${r.message ?? '调试启动失败'}`])
      } else {
        debugActiveRef.current = true
      }
    } catch (err) {
      setPhase('compiled')
      setOutput((prev) => [...prev, `[错误] ${friendlyError(err)}`])
    }
  }

  const sendDebugAction = async (action: CppDebugAction) => {
    if (!bridge) return
    const r = await bridge.cppDebugAction(action)
    if (!r.ok) setOutput((prev) => [...prev, `[调试] ${r.message ?? '命令失败'}`])
  }

  const stopDebug = async () => {
    if (!bridge) return
    debugActiveRef.current = false
    try {
      await bridge.cppDebugStop()
    } catch {
      /* 忽略 */
    }
    setPhase('compiled')
    setFrames([])
    setVariables([])
    setCurrentLine(null)
  }

  const toggleBreakpoint = (line: number) => {
    setBreakpoints((prev) => (prev.includes(line) ? prev.filter((l) => l !== line) : [...prev, line].sort((a, b) => a - b)))
  }

  const startProvision = async () => {
    if (!bridge) return
    setProvision({ phase: 'running', percent: -1, message: '准备部署…' })
    try {
      const r = await bridge.cppProvision()
      if (r.ok) {
        setProvision({ phase: 'done' })
        await refreshToolchain()
      } else {
        setProvision({ phase: 'failed', message: r.message ?? '部署失败' })
      }
    } catch (err) {
      setProvision({ phase: 'failed', message: friendlyError(err) })
    }
  }

  /* ---------------- 派生状态 ---------------- */

  const sel = toolchain?.selection
  const ready = sel?.ready === true
  const canDebug = sel?.canDebug === true
  const isCdb = sel?.compiler === 'cl'
  const busy = phase === 'compiling' || phase === 'run-running' || phase === 'debug-starting'
  const debugSessionActive = phase === 'debug-starting' || phase === 'debug-running' || phase === 'debug-paused'
  const showProvisionButton = toolchain !== null && (!ready || !canDebug)

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <ToggleButtonGroup
          size="small"
          value={lang}
          exclusive
          onChange={(_, v) => {
            if (v) setLang(v as Lang)
          }}
        >
          <ToggleButton value="js">JavaScript</ToggleButton>
          <ToggleButton value="cpp">C++（本机调试）</ToggleButton>
        </ToggleButtonGroup>
        {lang === 'cpp' && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {showProvisionButton && (
              <Button
                size="small"
                variant="outlined"
                startIcon={<CloudDownloadIcon />}
                onClick={startProvision}
                disabled={provision.phase === 'running'}
              >
                一键部署 MinGW
              </Button>
            )}
          </Box>
        )}
      </Box>

      {lang === 'cpp' && toolchain && (
        <ToolchainStatusBar toolchain={toolchain} />
      )}

      {lang === 'cpp' && !bridge && (
        <Alert severity="warning" sx={{ py: 0 }}>
          C++ 编译与调试需在桌面伴侣中使用；浏览器环境仅支持 JavaScript 运行。
        </Alert>
      )}
      {lang === 'cpp' && bridge && toolchain && !ready && (
        <Alert severity="error" sx={{ py: 0 }}>
          未检测到 C++ 工具链，可一键部署 MinGW 补齐编译/调试能力。
        </Alert>
      )}
      {lang === 'cpp' && bridge && toolchain && ready && !canDebug && (
        <Alert severity="warning" sx={{ py: 0 }}>
          {sel?.reason ?? '缺少调试器，无法调试；编译/运行仍可用。'}
        </Alert>
      )}

      {lang === 'cpp' && (
        <ProvisionProgress state={provision} onRetry={startProvision} />
      )}

      {lang === 'js' ? (
        <CodeEditor code={jsCode} onChange={setJsCode} breakpoints={[]} onToggleBreakpoint={() => undefined} />
      ) : (
        <CodeEditor
          code={cppCode}
          onChange={setCppCode}
          breakpoints={breakpoints}
          onToggleBreakpoint={toggleBreakpoint}
          currentLine={currentLine ?? undefined}
        />
      )}

      {lang === 'js' ? (
        <Stack direction="row" spacing={1}>
          <Button size="small" variant="contained" startIcon={<PlayArrowIcon />} onClick={runJs} disabled={jsRunning}>
            运行（Ctrl+Enter）
          </Button>
        </Stack>
      ) : (
        <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
          <Button size="small" variant="contained" startIcon={compilingIcon(phase)} onClick={compile} disabled={!bridge || !ready || busy}>
            编译
          </Button>
          <Button size="small" variant="outlined" startIcon={<PlayArrowIcon />} onClick={runCpp} disabled={!bridge || !ready || phase !== 'compiled' || busy}>
            运行
          </Button>
          <Button size="small" variant="outlined" startIcon={<BugReportIcon />} onClick={startDebug} disabled={!bridge || !canDebug || phase !== 'compiled' || busy}>
            调试
          </Button>
          <Button size="small" variant="outlined" startIcon={<PlayArrowIcon />} onClick={() => sendDebugAction('continue')} disabled={!bridge || phase !== 'debug-paused'}>
            继续
          </Button>
          <Button size="small" variant="outlined" startIcon={<SkipNextIcon />} onClick={() => sendDebugAction('step-over')} disabled={!bridge || phase !== 'debug-paused'}>
            单步跳过
          </Button>
          <Button size="small" variant="outlined" startIcon={<ArrowDownwardIcon />} onClick={() => sendDebugAction('step-into')} disabled={!bridge || phase !== 'debug-paused'}>
            单步进入
          </Button>
          <Tooltip title={isCdb ? 'cdb 调试器暂不支持运行中中断' : ''}>
            <span>
              <Button size="small" variant="outlined" startIcon={<PauseIcon />} onClick={() => sendDebugAction('interrupt')} disabled={!bridge || phase !== 'debug-running' || isCdb}>
                中断
              </Button>
            </span>
          </Tooltip>
          <Button size="small" variant="outlined" color="error" startIcon={<StopIcon />} onClick={stopDebug} disabled={!bridge || !debugSessionActive}>
            结束调试
          </Button>
        </Stack>
      )}

      {lang === 'cpp' && (phase === 'debug-running' || phase === 'debug-starting') && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <CircularProgress size={14} />
          <Typography variant="caption" color="text.secondary">
            {phase === 'debug-starting' ? '调试器启动中…' : '程序执行中…'}
          </Typography>
        </Box>
      )}

      {/* 输出面板 */}
      {(lang === 'js' ? jsOutput.length > 0 : output.length > 0) && (
        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
            输出结果
          </Typography>
          <Box
            ref={outputRef}
            sx={{
              p: 1,
              bgcolor: '#1e1e2e',
              color: '#a6e3a1',
              borderRadius: 1,
              fontFamily: MONO_FONT,
              fontSize: 11,
              lineHeight: 1.5,
              maxHeight: 180,
              overflowY: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {(lang === 'js' ? jsOutput : output).join('\n')}
          </Box>
        </Box>
      )}

      {/* 调用栈 + 变量面板 */}
      {lang === 'cpp' && (frames.length > 0 || variables.length > 0) && (
        <Stack direction="row" spacing={1.5}>
          {frames.length > 0 && (
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                调用栈
              </Typography>
              <Box sx={{ maxHeight: 160, overflowY: 'auto', fontSize: 11, fontFamily: 'ui-monospace, Consolas, monospace' }}>
                {frames.map((f) => (
                  <Typography key={f.level} variant="caption" component="div" noWrap sx={{ fontFamily: 'inherit', fontSize: 11 }}>
                    #{f.level} {f.func} {f.file ? `· ${f.file}${f.line ? `:${f.line}` : ''}` : ''}
                  </Typography>
                ))}
              </Box>
            </Box>
          )}
          {variables.length > 0 && (
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                局部变量
              </Typography>
              <Box sx={{ maxHeight: 160, overflowY: 'auto', fontSize: 11, fontFamily: 'ui-monospace, Consolas, monospace' }}>
                {variables.map((v, i) => (
                  <Typography key={`${v.name}-${i}`} variant="caption" component="div" noWrap sx={{ fontFamily: 'inherit', fontSize: 11 }}>
                    {v.type ? `${v.type} ` : ''}
                    {v.name} = {v.value}
                  </Typography>
                ))}
              </Box>
            </Box>
          )}
        </Stack>
      )}

      {lang === 'cpp' && phase === 'debug-ended' && (
        <Typography variant="caption" color="text.secondary">
          程序已结束，可点击「结束调试」清理会话，或修改代码后重新「编译 → 调试」。
        </Typography>
      )}
    </Box>
  )
}

function compilingIcon(phase: CppPhase) {
  return phase === 'compiling' ? <CircularProgress size={14} color="inherit" /> : <BuildIcon />
}
