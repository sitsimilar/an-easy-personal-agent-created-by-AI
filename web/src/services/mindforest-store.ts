/**
 * 思维树林存储层：localStorage 持久化 + legacy 单树迁移 + schema 校验 +
 * 树/树林/交叉链接的领域纯函数（CRUD + 级联 + 交叉判定）。
 *
 * - 权威存储键：personal-agent.mindforest.v1（唯一读写）；
 * - legacy 键 personal-agent.mindtree.v1 仅迁移时读，迁移后保留作备份；
 * - 所有领域函数为纯函数（不直接读写 localStorage），便于单测。
 */
import type {
  CrossLink,
  CrossLinkSuggestion,
  CrossNodeRef,
  CrossPartner,
  MindForest,
  MindForestStore,
  MindTree,
  MindTreeNode,
} from '@shared/types/domain'
import { createNode, normalizeNode } from '@/components/mindtree/dimensions'

/** 树林权威存储键。 */
export const MIND_FOREST_STORAGE_KEY = 'personal-agent.mindforest.v1'

/** legacy 单树存储键（仅迁移时读）。 */
const LEGACY_MIND_TREE_KEY = 'personal-agent.mindtree.v1'

/** 非法树林数据备份键（导入覆盖前也会备份到此处）。 */
const BACKUP_KEY = `${MIND_FOREST_STORAGE_KEY}.bak`

/** 云端同步标记键：记录「本浏览器是否已与云端同步过」（区分新设备/清缓存 vs 用户主动清空）。 */
const CLOUD_SYNC_KEY = `${MIND_FOREST_STORAGE_KEY}.cloud`

let seq = 0

/** 生成 id（优先 crypto.randomUUID，老环境退化随机串）。 */
function nextId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    /* 忽略 */
  }
  seq += 1
  return `mf-${Date.now().toString(36)}-${seq}-${Math.random().toString(36).slice(2, 8)}`
}

function nowIso(): string {
  return new Date().toISOString()
}

/** 宽松 JSON.parse，任何异常返回 null。 */
function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/** 前序查找节点（含根）；未命中返回 null。 */
function findNode(root: MindTreeNode, nodeId: string): MindTreeNode | null {
  if (root.id === nodeId) return root
  for (const child of root.children) {
    const hit = findNode(child, nodeId)
    if (hit) return hit
  }
  return null
}

/** 空树林文档。 */
export function emptyForestStore(): MindForestStore {
  return { version: 1, trees: [], forests: [], crossLinks: [] }
}

/** 新建一棵思维树（根节点文本即主题 name）。 */
export function createTree(name: string): MindTree {
  const text = name.trim()
  const now = nowIso()
  return {
    id: nextId(),
    name: text,
    root: createNode(text),
    createdAt: now,
    updatedAt: now,
  }
}

/** 新建一个树林（仅引用 treeId，不拷贝树）。 */
export function createForest(name: string, treeIds: string[]): MindForest {
  const now = nowIso()
  return { id: nextId(), name: name.trim(), treeIds: [...treeIds], createdAt: now, updatedAt: now }
}

/** 树的增/改（改=更新 name 或 root）；命中 id 则替换，否则追加。 */
export function upsertTree(store: MindForestStore, tree: MindTree): MindForestStore {
  const normalized: MindTree = {
    ...tree,
    name: tree.name,
    root: normalizeNode(tree.root),
    updatedAt: nowIso(),
  }
  const idx = store.trees.findIndex((t) => t.id === tree.id)
  const trees = idx >= 0 ? store.trees.map((t) => (t.id === tree.id ? normalized : t)) : [...store.trees, normalized]
  return { ...store, trees }
}

/** 重命名树。 */
export function renameTree(store: MindForestStore, treeId: string, name: string): MindForestStore {
  const nextName = name.trim()
  let changed = false
  const trees = store.trees.map((t) => {
    if (t.id !== treeId || t.name === nextName) return t
    changed = true
    return { ...t, name: nextName, updatedAt: nowIso() }
  })
  return changed ? { ...store, trees } : store
}

