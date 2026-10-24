/**
 * 思维树林云端同步服务：本地 localStorage 缓存 + 登录后云端同步（mind_trees 表）。
 *
 * - 云端每用户一行（owner_id 唯一），`payload` JSONB 存整份树林文档（MindForestStore）；
 * - pull：拉取并校验云端文档，返回合法树林或 null（无行 / 数据损坏）；
 * - push：按行 id 更新（无则插入），写回整份文档；
 * - mergeForestStores：纯函数「最近写入优先」合并，配合本地同步标记区分
 *   「新设备 / 清缓存（本地空 → 取云端）」与「用户主动清空（本地空 → 推空覆盖云端）」。
 */
import { cloud } from '@/lib/cloud'
import { unwrap } from '@/lib/unwrap'
import type { MindTreesRow } from '@/lib/database.types'
import type { MindForestStore } from '@shared/types/domain'
import { validateForestStore } from './mindforest-store'

/** 合并结果来源。 */
export type MergeSource = 'local' | 'cloud'

/** 判断树林文档是否为空（无树、无树林、无交叉链接）。 */
export function isEmptyForestStore(store: MindForestStore): boolean {
  return store.trees.length === 0 && store.forests.length === 0 && store.crossLinks.length === 0
}

/** 文档最近更新时间（取树/树林 updatedAt 与交叉链接 createdAt 的最大值；空文档返回 ''）。 */
export function latestUpdatedAt(store: MindForestStore): string {
  let latest = ''
  for (const t of store.trees) if (t.updatedAt > latest) latest = t.updatedAt
  for (const f of store.forests) if (f.updatedAt > latest) latest = f.updatedAt
  for (const l of store.crossLinks) if (l.createdAt > latest) latest = l.createdAt
  return latest
}

/**
 * 合并本地与云端文档（纯函数，无副作用）。
 *
 * 规则：
 * - 云端空、本地非空 → 本地（推云）；
 * - 本地空、云端非空：本浏览器从未同步（新设备 / 清缓存）→ 云端；否则视为用户主动清空 → 本地（推空，避免云端复活已删数据）；
 * - 双方非空 → 最近写入优先（内部 updatedAt 比较）；平局或不可比较偏本地（避免覆盖用户当前会话）。
 */
export function mergeForestStores(
  local: MindForestStore,
  cloud: MindForestStore,
  localHasSynced: boolean,
): { store: MindForestStore; source: MergeSource } {
  const localEmpty = isEmptyForestStore(local)
  const cloudEmpty = isEmptyForestStore(cloud)

  if (cloudEmpty && !localEmpty) return { store: local, source: 'local' }
  if (localEmpty && !cloudEmpty) {
    return localHasSynced ? { store: local, source: 'local' } : { store: cloud, source: 'cloud' }
  }
  if (localEmpty && cloudEmpty) return { store: local, source: 'local' }

  const localLatest = latestUpdatedAt(local)
  const cloudLatest = latestUpdatedAt(cloud)
  if (cloudLatest && cloudLatest > localLatest) return { store: cloud, source: 'cloud' }
  return { store: local, source: 'local' }
}

/** 取当前用户云端树林行（无则 null）。 */
async function getRow(): Promise<MindTreesRow | null> {
  const row = unwrap(
    await cloud.database.from('mind_trees').select('*').limit(1).maybeSingle(),
  ) as MindTreesRow | null
  return row
}

export const mindforestCloud = {
  /** 拉取云端树林文档；无行或数据损坏返回 null（调用方按「云端无数据」处理）。 */
  async pull(): Promise<MindForestStore | null> {
    const row = await getRow()
    if (!row) return null
    return validateForestStore(row.payload)
  },

  /**
   * 推送本地树林文档到云端（每用户一行：有则按 id 更新，无则插入）。
   * owner_id 由数据库 DEFAULT auth.uid() 填充，前端不发送；失败抛错由调用方决定是否静默。
   */
  async push(store: MindForestStore): Promise<void> {
    const payload = store as unknown
    const row = await getRow()
    if (row) {
      unwrap(
        await cloud.database
          .from('mind_trees')
          .update({ payload, updated_at: new Date().toISOString() })
          .eq('id', row.id)
          .select(),
      )
      return
    }
    unwrap(await cloud.database.from('mind_trees').insert({ payload }).select())
  },
}
