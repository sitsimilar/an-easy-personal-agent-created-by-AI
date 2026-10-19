/**
 * web/src/services/updateService.ts 单元测试（纯逻辑，不发起网络请求）。
 * 覆盖：语义化版本比较（容忍 v 前缀、缺段、多段）。
 * 运行方式：node qa/run-tests.mjs。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareVersions } from '../web/src/services/updateService'

test('compareVersions：新版 > 旧版', () => {
  assert.equal(compareVersions('2.9.0', '2.8.3'), 1)
  assert.equal(compareVersions('2.10.0', '2.9.0'), 1)
  assert.equal(compareVersions('3.0.0', '2.9.9'), 1)
})

test('compareVersions：旧版 < 新版', () => {
  assert.equal(compareVersions('2.8.3', '2.9.0'), -1)
  assert.equal(compareVersions('2.9.0', '2.10.0'), -1)
})

test('compareVersions：相等返回 0，容忍 v 前缀与缺段', () => {
  assert.equal(compareVersions('2.9.0', '2.9.0'), 0)
  assert.equal(compareVersions('v2.9.0', '2.9.0'), 0)
  assert.equal(compareVersions('2.9', '2.9.0'), 0)
  assert.equal(compareVersions('2.9.0', '2.9'), 0)
})

test('compareVersions：非数字段按 0 处理', () => {
  assert.equal(compareVersions('2.9.0', '2.9.0-beta'), 0)
  assert.equal(compareVersions('2.9.0', '2.9.x'), 0)
})