/** 删除树：级联清理 forests.treeIds、该树所有 crossLinks；树林变空则删树林。 */
export function deleteTree(store: MindForestStore, treeId: string): MindForestStore {
  const trees = store.trees.filter((t) => t.id !== treeId)
  const forests = store.forests
    .map((f) =>
      f.treeIds.includes(treeId)
        ? { ...f, treeIds: f.treeIds.filter((id) => id !== treeId), updatedAt: nowIso() }
        : f,
    )
    .filter((f) => f.treeIds.length > 0)
  const crossLinks = store.crossLinks.filter((l) => l.a.treeId !== treeId && l.b.treeId !== treeId)
  return { ...store, trees, forests, crossLinks }
}

/** 将树归入树林（已存在则跳过）。 */
export function addTreeToForest(store: MindForestStore, forestId: string, treeId: string): MindForestStore {
  let changed = false
  const forests = store.forests.map((f) => {
    if (f.id !== forestId || f.treeIds.includes(treeId)) return f
    changed = true
    return { ...f, treeIds: [...f.treeIds, treeId], updatedAt: nowIso() }
  })
  return changed ? { ...store, forests } : store
}

/** 将树移出树林：级联删除该树林下引用该树的 crossLinks；树林变空则删树林。 */
export function removeTreeFromForest(store: MindForestStore, forestId: string, treeId: string): MindForestStore {
  const crossLinks = store.crossLinks.filter(
    (l) => !(l.forestId === forestId && (l.a.treeId === treeId || l.b.treeId === treeId)),
  )
  const forests = store.forests
    .map((f) =>
      f.id === forestId && f.treeIds.includes(treeId)
        ? { ...f, treeIds: f.treeIds.filter((id) => id !== treeId), updatedAt: nowIso() }
        : f,
    )
    .filter((f) => f.treeIds.length > 0)
  return { ...store, forests, crossLinks }
}

/** 重命名树林。 */
export function renameForest(store: MindForestStore, forestId: string, name: string): MindForestStore {
  const nextName = name.trim()
  let changed = false
  const forests = store.forests.map((f) => {
    if (f.id !== forestId || f.name === nextName) return f
    changed = true
    return { ...f, name: nextName, updatedAt: nowIso() }
  })
  return changed ? { ...store, forests } : store
}

/** 删除树林：只删组群与它的 crossLinks，不删树。 */
export function deleteForest(store: MindForestStore, forestId: string): MindForestStore {
  const forests = store.forests.filter((f) => f.id !== forestId)
  const crossLinks = store.crossLinks.filter((l) => l.forestId !== forestId)
  return { ...store, forests, crossLinks }
}

/** 无序端点对 key：a/b 归一排序后拼接，(x,y) 与 (y,x) 视为同一对。 */
function unorderedPairKey(a: CrossNodeRef, b: CrossNodeRef): string {
  const ka = `${a.treeId}/${a.nodeId}`
  const kb = `${b.treeId}/${b.nodeId}`
  return ka <= kb ? `${ka}↔${kb}` : `${kb}↔${ka}`
}

/** 批量加入 AI 交叉建议（status=suggested；同树林内无序对去重；跳过同树端点）。 */
export function addSuggestedCrossLinks(
  store: MindForestStore,
  forestId: string,
  sugg: CrossLinkSuggestion[],
): MindForestStore {
  const existing = new Set(
    store.crossLinks.filter((l) => l.forestId === forestId).map((l) => unorderedPairKey(l.a, l.b)),
  )
  const additions: CrossLink[] = []
  const now = nowIso()
  for (const s of sugg) {
    if (!s || s.a.treeId === s.b.treeId) continue
    const key = unorderedPairKey(s.a, s.b)
    if (existing.has(key)) continue
    existing.add(key)
    additions.push({
      id: nextId(),
      forestId,
      a: { treeId: s.a.treeId, nodeId: s.a.nodeId },
      b: { treeId: s.b.treeId, nodeId: s.b.nodeId },
      status: 'suggested',
      reason: s.reason,
      createdAt: now,
    })
  }
  return additions.length > 0 ? { ...store, crossLinks: [...store.crossLinks, ...additions] } : store
}

