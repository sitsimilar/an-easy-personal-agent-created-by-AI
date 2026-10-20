/**
 * 领域类型（跨端共享，唯一事实来源）。
 *
 * 注意：领域类型使用 camelCase，而云数据库列使用 snake_case，
 * 二者在 web/src/services/* 中进行映射转换。
 */

export type RecordType = 'idea' | 'material' | 'todo'
export type TodoStatus = 'pending' | 'done'
export type Priority = 'high' | 'medium' | 'low'

/** 信息记录主表（统一存放想法/资料/待办）。 */
export interface InfoRecord {
  id: number
  type: RecordType
  title: string
  content: string
  url?: string | null
  /** 云存储对象路径。 */
  filePath?: string | null
  category?: string | null
  tags: string[]
  summary?: string | null
  todoStatus?: TodoStatus | null
  priority?: Priority | null
  remindAt?: string | null
  isDeleted: boolean
  deletedAt?: string | null
  createdAt: string
  updatedAt: string
}

/** 智能关联（记录 ↔ 记录）。 */
export interface RecordLink {
  id: number
  sourceId: number
  targetId: number
  score: number
  reason?: string | null
}

/** 代码分析问题条目。 */
export interface CodeIssue {
  severity: 'error' | 'warning' | 'suggestion'
  title: string
  description: string
  suggestion: string
  /** 大白话版标题（面向普通用户，与 title 内容一致、仅表达风格不同）。 */
  titlePlain?: string
  /** 大白话版描述。 */
  descriptionPlain?: string
  /** 大白话版建议。 */
  suggestionPlain?: string
  file?: string
  line?: number
}

/** 用户设置（云端共享，跨端一致）。 */
export interface UserSettings {
  vsPath?: string | null
  codeUploadEnabled: boolean
  floatWindowEnabled: boolean
  floatPosition?: unknown
  notifyEnabled: boolean
}

/** 新建记录入参。 */
export interface RecordCreateInput {
  type: RecordType
  title?: string
  content?: string
  url?: string | null
  filePath?: string | null
  category?: string | null
  tags?: string[]
  todoStatus?: TodoStatus | null
  priority?: Priority | null
  remindAt?: string | null
}

/** 记录列表筛选条件。 */
export interface RecordListFilter {
  type?: RecordType
  category?: string
  keyword?: string
  page?: number
  pageSize?: number
  /** 默认查询未删除记录；回收站传 true。 */
  isDeleted?: boolean
}

/** 记录分页结果。 */
export interface RecordListResult {
  records: InfoRecord[]
  total: number
}

/** 关联打分结果（LLM 输出）。 */
export interface RelateResultItem {
  targetId: number
  score: number
  reason?: string
}

/** 选区分析问题类别。 */
export type SelectionIssueCategory = 'syntax' | 'defect' | 'style'

/** 选区分析问题条目。 */
export interface SelectionIssue {
  category: SelectionIssueCategory
  title: string
  description: string
  suggestion: string
  line?: number
  snippet?: string
}

/** 选区分析结果。 */
export interface SelectionAnalysisResult {
  summary: string
  issues: SelectionIssue[]
}

/** 后续行动建议项（R-16）。 */
export interface ActionItem {
  title: string
  detail?: string
  priority?: Priority
}

/** 阶段回顾结果（R-15 + R-16 合并）。 */
export interface ReviewResult {
  summary: string
  actions: ActionItem[]
}

/** 重点提取的关键点（R-17）。 */
export interface KeyPoint {
  point: string
  detail?: string
}

/** 待办合并分组（R-18）。 */
export interface TodoMergeGroup {
  keep: string
  merge: string[]
}

/** 待办整理后的排序项（R-18）。 */
export interface TodoOrganizeItem {
  title: string
  priority: Priority
}

/** 待办整理结果（R-18）。 */
export interface TodoOrganizeResult {
  summary: string
  mergeGroups: TodoMergeGroup[]
  ordered: TodoOrganizeItem[]
}

/** 速查库条目类别：关键字 / 运算符 / 函数 / 语法结构。 */
export type CheatCategory = 'keyword' | 'operator' | 'function' | 'syntax'

/** C++ 速查库条目类别：语法 / 标准库 / 常用算法 / 内存管理 / 常见陷阱。 */
export type CppCheatCategory = 'syntax' | 'stl' | 'algorithm' | 'memory' | 'pitfall'

