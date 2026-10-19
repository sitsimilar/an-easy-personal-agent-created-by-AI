import { useEffect, useState } from 'react'
import {
  Box,
  Button,
  ButtonGroup,
  Card,
  CardContent,
  Chip,
  Divider,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useNavigate } from 'react-router-dom'
import type { CloudSession } from '@tencent-ai/workbuddy-cloud-sdk'
import { authService, PendingPhoneOtp } from '@/services/authService'
import { useAuthStore } from '@/store/authStore'
import { consumeRedirect } from '@/services/authExpired'
import { friendlyError } from '@/lib/unwrap'

export default function LoginPage() {
  const navigate = useNavigate()
  const session = useAuthStore((s) => s.session)
  const setSession = useAuthStore((s) => s.setSession)
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [pending, setPending] = useState<PendingPhoneOtp | null>(null)
  const [phoneError, setPhoneError] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [countdown, setCountdown] = useState(0)

  useEffect(() => {
    if (countdown <= 0) return
    const timer = window.setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [countdown])

  // 登录态就绪后跳回原页面（同窗口登录、以及跨窗口同步登录都会触发）。
  useEffect(() => {
    if (session) navigate(consumeRedirect() ?? '/', { replace: true })
  }, [session, navigate])

  const sendCode = async () => {
    if (!authService.isValidPhone(phone)) {
      setPhoneError('请输入正确的 11 位手机号')
      return
    }
    setPhoneError('')
    setError('')
    setSending(true)
    try {
      const p = await authService.sendPhoneCode(phone)
      setPending(p)
      setCountdown(60)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setSending(false)
    }
  }

  const submit = async () => {
    if (!pending || pending.phone !== phone) {
      setError('请先获取当前手机号的验证码')
      return
    }
    if (!code.trim()) {
      setError('请输入验证码')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const session: CloudSession = await authService.submitPhoneLogin(pending, code.trim())
      setSession(session)
      // 跳转统一由「session 变化」的 effect 处理，避免与跨窗口同步重复导航
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setSubmitting(false)
    }
  }

  const wechatLogin = async () => {
    setError('')
    try {
      await authService.startWechatLogin()
    } catch (err) {
      setError(friendlyError(err))
    }
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #eef2ff 0%, #f5f6f8 100%)',
        p: 2,
      }}
    >
      <Card sx={{ width: 400, p: 3 }}>
        <CardContent sx={{ p: '0 !important' }}>
          <Stack spacing={2.5}>
            <Box sx={{ textAlign: 'center' }}>
              <Typography variant="h5" fontWeight={700}>
                个人信息管家
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                记录想法、资料与待办，自动分类、总结与关联
              </Typography>
            </Box>

            <Divider />

            <TextField
              label="手机号"
              fullWidth
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value)
                setPhoneError('')
              }}
              error={!!phoneError}
              helperText={phoneError}
              placeholder="请输入 11 位手机号"
              inputProps={{ inputMode: 'numeric', autoComplete: 'tel' }}
            />

            <Stack direction="row" spacing={1}>
              <TextField
                label="验证码"
                fullWidth
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submit()
                }}
                placeholder="短信验证码"
                inputProps={{ inputMode: 'numeric', autoComplete: 'one-time-code' }}
              />
              <Button
                variant="outlined"
                onClick={sendCode}
                disabled={sending || countdown > 0}
                sx={{ minWidth: 120, whiteSpace: 'nowrap' }}
              >
                {sending ? '发送中…' : countdown > 0 ? `${countdown}s` : '获取验证码'}
              </Button>
            </Stack>

            {error && (
              <Box
                sx={{
                  p: 1,
                  borderRadius: 1,
                  bgcolor: 'error.main',
                  color: 'error.contrastText',
                }}
                role="alert"
              >
                <Typography variant="body2">{error}</Typography>
                <Typography variant="caption" sx={{ display: 'block', mt: 0.25, opacity: 0.9 }}>
                  收不到验证码？请检查手机号是否正确、短信是否被拦截，或稍后重新获取
                </Typography>
              </Box>
            )}

            <Button variant="contained" size="large" onClick={submit} disabled={submitting}>
              {submitting ? '登录中…' : '登录 / 注册'}
            </Button>

            <Divider>或</Divider>

            <Button variant="outlined" size="large" onClick={wechatLogin}>
              微信扫码登录
            </Button>

            <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>
              登录即代表你同意数据仅用于本人信息管理，账号数据云端隔离存储
            </Typography>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  )
}
