import { app } from 'electron'

// ⚠️ 必须在 app ready 之前、且先于其他任何 app 调用：
// 本机安全软件（火绒等）向 Chromium 子进程注入 DLL，GPU/渲染进程在沙箱内
// 启动即崩（0xC0000005），主进程报 "GPU process isn't usable. Goodbye." 整体退出。
// 关闭 Chromium 沙箱规避（2026-10-22 实测 --no-sandbox 可常驻，GPU 加速可用；
// 仅 --disable-gpu-sandbox 不够，渲染进程同样崩）。
app.commandLine.appendSwitch('no-sandbox')

// Windows 系统通知（P0-A）：必须与 electron-builder 的 appId 一致，
// 否则 toast 可能静默不显示（通知中心按 AppUserModelId 归属应用）。
app.setAppUserModelId('com.personalagent.desktop')

import { VsMonitor, detectVsInstalled } from './vs-monitor'
import { AnalysisOrchestrator } from './analysis-orchestrator'
import { store } from './store'
import { createFloatingWindow, getFloatingWindow, toggleFloatingWindow, clearFloatingAutoCollapseTimer } from './floating-window'
import { createMainWindow, setQuitting, showMainWindow } from './main-window'
import { createTray, refreshTray, setTrayNotice, updateTrayStatus } from './tray'
import { registerIpc, cppRunner } from './ipc'
import {
  getSelectionTargetWindow,
  registerSelectionShortcut,
  unregisterSelectionShortcut,
} from './selection-analyzer'

const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  const vsMonitor = new VsMonitor()
  const orchestrator = new AnalysisOrchestrator({
    vsMonitor,
    store,
    getWindow: getFloatingWindow,
    onStatus: updateTrayStatus,
    onNotice: setTrayNotice,
  })

  app.whenReady().then(() => {
    // 开机自启（打包后生效；开发环境忽略异常）
    try {
      app.setLoginItemSettings({ openAtLogin: true })
    } catch {
      /* 忽略 */
    }

    // 监听不阻塞启动：先同步建窗口，再后台启动监听/探测/快捷键
    createMainWindow()
    // 「启用桌面悬浮窗」开关：仅当云端设置同步为启用时才创建
    if (store.get('floatWindowEnabled')) createFloatingWindow()
    createTray({
      onToggleWindow: toggleFloatingWindow,
      onTriggerAnalysis: () => {
        void orchestrator.triggerManual()
      },
      onToggleListening: () => {
        const next = !store.get('listening')
        store.set('listening', next)
        vsMonitor.setEnabled(next)
        refreshTray()
      },
      listening: () => store.get('listening'),
    })

    registerIpc(orchestrator, vsMonitor)
    orchestrator.start()

    // 后台监听（不 await）
    if (store.get('listening')) vsMonitor.start()

    // 异步探测 VS 是否安装（fire-and-forget）
    void detectVsInstalled().then((ok) => orchestrator.setVsInstalled(ok))

    // 全局选区快捷键（失败仅记录 + 托盘提示，手动按钮仍可用）
    const reg = registerSelectionShortcut({ getTargetWindow: getSelectionTargetWindow })
    if (!reg.ok) {
      console.warn('[selection] 全局快捷键注册失败')
      setTrayNotice(reg.message ?? '选区快捷键注册失败')
    }
  })

  app.on('second-instance', () => {
    showMainWindow()
  })

  // 常驻托盘，关闭窗口不退出
  app.on('window-all-closed', () => {
    // 有意保持运行
  })

  app.on('before-quit', () => {
    setQuitting(true)
    vsMonitor.stop()
    unregisterSelectionShortcut()
    clearFloatingAutoCollapseTimer()
    cppRunner.dispose()
    store.flushSync()
  })
}