/** 确认交叉建议（suggested → confirmed）。 */
export function confirmCrossLink(store: MindForestStore, linkId: string): MindForestStore {
  let changed = false
  const crossLinks = store.crossLinks.map((l) => {
    if (l.id !== linkId || l.status === 'confirmed') return l
    changed = true
    return { ...l, status: 'confirmed' as const }
  })
  return changed ? { ...store, crossLinks } : store
}

/** 忽略交叉建议（删除该链接；对 confirmed 即「断开交叉」）。 */
export function ignoreCrossLink(store: MindForestStore, linkId: string): MindForestStore {
  const crossLinks = store.crossLinks.filter((l) => l.id !== linkId)
  return crossLinks.length === store.crossLinks.length ? store : { ...store, crossLinks }
}

/** 删除某节点时级联清理引用该节点的所有 crossLinks。 */
export function pruneNodeCrossLinks(store: MindForestStore, treeId: string, nodeId: string): MindForestStore {
  const crossLinks = store.crossLinks.filter(
    (l) => !((l.a.treeId === treeId && l.a.nodeId === nodeId) || (l.b.treeId === treeId && l.b.nodeId === nodeId)),
  )
  return crossLinks.length === store.crossLinks.length ? store : { ...store, crossLinks }
}

/** 过滤某树林下已确认的交叉关系。 */
export function confirmedLinksOf(store: MindForestStore, forestId: string): CrossLink[] {
  return store.crossLinks.filter((l) => l.forestId === forestId && l.status === 'confirmed')
}

/** 判定节点是否为交叉节点（仅 confirmed 生效）。 */
export function isCrossNode(
  store: MindForestStore,
  forestId: string,
  treeId: string,
  nodeId: string,
): boolean {
  return confirmedLinksOf(store, forestId).some(
    (l) =>
      (l.a.treeId === treeId && l.a.nodeId === nodeId) || (l.b.treeId === treeId && l.b.nodeId === nodeId),
  )
}

/** 取节点的伙伴列表（含树名/节点文本/理由；反查不到则跳过，双保险）。 */
export function crossPartnersOf(
  store: MindForestStore,
  forestId: string,
  treeId: string,
  nodeId: string,
): CrossPartner[] {
  const partners: CrossPartner[] = []
  for (const l of confirmedLinksOf(store, forestId)) {
    let other: CrossNodeRef | null = null
    if (l.a.treeId === treeId && l.a.nodeId === nodeId) other = l.b
    else if (l.b.treeId === treeId && l.b.nodeId === nodeId) other = l.a
    if (!other) continue
    const tree = store.trees.find((t) => t.id === other.treeId)
    if (!tree) continue
    const node = findNode(tree.root, other.nodeId)
    if (!node) continue
    partners.push({ treeId: tree.id, treeName: tree.name, nodeId: node.id, nodeText: node.text, reason: l.reason })
  }
  return partners
}

/** 某树林下全部「交叉节点键」集合（`${treeId}/${nodeId}`），供 UI 一次性构图。 */
export function crossNodeKeysOf(store: MindForestStore, forestId: string): Set<string> {
  const keys = new Set<string>()
  for (const l of confirmedLinksOf(store, forestId)) {
    keys.add(`${l.a.treeId}/${l.a.nodeId}`)
    keys.add(`${l.b.treeId}/${l.b.nodeId}`)
  }
  return keys
}

/** legacy 单树文档（解析用，容忍缺字段）。 */
interface LegacyDoc {
  id?: unknown
  topic?: unknown
  root?: unknown
  createdAt?: unknown
  updatedAt?: unknown
}

