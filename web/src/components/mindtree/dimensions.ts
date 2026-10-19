/**
 * 思维树维度元数据与节点工具（纯函数）。
 *
 * 维度固定 5 个：核心概念 / 前提与假设 / 可行性与风险 / 反面观点 / 下一步行动，
 * 与 MIND_TREE_SYSTEM_PROMPT 的 key 约定保持一致。
 *
 * 说明：单树/树林的文档级持久化已迁至 web/src/services/mindforest-store.ts；
 * 本文件仅保留节点工厂、维度元数据与归一化等可复用纯函数。
 */
import type { MindTreeDimension, MindTreeDimensionKey, MindTreeNode } from '@shared/types/domain'
import type { Theme } from '@mui/material'

/** 维度元数据：展示名 + 主题色路径（由 dimensionColor 从 theme 解析实际色值）。 */
export interface DimensionMeta {
  label: string
  /** 主题色路径，如 'primary.main'。 */
  colorPath: string
}

/** 5 个维度的元数据（固定顺序即分支窗口排列顺序）。 */
export const DIMENSION_META: Record<MindTreeDimensionKey, DimensionMeta> = {
  concept: { label: '核心概念', colorPath: 'primary.main' },
  premise: { label: '前提与假设', colorPath: 'info.main' },
  feasibility: { label: '可行性与风险', colorPath: 'success.main' },
  counter: { label: '反面观点', colorPath: 'error.main' },
  action: { label: '下一步行动', colorPath: 'warning.main' },
}

/** 维度 key 顺序（分支窗口固定排列）。 */
export const DIMENSION_ORDER: MindTreeDimensionKey[] = [
  'concept',
  'premise',
  'feasibility',
  'counter',
  'action',
]

/** 解析维度主题色（从 theme 取实际色值；未知 key 回落 divider）。 */
export function dimensionColor(key: string, theme: Theme): string {
  switch (key) {
    case 'concept':
      return theme.palette.primary.main
    case 'premise':
      return theme.palette.info.main
    case 'feasibility':
      return theme.palette.success.main
    case 'counter':
      return theme.palette.error.main
    case 'action':
      return theme.palette.warning.main
    default:
      return theme.palette.divider
  }
}

/** 维度展示名（优先内置元数据，缺失时回退 AI 返回 label，再回退 key 本身）。 */
export function dimensionLabel(key: string, fallback?: string): string {
  const meta = DIMENSION_META[key as MindTreeDimensionKey]
  if (meta) return meta.label
  if (fallback && fallback.trim()) return fallback.trim()
  return key
}

/** AI 失败时的内置引导模板：5 个维度各 3 条引导问题，主题自然嵌入文案。 */
export function fallbackDimensions(topic: string): MindTreeDimension[] {
  const t = topic.trim() || '这个主题'
  return [
    {
      key: 'concept',
      label: DIMENSION_META.concept.label,
      questions: [
        `「${t}」的核心概念有哪些？逐一解释`,
        '这些概念之间是什么关系？',
        '哪个概念最关键，为什么？',
      ],
    },
    {
      key: 'premise',
      label: DIMENSION_META.premise.label,
      questions: [
        `思考「${t}」时，隐含了哪些未明说的前提？`,
        '哪些假设还未经验证？如何验证？',
        '如果前提不成立，结论会怎样变化？',
      ],
    },
    {
      key: 'feasibility',
      label: DIMENSION_META.feasibility.label,
      questions: [
        `推进「${t}」需要哪些资源与时间？`,
        '最大的风险是什么，如何规避？',
        '有没有更轻量的验证方式？',
      ],
    },
    {
      key: 'counter',
      label: DIMENSION_META.counter.label,
      questions: [
        `反对「${t}」的最强理由是什么？`,
        '什么情况下这会彻底失败？',
        '有哪些反面证据被忽略了？',
      ],
    },
    {
      key: 'action',
      label: DIMENSION_META.action.label,
      questions: [
        `关于「${t}」，下一步能做的第一件事是什么？`,
        '如何用最小成本验证方向？',
        '本周可以完成哪一小步？',
      ],
    },
  ]
}

/** 压感归一化：有限且 >0 时 clamp 到 [0.05,1]，否则取默认 0.5。 */
export function normalizePressure(p: number): number {
  if (!Number.isFinite(p) || p <= 0) return 0.5
  return Math.min(1, Math.max(0.05, p))
}

/** 笔迹线宽：1 + pressure * 4（约 1~5px）。 */
export function strokeWidth(pressure: number): number {
  return 1 + pressure * 4
}

let nodeSeq = 0

/** 生成节点 id（优先 crypto.randomUUID，老环境退化为随机串）。 */
function nextId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    /* 忽略 */
  }
  nodeSeq += 1
  return `mt-${Date.now().toString(36)}-${nodeSeq}-${Math.random().toString(36).slice(2, 8)}`
}

/** 创建思维树节点。 */
export function createNode(text: string, dimension?: string): MindTreeNode {
  return {
    id: nextId(),
    text,
    dimension,
    collapsed: false,
    loading: false,
    children: [],
  }
}

/** 递归归一化节点：children 必须为数组、loading 复位为 false（持久化瞬间的生成中状态不恢复）。 */
export function normalizeNode(node: MindTreeNode): MindTreeNode {
  const children = Array.isArray(node.children) ? node.children.map(normalizeNode) : []
  return {
    ...node,
    children,
    collapsed: node.collapsed === true,
    loading: false,
  }
}
