import { BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'

/**
 * 在窗口 webContents 上挂载原生右键菜单（复制/粘贴/剪切/全选）。
 * 桌面环境（主窗口 + 悬浮窗）由本菜单接管，Web 端（浏览器直开）由 ContextMenu.tsx 接管。
 */
export function attachNativeContextMenu(win: BrowserWindow): void {
  win.webContents.on('context-menu', (_event, params) => {
    const template: MenuItemConstructorOptions[] = [
      { label: '复制', role: 'copy', enabled: params.editFlags.canCopy },
      { label: '粘贴', role: 'paste', enabled: params.editFlags.canPaste },
      { label: '剪切', role: 'cut', enabled: params.editFlags.canCut },
      { type: 'separator' },
      { label: '全选', role: 'selectAll', enabled: params.editFlags.canSelectAll },
    ]
    Menu.buildFromTemplate(template).popup({ window: win })
  })
}
