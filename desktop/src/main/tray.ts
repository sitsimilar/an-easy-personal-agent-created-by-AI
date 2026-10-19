import { app, Menu, Tray, nativeImage, shell } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { WEB_APP_URL, type DesktopStatus } from '../shared/ipc-contract'
import { showMainWindow } from './main-window'
import { uninstallApp } from './uninstall'

interface TrayOptions {
  onToggleWindow: () => void
  /** 立即分析当前 VS 项目。 */
  onTriggerAnalysis: () => void
  /** 切换 VS 监听。 */
  onToggleListening: () => void
  /** 当前监听开关。 */
  listening: () => boolean
}

let tray: Tray | null = null
let trayOptions: TrayOptions | null = null
let lastStatus: DesktopStatus | null = null
let notice: string | null = null

/** 创建系统托盘菜单。 */
export function createTray(options: TrayOptions): Tray {
  trayOptions = options

  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(app.getAppPath(), 'build', 'icon.png')
  const icon = existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty()

  tray = new Tray(icon)
  tray.setToolTip('个人信息管家')
  buildMenu()
  return tray
}

/** 根据最新状态计算一行状态文案。 */
function statusLabel(): string {
  const s = lastStatus
  if (!s) return '空闲'
  if (s.analyzing) return '分析中…'
  if (!s.listening) return '监听已暂停'
  if (s.vsRunning) return '已监听 VS'
  if (s.vsInstalled === false) return '未检测到 VS'
  return '空闲'
}

function tooltipText(): string {
  const parts = [`个人信息管家 · ${statusLabel()}`]
  if (lastStatus?.lastAnalysisAt && lastStatus.lastIssueCount !== null) {
    parts.push(`上次 ${lastStatus.lastIssueCount} 个建议`)
  }
  if (notice) parts.push(notice)
  return parts.join(' · ')
}

function buildMenu(): void {
  if (!tray || !trayOptions) return
  const template: Electron.MenuItemConstructorOptions[] = [
    { label: `状态：${statusLabel()}`, enabled: false },
    { type: 'separator' },
    { label: '显示/隐藏悬浮窗', click: () => trayOptions?.onToggleWindow() },
    { label: '打开主界面', click: () => showMainWindow() },
    { label: '在浏览器打开', click: () => void shell.openExternal(WEB_APP_URL) },
    { type: 'separator' },
    { label: '立即分析当前 VS 项目', click: () => trayOptions?.onTriggerAnalysis() },
    {
      label: trayOptions.listening?.() ? '暂停 VS 监听' : '恢复 VS 监听',
      click: () => trayOptions?.onToggleListening(),
    },
    { type: 'separator' },
    { label: '卸载软件', click: () => uninstallApp() },
    { label: '退出', click: () => app.quit() },
  ]
  const menu = Menu.buildFromTemplate(template)
  tray.setContextMenu(menu)
  tray.setToolTip(tooltipText())
}

/** 监听开关变化后刷新托盘菜单文案。 */
export function refreshTray(): void {
  buildMenu()
}

/** 状态变化时刷新托盘 tooltip 与状态行。 */
export function updateTrayStatus(status: DesktopStatus): void {
  lastStatus = status
  buildMenu()
}

/** 设置托盘提示（如「选区快捷键注册失败」），传 null 清除。 */
export function setTrayNotice(message: string | null): void {
  notice = message
  buildMenu()
}
