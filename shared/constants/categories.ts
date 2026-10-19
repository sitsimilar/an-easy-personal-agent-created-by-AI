/**
 * 预置分类标签与标签色板。
 */

export interface CategoryOption {
  key: string
  label: string
  color: string
}

/** 预置分类（可被 LLM 自动分类命中，也允许用户手动选择）。 */
export const PRESET_CATEGORIES: CategoryOption[] = [
  { key: '技术/AI', label: '技术/AI', color: '#6366f1' },
  { key: '技术/后端', label: '技术/后端', color: '#0ea5e9' },
  { key: '技术/前端', label: '技术/前端', color: '#f59e0b' },
  { key: '技术/架构', label: '技术/架构', color: '#8b5cf6' },
  { key: '工作/会议', label: '工作/会议', color: '#10b981' },
  { key: '工作/项目', label: '工作/项目', color: '#14b8a6' },
  { key: '学习/阅读', label: '学习/阅读', color: '#f43f5e' },
  { key: '学习/笔记', label: '学习/笔记', color: '#ec4899' },
  { key: '生活/日常', label: '生活/日常', color: '#f97316' },
  { key: '生活/健康', label: '生活/健康', color: '#84cc16' },
  { key: '其他', label: '其他', color: '#94a3b8' },
]

const TAG_COLOR_PALETTE = [
  '#6366f1',
  '#0ea5e9',
  '#f59e0b',
  '#10b981',
  '#f43f5e',
  '#8b5cf6',
  '#14b8a6',
  '#ec4899',
  '#f97316',
  '#84cc16',
]

/** 根据分类名返回稳定颜色。 */
export function categoryColor(category?: string | null): string {
  if (!category) return '#94a3b8'
  const found = PRESET_CATEGORIES.find((c) => c.key === category)
  return found ? found.color : '#94a3b8'
}

/** 根据标签文本返回稳定颜色（无则按哈希取色）。 */
export function tagColor(tag: string): string {
  let hash = 0
  for (let i = 0; i < tag.length; i++) {
    hash = (hash * 31 + tag.charCodeAt(i)) >>> 0
  }
  return TAG_COLOR_PALETTE[hash % TAG_COLOR_PALETTE.length]
}

/** 预置分类 key 列表。 */
export const PRESET_CATEGORY_KEYS = PRESET_CATEGORIES.map((c) => c.key)
