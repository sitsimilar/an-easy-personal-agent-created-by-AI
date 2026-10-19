import { useCallback } from 'react'
import {
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
} from '@mui/material'
import ContentCutIcon from '@mui/icons-material/ContentCut'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import ContentPasteIcon from '@mui/icons-material/ContentPaste'
import SelectAllIcon from '@mui/icons-material/SelectAll'

interface ContextMenuProps {
  /** 是否显示（null 坐标即隐藏）。 */
  open: boolean
  /** 菜单锚点 X（视口坐标）。 */
  x: number
  /** 菜单锚点 Y（视口坐标）。 */
  y: number
  onClose: () => void
}

/** 取当前聚焦的可编辑元素（input/textarea/contentEditable），无则返回 null。 */
function activeEditable(): HTMLInputElement | HTMLTextAreaElement | HTMLElement | null {
  const el = document.activeElement as HTMLElement | null
  if (!el) return null
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el
  if (el.isContentEditable) return el
  return null
}

/** 全选：优先全选当前可编辑元素内容，否则全选页面文本。 */
function selectAll(): void {
  const el = activeEditable()
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.focus()
    el.select()
    return
  }
  try {
    document.execCommand('selectAll')
  } catch {
    const selection = window.getSelection()
    if (selection) {
      const range = document.createRange()
      range.selectNodeContents(document.body)
      selection.removeAllRanges()
      selection.addRange(range)
    }
  }
}

/** 复制/剪切：优先走 execCommand（Electron/可编辑区域原生支持），复制失败回退剪贴板 API。 */
async function copyOrCut(kind: 'copy' | 'cut'): Promise<void> {
  const el = activeEditable()
  const command = kind
  try {
    if (document.execCommand(command)) return
  } catch {
    /* 忽略，走回退 */
  }
  // 回退：直接读当前选区写入剪贴板（cut 在非编辑场景按复制处理）
  const selection = window.getSelection()
  const text = selection ? selection.toString() : ''
  if (!text && el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
    const start = el.selectionStart ?? 0
    const end = el.selectionEnd ?? 0
    const selected = el.value.slice(start, end)
    if (selected) {
      await navigator.clipboard.writeText(selected)
      return
    }
  }
  if (text) {
    await navigator.clipboard.writeText(text)
  }
}

/** 粘贴：execCommand 优先（Electron 原生支持），失败回退剪贴板 API + 手动插入。 */
async function paste(): Promise<void> {
  const el = activeEditable()
  try {
    if (document.execCommand('paste')) return
  } catch {
    /* 忽略，走回退 */
  }
  if (!el) return
  try {
    const text = await navigator.clipboard.readText()
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const start = el.selectionStart ?? el.value.length
      const end = el.selectionEnd ?? el.value.length
      el.value = el.value.slice(0, start) + text + el.value.slice(end)
      const caret = start + text.length
      el.setSelectionRange(caret, caret)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    } else {
      // contentEditable：插入纯文本节点
      const range = window.getSelection()?.getRangeAt(0)
      if (range) {
        range.deleteContents()
        range.insertNode(document.createTextNode(text))
        range.collapse(false)
      }
    }
  } catch {
    /* 无剪贴板权限时静默失败 */
  }
}

/** 全局右键上下文菜单（复制/粘贴/剪切/全选）。桌面环境由 Electron 原生菜单接管。 */
export default function ContextMenu({ open, x, y, onClose }: ContextMenuProps) {
  const run = useCallback(
    (fn: () => void | Promise<void>) => {
      void fn()
      onClose()
    },
    [onClose],
  )

  return (
    <Menu
      open={open}
      onClose={onClose}
      anchorReference="anchorPosition"
      anchorPosition={{ top: y, left: x }}
      MenuListProps={{ dense: true }}
    >
      <MenuItem onClick={() => run(() => copyOrCut('copy'))}>
        <ListItemIcon>
          <ContentCopyIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText primary="复制" />
      </MenuItem>
      <MenuItem onClick={() => run(() => paste())}>
        <ListItemIcon>
          <ContentPasteIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText primary="粘贴" />
      </MenuItem>
      <MenuItem onClick={() => run(() => copyOrCut('cut'))}>
        <ListItemIcon>
          <ContentCutIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText primary="剪切" />
      </MenuItem>
      <MenuItem onClick={() => run(() => selectAll())}>
        <ListItemIcon>
          <SelectAllIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText primary="全选" />
      </MenuItem>
    </Menu>
  )
}
