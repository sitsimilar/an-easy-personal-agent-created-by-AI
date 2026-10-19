/**
 * 思维树林 AI 交叉建议纯函数：展平节点、构造编号清单 prompt、容错解析 LLM 输出。
 *
 * 编号规则：`t${treeIndex}-n${nodeIndex}`，客户端持 treeIndex/nodeIndex → treeId/nodeId 映射，
 * LLM 只回编号不回 id，避免 id 泄漏与幻觉 id。所有函数不得抛异常（解析函数降级为空数组）。
 */
import type { CrossLinkSuggestion, MindTree, MindTreeNode } from '@shared/types/domain'
import { parseJsonLoose } from '@shared/utils/llm'

/** 展平后的节点（带树/节点定位 + 编号索引）。 */
export interface FlatCrossNode {
  treeId: string
  nodeId: string
  label: string
  treeIndex: number
  nodeIndex: number
}

/** label 截断上限（字）。 */
const LABEL_MAX = 80

/** 节点总数上限（超出按均匀抽样）。 */
export const CROSS_NODE_LIMIT = 200

/** 前序遍历（含根）。 */
function walk(root: MindTreeNode, out: MindTreeNode[]): void {
  out.push(root)
  for (const child of root.children) walk(child, out)
}

/** 截断文本到 max 字，超出加省略号。 */
function truncate(text: string, max: number): string {
  const t = String(text ?? '')
  return t.length > max ? `${t.slice(0, max)}…` : t
}

/** 展平树林全部节点（前序，含根；按树顺序稳定编号）。 */
export function flattenForestNodes(trees: MindTree[]): FlatCrossNode[] {
  const flat: FlatCrossNode[] = []
  trees.forEach((tree, treeIndex) => {
    const nodes: MindTreeNode[] = []
    if (tree?.root) walk(tree.root, nodes)
    nodes.forEach((node, nodeIndex) => {
      flat.push({
        treeId: tree.id,
        nodeId: node.id,
        label: truncate(node.text, LABEL_MAX),
        treeIndex,
        nodeIndex,
      })
    })
  })
  return flat
}

/** 节点数超上限时按树顺序均匀抽样，返回 ≤max 条（索引仍与 trees 对齐）。 */
export function sampleNodes(nodes: FlatCrossNode[], max: number): FlatCrossNode[] {
  if (nodes.length <= max) return nodes
  const out: FlatCrossNode[] = []
  const step = nodes.length / max
  for (let i = 0; i < max; i++) {
    out.push(nodes[Math.min(nodes.length - 1, Math.floor(i * step))])
  }
  return out
}

/** 构造 LLM user 文本（编号清单）。 */
export function buildCrossUserPrompt(trees: MindTree[], nodes: FlatCrossNode[]): string {
  const byTree = new Map<number, FlatCrossNode[]>()
  for (const n of nodes) {
    const arr = byTree.get(n.treeIndex)
    if (arr) arr.push(n)
    else byTree.set(n.treeIndex, [n])
  }
  const lines: string[] = ['树林中的节点清单（编号 → 节点内容）：']
  trees.forEach((tree, i) => {
    const group = byTree.get(i)
    if (!group || group.length === 0) return
    lines.push(`t${i}: 树「${tree.name}」`)
    for (const n of group) {
      lines.push(`  t${n.treeIndex}-n${n.nodeIndex}: ${n.label}`)
    }
  })
  return lines.join('\n')
}

/** 无序端点对 key（与 store 侧一致，(x,y) 与 (y,x) 同对）。 */
function unorderedPairKey(a: FlatCrossNode, b: FlatCrossNode): string {
  const ka = `${a.treeId}/${a.nodeId}`
  const kb = `${b.treeId}/${b.nodeId}`
  return ka <= kb ? `${ka}↔${kb}` : `${kb}↔${ka}`
}

/**
 * 解析 LLM 输出为候选（容错：丢弃非法编号/同树端点/未知编号/无序对重复）。
 * 返回 {a,b,reason} 数组，任何异常降级为空数组。
 */
export function parseCrossLinkSuggestions(raw: string, nodes: FlatCrossNode[]): CrossLinkSuggestion[] {
  try {
    const byKey = new Map<string, FlatCrossNode>()
    for (const n of nodes) byKey.set(`t${n.treeIndex}-n${n.nodeIndex}`, n)

    const parsed = parseJsonLoose<Array<{ a?: unknown; b?: unknown; reason?: unknown }>>(raw)
    if (!Array.isArray(parsed)) return []

    const out: CrossLinkSuggestion[] = []
    const seen = new Set<string>()
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const aKey = typeof item.a === 'string' ? item.a : ''
      const bKey = typeof item.b === 'string' ? item.b : ''
      const a = byKey.get(aKey)
      const b = byKey.get(bKey)
      if (!a || !b) continue
      if (a.treeId === b.treeId) continue
      const pair = unorderedPairKey(a, b)
      if (seen.has(pair)) continue
      seen.add(pair)
      out.push({
        a: { treeId: a.treeId, nodeId: a.nodeId },
        b: { treeId: b.treeId, nodeId: b.nodeId },
        reason: typeof item.reason === 'string' ? item.reason.trim() : '',
      })
    }
    return out
  } catch {
    return []
  }
}
