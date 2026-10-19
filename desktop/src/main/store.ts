import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFile, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * 本地偏好持久化（等价 electron-store 的 JSON 文件存储）。
 *
 * 说明：为避免 electron-store（ESM-only）与 Electron 主进程 CJS 打包的兼容风险，
 * 采用 Node 内置 fs 实现同语义的 JSON 持久化，存于 userData 目录。
 * 仅保存纯本地偏好与增量 hash 缓存，不联网、不存敏感凭证。
 */
export interface LocalStoreSchema {
  vsPath: string
  codeUploadEnabled: boolean
  floatWindowEnabled: boolean
  notifyEnabled: boolean
  listening: boolean
  collapsed: boolean
  floatPosition: { x?: number; y?: number; width?: number; height?: number }
  /** 主窗口未最大化时的位置与尺寸（关闭时防抖保存） */
  mainWindowPosition: { x?: number; y?: number; width?: number; height?: number }
  /** 主窗口是否处于最大化态 */
  mainWindowMaximized: boolean
  /** 悬浮窗无交互自动收起开关（默认 true） */
  autoCollapseEnabled: boolean
  /** 选区分析全局快捷键（P1 可配） */
  selectionShortcut: string
  /** 自定义分析导出目录（空 = 默认 %LOCALAPPDATA%\PersonalAgent） */
  exportDir: string
  /** 一键部署的 MinGW 工具链目录（空 = 未部署） */
  toolchainDir: string
  /** solutionPath → (fileRelPath → sha256) 增量缓存（最近 50 个方案，见 analysis-orchestrator） */
  cache: Record<string, Record<string, string>>
}

const DEFAULTS: LocalStoreSchema = {
  vsPath: '',
  codeUploadEnabled: true,
  floatWindowEnabled: true,
  notifyEnabled: true,
  listening: true,
  collapsed: false,
  floatPosition: {},
  mainWindowPosition: {},
  mainWindowMaximized: false,
  autoCollapseEnabled: true,
  selectionShortcut: 'CommandOrControl+Shift+A',
  exportDir: '',
  toolchainDir: '',
  cache: {},
}

/** 写盘防抖间隔（ms）。 */
const PERSIST_DEBOUNCE_MS = 300

export class JsonStore {
  private data: LocalStoreSchema
  private filePath: string
  private persistTimer: ReturnType<typeof setTimeout> | null = null

  constructor() {
    const dir = app.getPath('userData')
    this.filePath = join(dir, 'preferences.json')
    this.data = this.load()
  }

  private load(): LocalStoreSchema {
    try {
      if (!existsSync(this.filePath)) return { ...DEFAULTS }
      const raw = readFileSync(this.filePath, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<LocalStoreSchema>
      return {
        ...DEFAULTS,
        ...parsed,
        cache: parsed.cache ?? {},
        floatPosition: parsed.floatPosition ?? {},
        mainWindowPosition: parsed.mainWindowPosition ?? {},
      }
    } catch {
      return { ...DEFAULTS }
    }
  }

  /** 异步/同步写盘；失败静默（不阻塞主流程）。 */
  private write(sync: boolean): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true })
      const payload = JSON.stringify(this.data, null, 2)
      if (sync) {
        writeFileSync(this.filePath, payload, 'utf-8')
      } else {
        void writeFile(this.filePath, payload, 'utf-8', () => undefined)
      }
    } catch {
      /* 写盘失败不阻塞主流程 */
    }
  }

  /** 防抖持久化（300ms），高频 set/patch 只落盘最后一次。 */
  private persist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer)
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      this.write(false)
    }, PERSIST_DEBOUNCE_MS)
  }

  /** 退出前同步 flush 尚未落盘的变更。 */
  flushSync(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
    }
    this.write(true)
  }

  get<K extends keyof LocalStoreSchema>(key: K): LocalStoreSchema[K] {
    return this.data[key]
  }

  set<K extends keyof LocalStoreSchema>(key: K, value: LocalStoreSchema[K]): void {
    this.data[key] = value
    this.persist()
  }

  /** 合并更新局部字段。 */
  patch(patch: Partial<LocalStoreSchema>): void {
    this.data = { ...this.data, ...patch }
    this.persist()
  }
}

export const store = new JsonStore()
