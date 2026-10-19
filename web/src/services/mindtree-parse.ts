/**
 * 思维树流式增量解析：从可能被截断的 LLM 输出文本中提取**已完整**的维度块。
 *
 * 用于 generateMindTree 的 onPartial 流式回调：边接收边渲染已到达的维度，
 * 不必等整个 JSON 生成完毕。所有函数不得抛异常。
 */
import { parseJsonLoose } from '@shared/utils/llm'
import type { MindTreeDimension } from '@shared/types/domain'

/** 校验单个维度是否可用（key/label 非空字符串、questions 为非空字符串数组）。 */
function isValidDimension(d: MindTreeDimension | null | undefined): d is MindTreeDimension {
  return (
    !!d &&
    typeof d.key === 'string' &&
    d.key.trim().length > 0 &&
    typeof d.label === 'string' &&
    d.label.trim().length > 0 &&
    Array.isArray(d.questions) &&
    d.questions.some((q) => typeof q === 'string' && q.trim().length > 0)
  )
}

/** 从 JSON 数组内容中提取所有字符串元素（容错转义）。 */
function parseStringArray(content: string): string[] {
  const out: string[] = []
  const re = /"((?:[^"\\]|\\.)*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    try {
      out.push(JSON.parse(`"${m[1]}"`) as string)
    } catch {
      out.push(m[1])
    }
  }
  return out
}

/** 取文本中指定字段最后一次出现的字符串值（维度块中该字段属于最近一个维度）。 */
function lastStringValue(text: string, field: string): string | null {
  const re = new RegExp(`"${field}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, 'g')
  let last: string | null = null
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    try {
      last = JSON.parse(`"${m[1]}"`) as string
    } catch {
      last = m[1]
    }
  }
  return last
}

/** 从 openIdx 处的 '[' 起找匹配的 ']'（跳过字符串内的括号与转义）；未闭合返回 -1。 */
function findClosingBracket(text: string, openIdx: number): number {
  let depth = 0
  let inString = false
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (ch === '\\') {
        i++
        continue
      }
      if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '[') depth++
    else if (ch === ']') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** 正则/扫描提取：questions 数组闭合才算该维度已完成。 */
function extractByScan(text: string): MindTreeDimension[] {
  const dims: MindTreeDimension[] = []
  const marker = '"questions"'
  let idx = text.indexOf(marker)
  while (idx !== -1) {
    const colon = text.indexOf('[', idx + marker.length)
    if (colon === -1) break
    const end = findClosingBracket(text, colon)
    if (end === -1) break // 数组未闭合 → 该维度尚未生成完整，后续也不再完整
    const before = text.slice(0, idx)
    const key = lastStringValue(before, 'key')
    const label = lastStringValue(before, 'label')
    const questions = parseStringArray(text.slice(colon + 1, end))
    if (key && label && questions.length > 0) {
      dims.push({ key, label, questions })
    }
    idx = text.indexOf(marker, end)
  }
  return dims.filter(isValidDimension)
}

/**
 * 从（可能被截断的）流式文本中提取已完整的维度列表。
 *
 * 1. 优先 parseJsonLoose 整段解析（文本已完整时命中）；
 * 2. 失败时扫描提取所有 questions 数组已闭合的维度块。
 * 任何异常都降级为空数组，不向外抛错。
 */
export function extractCompletedDimensions(partial: string): MindTreeDimension[] {
  if (!partial || !partial.trim()) return []
  try {
    const parsed = parseJsonLoose<{ dimensions?: MindTreeDimension[] }>(partial)
    if (parsed && Array.isArray(parsed.dimensions)) {
      const dims = parsed.dimensions.filter(isValidDimension)
      if (dims.length > 0) return dims
    }
  } catch {
    /* 走扫描提取 */
  }
  try {
    return extractByScan(partial)
  } catch {
    return []
  }
}
