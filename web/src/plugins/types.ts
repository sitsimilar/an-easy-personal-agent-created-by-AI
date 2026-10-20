/**
 * 插件运行时类型定义（MVP）。
 *
 * 契约来源：docs/PLUGIN-DESIGN.md §3.2 / §5。
 */

/** 插件运行时状态机。 */
export type PluginRuntimeState = 'idle' | 'loading' | 'running' | 'error'

/** 插件 manifest（plugin.json）。 */
export interface PluginManifest {
  id: string
  name: string
  version: string
  description?: string
  author?: string
  /** 入口文件相对路径，缺省 dist/index.js。 */
  entry?: string
  /** 权限声明 token 数组。 */
  permissions?: string[]
}

/** 插件注册的「工具入口」，展示在插件页并可点击执行。 */
export interface PluginTool {
  id: string
  label: string
  description?: string
  run: () => void | Promise<void>
}

/**
 * 受控插件上下文：只暴露已授权能力。
 * 安全底线：绝不含 cloud / authService / recordService 等内部对象。
 */
export interface PluginContext {
  /** 插件自身元信息。 */
  meta: { id: string; name: string; version: string }
  /** 日志（写 console，MVP 不落库）。 */
  log: (level: 'info' | 'warn' | 'error', ...args: unknown[]) => void
  /** 注册一个「工具入口」。 */
  registerTool: (tool: PluginTool) => void
  /** 插件私有持久化（localStorage 前缀 plugin:<id>: 隔离），需 storage 权限。 */
  storage: {
    get(key: string): string | null
    set(key: string, value: string): void
    remove(key: string): void
  }
  /** 受控 fetch（需 network 权限；仍受浏览器 CORS 限制）。 */
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
}

/** 插件入口模块导出契约（生命周期钩子均可选）。 */
export interface PluginModule {
  activate?: (ctx: PluginContext) => void | Promise<void>
  deactivate?: () => void | Promise<void>
}
