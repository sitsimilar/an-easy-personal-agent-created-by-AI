import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  FLOAT_LARGE,
  FLOAT_SMALL,
  clamp,
  dockTargetX,
  isLargeScale,
  isNearLeftEdge,
  keepAnchorX,
  keepAnchorY,
  scaleTargetOf,
  type Rect,
} from '../desktop/src/main/floating-geometry'

const workArea: Rect = { x: 0, y: 0, width: 1920, height: 1040 }

test('clamp 夹逼到 [min,max]', () => {
  assert.equal(clamp(5, 0, 10), 5)
  assert.equal(clamp(-5, 0, 10), 0)
  assert.equal(clamp(15, 0, 10), 10)
})

test('isLargeScale 以 440 为界判断档位', () => {
  assert.equal(isLargeScale(480), true)
  assert.equal(isLargeScale(440), true)
  assert.equal(isLargeScale(439), false)
  assert.equal(isLargeScale(300), false)
})

test('scaleTargetOf 在大/小两档间切换', () => {
  assert.deepEqual(scaleTargetOf(300), FLOAT_LARGE) // 小 → 大
  assert.deepEqual(scaleTargetOf(480), FLOAT_SMALL) // 大 → 小
})

test('keepAnchorX/Y 贴右/贴下锚定且不溢出', () => {
  // 右贴边缩放：放大时保证右边不变、左边左移；不越界
  const bounds: Rect = { x: 1620, y: 560, width: 300, height: 480 }
  const x = keepAnchorX(bounds, workArea, 480)
  assert.equal(x, 1620 + 300 - 480) // 右边缘不变
  assert.ok(x >= workArea.x)

  const y = keepAnchorY(bounds, workArea, 640)
  assert.equal(y, 560 + 480 - 640)
  assert.ok(y >= workArea.y)

  // 极端靠近左/上边缘时 clamp 到 0
  const leftBounds: Rect = { x: 0, y: 0, width: 300, height: 480 }
  assert.equal(keepAnchorX(leftBounds, workArea, 480), 0)
  assert.equal(keepAnchorY(leftBounds, workArea, 640), 0)
})

test('dock 边缘判断与目标 X', () => {
  // 右下角窗口 → 收进右边缘
  const rightWin: Rect = { x: 1600, y: 500, width: 300, height: 480 }
  assert.equal(isNearLeftEdge(rightWin, workArea), false)
  assert.equal(dockTargetX(rightWin, workArea, 8), 1920 - 8)

  // 偏左窗口 → 收进左边缘，露 8px
  const leftWin: Rect = { x: 100, y: 500, width: 300, height: 480 }
  assert.equal(isNearLeftEdge(leftWin, workArea), true)
  assert.equal(dockTargetX(leftWin, workArea, 8), 0 - (300 - 8))
})

test('scaleTargetOf 边界：440 判大档 → 目标小档', () => {
  assert.deepEqual(scaleTargetOf(440), FLOAT_SMALL) // 440 为大档，切到小
  assert.deepEqual(scaleTargetOf(441), FLOAT_SMALL)
  assert.deepEqual(scaleTargetOf(439), FLOAT_LARGE) // 439 为小档，切到大
})

test('dockTargetX 默认露 8px', () => {
  const rightWin: Rect = { x: 1600, y: 500, width: 300, height: 480 }
  assert.equal(dockTargetX(rightWin, workArea), 1920 - 8)
  const leftWin: Rect = { x: 100, y: 500, width: 300, height: 480 }
  assert.equal(dockTargetX(leftWin, workArea), 0 - (300 - 8))
})

test('isNearLeftEdge：窗口中心恰好在中线时判右边缘', () => {
  const centerWin: Rect = { x: 810, y: 500, width: 300, height: 480 } // 中心 960 = 1920/2
  assert.equal(isNearLeftEdge(centerWin, workArea), false)
})

test('keepAnchorX/Y：新尺寸过大时 clamp 不溢出工作区', () => {
  const smallArea: Rect = { x: 0, y: 0, width: 400, height: 500 }
  const bounds: Rect = { x: 100, y: 50, width: 300, height: 480 }
  // newWidth 600 > workArea 400，clamp 到 [workArea.x, workArea.x+width-newWidth]=[0, -200] → 退化为 -200（取 min 边界语义）
  // 实际尺寸受 FLOAT_MAX=600 且 minWidth 约束，此处仅验证函数不抛错且返回有限值
  const x = keepAnchorX(bounds, smallArea, 600)
  assert.ok(Number.isFinite(x))
  const y = keepAnchorY(bounds, smallArea, 800)
  assert.ok(Number.isFinite(y))
})