/** legacy 单树 → MindTree（topic → name；root 归一化）。 */
function migrateLegacy(input: unknown): MindTree | null {
  if (!input || typeof input !== 'object') return null
  const doc = input as LegacyDoc
  if (typeof doc.id !== 'string' || typeof doc.topic !== 'string') return null
  if (!doc.root || typeof doc.root !== 'object') return null
  const root = doc.root as Partial<MindTreeNode>
  if (typeof root.id !== 'string' || typeof root.text !== 'string') return null
  return {
    id: doc.id,
    name: doc.topic,
    root: normalizeNode(doc.root as MindTreeNode),
    createdAt: typeof doc.createdAt === 'string' ? doc.createdAt : nowIso(),
    updatedAt: typeof doc.updatedAt === 'string' ? doc.updatedAt : nowIso(),
  }
}

/**
 * 校验并归一化树林文档；任一关键结构非法返回 null（走备份+回空）。
 * - trees/forests/crossLinks 必须为数组；
 * - 过滤 forests 中不存在的 treeId；
 * - 过滤 a.treeId===b.treeId、引用已删树/节点/树林的悬挂 crossLink、非法 status。
 */
export function validateForestStore(input: unknown): MindForestStore | null {
  try {
    if (!input || typeof input !== 'object') return null
    const raw = input as Partial<MindForestStore>
    if (raw.version !== 1) return null
    if (!Array.isArray(raw.trees) || !Array.isArray(raw.forests) || !Array.isArray(raw.crossLinks)) return null

    const trees: MindTree[] = []
    for (const t of raw.trees) {
      if (!t || typeof t !== 'object') return null
      const tree = t as Partial<MindTree>
      if (typeof tree.id !== 'string' || !tree.id) return null
      if (typeof tree.name !== 'string') return null
      if (!tree.root || typeof tree.root !== 'object') return null
      const root = tree.root as Partial<MindTreeNode>
      if (typeof root.id !== 'string' || !root.id) return null
      if (typeof root.text !== 'string') return null
      trees.push({
        id: tree.id,
        name: tree.name,
        root: normalizeNode(tree.root as MindTreeNode),
        createdAt: typeof tree.createdAt === 'string' ? tree.createdAt : nowIso(),
        updatedAt: typeof tree.updatedAt === 'string' ? tree.updatedAt : nowIso(),
      })
    }

    const treeIds = new Set(trees.map((t) => t.id))

    const forests: MindForest[] = []
    for (const f of raw.forests) {
      if (!f || typeof f !== 'object') return null
      const forest = f as Partial<MindForest>
      if (typeof forest.id !== 'string' || !forest.id) return null
      if (typeof forest.name !== 'string') return null
      if (!Array.isArray(forest.treeIds)) return null
      forests.push({
        id: forest.id,
        name: forest.name,
        treeIds: forest.treeIds.filter((id): id is string => typeof id === 'string' && treeIds.has(id)),
        createdAt: typeof forest.createdAt === 'string' ? forest.createdAt : nowIso(),
        updatedAt: typeof forest.updatedAt === 'string' ? forest.updatedAt : nowIso(),
      })
    }

    const forestIds = new Set(forests.map((f) => f.id))

    const crossLinks: CrossLink[] = []
    for (const item of raw.crossLinks) {
      if (!item || typeof item !== 'object') return null
      const l = item as Partial<CrossLink>
      if (typeof l.id !== 'string' || !l.id) return null
      if (typeof l.forestId !== 'string' || !forestIds.has(l.forestId)) continue
      if (!l.a || !l.b || typeof l.a !== 'object' || typeof l.b !== 'object') continue
      const a = l.a as Partial<CrossNodeRef>
      const b = l.b as Partial<CrossNodeRef>
      const aTreeId = typeof a.treeId === 'string' ? a.treeId : null
      const aNodeId = typeof a.nodeId === 'string' ? a.nodeId : null
      const bTreeId = typeof b.treeId === 'string' ? b.treeId : null
      const bNodeId = typeof b.nodeId === 'string' ? b.nodeId : null
      if (!aTreeId || !aNodeId || !bTreeId || !bNodeId) continue
      if (aTreeId === bTreeId) continue
      if (l.status !== 'suggested' && l.status !== 'confirmed') continue
      if (!treeIds.has(aTreeId) || !treeIds.has(bTreeId)) continue
      const ta = trees.find((t) => t.id === aTreeId)
      const tb = trees.find((t) => t.id === bTreeId)
      if (!ta || !tb) continue
      if (!findNode(ta.root, aNodeId) || !findNode(tb.root, bNodeId)) continue
      crossLinks.push({
        id: l.id,
        forestId: l.forestId,
        a: { treeId: aTreeId, nodeId: aNodeId },
        b: { treeId: bTreeId, nodeId: bNodeId },
        status: l.status,
        reason: typeof l.reason === 'string' ? l.reason : undefined,
        createdAt: typeof l.createdAt === 'string' ? l.createdAt : nowIso(),
      })
    }

    return { version: 1, trees, forests, crossLinks }
  } catch {
    return null
  }
}

