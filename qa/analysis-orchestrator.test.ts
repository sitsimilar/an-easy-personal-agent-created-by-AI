/**
 * desktop/src/main/analysis-orchestrator.ts 单元测试
 * 覆盖：30s 冷却去重（activate 受冷却、start/manual 不受）、状态回填、失败提示。
 *
 * 通过注入 codeUploadEnabled=false 的 fake store，使 triggerSolution 在调用 readSolution 前短路，
 * 从而无需触碰文件系统即可确定性验证去重与 reason 逻辑。
 */
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { AnalysisOrchestrator } from '../desktop/src/main/analysis-orchestrator'
import { IPC } from '../desktop/src/shared/ipc-contract'
// 真实 store 单例（floating-window.touchFloating 内部依赖它）；关闭自动收起避免遗留 5s 计时器
import { store as realStore } from '../desktop/src/main/store'

interface Sent {
  channel: string
  payload: unknown
}

beforeEach(() => {
  realStore.set('autoCollapseEnabled', false)
})

function makeOrchestrator() {
  const sends: Sent[] = []
  const win = {
    webContents: {
      send: (channel: string, payload: unknown) => {
        sends.push({ channel, payload })
      },
    },
  }
  const vsMonitor = new EventEmitter()
  const store = {
    get: (key: string) => {
      if (key === 'listening') return true
      if (key === 'codeUploadEnabled') return false // 短路，避免触发真实 readSolution
      if (key === 'cache') return {}
      return undefined
    },
    set: () => undefined,
    patch: () => undefined,
  }
  const notices: Array<string | null> = []
  const statuses: unknown[] = []
  const orchestrator = new AnalysisOrchestrator({
    // 类型在运行期被擦除，此处用 any 注入轻量 fake
    vsMonitor: vsMonitor as unknown as never,
    store: store as unknown as never,
    getWindow: () => win as unknown as never,
    onStatus: (s) => statuses.push(s),
    onNotice: (m) => notices.push(m),
  })
  orchestrator.start()

  const vsStartedCount = () => sends.filter((s) => s.channel === IPC.evtVsStarted).length

  return { orchestrator, vsMonitor, sends, notices, statuses, vsStartedCount }
}

test('vs-started 触发分析（reason=start）', () => {
  const { orchestrator, vsMonitor, vsStartedCount } = makeOrchestrator()
  vsMonitor.emit('vs-started', { pid: 1, solutionPath: 'C:\\a\\S.sln' })
  assert.equal(orchestrator.getStatus().lastTriggerReason, 'start')
  assert.equal(vsStartedCount(), 1)
})

test('vs-activated 首次触发（reason=activate）', () => {
  const { orchestrator, vsMonitor, vsStartedCount } = makeOrchestrator()
  vsMonitor.emit('vs-activated', { pid: 1, solutionPath: 'C:\\a\\S.sln' })
  assert.equal(orchestrator.getStatus().lastTriggerReason, 'activate')
  assert.equal(vsStartedCount(), 1)
})

test('30s 冷却：activate 冷却期内重复激活被跳过', () => {
  const { orchestrator, vsMonitor, vsStartedCount } = makeOrchestrator()
  vsMonitor.emit('vs-activated', { pid: 1, solutionPath: 'C:\\a\\S.sln' })
  assert.equal(vsStartedCount(), 1)

  // 同一 solution 立即再次激活 → 冷却期内静默跳过
  vsMonitor.emit('vs-activated', { pid: 1, solutionPath: 'C:\\a\\S.sln' })
  assert.equal(vsStartedCount(), 1) // 未新增
  assert.equal(orchestrator.getStatus().lastTriggerReason, 'activate')
})

test('30s 冷却：不同 solution 各自触发', () => {
  const { vsMonitor, vsStartedCount } = makeOrchestrator()
  vsMonitor.emit('vs-activated', { pid: 1, solutionPath: 'C:\\a\\S.sln' })
  vsMonitor.emit('vs-activated', { pid: 1, solutionPath: 'C:\\b\\T.sln' })
  assert.equal(vsStartedCount(), 2)
})

test('vs-started 不受冷却约束（重复 start 仍触发）', () => {
  const { vsMonitor, vsStartedCount } = makeOrchestrator()
  vsMonitor.emit('vs-started', { pid: 1, solutionPath: 'C:\\a\\S.sln' })
  vsMonitor.emit('vs-started', { pid: 1, solutionPath: 'C:\\a\\S.sln' })
  assert.equal(vsStartedCount(), 2)
})

test('solutionPath 为 null：不触发分析，仅广播 currentSolution=null', () => {
  const { orchestrator, vsMonitor, vsStartedCount } = makeOrchestrator()
  vsMonitor.emit('vs-started', { pid: 1, solutionPath: null })
  assert.equal(orchestrator.getStatus().currentSolution, null)
  assert.equal(vsStartedCount(), 0)
})

test('triggerManual：VS 未运行 → 明确中文错误', async () => {
  const { orchestrator } = makeOrchestrator()
  const r = await orchestrator.triggerManual()
  assert.equal(r.ok, false)
  assert.ok(r.message && r.message.includes('未检测到正在运行的 Visual Studio'))
})

test('triggerManual：VS 运行但无解决方案 → 明确中文错误', async () => {
  const { orchestrator, vsMonitor } = makeOrchestrator()
  vsMonitor.emit('status-changed', { vsRunning: true })
  const r = await orchestrator.triggerManual()
  assert.equal(r.ok, false)
  assert.ok(r.message && r.message.includes('未检测到当前 VS 解决方案'))
})

test('triggerManual：有解决方案时以 reason=manual 触发（不受冷却）', async () => {
  const { orchestrator, vsMonitor, vsStartedCount } = makeOrchestrator()
  vsMonitor.emit('status-changed', { vsRunning: true })
  vsMonitor.emit('vs-started', { pid: 1, solutionPath: 'C:\\a\\S.sln' })
  const before = vsStartedCount()
  const r = await orchestrator.triggerManual()
  assert.equal(r.ok, true)
  assert.equal(orchestrator.getStatus().lastTriggerReason, 'manual')
  assert.equal(vsStartedCount(), before + 1)
})

test('markAnalysisDone：回填 lastAnalysisAt / lastIssueCount', () => {
  const { orchestrator } = makeOrchestrator()
  orchestrator.markAnalysisDone({ analysisId: 1, status: 'done', issueCount: 5 })
  const s = orchestrator.getStatus()
  assert.equal(s.analyzing, false)
  assert.equal(s.lastIssueCount, 5)
  assert.ok(typeof s.lastAnalysisAt === 'string' && s.lastAnalysisAt.length > 0)
})

test('setVsInstalled：更新 vsInstalled 状态', () => {
  const { orchestrator } = makeOrchestrator()
  assert.equal(orchestrator.getStatus().vsInstalled, null)
  orchestrator.setVsInstalled(false)
  assert.equal(orchestrator.getStatus().vsInstalled, false)
})

test('foreground-unavailable：触发 onNotice 中文提示', () => {
  const { vsMonitor, notices } = makeOrchestrator()
  vsMonitor.emit('foreground-unavailable')
  assert.ok(notices.some((n) => n && n.includes('前台检测不可用')))
})
