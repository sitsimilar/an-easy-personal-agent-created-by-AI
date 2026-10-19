import { cloud } from '@/lib/cloud'
import { collectStream, parseJsonLoose } from '@shared/utils/llm'
import {
  ANALYZE_CODE_SYSTEM_PROMPT,
  ANALYZE_SCREENSHOT_SYSTEM_PROMPT,
  ANALYZE_SELECTION_SYSTEM_PROMPT,
  CLASSIFY_SYSTEM_PROMPT,
  CROSS_LINK_SYSTEM_PROMPT,
  EXTRACT_KEY_POINTS_SYSTEM_PROMPT,
  GENERATE_CODE_SYSTEM_PROMPT,
  MIND_TREE_SYSTEM_PROMPT,
  ORGANIZE_TODOS_SYSTEM_PROMPT,
  RELATE_SYSTEM_PROMPT,
  REVIEW_SYSTEM_PROMPT,
  SUMMARIZE_SYSTEM_PROMPT,
} from '@shared/constants/prompts'
import type {
  CodeIssue,
  CrossLinkSuggestion,
  InfoRecord,
  KeyPoint,
  MindTree,
  MindTreeDimension,
  MindTreeGenerateResult,
  RelateResultItem,
  ReviewResult,
  SelectionAnalysisResult,
  TodoOrganizeResult,
} from '@shared/types/domain'
import type { SourceFilePayload } from '@shared/types/ipc'
import { friendlyError } from '@/lib/unwrap'
import { onServiceError } from '@/services/authExpired'
import { extractCompletedDimensions } from './mindtree-parse'
import { buildCrossUserPrompt, flattenForestNodes, parseCrossLinkSuggestions, sampleNodes } from './mindforest-cross'
import { recordService } from './recordService'

/** 模型选择偏好：auto=取第一个可用（默认，质量优先）；fast=优先轻量快速模型（速度优先）；vision=支持图像的模型。 */
export type ModelPreference = 'auto' | 'fast' | 'vision'

/** 模型 id 缓存 TTL：过期自动重取，模型被禁用后可自愈。 */
const MODEL_CACHE_TTL_MS = 15 * 60 * 1000

interface ModelCacheEntry {
  id: string
  ts: number
}

const cachedModels = new Map<ModelPreference, ModelCacheEntry>()
const pendingModels = new Map<ModelPreference, Promise<string>>()

/** LLM 输入/结果上限集中配置（避免魔法值散落）。 */
const LIMITS = {
  classifyInput: 4000,
  summarizeInput: 6000,
  relateCandidate: 500,
  relateTarget: 1000,
  selectionInput: 16000,
  reviewInput: 30000,
  reviewPerRecord: 500,
  keyPointsInput: 30000,
  codeGenInput: 12000,
  mindTreeInput: 4000,
  crossNodeLimit: 200,
  crossMax: 10,
  relateMax: 5,
  reviewActionsMax: 8,
  keyPointsMax: 10,
  todoMax: 50,
  selectionIssuesMax: 20,
  screenshotVisionNeed: true,
} as const

/** 同 key 进行中复用：相同输入并发调用只发起一次 LLM 请求，防重复 token 消耗与结果竞态。 */
function dedupeInflight<T>(map: Map<string, Promise<T>>, key: string, run: () => Promise<T>): Promise<T> {
  const hit = map.get(key)
  if (hit) return hit
  const p = run().finally(() => {
    if (map.get(key) === p) map.delete(key)
  })
  map.set(key, p)
  return p
}

const inflightClassify = new Map<string, Promise<ClassifyResult>>()
const inflightSummarize = new Map<string, Promise<string>>()
const inflightSelection = new Map<string, Promise<SelectionAnalysisResult>>()
const inflightCodeGen = new Map<string, Promise<string>>()
const inflightScreenshot = new Map<string, Promise<string>>()

/** 分析模型偏好（用户可在设置页切换）：fast=速度优先（默认）；auto=质量优先。 */
export type AnalysisPreference = 'fast' | 'auto'
const ANALYSIS_PREFERENCE_KEY = 'personal-agent.analysis-model-preference'