/** 立即持久化（写失败静默）。 */
export function saveForestStore(store: MindForestStore): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(MIND_FOREST_STORAGE_KEY, JSON.stringify(store))
  } catch {
    /* 忽略：持久化失败不阻塞交互 */
  }
}

/** 备份当前树林到 .bak 键（导入覆盖前调用；写失败静默）。 */
export function backupForestStore(store: MindForestStore): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(BACKUP_KEY, JSON.stringify(store))
  } catch {
    /* 忽略：备份失败不阻塞导入 */
  }
}

/** 是否已与云端同步过（新设备/清缓存返回 false）。 */
export function hasCloudSyncMarker(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false
    return localStorage.getItem(CLOUD_SYNC_KEY) === '1'
  } catch {
    return false
  }
}

/** 记录「本浏览器已与云端同步」（pull/push 成功后调用；写失败静默）。 */
export function setCloudSyncMarker(): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(CLOUD_SYNC_KEY, '1')
  } catch {
    /* 忽略 */
  }
}

/** 序列化树林文档为 JSON 字符串（导出用；含版本号与全部树/树林/交叉）。 */
export function serializeForestStore(store: MindForestStore): string {
  return JSON.stringify(store, null, 2)
}

/**
 * 从 JSON 字符串解析树林文档（导入用）。
 * 非法或结构不完整返回 null（由调用方提示错误，不覆盖现有数据）。
 */
export function deserializeForestStore(raw: string): MindForestStore | null {
  const parsed = safeParse(raw)
  return validateForestStore(parsed)
}

/** debounce 持久化（默认 400ms）；返回接收 store 的保存函数。 */
export function createDebouncedSaver(waitMs = 400): (store: MindForestStore) => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: MindForestStore | null = null
  const flush = (): void => {
    if (pending) saveForestStore(pending)
    pending = null
    timer = null
  }
  return (store) => {
    pending = store
    if (timer) clearTimeout(timer)
    timer = setTimeout(flush, waitMs)
  }
}

/** 加载树林：优先新键；缺失则迁移 legacy；结构非法则备份后回空（保留 legacy 备份）。 */
export function loadForestStore(): MindForestStore {
  try {
    if (typeof localStorage === 'undefined') return emptyForestStore()

    const raw = localStorage.getItem(MIND_FOREST_STORAGE_KEY)
    if (raw) {
      const valid = validateForestStore(safeParse(raw))
      if (valid) return valid
      // 非法：备份后移除，继续尝试 legacy 迁移
      localStorage.setItem(BACKUP_KEY, raw)
      localStorage.removeItem(MIND_FOREST_STORAGE_KEY)
    }

    const legacyRaw = localStorage.getItem(LEGACY_MIND_TREE_KEY)
    if (legacyRaw) {
      const migrated = migrateLegacy(safeParse(legacyRaw))
      if (migrated) {
        const store: MindForestStore = { version: 1, trees: [migrated], forests: [], crossLinks: [] }
        saveForestStore(store)
        return store
      }
    }
    return emptyForestStore()
  } catch {
    return emptyForestStore()
  }
}
