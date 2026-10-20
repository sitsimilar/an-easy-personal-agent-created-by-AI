import { useEffect, useState } from 'react'
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  IconButton,
  Link,
  Snackbar,
  Stack,
  Switch,
  Tooltip,
  Typography,
} from '@mui/material'
import type { ChipProps } from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import ExtensionIcon from '@mui/icons-material/Extension'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import type { Plugin } from '@shared/types/domain'
import type { PluginRuntimeState } from '@/plugins/types'
import { usePluginStore } from '@/store/pluginStore'
import PageHeader from '@/components/PageHeader'
import PluginInstallDialog from '@/components/PluginInstallDialog'
import { friendlyError } from '@/lib/unwrap'

const PERMISSION_LABELS: Record<string, string> = {
  storage: '存储',
  network: '网络',
}

const STATE_META: Record<PluginRuntimeState, { label: string; color: ChipProps['color'] }> = {
  idle: { label: '未启用', color: 'default' },
  loading: { label: '加载中', color: 'info' },
  running: { label: '运行中', color: 'success' },
  error: { label: '加载失败', color: 'error' },
}

/** 插件管理页：四态渲染 + 列表（名称/版本/简介/作者/权限/启停/来源/状态徽标）+ 安装对话框。 */
export default function PluginsPage() {
  const plugins = usePluginStore((s) => s.plugins)
  const runtime = usePluginStore((s) => s.runtime)
  const loading = usePluginStore((s) => s.loading)
  const error = usePluginStore((s) => s.error)
  const load = usePluginStore((s) => s.load)
  const restore = usePluginStore((s) => s.restore)
  const toggle = usePluginStore((s) => s.toggle)
  const retry = usePluginStore((s) => s.retry)
  const remove = usePluginStore((s) => s.remove)
  const runTool = usePluginStore((s) => s.runTool)

  const [installOpen, setInstallOpen] = useState(false)
  const [snackbar, setSnackbar] = useState('')
  const [busy, setBusy] = useState<Record<number, boolean>>({})

  useEffect(() => {
    // 挂载：先拉列表，再逐个激活 enabled=true 的插件（启动恢复 §6.3）
    const run = async () => {
      await load()
      await restore()
    }
    run()
  }, [load, restore])

  const setBusyFor = (id: number, v: boolean) => setBusy((b) => ({ ...b, [id]: v }))

  const handleToggle = async (p: Plugin) => {
    setBusyFor(p.id, true)
    try {
      await toggle(p.id)
    } catch (err) {
      setSnackbar(friendlyError(err))
    } finally {
      setBusyFor(p.id, false)
    }
  }

  const handleRetry = async (p: Plugin) => {
    setBusyFor(p.id, true)
    try {
      await retry(p.id)
    } catch (err) {
      setSnackbar(friendlyError(err))
    } finally {
      setBusyFor(p.id, false)
    }
  }

  const handleRemove = async (p: Plugin) => {
    if (!window.confirm(`确认卸载插件「${p.name}」？其代码包将被删除。`)) return
    setBusyFor(p.id, true)
    try {
      await remove(p.id)
    } catch (err) {
      setSnackbar(friendlyError(err))
    } finally {
      setBusyFor(p.id, false)
    }
  }

  const handleRunTool = async (p: Plugin, toolId: string, label: string) => {
    try {
      await runTool(p.pluginId, toolId)
      setSnackbar(`工具「${label}」执行完成`)
    } catch (err) {
      setSnackbar(friendlyError(err))
    }
  }

  return (
    <Box sx={{ p: 3, maxWidth: 900, mx: 'auto' }}>
      <PageHeader
        title="插件"
        subtitle="从 GitHub 仓库安装插件，控制启停并查看运行时状态"
        action={
          <Button variant="contained" startIcon={<ExtensionIcon />} onClick={() => setInstallOpen(true)}>
            安装插件
          </Button>
        }
      />

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      ) : error ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5, py: 8 }}>
          <Typography color="error">{error}</Typography>
          <Button variant="outlined" size="small" startIcon={<RefreshIcon />} onClick={load}>
            重试加载
          </Button>
        </Box>
      ) : plugins.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 8, color: 'text.secondary' }}>
          <Typography sx={{ mb: 1.5 }}>还没有安装任何插件</Typography>
          <Button variant="outlined" startIcon={<ExtensionIcon />} onClick={() => setInstallOpen(true)}>
            从 GitHub 安装
          </Button>
        </Box>
      ) : (
        <Stack spacing={2}>
          {plugins.map((p) => {
            const rt = runtime[p.pluginId]
            const state: PluginRuntimeState = rt?.state ?? 'idle'
            const meta = STATE_META[state]
            const isBusy = busy[p.id]
            return (
              <Card key={p.id} variant="outlined">
                <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                  <Stack direction="row" alignItems="flex-start" spacing={2}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
                        <Typography variant="subtitle1" fontWeight={700}>
                          {p.name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          v{p.version}
                        </Typography>
                        <Chip size="small" label={meta.label} color={meta.color} />
                      </Stack>
                      {p.description && (
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                          {p.description}
                        </Typography>
                      )}
                      <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
                        {p.author && (
                          <Typography variant="caption" color="text.secondary">
                            作者：{p.author}
                          </Typography>
                        )}
                        {p.repoUrl && (
                          <Link href={p.repoUrl} target="_blank" rel="noreferrer" variant="caption">
                            来源仓库
                          </Link>
                        )}
                        {p.permissions.map((perm) => (
                          <Chip key={perm} size="small" variant="outlined" label={PERMISSION_LABELS[perm] ?? perm} />
                        ))}
                      </Stack>
                      {state === 'error' && (
                        <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 1 }}>
                          <Typography variant="caption" color="error">
                            {rt?.error ?? '加载失败'}
                          </Typography>
                          <Button size="small" variant="outlined" onClick={() => handleRetry(p)} disabled={isBusy}>
                            重试
                          </Button>
                        </Stack>
                      )}
                      {state === 'running' && rt && rt.tools.length > 0 && (
                        <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
                          <Typography variant="caption" color="text.secondary">
                            工具入口：
                          </Typography>
                          {rt.tools.map((tool) => (
                            <Button
                              key={tool.id}
                              size="small"
                              variant="outlined"
                              startIcon={<PlayArrowIcon />}
                              onClick={() => handleRunTool(p, tool.id, tool.label)}
                            >
                              {tool.label}
                            </Button>
                          ))}
                        </Stack>
                      )}
                    </Box>
                    <Stack direction="row" alignItems="center" spacing={0.5}>
                      <Switch checked={p.enabled} onChange={() => handleToggle(p)} disabled={isBusy || state === 'loading'} />
                      <Tooltip title="卸载">
                        <IconButton size="small" onClick={() => handleRemove(p)} disabled={isBusy}>
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  </Stack>
                </CardContent>
              </Card>
            )
          })}
        </Stack>
      )}

      <PluginInstallDialog open={installOpen} onClose={() => setInstallOpen(false)} onInstalled={() => setInstallOpen(false)} />

      <Snackbar open={!!snackbar} autoHideDuration={4000} onClose={() => setSnackbar('')} message={snackbar} />
    </Box>
  )
}
