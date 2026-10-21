/**
 * 权限白名单与受控 ctx 构造（docs/PLUGIN-DESIGN.md §5）。
 *
 * 未知 token 在安装时提示并剔除（不阻断）；无对应权限时注入抛错占位。
 */
import type { PluginContext, PluginManifest } from './types'

/** 已知权限 token 白名单（粗粒度）。 */
export const KNOWN_PERMISSIONS = ['storage', 'network'] as const

export type KnownPermission = (typeof KNOWN_PERMISSIONS)[number]

/** 判断 manifest 是否声明了某权限。 */
export function hasPermission(manifest: PluginManifest, token: KnownPermission): boolean {
  return Array.isArray(manifest.permissions) && manifest.permissions.includes(token)
}

/** 剔除未知权限 token，返回保留项与被剔除项。 */
export function filterPermissions(
  list: string[] | undefined | null,
): { kept: string[]; removed: string[] } {
  const src = Array.isArray(list) ? list : []
  const kept: string[] = []
  const removed: string[] = []
  for (const raw of src) {
    const token = typeof raw === 'string' ? raw.trim() : ''
    if (token && (KNOWN_PERMISSIONS as readonly string[]).includes(token)) {
      kept.push(token)
    } else {
      removed.push(raw)
    }
  }
  return { kept, removed }
}

/** localStorage 键（前缀 plugin:<id>: 隔离，避免插件间读写串扰）。 */
function storageKey(pluginId: string, key: string): string {
  return `plugin:${pluginId}:${key}`
}

/**
 * 构造受控 ctx：按权限注入 storage / fetch；无对应权限时注入抛错占位。
 * ctx 不含任何内部对象（cloud / authService / recordService 等）。
 */
export function buildContext(
  manifest: PluginManifest,
  deps: { registerTool: PluginContext['registerTool'] },
): PluginContext {
  const meta = { id: manifest.id, name: manifest.name, version: manifest.version }

  const log: PluginContext['log'] = (level, ...args) => {
    const prefix = `[plugin:${manifest.id}]`
    if (level === 'error') console.error(prefix, ...args)
    else if (level === 'warn') console.warn(prefix, ...args)
    else console.info(prefix, ...args)
  }

  const storage: PluginContext['storage'] = hasPermission(manifest, 'storage')
    ? {
        get: (key) => localStorage.getItem(storageKey(manifest.id, key)),
        set: (key, value) => {
          localStorage.setItem(storageKey(manifest.id, key), value)
        },
        remove: (key) => {
          localStorage.removeItem(storageKey(manifest.id, key))
        },
      }
    : {
        get: () => {
          throw new Error(`插件「${manifest.name}」未授权 storage 权限`)
        },
        set: () => {
          throw new Error(`插件「${manifest.name}」未授权 storage 权限`)
        },
        remove: () => {
          throw new Error(`插件「${manifest.name}」未授权 storage 权限`)
        },
      }

  const fetchImpl: PluginContext['fetch'] = hasPermission(manifest, 'network')
    ? (input, init) => fetch(input, init)
    : () => {
        throw new Error(`插件「${manifest.name}」未授权 network 权限`)
      }

  return { meta, log, registerTool: deps.registerTool, storage, fetch: fetchImpl }
}
