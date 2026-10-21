/**
 * 插件全局 store：插件列表 + 运行时状态（来自 registry）。
 *
 * 范式照搬 recordStore：data/loading/error + 模块级 loadSeq 竞态保护。
 */
import { create } from 'zustand'
import type { Plugin, PluginInstallInput } from '@shared/types/domain'
import { pluginService } from '@/services/pluginService'
import * as pluginRegistry from '@/plugins/registry'
import type { PluginRuntimeSnapshot } from '@/plugins/registry'
import { friendlyError } from '@/lib/unwrap'

interface PluginState {
  plugins: Plugin[]
  /** 运行时状态快照（key = pluginId，来自 registry）。 */
  runtime: Record<string, PluginRuntimeSnapshot>
  loading: boolean
  error: string | null
  load: () => Promise<void>
  restore: () => Promise<void>
  install: (input: PluginInstallInput) => Promise<Plugin>
  toggle: (id: number) => Promise<void>
  retry: (id: number) => Promise<void>
  remove: (id: number) => Promise<void>
  runTool: (pluginId: string, toolId: string) => Promise<void>
}

/** 请求序号：仅最新一次请求可写回，防旧慢请求覆盖新结果。 */
let loadSeq = 0

/** 从 registry 收集当前运行时状态快照。 */
function collectRuntime(): Record<string, PluginRuntimeSnapshot> {
  const map: Record<string, PluginRuntimeSnapshot> = {}
  for (const s of pluginRegistry.listStates()) map[s.pluginId] = s
  return map
}

export const usePluginStore = create<PluginState>((set, get) => ({
  plugins: [],
  runtime: {},
  loading: false,
  error: null,

  load: async () => {
    const seq = ++loadSeq
    set({ loading: true, error: null })
    try {
      const plugins = await pluginService.listPlugins()
      if (seq !== loadSeq) return
      set({ plugins, loading: false, runtime: collectRuntime() })
    } catch (err) {
      if (seq !== loadSeq) return
      set({ error: friendlyError(err), loading: false })
    }
  },

  /** 启动恢复（§6.3）：先拉列表，再逐个 activate enabled=true 的插件；任一失败仅标记 error，继续其余。 */
  restore: async () => {
    await get().load()
    const enabled = get().plugins.filter((p) => p.enabled)
    for (const p of enabled) {
      await pluginRegistry.activate(p)
    }
    set({ runtime: collectRuntime() })
  },

  install: async (input) => {
    const installed = await pluginService.installPlugin(input)
    // 重装后刷新运行时：先停旧实例，若仍启用则重新激活
    try {
      await pluginRegistry.deactivate(installed.pluginId)
    } catch {
      /* 运行时停用失败不阻断 */
    }
    if (installed.enabled) {
      try {
        await pluginRegistry.activate(installed)
      } catch {
        /* 激活异常由 registry 内部标记为 error */
      }
    }
    await get().load()
    return installed
  },

  toggle: async (id) => {
    const plugin = get().plugins.find((p) => p.id === id)
    if (!plugin) throw new Error('插件不存在')
    const next = !plugin.enabled
    // 持久化优先：先写库成功，再动运行时；运行时失败不影响库里的 enabled，仅以 error 状态反馈
    await pluginService.setEnabled(id, next)
    if (next) {
      await pluginRegistry.activate(plugin)
    } else {
      await pluginRegistry.deactivate(plugin.pluginId)
    }
    await get().load()
  },

  retry: async (id) => {
    const plugin = get().plugins.find((p) => p.id === id)
    if (!plugin) return
    await pluginRegistry.activate(plugin)
    set({ runtime: collectRuntime() })
  },

  remove: async (id) => {
    const plugin = get().plugins.find((p) => p.id === id)
    if (plugin) {
      try {
        await pluginRegistry.deactivate(plugin.pluginId)
      } catch {
        /* 运行时停用失败不阻断 */
      }
    }
    await pluginService.removePlugin(id)
    await get().load()
  },

  runTool: async (pluginId, toolId) => {
    await pluginRegistry.runTool(pluginId, toolId)
  },
}))
