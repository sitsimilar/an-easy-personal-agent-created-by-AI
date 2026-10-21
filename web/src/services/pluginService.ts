/**
 * 插件数据访问层：插件元数据（plugins 表）+ 代码包（云 storage）。
 *
 * - 元数据走 cloud.database.from('plugins')，列 snake_case，领域类型 camelCase；
 * - 代码包存 cloud.storage.userPath(ownerId, 'plugins/<pluginId>/<version>/index.js')，
 *   元数据与代码通过 entry_path 关联；
 * - 安装失败回滚已上传对象，避免孤儿 storage 对象（参照 imageService 回滚模式）。
 */
import { cloud } from '@/lib/cloud'
import { unwrap } from '@/lib/unwrap'
import type { PluginsRow } from '@/lib/database.types'
import type { Plugin, PluginInstallInput } from '@shared/types/domain'
import { authService } from './authService'
import { storageService } from './storageService'

/** 单插件代码包大小上限（1MB）。 */
export const MAX_PLUGIN_PACKAGE_SIZE = 1 * 1024 * 1024

/** 单用户插件数量上限。 */
export const MAX_PLUGINS_PER_USER = 50

/** 数据库行（snake_case）→ 领域类型（camelCase）。 */
export function mapPlugin(row: PluginsRow): Plugin {
  return {
    id: row.id,
    pluginId: row.plugin_id,
    name: row.name,
    version: row.version,
    description: row.description,
    author: row.author,
    repoUrl: row.repo_url,
    permissions: Array.isArray(row.permissions) ? row.permissions : [],
    entryPath: row.entry_path,
    enabled: row.enabled,
    installedAt: row.installed_at,
    updatedAt: row.updated_at,
  }
}

/** 领域入参 → snake_case 数据库字段（不含 owner_id / entry_path / enabled）。 */
function toSnake(input: PluginInstallInput): Record<string, unknown> {
  return {
    plugin_id: input.pluginId,
    name: input.name,
    version: input.version,
    description: input.description,
    author: input.author ?? null,
    repo_url: input.repoUrl ?? null,
    permissions: Array.isArray(input.permissions) ? input.permissions : [],
  }
}

export const pluginService = {
  /** 已安装插件列表（按安装时间倒序）。 */
  async listPlugins(): Promise<Plugin[]> {
    const { data, error } = await cloud.database
      .from('plugins')
      .select('*')
      .order('installed_at', { ascending: false })
    return ((unwrap({ data, error }) as PluginsRow[] | null) ?? []).map(mapPlugin)
  },

  /** 按 plugin_id 查询（不存在返回 null）。 */
  async getPluginByPluginId(pluginId: string): Promise<Plugin | null> {
    const { data, error } = await cloud.database
      .from('plugins')
      .select('*')
      .eq('plugin_id', pluginId)
      .maybeSingle()
    const row = unwrap({ data, error }) as PluginsRow | null
    return row ? mapPlugin(row) : null
  },

  /** 单条（不存在返回 null）。 */
  async getPlugin(id: number): Promise<Plugin | null> {
    const { data, error } = await cloud.database
      .from('plugins')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    const row = unwrap({ data, error }) as PluginsRow | null
    return row ? mapPlugin(row) : null
  },

  /**
   * 安装 / 重装插件：
   * 1. 校验单包 ≤ 1MB、单用户插件数 ≤ 50；
   * 2. 上传代码包到 userPath(ownerId, 'plugins/<id>/<version>/index.js')；
   * 3. 写库（新装 insert；重装 update 行 + 清理旧版本对象）；
   * 4. 任一步失败回滚清理已上传的新对象。
   */
  async installPlugin(input: PluginInstallInput): Promise<Plugin> {
    const blob = new Blob([input.sourceCode], { type: 'text/javascript' })
    if (blob.size > MAX_PLUGIN_PACKAGE_SIZE) {
      throw new Error('插件代码包不能超过 1MB')
    }

    const session = await authService.getSession()
    const ownerId = session?.user?.id
    if (!ownerId) throw new Error('请先登录')

    const entryPath = cloud.storage.userPath(ownerId, `plugins/${input.pluginId}/${input.version}/index.js`)

    const existing = await pluginService.getPluginByPluginId(input.pluginId)
    if (!existing) {
      const plugins = await pluginService.listPlugins()
      if (plugins.length >= MAX_PLUGINS_PER_USER) {
        throw new Error(`插件数量已达上限（${MAX_PLUGINS_PER_USER} 个），请先卸载部分插件`)
      }
    }

    // 仅当上传的是「新对象」（非覆盖已有同路径对象）时，失败才需要清理该对象
    const overwritesExisting = !!existing && existing.entryPath === entryPath
    const uploadedPaths: string[] = overwritesExisting ? [] : [entryPath]

    try {
      unwrap(await cloud.storage.upload(entryPath, blob, { contentType: 'text/javascript' }))

      if (existing) {
        // 重装 = 覆盖更新：回填新 entry_path；若换版本路径则删除旧对象
        const { data, error } = await cloud.database
          .from('plugins')
          .update({ ...toSnake(input), entry_path: entryPath })
          .eq('id', existing.id)
          .select()
        const rows = unwrap({ data, error }) as PluginsRow[] | null
        if (!rows || rows.length === 0) throw new Error('更新插件失败')
        if (existing.entryPath && existing.entryPath !== entryPath) {
          try {
            await cloud.storage.remove([existing.entryPath])
          } catch {
            /* 旧对象清理失败不阻断主流程 */
          }
        }
        return mapPlugin(rows[0])
      }

      // 新装：owner_id 由数据库 DEFAULT auth.uid() 填充，前端不发送
      const { data, error } = await cloud.database
        .from('plugins')
        .insert({ ...toSnake(input), entry_path: entryPath, enabled: false })
        .select()
      const rows = unwrap({ data, error }) as PluginsRow[] | null
      if (!rows || rows.length === 0) throw new Error('安装插件失败')
      return mapPlugin(rows[0])
    } catch (err) {
      // 失败回滚：清理已上传的新对象（避免孤儿 storage 对象）
      if (uploadedPaths.length > 0) {
        try {
          await cloud.storage.remove(uploadedPaths)
        } catch {
          /* 对象清理失败不阻断主流程 */
        }
      }
      throw err
    }
  },

  /** 启停（持久化 enabled）。 */
  async setEnabled(id: number, enabled: boolean): Promise<Plugin> {
    const { data, error } = await cloud.database
      .from('plugins')
      .update({ enabled })
      .eq('id', id)
      .select()
    const rows = unwrap({ data, error }) as PluginsRow[] | null
    if (!rows || rows.length === 0) throw new Error('无权限或插件不存在')
    return mapPlugin(rows[0])
  },

  /** 卸载：删库 + 删 storage 对象（对象删除失败不阻断，避免留下指向已删对象的脏记录）。 */
  async removePlugin(id: number): Promise<void> {
    const existing = await pluginService.getPlugin(id)
    unwrap(await cloud.database.from('plugins').delete().eq('id', id).select())
    if (existing?.entryPath) {
      try {
        await cloud.storage.remove([existing.entryPath])
      } catch {
        /* 对象删除失败不阻断（记录已删） */
      }
    }
  },

  /** 获取代码包签名下载地址（复用 storageService）。 */
  async getSignedUrl(path: string): Promise<string> {
    return storageService.getSignedUrl(path)
  },
}