/** 速查库单条条目（结构化，便于维护与扩展）。 */
export interface CheatEntry {
  /** 唯一标识（稳定，勿改动）。 */
  id: string
  /** 名称（关键字/运算符/函数名/语法名）。 */
  name: string
  category: CheatCategory
  /** 用途说明。 */
  description: string
  /** 语法格式。 */
  syntax: string
  /** 使用示例。 */
  example: string
  /** 常见注意事项 / 易错点（可选）。 */
  notes?: string
  /** 附加搜索关键词（可选）。 */
  tags?: string[]
}

/** C++ 速查库单条条目（与 CheatEntry 同构，类别语义不同）。 */
export interface CppCheatEntry {
  /** 唯一标识（稳定，勿改动）。 */
  id: string
  /** 名称（语法/库/算法/概念名）。 */
  name: string
  category: CppCheatCategory
  /** 用途说明。 */
  description: string
  /** 语法格式。 */
  syntax: string
  /** 使用示例。 */
  example: string
  /** 常见注意事项 / 易错点（可选）。 */
  notes?: string
  /** 附加搜索关键词（可选）。 */
  tags?: string[]
}

/** 思维树维度 key。 */
export type MindTreeDimensionKey = 'concept' | 'premise' | 'feasibility' | 'counter' | 'action'

/** 思维树单个维度（一个分支窗口）。 */
export interface MindTreeDimension {
  key: string
  label: string
  questions: string[]
}

/** 思维树分支生成结果（AI 输出）。 */
export interface MindTreeGenerateResult {
  dimensions: MindTreeDimension[]
}

/** 思维树节点（根/分支/思考点通用）。 */
export interface MindTreeNode {
  id: string
  text: string
  /** 所属维度 key（concept/premise/...，根的直接子节点与延伸子节点用；展示时经 dimensionLabel 转换）。 */
  dimension?: string
  collapsed: boolean
  /** 是否正在生成子分支。 */
  loading: boolean
  children: MindTreeNode[]
  /** 节点备注（可编辑文本，仅本地持久化）。 */
  note?: string
}

/** 思维树（单棵）：name 即主题/标题（原单树文档的 topic 字段已并入 name）。 */
export interface MindTree {
  id: string
  name: string
  root: MindTreeNode
  createdAt: string
  updatedAt: string
}

/** 思维树林：多棵思维树的组群（仅引用 treeId，树本体独立发展）。 */
export interface MindForest {
  id: string
  /** 用户自定义名称。 */
  name: string
  treeIds: string[]
  createdAt: string
  updatedAt: string
}

/** 交叉节点定位（跨树端点）。 */
export interface CrossNodeRef {
  treeId: string
  nodeId: string
}

/** 交叉关系：两条（跨树）节点的关联。 */
export interface CrossLink {
  id: string
  forestId: string
  a: CrossNodeRef
  b: CrossNodeRef
  /** suggested = AI 建议待确认；confirmed = 用户已确认，节点据此显示交叉徽标。 */
  status: 'suggested' | 'confirmed'
  reason?: string
  createdAt: string
}

/** AI 交叉建议候选（未落库原始形态，由 suggestCrossLinks 返回）。 */
export interface CrossLinkSuggestion {
  a: CrossNodeRef
  b: CrossNodeRef
  reason: string
}

/** 交叉节点渲染所需的「伙伴节点」信息（由 store 派生）。 */
export interface CrossPartner {
  treeId: string
  treeName: string
  nodeId: string
  nodeText: string
  reason?: string
}

/** 思维树林持久化文档（localStorage，key: personal-agent.mindforest.v1）。 */
export interface MindForestStore {
  version: 1
  trees: MindTree[]
  forests: MindForest[]
  crossLinks: CrossLink[]
}

/** 插件（camelCase 领域类型，service 层从 PluginsRow 映射）。 */
export interface Plugin {
  id: number
  pluginId: string
  name: string
  version: string
  description: string
  author?: string | null
  repoUrl?: string | null
  permissions: string[]
  entryPath: string
  enabled: boolean
  installedAt: string
  updatedAt: string
}

/** 插件安装入参（manifest 校验后 + 拉取到的入口源码）。 */
export interface PluginInstallInput {
  pluginId: string
  name: string
  version: string
  description: string
  author?: string | null
  repoUrl?: string | null
  permissions: string[]
  /** 入口源码（单文件自包含 ESM，安装时上传到云 storage）。 */
  sourceCode: string
}
