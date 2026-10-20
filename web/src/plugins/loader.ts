/**
 * 运行时加载器（docs/PLUGIN-DESIGN.md §4.1）。
 *
 * download(entry_path) → Blob → 源码字符串 → Blob URL → 动态 import。
 * Blob URL 无法解析相对 import，因此插件必须是单文件自包含 ESM。
 */
import { cloud } from '@/lib/cloud'
import { unwrap } from '@/lib/unwrap'
import type { PluginModule } from './types'

export interface LoadedPlugin {
  mod: PluginModule
  /** 释放 Blob URL（防止内存泄漏）。 */
  cleanup: () => void
}

/** 下载入口代码包并动态 import（Blob URL）。 */
export async function loadPlugin(entryPath: string): Promise<LoadedPlugin> {
  const result = await cloud.storage.download(entryPath)
  const blob = unwrap(result)
  const code = await blob.text()
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
  try {
    const mod = (await import(/* @vite-ignore */ url)) as PluginModule
    return { mod, cleanup: () => URL.revokeObjectURL(url) }
  } catch (err) {
    URL.revokeObjectURL(url)
    throw err
  }
}
