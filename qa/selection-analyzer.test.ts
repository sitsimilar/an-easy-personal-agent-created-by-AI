/**
 * desktop/src/main/selection-analyzer.ts 单元测试（electron 已 mock）
 * 覆盖：readClipboardSelection 四态（ok/empty/non-text/error）、截断、快捷键注册成败。
 */
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  __setElectronMock,
  __resetElectronMock,
} from './mocks/electron'
import {
  readClipboardSelection,
  registerSelectionShortcut,
  unregisterSelectionShortcut,
} from '../desktop/src/main/selection-analyzer'
import { IPC } from '../desktop/src/shared/ipc-contract'

beforeEach(() => {
  __resetElectronMock()
  delete (globalThis as unknown as { __registeredShortcut?: unknown }).__registeredShortcut
})

test('ok：剪贴板有文本 → status=ok + capturedAt', () => {
  __setElectronMock({ clipboardText: 'const a = 1' })
  const r = readClipboardSelection()
  assert.equal(r.status, 'ok')
  assert.equal(r.text, 'const a = 1')
  assert.ok(r.capturedAt && r.capturedAt.length > 0)
})

test('ok：超过 20000 字符被截断', () => {
  __setElectronMock({ clipboardText: 'x'.repeat(30000) })
  const r = readClipboardSelection()
  assert.equal(r.status, 'ok')
  assert.equal(r.text?.length, 20000)
})

test('empty：空剪贴板且无非文本格式 → 中文提示', () => {
  __setElectronMock({ clipboardText: '', clipboardFormats: [] })
  const r = readClipboardSelection()
  assert.equal(r.status, 'empty')
  assert.ok(r.message && r.message.includes('剪贴板为空'))
})

test('empty：仅空白文本视为空', () => {
  __setElectronMock({ clipboardText: '   \n\t ', clipboardFormats: [] })
  const r = readClipboardSelection()
  assert.equal(r.status, 'empty')
})

test('non-text：剪贴板为图片/文件 → 中文提示', () => {
  __setElectronMock({ clipboardText: '', clipboardFormats: ['image/png'] })
  const r = readClipboardSelection()
  assert.equal(r.status, 'non-text')
  assert.ok(r.message && r.message.includes('不是文本'))
})

test('error：读取剪贴板抛异常 → 中文提示', () => {
  __setElectronMock({ clipboardThrows: true })
  const r = readClipboardSelection()
  assert.equal(r.status, 'error')
  assert.ok(r.message && r.message.includes('读取剪贴板失败'))
})

test('registerSelectionShortcut：注册成功返回 ok', () => {
  __setElectronMock({ shortcutRegisterResult: true })
  const r = registerSelectionShortcut({ getTargetWindow: () => null })
  assert.equal(r.ok, true)
})

test('registerSelectionShortcut：注册失败返回中文提示', () => {
  __setElectronMock({ shortcutRegisterResult: false })
  const r = registerSelectionShortcut({ getTargetWindow: () => null })
  assert.equal(r.ok, false)
  assert.ok(r.message && r.message.includes('注册失败'))
})

test('registerSelectionShortcut：抛异常返回中文提示（不抛到调用方）', () => {
  __setElectronMock({ shortcutThrows: true })
  const r = registerSelectionShortcut({ getTargetWindow: () => null })
  assert.equal(r.ok, false)
  assert.ok(r.message && r.message.includes('注册失败'))
})

test('registerSelectionShortcut 回调：读剪贴板并推送到目标窗口', () => {
  __setElectronMock({ shortcutRegisterResult: true, clipboardText: 'void foo() {}' })
  const sends: Array<{ channel: string; payload: unknown }> = []
  const win = {
    isDestroyed: () => false,
    isVisible: () => false,
    show: () => undefined,
    webContents: {
      send: (ch: string, p: unknown) => sends.push({ channel: ch, payload: p }),
    },
  }
  registerSelectionShortcut({ getTargetWindow: () => win as never })
  const reg = (globalThis as unknown as { __registeredShortcut: { accel: string; cb: () => void } })
    .__registeredShortcut
  assert.equal(reg.accel, 'CommandOrControl+Shift+A')
  reg.cb()
  assert.equal(sends.length, 1)
  assert.equal(sends[0].channel, IPC.evtSelectionRead)
  assert.equal((sends[0].payload as { status: string }).status, 'ok')
  assert.equal((sends[0].payload as { text: string }).text, 'void foo() {}')
})

test('unregisterSelectionShortcut：不抛错', () => {
  __setElectronMock({ shortcutThrows: false })
  assert.doesNotThrow(() => unregisterSelectionShortcut())
})
