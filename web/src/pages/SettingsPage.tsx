import { useEffect, useRef, useState } from 'react'
import {
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Divider,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
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
import { reminderService } from '@/services/reminderService'
import { pushNotice } from '@/store/noticeStore'
import { useProfileStore } from '@/store/profileStore'

const DEFAULT_SETTINGS = {
  vsPath: '',
  codeUploadEnabled: true,
  floatWindowEnabled: true,
}

/** 提醒提前量可选值（分钟）。 */
const LEAD_OPTIONS = [0, 5, 10, 15, 30, 60]

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
  const [notifyEnabled, setNotifyEnabled] = useState(true)
  const [remindLeadMinutes, setRemindLeadMinutes] = useState(0)
  const [quietHoursEnabled, setQuietHoursEnabled] = useState(false)
  const [quietStart, setQuietStart] = useState('22:00')
  const [quietEnd, setQuietEnd] = useState('08:00')
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
          setNotifyEnabled(row.notify_enabled ?? true)
          setRemindLeadMinutes(Number.isFinite(row.remind_lead_minutes) ? Number(row.remind_lead_minutes) : 0)
          setQuietHoursEnabled(row.quiet_hours_enabled ?? false)
          setQuietStart(row.quiet_start || '22:00')
          setQuietEnd(row.quiet_end || '08:00')
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
        notify_enabled: notifyEnabled,
        remind_lead_minutes: remindLeadMinutes,
        quiet_hours_enabled: quietHoursEnabled,
        quiet_start: quietStart || '22:00',
        quiet_end: quietEnd || '08:00',
      })
      setSettingsId(id)

      // 同步到桌面伴侣主进程（代码上传 / 悬浮窗开关 / VS 路径）
      if (window.desktopBridge) {
        await window.desktopBridge.setCodeUploadEnabled(codeUploadEnabled)
        await window.desktopBridge.setFloatWindowEnabled(floatWindowEnabled)
        await window.desktopBridge.setVsPath(vsPath.trim())
      }

      // 立即让对方生效：缓存失效 + 重新计算一次提醒窗口
      reminderService.onSettingsSaved()
      setSaved(true)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setSaving(false)
    }
  }

  /** 首次开启总开关时请求通知权限（Web 需授权；被拒降级为应用内提示，不报错）。 */
  const handleNotifyToggle = async (enabled: boolean) => {
    setNotifyEnabled(enabled)
    setSaved(false)
    if (!enabled) return
    const permission = await reminderService.requestPermission()
    if (permission === 'denied') {
      pushNotice('通知权限未开启，提醒将降级为应用内提示', 'warning')
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

      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="subtitle2" gutterBottom>
            提醒
          </Typography>
          <Stack spacing={2}>
            <FormControlLabel
              control={
                <Switch
                  checked={notifyEnabled}
                  onChange={(e) => void handleNotifyToggle(e.target.checked)}
                  disabled={loading}
                />
              }
              label="到点弹系统通知（关闭后列表仍显示提醒时间）"
            />

            <FormControl size="small" sx={{ maxWidth: 260 }} disabled={loading || !notifyEnabled}>
              <InputLabel id="remind-lead-label">提前量</InputLabel>
              <Select
                labelId="remind-lead-label"
                label="提前量"
                value={remindLeadMinutes}
                onChange={(e) => {
                  setRemindLeadMinutes(Number(e.target.value))
                  setSaved(false)
                }}
              >
                {LEAD_OPTIONS.map((m) => (
                  <MenuItem key={m} value={m}>
                    {m === 0 ? '到点提醒' : `提前 ${m} 分钟`}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControlLabel
              control={
                <Switch
                  checked={quietHoursEnabled}
                  onChange={(e) => {
                    setQuietHoursEnabled(e.target.checked)
                    setSaved(false)
                  }}
                  disabled={loading || !notifyEnabled}
                />
              }
              label="免打扰时段（时段内不弹，结束后补发一次）"
            />

            <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <TextField
                size="small"
                type="time"
                label="免打扰开始"
                value={quietStart}
                onChange={(e) => {
                  setQuietStart(e.target.value)
                  setSaved(false)
                }}
                InputLabelProps={{ shrink: true }}
                disabled={loading || !notifyEnabled || !quietHoursEnabled}
                sx={{ width: 168 }}
              />
              <TextField
                size="small"
                type="time"
                label="免打扰结束"
                value={quietEnd}
                onChange={(e) => {
                  setQuietEnd(e.target.value)
                  setSaved(false)
                }}
                InputLabelProps={{ shrink: true }}
                disabled={loading || !notifyEnabled || !quietHoursEnabled}
                sx={{ width: 168 }}
              />
            </Stack>

            <Typography variant="caption" color="text.secondary">
              免打扰默认 22:00–08:00（可跨零点）；超过 12 小时未提醒的待办直接丢弃，不堆积轰炸。保存设置后立即生效。
            </Typography>
          </Stack>
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
