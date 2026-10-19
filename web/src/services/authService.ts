import { cloud } from '@/lib/cloud'
import { unwrap } from '@/lib/unwrap'
import type { CloudSession, CloudUser } from '@tencent-ai/workbuddy-cloud-sdk'

/** 待验证的手机号 OTP 上下文（由「获取验证码」产生，供「登录」消费）。 */
export interface PendingPhoneOtp {
  phone: string
  verificationId: string
  isExistingUser: boolean
}

export type AuthStateCallback = (
  event: 'INITIAL_SESSION' | 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED' | 'USER_UPDATED' | 'PASSWORD_RECOVERY',
  session: CloudSession | null,
) => void

export const PHONE_REGEX = /^1\d{10}$/

export const authService = {
  /** 校验手机号（大陆 11 位、1 开头）。 */
  isValidPhone(phone: string): boolean {
    return PHONE_REGEX.test(phone)
  },

  /** 发送手机验证码，返回待验证上下文（供后续 verify 使用）。 */
  async sendPhoneCode(phone: string): Promise<PendingPhoneOtp> {
    const result = await cloud.auth.sendOtp({ phone })
    const data = unwrap(result)
    return {
      phone,
      verificationId: data.verificationId,
      isExistingUser: data.isExistingUser,
    }
  },

  /** 提交验证码完成登录/注册。 */
  async submitPhoneLogin(pending: PendingPhoneOtp, code: string): Promise<CloudSession> {
    const result = await cloud.auth.verifyOtp({
      phone: pending.phone,
      verificationId: pending.verificationId,
      isExistingUser: pending.isExistingUser,
      token: code,
    })
    return unwrap(result)
  },

  /** 获取当前会话（可能为 null）。 */
  async getSession(): Promise<CloudSession | null> {
    const result = await cloud.auth.getSession()
    return unwrap(result)
  },

  /** 登出。 */
  async signOut(): Promise<void> {
    const result = await cloud.auth.signOut()
    unwrap(result)
  },

  /** 订阅登录态变化，返回取消订阅函数。 */
  onAuthStateChange(cb: AuthStateCallback): () => void {
    return cloud.auth.onAuthStateChange((event, session) => {
      cb(event, session)
    })
  },

  /** 微信 Web 登录：获取授权 URL 并跳转。 */
  async startWechatLogin(): Promise<void> {
    const result = await cloud.auth.signInWithOAuth({
      provider: 'wechat',
      redirectTo: window.location.origin,
    })
    const data = unwrap(result)
    window.location.assign(data.url)
  },

  /** 处理微信登录回调（应用启动时无条件先执行）。 */
  async handleWechatWebCallback(): Promise<CloudSession | null> {
    const result = await cloud.auth.handleWechatWebCallback()
    return unwrap(result)
  },

  /** 解析会话用户（供展示，不做安全边界）。 */
  userOf(session: CloudSession | null): CloudUser | null {
    return session?.user ?? null
  },
}
