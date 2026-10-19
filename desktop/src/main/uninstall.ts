import { app, dialog, shell } from 'electron'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawn } from 'node:child_process'

/**
 * 一键删除：清理本地数据 + 卸载程序。
 *
 * 删除范围：
 * - 本地配置：userData（preferences.json 等本地偏好）
 * - 缓存/导出：%LOCALAPPDATA%\PersonalAgent\（VSIX 读取的分析结果）
 * - 程序文件：NSIS 卸载器（已安装）或自删除脚本（便携/绿色版）
 * - 注册表项：由 NSIS 卸载器负责清理
 *
 * 不删除：云端数据（记录、分析结果等，存储在云服务，与本地卸载无关）。
 */

/** 清理本地数据（配置 + 导出缓存），不删云端数据。 */
function cleanupLocalData(): void {
  try {
    const base = process.env.LOCALAPPDATA || process.env.TEMP || '.'
    rmSync(join(base, 'PersonalAgent'), { recursive: true, force: true })
  } catch {
    /* 忽略 */
  }
  try {
    rmSync(app.getPath('userData'), { recursive: true, force: true })
  } catch {
    /* 忽略 */
  }
}

/** 便携/绿色版：写自删除脚本，进程退出后删除自身目录并清理。 */
function spawnSelfDelete(appDir: string): void {
  try {
    const bat = join(app.getPath('temp'), 'personal-agent-uninstall.bat')
    const content = `@echo off\r\ntimeout /t 2 /nobreak >nul\r\nrmdir /s /q "${appDir}"\r\ndel "%~f0"\r\n`
    writeFileSync(bat, content, 'utf-8')
    spawn('cmd.exe', ['/c', bat], { detached: true, stdio: 'ignore' }).unref()
  } catch {
    /* 忽略 */
  }
}

/** 已安装（NSIS）：启动卸载器；找不到则打开安装目录兜底。 */
function launchUninstaller(): void {
  try {
    const appDir = dirname(app.getPath('exe'))
    const uninstaller = join(appDir, 'Uninstall 个人信息管家.exe')
    if (existsSync(uninstaller)) {
      spawn(uninstaller, [], { detached: true, stdio: 'ignore' }).unref()
    } else {
      void shell.openPath(appDir)
    }
  } catch {
    /* 忽略 */
  }
}

/** 一键删除：防误删确认 → 清理本地数据 → 卸载程序 → 退出。 */
export function uninstallApp(): void {
  dialog
    .showMessageBox({
      type: 'warning',
      title: '卸载个人信息管家',
      message: '确定要卸载「个人信息管家」吗？',
      detail:
        '将删除程序文件、本地配置与缓存文件。\n\n云端数据（你的记录、分析结果等）不受影响、会保留。\n\n此操作不可恢复，请确认。',
      buttons: ['取消', '确认卸载'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    })
    .then(({ response }) => {
      if (response !== 1) return // 取消，不执行
      cleanupLocalData()
      const appDir = dirname(app.getPath('exe'))
      if (app.isPackaged) {
        launchUninstaller()
      } else {
        spawnSelfDelete(appDir)
        void shell.openPath(appDir)
      }
      app.quit()
    })
    .catch(() => undefined)
}
