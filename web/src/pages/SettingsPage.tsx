import { useEffect, useRef, useState } from 'react'
import {
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Divider,
  FormControlLabel,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { cloud } from '@/lib/cloud'
import { unwrap, friendlyError } from '@/lib/unwrap'
import type { SettingsRow } from '@/lib/database.types'
import { useAuthStore, useCurrentUser } from '@/store/authStore'
import { authService } from '@/services/authService'
import { getAnalysisPreference, setAnalysisPreference, type AnalysisPreference } from '@/services/aiService'
import { useNavigate } from 'react-router-dom'
import PageHeader from '@/components/PageHeader'
import UpdateDialog from '@/components/UpdateDialog'
import { checkForUpdate, currentVersion, type CheckResult } from '@/services/updateService'
import { imageService } from '@/services/imageService'
import { profileService, validateNickname, formatAccountId } from '@/services/profileService'
import { useProfileStore } from '@/store/profileStore'

const DEFAULT_SETTINGS = {
  vsPath: '',
  codeUploadEnabled: true,
  floatWindowEnabled: true,
}

export default function SettingsPage() {
  const navigate = useNavigate()
  const user = useCurrentUser()
  const clear = useAuthStore((s) => s.clear)
  const setProfile = useProfileStore((s) => s.setProfile)

  const [vsPath, setVsPath] = useState('')
  const [detecting, setDetecting] = useState(false)
  const [codeUploadEnabled, setCodeUploadEnabled] = useState(true)
  const [floatWindowEnabled, setFloatWindowEnabled] = useState(true)
  const [analysisPref, setAnalysisPref] = useState<AnalysisPreference>(() => getAnalysisPreference())
  const [loading, setLoading] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [checking, setChecking] = useState(false)
  const [updateResult, setUpdateResult] = useState<CheckResult | null>(null)
  const [checkMsg, setCheckMsg] = useState('')
  const [avatarImageId, setAvatarImageId] = useState<number | null>(null)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [settingsId, setSettingsId] = useState<number | null>(null)
  const [nickname, setNickname] = useState('')
  const [nicknameSaving, setNicknameSaving] = useState(false)
  const [nicknameSaved, setNicknameSaved] = useState(false)
  const [copyHint, setCopyHint] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setLoadFailed(false)
      try {
        const res = await cloud.database.from('settings').select('*').limit(1).maybeSingle()
        const row = unwrap(res) as SettingsRow | null
        if (cancelled) return
        if (row) {
          setSettingsId(row.id ?? null)
          setNickname(row.nickname ?? '')
          setProfile({ nickname: row.nickname ?? '' })
          setVsPath(row.vs_path ?? '')
          setCodeUploadEnabled(row.code_upload_enabled ?? true)
          setFloatWindowEnabled(row.float_window_enabled ?? true)
          setAvatarImageId(row.avatar_image_id ?? null)
        }
      } catch (err) {
        if (!cancelled) {
          setError(friendlyError(err))
          setLoadFailed(true)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const save = async () => {
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      const id = await profileService.save(settingsId, {
        vs_path: vsPath.trim() || null,
        code_upload_enabled: codeUploadEnabled,
        float_window_enabled: floatWindowEnabled,
      })
      setSettingsId(id)

      // 同步到桌面伴侣主进程（代码上传 / 悬浮窗开关 / VS 路径）
      if (window.desktopBridge) {
        await window.desktopBridge.setCodeUploadEnabled(codeUploadEnabled)
        await window.desktopBridge.setFloatWindowEnabled(floatWindowEnabled)
        await window.desktopBridge.setVsPath(vsPath.trim())
      }
      setSaved(true)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setSaving(false)
    }
  }

  const logout = async () => {
    try {
      await authService.signOut()
    } catch {
      /* 忽略 */
    }
    clear()
    navigate('/login', { replace: true })
  }

  /** 自动检测本机 Visual Studio（通过桌面伴侣 C++ 工具链检测，取 cl.exe 所在 VS 目录）。 */
  const autoDetectVs = async () => {
    const bridge = window.desktopBridge
    if (!bridge?.cppDetect) {
      setError('自动检测需在桌面伴侣程序中使用；也可留空，程序会尝试自动识别')
      return
    }
    setDetecting(true)
    setError('')
    try {
      const status = await bridge.cppDetect()
      const clPath = status.cl?.path
      if (clPath) {
        // cl.exe 通常位于 <VS安装目录>\...\VC\Tools\MSVC\<版本>\bin\Hostx64\x64\cl.exe，
        // 向上取「Microsoft Visual Studio」目录段作为 VS 安装根。
        const m = clPath.match(/^(.+[\\/]Microsoft Visual Studio[\\/][^\\/]+)/i)
        if (m) {
          setVsPath(m[1])
          setSaved(false)
        } else {
          setVsPath(clPath)
          setSaved(false)
        }
        setError('')
      } else {
        setError('未检测到 Visual Studio（cl.exe），请确认已安装或手动填写路径')
      }
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setDetecting(false)
    }
  }

  /** 手动检查更新。 */
  const checkUpdate = async () => {
    setChecking(true)
    setCheckMsg('')
    try {
      const r = await checkForUpdate()
      if (r.hasUpdate) {
        setUpdateResult(r)
      } else if (r.error) {
        setCheckMsg(r.error)
      } else {
        setCheckMsg('已是最新版本')
      }
    } finally {
      setChecking(false)
    }
  }

  // 加载头像签名 URL（128 档缩略图）
  useEffect(() => {
    let cancelled = false
    if (!avatarImageId) {
      setAvatarUrl(null)
      return
    }
    imageService
      .getImage(avatarImageId)
      .then(async (row) => {
        if (!row || cancelled) return
        const urls = await imageService.getSignedUrls(row)
        if (!cancelled) {
          setAvatarUrl(urls.t128)
          setProfile({ avatarUrl: urls.t128 })
        }
      })
      .catch(() => {
        if (!cancelled) setAvatarUrl(null)
      })
    return () => {
      cancelled = true
    }
  }, [avatarImageId])

  /** 上传头像。 */
  const uploadAvatar = async (file: File) => {
    setAvatarUploading(true)
    setError('')
    try {
      const row = await imageService.uploadImage(file, '头像')
      const id = await profileService.save(settingsId, { avatar_image_id: row.id })
      setSettingsId(id)
      setAvatarImageId(row.id)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setAvatarUploading(false)
    }
  }

  /** 删除头像（回落默认首字头像）。 */
  const removeAvatar = async () => {
    setError('')
    try {
      if (avatarImageId) await imageService.deleteImage(avatarImageId)
      if (settingsId != null) {
        await profileService.save(settingsId, { avatar_image_id: null })
      }
      setAvatarImageId(null)
      setAvatarUrl(null)
      setProfile({ avatarUrl: null })
    } catch (err) {
      setError(friendlyError(err))
    }
  }

  /** 保存昵称（空输入表示清空昵称）。 */
  const saveNickname = async () => {
    setNicknameSaving(true)
    setError('')
    setNicknameSaved(false)
    try {
      const trimmed = nickname.trim()
      if (trimmed) {
        const err = validateNickname(trimmed)
        if (err) {
          setError(err)
          return
        }
        const id = await profileService.save(settingsId, { nickname: trimmed })
        setSettingsId(id)
      } else if (settingsId != null) {
        await profileService.save(settingsId, { nickname: null })
      }
      setNickname(trimmed)
      setProfile({ nickname: trimmed })
      setNicknameSaved(true)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setNicknameSaving(false)
    }
  }

  /** 复制账户 ID。 */
  const copyAccountId = async () => {
    if (settingsId == null) return
    try {
      await navigator.clipboard.writeText(formatAccountId(settingsId))
      setCopyHint(true)
      setTimeout(() => setCopyHint(false), 1500)
    } catch {
      setError('复制失败，请手动复制')
    }
  }

  const userLabel = user?.name || user?.phone || user?.email || '未知用户'
  const displayName = nickname.trim() || userLabel
  const accountIdLabel = settingsId != null ? formatAccountId(settingsId) : '未分配'

  return (
    <Box sx={{ p: 3, maxWidth: 640, mx: 'auto' }}>
      <PageHeader title="设置" subtitle="偏好、快捷键与数据管理" />
      {error && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <Typography color="error" variant="body2" sx={{ flex: 1 }}>
            {error}
            {loadFailed && '（当前显示为默认值，加载失败前请勿保存）'}
          </Typography>
          {loadFailed && (
            <Button size="small" variant="outlined" onClick={() => window.location.reload()}>
              重新加载
            </Button>
          )}
        </Box>
      )}

      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="subtitle2" gutterBottom>
            账号
          </Typography>
          <Stack direction="row" alignItems="center" spacing={2}>
            <Avatar
              src={avatarUrl ?? undefined}
              sx={{ width: 64, height: 64, bgcolor: 'primary.main', fontSize: 28, flexShrink: 0 }}
            >
              {displayName.slice(0, 1)}
            </Avatar>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body1">{displayName}</Typography>
              <Stack direction="row" alignItems="center" spacing={1}>
                <Typography variant="caption" color="text.secondary">
                  账户 ID：{accountIdLabel}
                </Typography>
                {settingsId != null && (
                  <Button
                    size="small"
                    onClick={copyAccountId}
                    sx={{ minWidth: 0, px: 1, py: 0, lineHeight: 1.4 }}
                  >
                    {copyHint ? '已复制' : '复制'}
                  </Button>
                )}
              </Stack>
              <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => avatarInputRef.current?.click()}
                  disabled={avatarUploading}
                >
                  {avatarUploading ? '上传中…' : '更换头像'}
                </Button>
                {avatarImageId && (
                  <Button size="small" color="error" onClick={removeAvatar}>
                    删除头像
                  </Button>
                )}
              </Stack>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void uploadAvatar(file)
                  e.target.value = ''
                }}
              />
            </Box>
            <Button size="small" color="error" variant="outlined" onClick={logout}>
              退出登录
            </Button>
          </Stack>

          <Divider sx={{ my: 2 }} />

          <Stack direction="row" spacing={1} alignItems="flex-start">
            <TextField
              label="昵称"
              size="small"
              fullWidth
              value={nickname}
              onChange={(e) => {
                setNickname(e.target.value)
                setNicknameSaved(false)
              }}
              placeholder="1–20 个字符，中英文、数字、下划线"
              helperText="用于展示与默认头像首字；留空表示不设置昵称，允许与他人重名"
              disabled={loading}
              inputProps={{ maxLength: 20 }}
            />
            <Button
              variant="outlined"
              onClick={saveNickname}
              disabled={nicknameSaving || loading}
              sx={{ whiteSpace: 'nowrap', mt: 0.5 }}
            >
              {nicknameSaving ? '保存中…' : '保存昵称'}
            </Button>
          </Stack>
          {nicknameSaved && (
            <Typography variant="caption" color="success.main" sx={{ display: 'block', mt: 0.5 }}>
              昵称已保存
            </Typography>
          )}
        </CardContent>
      </Card>

      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="subtitle2" gutterBottom>
            AI 分析
          </Typography>
          <FormControlLabel
            control={
              <Switch
                checked={analysisPref === 'fast'}
                onChange={(e) => {
                  const next: AnalysisPreference = e.target.checked ? 'fast' : 'auto'
                  setAnalysisPref(next)
                  setAnalysisPreference(next)
                }}
              />
            }
            label="分析模型速度优先（关闭则用质量优先模型）"
          />
          <Typography variant="caption" color="text.secondary" display="block">
            影响选区分析的模型选择，切换即时生效；自动分类、自动总结等始终使用质量优先模型。
          </Typography>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" gutterBottom>
            偏好设置
          </Typography>
          <Stack spacing={2}>
            <TextField
              label="Visual Studio 路径"
              fullWidth
              value={vsPath}
              onChange={(e) => setVsPath(e.target.value)}
              placeholder="例如 C:\Program Files\Microsoft Visual Studio\20xx\Community"
              helperText="留空则桌面伴侣自动检测；仅当自动检测失败时手动填写（可选）"
              disabled={loading}
              InputProps={{
                endAdornment: (
                  <Button
                    size="small"
                    onClick={autoDetectVs}
                    disabled={loading || detecting}
                    sx={{ whiteSpace: 'nowrap' }}
                  >
                    {detecting ? '检测中…' : '自动检测'}
                  </Button>
                ),
              }}
            />

            <Divider />

            <FormControlLabel
              control={
                <Switch
                  checked={codeUploadEnabled}
                  onChange={(e) => setCodeUploadEnabled(e.target.checked)}
                />
              }
              label="允许上传代码用于分析（关闭后桌面伴侣不读取、不上传源码）"
            />
            <FormControlLabel
              control={
                <Switch
                  checked={floatWindowEnabled}
                  onChange={(e) => setFloatWindowEnabled(e.target.checked)}
                />
              }
              label="启用桌面悬浮窗"
            />

            <Box>
              <Button
                variant="contained"
                onClick={save}
                disabled={saving || loading || loadFailed}
              >
                {saving ? '保存中…' : '保存设置'}
              </Button>
              {loadFailed && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                  设置加载失败，已禁用保存以避免覆盖云端数据；请先「重新加载」
                </Typography>
              )}
              {saved && (
                <Typography variant="body2" color="success.main" sx={{ mt: 1 }}>
                  已保存
                </Typography>
              )}
            </Box>
          </Stack>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" gutterBottom>
            关于
          </Typography>
          <Stack direction="row" alignItems="center" spacing={2}>
            <Box sx={{ flex: 1 }}>
              <Typography variant="body2">当前版本 v{currentVersion()}</Typography>
              {checkMsg && (
                <Typography
                  variant="caption"
                  color={checkMsg === '已是最新版本' ? 'success.main' : 'text.secondary'}
                  sx={{ display: 'block', mt: 0.5 }}
                >
                  {checkMsg}
                </Typography>
              )}
            </Box>
            <Button size="small" variant="outlined" onClick={checkUpdate} disabled={checking}>
              {checking ? '检查中…' : '检查更新'}
            </Button>
          </Stack>
        </CardContent>
      </Card>

      <UpdateDialog result={updateResult} onClose={() => setUpdateResult(null)} />
    </Box>
  )
}
