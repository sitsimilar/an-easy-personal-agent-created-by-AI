/**
 * 多插件运行时注册表（docs/PLUGIN-DESIGN.md §4.2）。
 *
 * 状态机：idle →(enable)→ loading →(activate 成功)→ running
 *                             └(activate 抛异常)→ error（可停用/重试）
 *        running →(disable)→ idle（deactivate + revoke Blob URL）
 *        error   →(disable)→ idle
 *
 * 每个插件一个实例，activate/deactivate 均 try/catch 隔离，异常只影响本实例。
 */
import type { Plugin } from '@shared/types/domain'
import { friendlyError } from '@/lib/unwrap'
import { buildContext } from './permissions'
import { loadPlugin, type LoadedPlugin } from './loader'
import type { PluginContext, PluginRuntimeState, PluginTool } from './types'

export interface PluginRuntimeSnapshot {
  pluginId: string
  state: PluginRuntimeState
  error: string | null
  tools: PluginTool[]
}

interface PluginInstance {
  plugin: Plugin
  loaded: LoadedPlugin | null
  ctx: PluginContext | null
  state: PluginRuntimeState
  error: string | null
  tools: PluginTool[]
}

const instances = new Map<string, PluginInstance>()

/** 激活插件：download → import → activate(ctx)；异常只影响本实例。 */
export async function activate(plugin: Plugin): Promise<void> {
  const existing = instances.get(plugin.pluginId)
  if (existing && existing.state === 'running') {
    // 幂等：已在运行则跳过，避免重复 import/activate
    return
  }

  const inst: PluginInstance = existing ?? {
    plugin,
    loaded: null,
    ctx: null,
    state: 'idle',
    error: null,
    tools: [],
  }
  inst.plugin = plugin
  inst.state = 'loading'
  inst.error = null
  inst.tools = []
  instances.set(plugin.pluginId, inst)

  try {
    const loaded = await loadPlugin(plugin.entryPath)
    inst.loaded = loaded

    const ctx = buildContext(
      {
        id: plugin.pluginId,
        name: plugin.name,
        version: plugin.version,
        permissions: plugin.permissions,
      },
      { registerTool: (tool) => { inst.tools.push(tool) } },
    )
    inst.ctx = ctx

    await loaded.mod.activate?.(ctx)
    inst.state = 'running'
  } catch (err) {
    inst.state = 'error'
    inst.error = friendlyError(err)
    inst.ctx = null
    try {
      inst.loaded?.cleanup()
    } catch {
      /* 清理失败不阻断 */
    }
    inst.loaded = null
  }
}

/** 停用插件：deactivate + revoke Blob URL。 */
export async function deactivate(pluginId: string): Promise<void> {
  const inst = instances.get(pluginId)
  if (!inst) return
  try {
    await inst.loaded?.mod.deactivate?.()
  } catch (err) {
    console.error(`[plugin:${pluginId}] deactivate 异常`, err)
  } finally {
    try {
      inst.loaded?.cleanup()
    } catch {
      /* 清理失败不阻断 */
    }
    inst.loaded = null
    inst.ctx = null
    inst.tools = []
    inst.state = 'idle'
    inst.error = null
  }
}

/** 获取单个插件运行时状态（未加载返回 null）。 */
export function getState(pluginId: string): PluginRuntimeSnapshot | null {
  const inst = instances.get(pluginId)
  if (!inst) return null
  return { pluginId: inst.plugin.pluginId, state: inst.state, error: inst.error, tools: inst.tools }
}

/** 列出全部已加载插件的运行时状态。 */
export function listStates(): PluginRuntimeSnapshot[] {
  return Array.from(instances.values()).map((inst) => ({
    pluginId: inst.plugin.pluginId,
    state: inst.state,
    error: inst.error,
    tools: inst.tools,
  }))
}

/** 执行插件工具入口：run 抛异常时捕获并 log，再上抛给 UI 提示。 */
export async function runTool(pluginId: string, toolId: string): Promise<void> {
  const inst = instances.get(pluginId)
  const tool = inst?.tools.find((t) => t.id === toolId)
  if (!tool) throw new Error('工具不存在或插件未启用')
  try {
    await tool.run()
  } catch (err) {
    console.error(`[plugin:${pluginId}] 工具 ${toolId} 执行失败`, err)
    throw err
  }
}
