/**
 * 账户资料服务单元测试（纯函数，不发起网络/存储请求）。
 * 覆盖：昵称校验、敏感词检测/脱敏、账户 ID 零填充。
 * 运行方式：node qa/run-tests.mjs。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateNickname, maskSensitiveWords, hasSensitiveWord, formatAccountId } from '../web/src/services/profileService'

test('validateNickname：合法昵称返回 null', () => {
  assert.equal(validateNickname('张三'), null)
  assert.equal(validateNickname('abc123_中文'), null)
  assert.equal(validateNickname('a'), null)
  assert.equal(validateNickname('a'.repeat(20)), null)
  assert.equal(validateNickname('中'.repeat(20)), null)
})

test('validateNickname：空/超长/非法字符/敏感词返回错误', () => {
  assert.ok(validateNickname(''))
  assert.ok(validateNickname('   '))
  assert.ok(validateNickname('a'.repeat(21)))
  assert.ok(validateNickname('abc def')) // 空格
  assert.ok(validateNickname('abc-def')) // 连字符
  assert.ok(validateNickname('abc.def')) // 点
  assert.ok(validateNickname('abc😀')) // emoji
  assert.ok(validateNickname('赌博')) // 敏感词
})

test('hasSensitiveWord：命中检测', () => {
  assert.equal(hasSensitiveWord('正常昵称'), false)
  assert.equal(hasSensitiveWord('含毒品词'), true)
})

test('maskSensitiveWords：命中词替换为等长 *', () => {
  assert.equal(maskSensitiveWords('你好'), '你好')
  assert.equal(maskSensitiveWords('我赌博'), '我**')
  assert.equal(maskSensitiveWords('高利贷'), '***')
})

test('formatAccountId：BIGINT 零填充为 9 位', () => {
  assert.equal(formatAccountId(1), '000000001')
  assert.equal(formatAccountId(123), '000000123')
  assert.equal(formatAccountId(123456789), '123456789')
})
