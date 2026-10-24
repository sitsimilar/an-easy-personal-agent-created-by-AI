/**
 * 统一错误处理工具：
 * - unwrap：{ data, error } 包络 → 有错即抛，返回 data
 * - friendlyError：把各类错误（CloudError / CloudOpenAIError / Error）
 *   转成中文友好提示，不暴露后端堆栈与敏感信息。
 */

/** 兼容 SDK CloudResult 与 supabase PostgrestResult 的宽松包络。 */
export interface ResultEnvelope<T> {
  data: T | null
  error: unknown
}

/**
 * 有错即抛、无错返回 data。
 * 注意：data 允许合法为 null（如 getSession / maybeSingle），由调用方自行判断。
 */
/** 全局 401 拦截钩子（由 main.tsx 注册；unwrap 抛错前回调，用于会话失效跳登录）。 */
let authHook: ((err: unknown) => void) | null = null

export function setUnwrapAuthHook(fn: ((err: unknown) => void) | null): void {
  authHook = fn
}

export function unwrap<T>(result: ResultEnvelope<T>): T {
  if (result.error) {
    authHook?.(result.error)
    throw result.error
  }
  return result.data as T
}

/** 读取错误码（CloudError.code 或 CloudOpenAIError.error.code）。 */
function readCode(err: unknown): string {
  if (!err) return ''
  const e = err as {
    code?: string
    kind?: string
    error?: { code?: string | null }
  }
  return e.code ?? e.error?.code ?? ''
}

/** 读取错误 kind。 */
function readKind(err: unknown): string {
  if (!err) return ''
  const e = err as { kind?: string }
  return e.kind ?? ''
}

/** 错误大类（用于差异化文案与跳转决策）。 */
export type ErrorClass = 'auth' | 'network' | 'server' | 'validation' | 'unknown'

/**
 * 识别「会话/凭证已失效」错误：兼容云 SDK 归一化 CloudError
 * （kind: 'unauthenticated' / status: 401 / code: 'invalid_grant'）与其它常见 401 结构。
 * 仅依据结构化字段判定，不匹配 message 文本（避免第三方合法文案误触发登出）。
 */
export function isAuthExpired(err: unknown): boolean {
  if (!err) return false
  const e = err as {
    kind?: string
    status?: number | string
    statusCode?: number | string
    httpStatus?: number | string
    code?: string
    message?: string
    cause?: unknown
  }
  if (e.kind === 'unauthenticated') return true
  if (Number(e.status) === 401 || Number(e.statusCode) === 401 || Number(e.httpStatus) === 401) return true
  if (e.code === '401' || e.code === 'invalid_jwt' || e.code === 'session_not_found' || e.code === 'invalid_grant') {
    return true
  }
  // 兼容上游 OAuth2 原始错误体（SDK cause 原样保留）：{ error: 'invalid_grant', ... }
  const cause = e.cause as { error?: unknown } | undefined
  if (cause?.error === 'invalid_grant') return true
  return false
}

/** 错误归类：登录失效 / 网络 / 服务端 / 参数 / 未知。 */
export function classifyError(err: unknown): ErrorClass {
  if (isAuthExpired(err)) return 'auth'
  if (!err) return 'unknown'
  const e = err as { kind?: string; status?: number; statusCode?: number; code?: string; message?: string }
  const kind = e.kind ?? ''
  const msg = String(e.message ?? '')
  if (kind === 'network' || /network|fetch|ECONN|ETIMEDOUT/i.test(msg)) return 'network'
  const status = Number(e.status ?? e.statusCode ?? 0)
  if (status >= 500 || kind === 'backend-unavailable') return 'server'
  if (status === 400 || kind === 'invalid-request' || String(e.code ?? '').startsWith('request_')) return 'validation'
  return 'unknown'
}

/**
 * 把任意错误转为中文友好提示。
 * 不展示后端堆栈、不打印 token / 手机号等敏感信息。
 */
export function friendlyError(err: unknown): string {
  if (!err) return '操作失败，请稍后重试'

  const code = readCode(err)
  const kind = readKind(err)
  const message = (err as { message?: string }).message ?? ''

  // 优先按错误类别分支（登录失效 / 网络 / 服务端 / 参数），保证过期/断网不再兜底成笼统文案
  const cls = classifyError(err)
  if (cls === 'auth') return '登录已失效，请重新登录'
  if (cls === 'network') return '网络异常，请检查网络后重试'
  if (cls === 'server') return '服务暂时不可用，请稍后重试'
  if (cls === 'validation') return '请求参数有误，请检查后重试'

  // LLM 错误按 code 前缀分支
  if (code.startsWith('quota_')) return '额度不足或触发限流，请稍后重试'
  if (code.startsWith('gateway_') || code.startsWith('model_')) {
    return '模型服务暂时不可用，请稍后重试或点击重新生成'
  }
  if (code.startsWith('auth_')) return '登录状态或访问来源校验失败，请重新登录'
  if (code.startsWith('request_')) return '请求参数有误，请检查后重试'

  // 数据库错误码
  if (code === '23505') return '记录已存在，请勿重复提交'
  if (code === '42501') return '无权限或记录不存在'
  if (code === '42P01') return '数据表不存在，请联系管理员'

  // 归一化 kind
  if (kind === 'unauthenticated') return '登录已失效，请重新登录'
  if (kind === 'permission-denied') return '无权限或记录不存在'
  if (kind === 'network') return '网络异常，请检查网络后重试'
  if (kind === 'credits-exhausted') return '额度已用尽，请稍后再试'
  if (kind === 'rate-limited') return '操作过于频繁，请稍后重试'
  if (kind === 'backend-unavailable') return '服务暂时不可用，请稍后重试'

  // 仅放行「短、纯中文/常见标点、不含路径与结构符号」的已知文案，其余统一兜底脱敏
  if (
    message &&
    message.length <= 60 &&
    !/[\\/{}"']/.test(message) &&
    /^[\u4e00-\u9fa5A-Za-z0-9，。！？、：；（）\s.+-]+$/.test(message)
  ) {
    return message
  }
  return '操作失败，请稍后重试'
}
