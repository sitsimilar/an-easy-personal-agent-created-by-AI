/**
 * desktop/src/main/main-window.ts 单元测试（electron 已 mock）
 * 覆盖：位置/尺寸 clamp、越界回退居中、窗口标志（无边框/可缩放/最小尺寸）、
 *       最大化态持久化、关闭=隐藏到托盘。
 */
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { __setElectronMock, __resetElectronMock, BrowserWindow } from './mocks/electron'
import { store } from '../desktop/src/main/store'
import { createMainWindow, setQuitting } from '../desktop/src/main/main-window'

beforeEach(() => {
  __resetElectronMock()
  BrowserWindow.instances.length = 0
  store.patch({ mainWindowPosition: {}, mainWindowMaximized: false })
  setQuitting(false)
})

test('尺寸过小时 clamp 到最小值 960×640（位置保留）', () => {
  __setElectronMock({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } })
  store.patch({ mainWindowPosition: { x: 10, y: 20, width: 100, height: 100 } })
  const win = createMainWindow()
  assert.equal(win.options.width, 960)
  assert.equal(win.options.height, 640)
  assert.equal(win.options.x, 10)
  assert.equal(win.options.y, 20)
})

test('尺寸超过工作区时 clamp 到工作区大小', () => {
  __setElectronMock({ workArea: { x: 0, y: 0, width: 1280, height: 720 } })
  store.patch({ mainWindowPosition: { x: 0, y: 0, width: 4000, height: 4000 } })
  const win = createMainWindow()
  assert.equal(win.options.width, 1280)
  assert.equal(win.options.height, 720)
})

test('越界坐标回退为居中（换显示器/改分辨率）', () => {
  __setElectronMock({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } })
  store.patch({ mainWindowPosition: { x: 5000, y: 5000, width: 1200, height: 800 } })
  const win = createMainWindow()
  assert.equal(win.options.width, 1200)
  assert.equal(win.options.height, 800)
  // 居中：x = 0 + round((1920-1200)/2) = 360；y = 0 + round((1040-800)/2) = 120
  assert.equal(win.options.x, 360)
  assert.equal(win.options.y, 120)
})

test('窗口标志：无边框、可缩放、thickFrame、最小尺寸', () => {
  __setElectronMock({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } })
  const win = createMainWindow()
  assert.equal(win.options.frame, false)
  assert.equal(win.options.thickFrame, true)
  assert.equal(win.options.resizable, true)
  assert.equal(win.options.minWidth, 960)
  assert.equal(win.options.minHeight, 640)
})

test('maximize/unmaximize 持久化 mainWindowMaximized', () => {
  __setElectronMock({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } })
  const win = createMainWindow()
  win.maximize()
  assert.equal(store.get('mainWindowMaximized'), true)
  win.unmaximize()
  assert.equal(store.get('mainWindowMaximized'), false)
})

test('关闭 = 隐藏到托盘（preventDefault + hide）', () => {
  __setElectronMock({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } })
  const win = createMainWindow()
  win.show()
  let prevented = false
  win.emit('close', { preventDefault: () => (prevented = true) })
  assert.equal(prevented, true)
  assert.equal(win.isVisible(), false)
})

test('setQuitting(true) 后 close 不再拦截（真正退出）', () => {
  __setElectronMock({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } })
  const win = createMainWindow()
  win.show()
  setQuitting(true)
  let prevented = false
  win.emit('close', { preventDefault: () => (prevented = true) })
  assert.equal(prevented, false) // 未拦截
})
