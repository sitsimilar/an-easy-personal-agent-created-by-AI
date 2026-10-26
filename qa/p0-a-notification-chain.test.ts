/**
 * P0-A 提醒链路 · 静态链路核对（QA 独立补充）。
 *
 * 为什么需要它：A1（系统通知出现）与 A2（点击通知打开详情）都需要**打包实机**才能点验，
 * 无 GUI 环境无法证明。本文件把「代码链路是否接通」逐段固定下来，避免出现
 * 「IPC 有实现但没注册 / preload 没暴露 / 路由没监听」这类静默断链。
 *
 * 结论口径：这些用例通过 = 链路静态接通；不等于实机通知一定弹出（Windows 通知中心依赖
 * AppUserModelId 与系统设置），实机验证仍列为「未验证」。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = typeof __dirname === 'string' ? path.resolve(__dirname, '..', '..') : process.cwd()

function src(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), 'utf8')
}

/* ------------------------- 桌面端：渲染 → 主进程 → 系统通知 ------------------------- */

test('IPC 契约：通道名在 desktop 与 shared 两侧一致（notify / notify-clicked）', () => {
  const contract = src('desktop/src/shared/ipc-contract.ts')
  const shared = src('shared/types/ipc.ts')

  assert.match(contract, /notify: 'desktop:notify'/, 'invoke 通道应已登记')
  assert.match(contract, /evtNotifyClicked: 'desktop:notify-clicked'/, '点击事件通道应已登记')
  assert.match(shared, /notify\(payload: NotifyPayload\): Promise<\{ ok: boolean; message\?: string \}>/)
  assert.match(shared, /onNotificationClicked\(cb: \(payload: NotifyClickedPayload\) => void\)/)
})

test('preload：通过 ipcRenderer.invoke 发送、通过 on 监听点击并可取消', () => {
  const preload = src('desktop/src/preload/index.ts')

  assert.match(preload, /ipcRenderer\.invoke\(IPC\.notify, payload\)/)
  assert.match(preload, /ipcRenderer\.on\(IPC\.evtNotifyClicked/)
  assert.match(preload, /ipcRenderer\.removeListener\(IPC\.evtNotifyClicked/)
})

test('主进程：注册 IPC.notify 且校验来源（assertTrusted）', () => {
  const ipc = src('desktop/src/main/ipc.ts')

  assert.match(ipc, /ipcMain\.handle\(IPC\.notify/)
  assert.match(ipc, /ipcMain\.handle\(IPC\.notify,[\s\S]{0,200}isTrustedSender\(event\)/, '必须校验来源窗口')
  assert.match(ipc, /showSystemNotification\(payload\)/)
})

test('主进程：点击通知 → 窗口前置 + 回推 recordId', () => {
  const notifier = src('desktop/src/main/notifier.ts')

  assert.match(notifier, /Notification\.isSupported\(\)/, '不支持时应有明确分支（Windows 兼容）')
  assert.match(notifier, /new Notification\(/, '应创建原生通知')
  assert.match(notifier, /notification\.show\(\)/, '必须显式 show')
  assert.match(notifier, /on\('click'[\s\S]{0,200}showMainWindow\(\)/, '点击应先前置窗口')
  assert.match(notifier, /send\(IPC\.evtNotifyClicked/, '随后回推 recordId')
  assert.match(notifier, /alive\.add\(notification\)/, '必须持有引用（否则 GC 后 click 丢失）')
})

test('Windows 通知可用性：setAppUserModelId 与 appId 对齐', () => {
  const mainIndex = src('desktop/src/main/index.ts')
  assert.match(mainIndex, /app\.setAppUserModelId\('com\.personalagent\.desktop'\)/)

  const builderConfig = src('desktop/electron-builder.yml')
  assert.match(builderConfig, /appId:\s*com\.personalagent\.desktop/, 'appId 必须与 AppUserModelId 一致')
})

test('窗口隐藏到托盘仍生效：backgroundThrottling: false', () => {
  const mainWindow = src('desktop/src/main/main-window.ts')
  assert.match(mainWindow, /backgroundThrottling: false/, '渲染层 30s 定时器不得被后台节流降频（A6）')
})

/* ------------------------- 渲染层：调度器 + 点击跳转 ------------------------- */

test('Layout：挂载调度器（companion 模式不挂）+ 应用内提示宿主', () => {
  const layout = src('web/src/components/Layout.tsx')

  assert.match(layout, /<ReminderScheduler \/>/)
  assert.match(layout, /<NoticeHost \/>/)
  assert.match(layout, /!isCompanionMode\(\) && <ReminderScheduler/, '悬浮窗模式不得挂调度器（防双弹）')
})

test('ReminderScheduler：启动调度 + 点击跳转 /todo?record=<id>', () => {
  const scheduler = src('web/src/components/ReminderScheduler.tsx')

  assert.match(scheduler, /reminderService\.start\(\)/)
  assert.match(scheduler, /reminderService\.stop\(\)/, '卸载必须停止（防重复定时器）')
  assert.match(scheduler, /provider\.onClick\(\(recordId\)/)
  assert.match(scheduler, /navigate\(`\/todo\?record=\$\{recordId\}`\)/)
})

test('TodoPage：?record= 定位详情；已软删 → 待办页 + 「该记录已删除」', () => {
  const page = src('web/src/pages/TodoPage.tsx')

  assert.match(page, /searchParams\.get\('record'\)/)
  assert.match(page, /if \(!target \|\| target\.isDeleted\)/, '软删需单独判定')
  assert.match(page, /pushNotice\('该记录已删除'/, '应提示中文文案')
  assert.match(page, /setDetail\(target\)/, '命中则直接打开详情')
})

test('设置页：提醒卡片含总开关 / 提前量枚举 / 免打扰起止，且保存 payload 带 4 个新键', () => {
  const settings = src('web/src/pages/SettingsPage.tsx')

  assert.match(settings, /const LEAD_OPTIONS = \[0, 5, 10, 15, 30, 60\]/, '提前量枚举与 PRD 一致')
  assert.match(settings, /notify_enabled: notifyEnabled/)
  assert.match(settings, /remind_lead_minutes: remindLeadMinutes/)
  assert.match(settings, /quiet_hours_enabled: quietHoursEnabled/)
  assert.match(settings, /quiet_start: quietStart/)
  assert.match(settings, /quiet_end: quietEnd/)
  assert.match(settings, /reminderService\.onSettingsSaved\(\)/, '保存后立即生效')
  assert.match(settings, /requestPermission\(\)/, '首次开启总开关时请求权限（Web）')
})

test('调度器常量：30s 轮询（满足免打扰补发 08:00–08:05 精度）', () => {
  const service = src('web/src/services/reminderService.ts')

  assert.match(service, /const TICK_MS = 30_000/)
  assert.match(service, /if \(!settings\.notifyEnabled\) return/, '总开关关闭必须短路（A6）')
  assert.match(service, /if \(decision\.action === 'defer'\) return/, '免打扰：不写键、等下个周期补发（A5）')
})
