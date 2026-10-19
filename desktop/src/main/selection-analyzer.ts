import { BrowserWindow, clipboard, globalShortcut } from 'electron'
import { store } from './store'
import { IPC, type SelectionReadResult } from '../shared/ipc-contract'
import { getFloatingWindow, touchFloating } from './floating-window'
import { getMainWindow } from './main-window'

/** 读取剪贴板文本（零原生依赖），返回结构化结果。 */
export function readClipboardSelection(): SelectionReadResult {
  try {
    const text = clipboard.readText()
    if (text && text.trim()) {
      return { status: 'ok', text: text.slice(0, 20000), capturedAt: new Date().toISOString() }
    }
    const formats = clipboard.availableFormats()
    const hasNonText = formats.some(
      (f) => f.startsWith('image/') || /png|bitmap|file/i.test(f),
    )
    return hasNonText
      ? { status: 'non-text', message: '剪贴板内容不是文本，无法进行代码分析' }
      : { status: 'empty', message: '剪贴板为空，请先复制要分析的文本（Ctrl+C）' }
  } catch {
    return { status: 'error', message: '读取剪贴板失败，请重试或重新复制' }
  }
}

/** 目标窗口：优先悬浮窗（若启用且存在）→ 否则主窗口。 */
export function getSelectionTargetWindow(): BrowserWindow | null {
  if (store.get('floatWindowEnabled')) {
    const fw = getFloatingWindow()
    if (fw && !fw.isDestroyed()) return fw
  }
  return getMainWindow()
}

/** 注册全局快捷键（默认 Ctrl+Shift+A），触发读剪贴板并推给目标窗口。 */
export function registerSelectionShortcut(opts: {
  getTargetWindow: () => BrowserWindow | null
}): { ok: boolean; message?: string } {
  const accel = store.get('selectionShortcut')
  try {
    const ok = globalShortcut.register(accel, () => {
      const result = readClipboardSelection()
      const win = opts.getTargetWindow()
      if (win && !win.isDestroyed()) {
        if (!win.isVisible()) win.show()
        win.webContents.send(IPC.evtSelectionRead, result)
        // 选区分析进行中保持悬浮窗展开
        touchFloating()
      }
    })
    return ok ? { ok: true } : { ok: false, message: `全局快捷键 ${accel} 注册失败（可能被占用）` }
  } catch {
    return { ok: false, message: `全局快捷键 ${accel} 注册失败（可能被占用）` }
  }
}

/** 注销全部全局快捷键。 */
export function unregisterSelectionShortcut(): void {
  try {
    globalShortcut.unregisterAll()
  } catch {
    /* 忽略 */
  }
}