function loadAnalysisPreference(): AnalysisPreference {
  try {
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem(ANALYSIS_PREFERENCE_KEY) : null
    return v === 'auto' ? 'auto' : 'fast'
  } catch {
    return 'fast'
  }
}

let analysisPreference: AnalysisPreference = loadAnalysisPreference()

export function getAnalysisPreference(): AnalysisPreference {
  return analysisPreference
}

export function setAnalysisPreference(pref: AnalysisPreference): void {
  analysisPreference = pref
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(ANALYSIS_PREFERENCE_KEY, pref)
  } catch {
    /* 忽略 */
  }
  cachedModels.clear()
  pendingModels.clear()
}

/** 模型速度/适用性打分（越小越快），用于 fast 偏好下的排序。 */
function modelSpeedRank(m: { id: string; name?: string }): number {
  const s = `${m.id} ${m.name ?? ''}`.toLowerCase()
  if (/thinking|reason|image|vision/.test(s)) return 99 // 慢（推理）/不适用（图像）
  if (/flash/.test(s)) return 0 // 最快
  if (/turbo|turbos|air|lite|mini|fast|quick/.test(s)) return 1
  if (/pro|max|ultra|opus|sonnet/.test(s)) return 3 // 强但慢
  return 2
}

/** 动态取模型 id（不写死）；fast 偏好下跳过 thinking/图像模型、优先 flash/turbo；vision 取支持图像的模型。 */
function getModelId(pref: ModelPreference = 'auto'): Promise<string> {
  const hit = cachedModels.get(pref)
  if (hit && Date.now() - hit.ts < MODEL_CACHE_TTL_MS) return Promise.resolve(hit.id)
  if (hit) cachedModels.delete(pref) // 过期清缓存
  const pending = pendingModels.get(pref)
  if (pending) return pending
  const p = (async () => {
    const models = await cloud.llm.models.list()
    const enabled = models.filter((m) => m.disabled !== true)
    if (enabled.length === 0) throw new Error('当前没有可用的 AI 模型，请稍后再试')
    let chosen = enabled[0]
    if (pref === 'fast') {
      const ranked = [...enabled].sort((a, b) => modelSpeedRank(a) - modelSpeedRank(b))
      chosen = ranked[0]
    } else if (pref === 'vision') {
      const vision = enabled.find((m) => (m as { supportsImages?: boolean }).supportsImages === true)
      if (!vision) throw new Error('当前没有支持图像识别的模型，请稍后再试')
      chosen = vision
    }
    cachedModels.set(pref, { id: chosen.id, ts: Date.now() })
    return chosen.id
  })().catch((err) => {
    pendingModels.delete(pref)
    throw err
  })
  pendingModels.set(pref, p)
  return p
}

/** 统一的 LLM 错误包装（转为中文友好提示）。 */
function wrapLlmError(err: unknown): Error {
  onServiceError(err) // 会话失效时触发跳登录
  if (err instanceof Error && err.message && /[\u4e00-\u9fa5]/.test(err.message)) return err
  return new Error(friendlyError(err))
}

/** 从 LLM 输出中提取 markdown 代码围栏内的代码（无围栏则原样返回）。 */
function extractCodeBlock(raw: string): string {
  const fence = raw.match(/```(?:cpp|c\+\+|cxx)?\s*([\s\S]*?)```/i)
  if (fence) return fence[1].trim()
  return raw.trim()
}

export interface ClassifyResult {
  category: string
  tags: string[]
}

/** 选区分析结果缓存（同一文本重复分析直接命中，不再调 LLM）。 */
const selectionCache = new Map<string, SelectionAnalysisResult>()
const SELECTION_CACHE_MAX = 10

/** 供测试/设置清理缓存。 */
export function clearSelectionCache(): void {
  selectionCache.clear()
}

/** 思维树生成结果缓存（同一输入重复生成直接命中，不再调 LLM）。 */
const mindTreeCache = new Map<string, MindTreeGenerateResult>()
const MIND_TREE_CACHE_MAX = 10

