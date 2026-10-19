/**
 * 悬浮窗纯几何/档位计算（无 electron 依赖，可单测）。
 * 供 floating-window.ts 复用，并与 qa/floating-geometry.test.ts 对应。
 */

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** 悬浮窗两档尺寸与缩放边界。 */
export const FLOAT_SMALL = { width: 300, height: 480 }
export const FLOAT_LARGE = { width: 480, height: 640 }
export const FLOAT_MIN = { width: 280, height: 400 }
export const FLOAT_MAX = { width: 600, height: 800 }

/** 收起后露出的窄边宽度。 */
export const EDGE_VISIBLE = 8

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** 当前宽度是否算「大档」。 */
export function isLargeScale(currentWidth: number): boolean {
  return currentWidth >= FLOAT_LARGE.width - 40
}

/** 缩放目标：由当前宽度决定切换到的下一档尺寸。 */
export function scaleTargetOf(currentWidth: number): { width: number; height: number } {
  return isLargeScale(currentWidth) ? FLOAT_SMALL : FLOAT_LARGE
}

/** 缩放锚定 X：贴右，保证新宽度不溢出工作区。 */
export function keepAnchorX(bounds: Rect, workArea: Rect, newWidth: number): number {
  return clamp(bounds.x + bounds.width - newWidth, workArea.x, workArea.x + workArea.width - newWidth)
}

/** 缩放锚定 Y：贴下，保证新高度不溢出工作区。 */
export function keepAnchorY(bounds: Rect, workArea: Rect, newHeight: number): number {
  return clamp(bounds.y + bounds.height - newHeight, workArea.y, workArea.y + workArea.height - newHeight)
}

/** dock 边缘判断：窗口偏左屏则收进左边缘，否则右边缘。 */
export function isNearLeftEdge(bounds: Rect, workArea: Rect): boolean {
  return bounds.x + bounds.width / 2 < workArea.x + workArea.width / 2
}

/** dock 目标 X：偏左收进左边缘、否则右边缘，各露 EDGE_VISIBLE 宽窄边。 */
export function dockTargetX(bounds: Rect, workArea: Rect, edgeVisible = EDGE_VISIBLE): number {
  return isNearLeftEdge(bounds, workArea)
    ? workArea.x - (bounds.width - edgeVisible)
    : workArea.x + workArea.width - edgeVisible
}

/** 贴靠阈值：窗口边缘距工作区边缘 ≤ 该值视为「贴靠」。 */
export const SNAP_THRESHOLD = 8

export type DockEdge = 'left' | 'right' | 'top' | 'bottom'

/** 窗口四边到工作区四边的距离。 */
export function edgeDistances(bounds: Rect, workArea: Rect): Record<DockEdge, number> {
  return {
    left: bounds.x - workArea.x,
    right: workArea.x + workArea.width - (bounds.x + bounds.width),
    top: bounds.y - workArea.y,
    bottom: workArea.y + workArea.height - (bounds.y + bounds.height),
  }
}

/** 最近的可收起边缘（四边取距离最小者）。 */
export function nearestDockEdge(bounds: Rect, workArea: Rect): DockEdge {
  const d = edgeDistances(bounds, workArea)
  let edge: DockEdge = 'right'
  let min = d.right
  if (d.left < min) {
    edge = 'left'
    min = d.left
  }
  if (d.top < min) {
    edge = 'top'
    min = d.top
  }
  if (d.bottom < min) {
    edge = 'bottom'
  }
  return edge
}

/** dock 目标位置：按指定边缘收起，仅露 edgeVisible 窄边，另一轴保持原位。 */
export function dockTargetPosition(
  bounds: Rect,
  workArea: Rect,
  edge: DockEdge,
  edgeVisible = EDGE_VISIBLE,
): { x: number; y: number } {
  switch (edge) {
    case 'left':
      return { x: workArea.x - (bounds.width - edgeVisible), y: bounds.y }
    case 'right':
      return { x: workArea.x + workArea.width - edgeVisible, y: bounds.y }
    case 'top':
      return { x: bounds.x, y: workArea.y - (bounds.height - edgeVisible) }
    case 'bottom':
      return { x: bounds.x, y: workArea.y + workArea.height - edgeVisible }
  }
}

/** 窗口是否贴靠在屏幕边缘（任一边距离 ≤ snapThreshold）。 */
export function isSnappedToEdge(bounds: Rect, workArea: Rect, snapThreshold = SNAP_THRESHOLD): boolean {
  const d = edgeDistances(bounds, workArea)
  return d.left <= snapThreshold || d.right <= snapThreshold || d.top <= snapThreshold || d.bottom <= snapThreshold
}
