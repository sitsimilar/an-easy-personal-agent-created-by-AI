import { useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import type { PluginManifest } from '@/plugins/types'
import { filterPermissions } from '@/plugins/permissions'
import { MAX_PLUGIN_PACKAGE_SIZE } from '@/services/pluginService'
import { usePluginStore } from '@/store/pluginStore'
import { friendlyError } from '@/lib/unwrap'

interface PluginInstallDialogProps {
  open: boolean
  onClose: () => void
  onInstalled?: () => void
}

interface Preview {
  owner: string
  repo: string
  manifest: PluginManifest
  kept: string[]
  removed: string[]
  sourceCode: string
}

const PERMISSION_LABELS: Record<string, string> = {
  storage: '存储',
  network: '网络',
}

/** 解析 GitHub 仓库地址（支持 https://github.com/o/r、git@github.com:o/r.git、o/r）。 */
function parseRepo(raw: string): { owner: string; repo: string } | null {
  const s = raw.trim()
  if (!s) return null
  let m = s.match(/^https?:\/\/github\.com\/([^/\s]+)\/([^/\s#?]+)/i)
  if (m) return { owner: m[1], repo: m[2].replace(/\.git$/i, '') }
  m = s.match(/^git@github\.com:([^/\s]+)\/([^/\s]+?)(\.git)?$/i)
  if (m) return { owner: m[1], repo: m[2] }
  m = s.match(/^([^/\s]+)\/([^/\s]+)$/)
  if (m) return { owner: m[1], repo: m[2].replace(/\.git$/i, '') }
  return null
}

/** 探测默认分支：main → master，拉取 plugin.json。 */
async function fetchManifest(
  owner: string,
  repo: string,
): Promise<{ branch: string; manifest: PluginManifest }> {
  for (const branch of ['main', 'master']) {
    const res = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/plugin.json`)
    if (res.ok) {
      let json: unknown
      try {
        json = await res.json()
      } catch {
        throw new Error('plugin.json 不是合法 JSON')
      }
      return { branch, manifest: json as PluginManifest }
    }
    if (res.status === 404) continue
    throw new Error(`拉取 plugin.json 失败（HTTP ${res.status}）`)
  }
  throw new Error('仓库中未找到 plugin.json（已尝试 main 与 master 分支）')
}

/** 校验 manifest 必填字段。 */
function validateManifest(m: PluginManifest): void {
  if (!m || typeof m !== 'object') throw new Error('plugin.json 格式非法')
  if (!m.id || !m.name || !m.version) throw new Error('plugin.json 缺少必填字段 id/name/version')
}

/** 插件安装对话框：输入 GitHub URL → 拉 manifest → 展示信息 → 确认安装。 */
export default function PluginInstallDialog({ open, onClose, onInstalled }: PluginInstallDialogProps) {
  const install = usePluginStore((s) => s.install)
  const [url, setUrl] = useState('')
  const [fetching, setFetching] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError] = useState('')

  const reset = () => {
    setUrl('')
    setPreview(null)
    setError('')
  }

  const close = () => {
    reset()
    onClose()
  }

  const handleFetch = async () => {
    setFetching(true)
    setError('')
    try {
      const parsed = parseRepo(url)
      if (!parsed) {
        throw new Error('无法识别 GitHub 仓库地址，请使用 https://github.com/o/r、git@github.com:o/r.git 或 o/r 格式')
      }
      const { branch, manifest } = await fetchManifest(parsed.owner, parsed.repo)
      validateManifest(manifest)
      const { kept, removed } = filterPermissions(manifest.permissions)
      const entry = manifest.entry || 'dist/index.js'
      const entryRes = await fetch(
        `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${branch}/${entry}`,
      )
      if (!entryRes.ok) throw new Error(`下载入口文件失败（HTTP ${entryRes.status}）`)
      const sourceCode = await entryRes.text()
      if (new Blob([sourceCode]).size > MAX_PLUGIN_PACKAGE_SIZE) throw new Error('插件代码包不能超过 1MB')
      setPreview({ owner: parsed.owner, repo: parsed.repo, manifest, kept, removed, sourceCode })
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setFetching(false)
    }
  }

  const handleInstall = async () => {
    if (!preview) return
    setInstalling(true)
    setError('')
    try {
      await install({
        pluginId: preview.manifest.id,
        name: preview.manifest.name,
        version: preview.manifest.version,
        description: preview.manifest.description ?? '',
        author: preview.manifest.author ?? null,
        repoUrl: `https://github.com/${preview.owner}/${preview.repo}`,
        permissions: preview.kept,
        sourceCode: preview.sourceCode,
      })
      reset()
      onClose()
      onInstalled?.()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setInstalling(false)
    }
  }

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="sm">
      <DialogTitle>安装插件</DialogTitle>
      <DialogContent dividers>
        {preview ? (
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Box>
              <Typography variant="subtitle1" fontWeight={700}>
                {preview.manifest.name}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                版本 {preview.manifest.version}
              </Typography>
            </Box>
            {preview.manifest.description && <Typography variant="body2">{preview.manifest.description}</Typography>}
            {preview.manifest.author && (
              <Typography variant="body2" color="text.secondary">
                作者：{preview.manifest.author}
              </Typography>
            )}
            <Typography variant="body2" color="text.secondary">
              来源：https://github.com/{preview.owner}/{preview.repo}
            </Typography>
            <Box>
              <Typography variant="subtitle2" gutterBottom>
                权限清单
              </Typography>
              {preview.kept.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  无特殊权限
                </Typography>
              ) : (
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  {preview.kept.map((perm) => (
                    <Chip key={perm} size="small" label={PERMISSION_LABELS[perm] ?? perm} color="primary" variant="outlined" />
                  ))}
                </Stack>
              )}
              {preview.removed.length > 0 && (
                <Typography variant="caption" color="warning.main" display="block" sx={{ mt: 1 }}>
                  已忽略未知权限：{preview.removed.join('、')}
                </Typography>
              )}
            </Box>
            <Alert severity="warning">插件可访问当前页面数据，请仅安装可信来源。</Alert>
            {error && (
              <Typography color="error" variant="body2">
                {error}
              </Typography>
            )}
          </Stack>
        ) : (
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="GitHub 仓库地址"
              fullWidth
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://github.com/owner/repo"
              helperText="支持 https://github.com/o/r、git@github.com:o/r.git、o/r 三种格式"
              disabled={fetching}
            />
            {error && (
              <Typography color="error" variant="body2">
                {error}
              </Typography>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={close} disabled={fetching || installing}>
          取消
        </Button>
        {preview ? (
          <Button
            variant="contained"
            onClick={handleInstall}
            disabled={installing}
            startIcon={installing ? <CircularProgress size={16} /> : undefined}
          >
            {installing ? '安装中…' : '确认安装'}
          </Button>
        ) : (
          <Button variant="contained" onClick={handleFetch} disabled={fetching || !url.trim()}>
            {fetching ? '拉取中…' : '拉取信息'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