/** 供测试/设置清理缓存。 */
export function clearMindTreeCache(): void {
  mindTreeCache.clear()
}

/** 预热模型列表缓存（失败静默）：缩短首次 AI 调用的延迟。 */
export function warmup(): void {
  void getModelId('fast').catch(() => undefined)
  void getModelId().catch(() => undefined)
}

/** AI 交叉建议入参。 */
export interface CrossLinkSuggestInput {
  forestId: string
  trees: MindTree[]
}

export const aiService = {
  /** 自动分类。 */
  async classify(content: string): Promise<ClassifyResult> {
    const key = content.trim()
    return dedupeInflight(inflightClassify, key, async () => {
      try {
        const model = await getModelId()
        const stream = cloud.llm.chat.completions.create({
          model,
          messages: [
            { role: 'system', content: CLASSIFY_SYSTEM_PROMPT },
            { role: 'user', content: content.slice(0, LIMITS.classifyInput) },
          ],
          stream: true,
        })
        const text = await collectStream(stream)
        const parsed = parseJsonLoose<{ category?: string; tags?: string[] }>(text)
        return {
          category: parsed?.category ?? '其他',
          tags: Array.isArray(parsed?.tags) ? parsed.tags.slice(0, 5).map(String) : [],
        }
      } catch (err) {
        throw wrapLlmError(err)
      }
    })
  },

  /** 自动总结。 */
  async summarize(content: string): Promise<string> {
    const key = content.trim()
    return dedupeInflight(inflightSummarize, key, async () => {
      try {
        const model = await getModelId()
        const stream = cloud.llm.chat.completions.create({
          model,
          messages: [
            { role: 'system', content: SUMMARIZE_SYSTEM_PROMPT },
            { role: 'user', content: content.slice(0, LIMITS.summarizeInput) },
          ],
          stream: true,
        })
        const text = await collectStream(stream)
        return text.trim() || '暂无摘要'
      } catch (err) {
        throw wrapLlmError(err)
      }
    })
  },

  /** 智能关联：对候选记录打分。 */
  async relate(target: InfoRecord, candidates: InfoRecord[]): Promise<RelateResultItem[]> {
    if (candidates.length === 0) return []
    try {
      const model = await getModelId()
      const candidateList = candidates
        .map((c) => `id: ${c.id}\n标题: ${c.title}\n内容: ${c.content.slice(0, LIMITS.relateCandidate)}`)
        .join('\n---\n')
      const targetText = `目标记录 id: ${target.id}\n标题: ${target.title}\n内容: ${target.content.slice(0, LIMITS.relateTarget)}`
      const user = `目标记录：\n${targetText}\n\n候选记录列表：\n${candidateList}`

      const stream = cloud.llm.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: RELATE_SYSTEM_PROMPT },
          { role: 'user', content: user },
        ],
        stream: true,
      })
      const text = await collectStream(stream)
      const parsed = parseJsonLoose<Array<{ targetId?: number; score?: number; reason?: string }>>(text)
      if (!Array.isArray(parsed)) return []
      return parsed
        .filter(
          (it) => it && typeof it.targetId === 'number' && typeof it.score === 'number' && it.score >= 0.5,
        )
        .map((it) => ({ targetId: it.targetId as number, score: it.score as number, reason: it.reason }))
        .slice(0, LIMITS.relateMax)
    } catch (err) {
      throw wrapLlmError(err)
    }
  },

  /** 选区文本分析：输出三类问题（语法错误/潜在缺陷/风格规范），同文本命中缓存 + 进行中复用。 */
  async analyzeSelection(text: string): Promise<SelectionAnalysisResult> {
    const cacheKey = text.trim()
    const cached = selectionCache.get(cacheKey)
    if (cached) return cached
    return dedupeInflight(inflightSelection, cacheKey, async () => {
      try {
        const model = await getModelId(analysisPreference)
        const stream = cloud.llm.chat.completions.create({
          model,
          messages: [
            { role: 'system', content: ANALYZE_SELECTION_SYSTEM_PROMPT },
            { role: 'user', content: text.slice(0, LIMITS.selectionInput) },
          ],
          stream: true,
        })
        const raw = await collectStream(stream)
        const parsed = parseJsonLoose<SelectionAnalysisResult>(raw)
        if (parsed && Array.isArray(parsed.issues)) {
          const result: SelectionAnalysisResult = {
            summary: parsed.summary ?? '分析完成',
            issues: parsed.issues.slice(0, LIMITS.selectionIssuesMax),
          }
          if (selectionCache.size >= SELECTION_CACHE_MAX) {
            const oldest = selectionCache.keys().next().value
            if (oldest !== undefined) selectionCache.delete(oldest)
          }
          selectionCache.set(cacheKey, result)
          return result
        }
        return { summary: raw.trim() || '未能解析分析结果', issues: [] }
      } catch (err) {
        throw wrapLlmError(err)
      }
    })
  },

  /** 阶段回顾：总结 + 行动建议（R-15/R-16）。 */
  async generateReview(records: InfoRecord[]): Promise<ReviewResult> {
    try {
      const model = await getModelId()
      const text = records
        .map(
          (r) =>
            `[${r.type}] ${r.title}\n${r.content.slice(0, LIMITS.reviewPerRecord)}${r.category ? `\n分类:${r.category}` : ''}`,
        )
        .join('\n---\n')
      const stream = cloud.llm.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: REVIEW_SYSTEM_PROMPT },
          { role: 'user', content: text.slice(0, LIMITS.reviewInput) },
        ],
        stream: true,
      })
      const raw = await collectStream(stream)
      const parsed = parseJsonLoose<ReviewResult>(raw)
      if (parsed && typeof parsed.summary === 'string') {
        return {
          summary: parsed.summary,
          actions: Array.isArray(parsed.actions)
            ? parsed.actions
                .filter((a) => a && typeof a.title === 'string')
                .slice(0, LIMITS.reviewActionsMax)
            : [],
        }
      }
      return { summary: raw.trim() || '未能生成回顾', actions: [] }
    } catch (err) {
      throw wrapLlmError(err)
    }
  },

  /** 重点提取（R-17）。 */
  async extractKeyPoints(content: string): Promise<KeyPoint[]> {
    try {
      const model = await getModelId()
      const stream = cloud.llm.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: EXTRACT_KEY_POINTS_SYSTEM_PROMPT },
          { role: 'user', content: content.slice(0, LIMITS.keyPointsInput) },
        ],
        stream: true,
      })
      const raw = await collectStream(stream)
      const parsed = parseJsonLoose<KeyPoint[]>(raw)
      return Array.isArray(parsed)
        ? parsed.filter((k) => k && typeof k.point === 'string').slice(0, LIMITS.keyPointsMax)
        : []
    } catch (err) {
      throw wrapLlmError(err)
    }
  },

  /** 待办整理（R-18）。 */
  async organizeTodos(todos: InfoRecord[]): Promise<TodoOrganizeResult> {
    try {
      const model = await getModelId()
      const text = todos.map((t) => `${t.title}（优先级:${t.priority ?? 'medium'}）`).join('\n')
      const stream = cloud.llm.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: ORGANIZE_TODOS_SYSTEM_PROMPT },
          { role: 'user', content: text.slice(0, LIMITS.reviewInput) },
        ],
        stream: true,
      })
      const raw = await collectStream(stream)
      const parsed = parseJsonLoose<TodoOrganizeResult>(raw)
      if (parsed && Array.isArray(parsed.ordered)) {
        return {
          summary: parsed.summary ?? '',
          mergeGroups: Array.isArray(parsed.mergeGroups)
            ? parsed.mergeGroups.filter((g) => g && typeof g.keep === 'string')
            : [],
          ordered: parsed.ordered
            .filter((o) => o && typeof o.title === 'string')
            .slice(0, LIMITS.todoMax),
        }
      }
      return { summary: '未能整理待办', mergeGroups: [], ordered: [] }
    } catch (err) {
      throw wrapLlmError(err)
    }
  },

  /** 自然语言生成 C++ 代码（快速模型 + 流式增量回调，返回去除围栏后的纯代码）。 */
  async generateCode(
    requirement: string,
    opts?: { onDelta?: (text: string) => void },
  ): Promise<string> {
    return dedupeInflight(inflightCodeGen, requirement.trim(), async () => {
      try {
        const model = await getModelId('fast')
        const stream = cloud.llm.chat.completions.create({
          model,
          messages: [
            { role: 'system', content: GENERATE_CODE_SYSTEM_PROMPT },
            { role: 'user', content: requirement.slice(0, LIMITS.codeGenInput) },
          ],
          stream: true,
        })
        const raw = await collectStream(stream, opts?.onDelta)
        return extractCodeBlock(raw)
      } catch (err) {
        throw wrapLlmError(err)
      }
    })
  },

  /** 思维树分支生成：围绕主题/思考点按 5 个维度输出引导问题（fast 模型 + 结果缓存 + 流式增量）。 */
  async generateMindTree(
    input: string,
    opts?: { onPartial?: (dims: MindTreeDimension[]) => void },
  ): Promise<MindTreeGenerateResult> {
    const cacheKey = input.trim()
    const cached = mindTreeCache.get(cacheKey)
    if (cached) {
      // 命中缓存：直接回调全量结果，不再调 LLM
      opts?.onPartial?.(cached.dimensions)
      return cached
    }
    try {
      const model = await getModelId('fast')
      // 流式增量：每累计 ≥250ms 尝试解析已完整的维度，经 onPartial 推送（去重：仅维度数增长才推）
      let accumulated = ''
      let pushedCount = 0
      let lastFlush = 0
      const stream = cloud.llm.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: MIND_TREE_SYSTEM_PROMPT },
          { role: 'user', content: input.slice(0, LIMITS.mindTreeInput) },
        ],
        stream: true,
      })
      const text = await collectStream(stream, (delta) => {
        accumulated += delta
        const now = Date.now()
        if (now - lastFlush < 250) return
        lastFlush = now
        const partial = extractCompletedDimensions(accumulated)
        if (partial.length > pushedCount) {
          pushedCount = partial.length
          opts?.onPartial?.(partial)
        }
      })
      const parsed = parseJsonLoose<MindTreeGenerateResult>(text)
      const dimensions = Array.isArray(parsed?.dimensions)
        ? parsed.dimensions
            .filter(
              (d) =>
                d &&
                typeof d.key === 'string' &&
                d.key.trim().length > 0 &&
                typeof d.label === 'string' &&
                d.label.trim().length > 0 &&
                Array.isArray(d.questions),
            )
            .map((d) => ({
              key: d.key.trim(),
              label: d.label.trim(),
              questions: d.questions
                .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
                .map((q) => q.trim())
                .slice(0, 3),
            }))
            .filter((d) => d.questions.length > 0)
        : []
      if (dimensions.length === 0) {
        throw new Error('未能生成有效的思维分支，请重试')
      }
      if (mindTreeCache.size >= MIND_TREE_CACHE_MAX) {
        const oldest = mindTreeCache.keys().next().value
        if (oldest !== undefined) mindTreeCache.delete(oldest)
      }
      const result: MindTreeGenerateResult = { dimensions }
      mindTreeCache.set(cacheKey, result)
      return result
    } catch (err) {
      throw wrapLlmError(err)
    }
  },

  /** AI 交叉建议：展平节点 → fast 模型 → 解析候选（返回去重后的 {a,b,reason}）。 */
  async suggestCrossLinks(
    input: CrossLinkSuggestInput,
    opts?: { max?: number },
  ): Promise<CrossLinkSuggestion[]> {
    const max = opts?.max ?? LIMITS.crossMax
    try {
      const flat = sampleNodes(flattenForestNodes(input.trees), LIMITS.crossNodeLimit)
      const userText = buildCrossUserPrompt(input.trees, flat)
      const model = await getModelId('fast')
      const stream = cloud.llm.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: CROSS_LINK_SYSTEM_PROMPT },
          { role: 'user', content: userText },
        ],
        stream: true,
      })
      const text = await collectStream(stream)
      return parseCrossLinkSuggestions(text, flat).slice(0, max)
    } catch (err) {
      throw wrapLlmError(err)
    }
  },

  /** 截图识别：上传截图 + 上下文 → 分析内容并推测需求（vision 模型 + 结果去重）。 */
  async analyzeScreenshot(imageDataUrl: string, context: string): Promise<string> {
    return dedupeInflight(inflightScreenshot, imageDataUrl, async () => {
      try {
        const model = await getModelId('vision')
        const userContent: Array<Record<string, unknown>> = []
        if (context.trim()) {
          userContent.push({ type: 'text', text: `上下文：${context.trim()}` })
        }
        userContent.push({ type: 'text', text: '请分析这张截图' })
        userContent.push({ type: 'image_url', image_url: { url: imageDataUrl } })
        const messages = [
          { role: 'system', content: ANALYZE_SCREENSHOT_SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ]
        // SDK 类型仅声明 content: string，这里用局部窄类型表达多模态消息，避免 any
        type MultimodalChatInput = {
          model: string
          messages: Array<{ role: string; content: string | Array<Record<string, unknown>> }>
          stream: boolean
        }
        const create = cloud.llm.chat.completions.create as unknown as (args: MultimodalChatInput) => AsyncIterable<unknown>
        const stream = create({ model, messages, stream: true })
        return await collectStream(stream)
      } catch (err) {
        throw wrapLlmError(err)
      }
    })
  },

  /** VS 变更文件分析：返回 summary + CodeIssue[]（供悬浮窗回传 analysisDone）。 */
  async analyzeChangedFiles(files: SourceFilePayload[]): Promise<{ summary: string; issues: CodeIssue[] }> {
    if (!files || files.length === 0) return { summary: '未检测到变更文件', issues: [] }
    try {
      const model = await getModelId()
      const text = files
        .map((f) => `文件：${f.relativePath}\n${f.content.slice(0, 4000)}`)
        .join('\n---\n')
      const stream = cloud.llm.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: ANALYZE_CODE_SYSTEM_PROMPT },
          { role: 'user', content: text.slice(0, 60000) },
        ],
        stream: true,
      })
      const raw = await collectStream(stream)
      const parsed = parseJsonLoose<{ summary?: string; issues?: CodeIssue[] }>(raw)
      if (parsed && typeof parsed.summary === 'string') {
        const issues = Array.isArray(parsed.issues)
          ? parsed.issues
              .filter((i) => i && typeof i.title === 'string' && ['error', 'warning', 'suggestion'].includes(i.severity))
              .slice(0, LIMITS.selectionIssuesMax)
          : []
        return { summary: parsed.summary, issues }
      }
      return { summary: raw.trim() || '分析完成', issues: [] }
    } catch (err) {
      throw wrapLlmError(err)
    }
  },

  /** 新建记录后的自动增强：分类 + 总结（并行）+ 关联。 */
  async enrichRecord(record: InfoRecord): Promise<void> {
    const content = `${record.title}\n${record.content}`.trim()
    if (!content) return

    // 分类与总结并行回写，失败不阻塞主流程
    const classifyTask = this.classify(content)
      .then((r) => recordService.patchRecord(record.id, { category: r.category, tags: r.tags }))
      .catch(() => undefined)
    const summarizeTask = this.summarize(content)
      .then((s) => recordService.patchRecord(record.id, { summary: s }))
      .catch(() => undefined)
    await Promise.all([classifyTask, summarizeTask])

    // 智能关联（失败不阻塞）
    try {
      const candidates = await recordService.searchCandidates(content.slice(0, 50), 20, record.id)
      const links = await this.relate(record, candidates)
      await recordService.saveLinks(record.id, links)
    } catch {
      /* 关联失败不阻塞 */
    }
  },
}
