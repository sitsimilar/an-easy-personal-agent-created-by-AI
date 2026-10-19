/**
 * 图片存储服务单元测试（纯函数，不发起网络/存储请求）。
 * 覆盖：文件名校验、ID 零填充、缩略图尺寸计算。
 * 运行方式：node qa/run-tests.mjs。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateImageName, formatImageId } from '../web/src/services/imageService'
import { computeThumbnailSize } from '../web/src/lib/thumbnail'

test('validateImageName：合法名称返回 null', () => {
  assert.equal(validateImageName('照片_2024'), null)
  assert.equal(validateImageName('abc123_中文'), null)
  assert.equal(validateImageName('a'), null)
  assert.equal(validateImageName('a'.repeat(20)), null)
})

test('validateImageName：空/超长/非法字符返回错误', () => {
  assert.ok(validateImageName(''))
  assert.ok(validateImageName('   '))
  assert.ok(validateImageName('a'.repeat(21)))
  assert.ok(validateImageName('abc def')) // 空格
  assert.ok(validateImageName('abc-def')) // 连字符
  assert.ok(validateImageName('abc.def')) // 点
  assert.ok(validateImageName('abc😀')) // emoji
})

test('formatImageId：BIGINT 零填充为 9 位', () => {
  assert.equal(formatImageId(1), '000000001')
  assert.equal(formatImageId(123), '000000123')
  assert.equal(formatImageId(123456789), '123456789')
})

test('computeThumbnailSize：最长边缩放、保持比例、不放大', () => {
  assert.deepEqual(computeThumbnailSize(1000, 500, 128), { w: 128, h: 64 }) // 横向
  assert.deepEqual(computeThumbnailSize(500, 1000, 128), { w: 64, h: 128 }) // 纵向
  assert.deepEqual(computeThumbnailSize(256, 256, 128), { w: 128, h: 128 }) // 正方形
  assert.deepEqual(computeThumbnailSize(100, 100, 128), { w: 100, h: 100 }) // 小于目标不放大
  assert.deepEqual(computeThumbnailSize(0, 0, 128), { w: 128, h: 128 }) // 非法输入回落
})
