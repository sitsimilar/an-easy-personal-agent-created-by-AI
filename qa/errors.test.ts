/**
 * web/src/lib/unwrap.ts 错误分类与文案单元测试（纯逻辑，无云依赖）。
 * 覆盖：isAuthExpired / classifyError / friendlyError 对 401、网络、服务端、参数、未知等各类错误对象。
 * 运行方式：node qa/run-tests.mjs（esbuild bundle 后 node:test）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isAuthExpired, classifyError, friendlyError } from '../web/src/lib/unwrap'

test('isAuthExpired：识别多种 401/凭证失效结构', () => {
  assert.equal(isAuthExpired(null), false)
  assert.equal(isAuthExpired(undefined), false)
  assert.equal(isAuthExpired({}), false)
  assert.equal(isAuthExpired({ kind: 'unauthenticated' }), true)
  assert.equal(isAuthExpired({ status: 401 }), true)
  assert.equal(isAuthExpired({ statusCode: 401 }), true)
  assert.equal(isAuthExpired({ httpStatus: 401 }), true)
  assert.equal(isAuthExpired({ code: '401' }), true)
  assert.equal(isAuthExpired({ code: 'invalid_jwt' }), true)
  assert.equal(isAuthExpired({ code: 'session_not_found' }), true)
  // 云 SDK 归一化 CloudError 的真实失效信号（shouldClearCredentials 同源判定）
  assert.equal(isAuthExpired({ code: 'invalid_grant' }), true)
  assert.equal(isAuthExpired({ kind: 'unauthenticated', status: 401, code: 'invalid_grant' }), true)
  assert.equal(isAuthExpired({ status: '401' }), true)
  // 上游 OAuth2 原始错误体（SDK cause 原样保留）
  assert.equal(isAuthExpired({ code: undefined, cause: { error: 'invalid_grant' } }), true)
  assert.equal(isAuthExpired({ cause: { error: 'invalid_request' } }), false)
  // 仅结构化字段判定，不依赖 message 正则（第三方合法文案含 "expired"/"401" 不应误判登出）
  assert.equal(isAuthExpired({ message: 'JWT expired at 2026-01-01' }), false)
  assert.equal(isAuthExpired({ message: 'token invalid' }), false)
  // 非 401 不误判
  assert.equal(isAuthExpired({ status: 500 }), false)
  assert.equal(isAuthExpired({ code: '23505' }), false)
  assert.equal(isAuthExpired({ message: '网络异常' }), false)
})

test('classifyError：正确归类 auth/network/server/validation/unknown', () => {
  assert.equal(classifyError({ kind: 'unauthenticated' }), 'auth')
  assert.equal(classifyError({ status: 401 }), 'auth')
  assert.equal(classifyError({ kind: 'network' }), 'network')
  assert.equal(classifyError({ message: 'fetch failed: ECONNREFUSED' }), 'network')
  assert.equal(classifyError({ status: 500 }), 'server')
  assert.equal(classifyError({ status: 503 }), 'server')
  assert.equal(classifyError({ kind: 'backend-unavailable' }), 'server')
  assert.equal(classifyError({ status: 400 }), 'validation')
  assert.equal(classifyError({ kind: 'invalid-request' }), 'validation')
  assert.equal(classifyError({ code: 'request_invalid' }), 'validation')
  assert.equal(classifyError(null), 'unknown')
  assert.equal(classifyError({}), 'unknown')
})

test('friendlyError：会话失效不再落兜底文案', () => {
  assert.equal(friendlyError({ status: 401, message: '{ detail: "expired" }' }), '登录已失效，请重新登录')
  assert.equal(friendlyError({ kind: 'unauthenticated' }), '登录已失效，请重新登录')
  assert.equal(friendlyError({ kind: 'network' }), '网络异常，请检查网络后重试')
  assert.equal(friendlyError({ status: 500 }), '服务暂时不可用，请稍后重试')
  assert.equal(friendlyError({ status: 400 }), '请求参数有误，请检查后重试')
  assert.equal(friendlyError(null), '操作失败，请稍后重试')
  // 原有数据库错误分支仍生效
  assert.equal(friendlyError({ code: '23505' }), '记录已存在，请勿重复提交')
})
