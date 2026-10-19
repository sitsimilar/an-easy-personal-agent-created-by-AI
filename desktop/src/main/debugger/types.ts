import type { CppDebugEvent } from '../../shared/ipc-contract'

/**
 * 语义化调试动作（UI 对 gdb/cdb 后端无感知，由主进程翻译）。
 * 与 ipc-contract.ts 的 CppDebugAction 保持一致（单一事实来源）。
 */
export type CppDebugAction = 'continue' | 'step-over' | 'step-into' | 'interrupt'

/** 启动调试会话所需入参（断点 + 源文件路径）。 */
export interface DebuggerStartInput {
  sourcePath: string
  breakpoints: number[]
}

/**
 * 调试器后端统一接口。
 *
 * 说明（对设计 §5.1 的微调）：`start()` 接收 `DebuggerStartInput`，
 * 使「设断点 + 启动运行」收敛在会话内部，避免 cpp-runner 与具体后端耦合；
 * 额外暴露 `isClosed()` 供 cpp-runner 判断会话存活。
 */
export interface DebuggerSession {
  readonly backend: 'gdb' | 'cdb'
  /** 建会话初始化 + 设断点 + 启动运行。 */
  start(input: DebuggerStartInput): Promise<{ ok: boolean; message?: string }>
  /** 语义化动作，由后端翻译成具体命令。 */
  execute(action: CppDebugAction): Promise<{ ok: boolean; message?: string }>
  /** 运行中暂停；cdb 后端 MVP 为空实现。 */
  interrupt(): Promise<void>
  /** 结束会话：优雅退出 + 2s 兜底 kill。 */
  dispose(): Promise<void>
  /** 会话是否已关闭（进程退出/被 kill）。 */
  isClosed(): boolean
}

/** 主进程推给 CppRunner 的事件回调。 */
export type DebuggerEventSink = (evt: CppDebugEvent) => void
