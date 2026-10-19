/**
 * LLM 流式收集与容错 JSON 解析工具（跨端共享）。
 */

/** 流式响应的最小结构（SDK 的 ChatCompletionChunk 结构兼容）。 */
export interface LlmStreamChunk {
  choices?: Array<{ delta?: { content?: string | null } }>
}

/**
 * 收集流式响应中的文本增量。
 *
 * @param stream  `cloud.llm.chat.completions.create({ stream: true, ... })` 返回的异步迭代器
 * @param onDelta 每收到一段增量时回调（用于逐字渲染）
 * @returns 完整拼接后的文本
 */
export async function collectStream(
  stream: AsyncIterable<unknown>,
  onDelta?: (text: string) => void,
): Promise<string> {
  let content = ''
  for await (const raw of stream) {
    const chunk = raw as LlmStreamChunk
    const delta = chunk?.choices?.[0]?.delta?.content
    if (typeof delta === 'string' && delta.length > 0) {
      content += delta
      onDelta?.(delta)
    }
  }
  return content
}

/**
 * 容错解析 LLM 输出的 JSON：
 * 1. 剥离 ```json ... ``` 等 markdown 代码围栏；
 * 2. 截取首个平衡的 {...} 或 [...] 片段；
 * 3. JSON.parse 失败时返回 null（调用方应降级为纯文本）。
 */
export function parseJsonLoose<T = unknown>(text: string): T | null {
  if (!text) return null
  let source = text.trim()

  // 剥离 markdown 代码围栏
  const fenceMatch = source.match(/```(?:json|JSON)?\s*([\s\S]*?)```/)
  if (fenceMatch) {
    source = fenceMatch[1].trim()
  }

  // 先尝试直接解析
  try {
    return JSON.parse(source) as T
  } catch {
    /* 继续容错 */
  }

  // 定位首个 { 或 [
  const objStart = source.indexOf('{')
  const arrStart = source.indexOf('[')
  let start = -1
  if (objStart === -1) start = arrStart
  else if (arrStart === -1) start = objStart
  else start = Math.min(objStart, arrStart)
  if (start === -1) return null

  const open = source[start]
  const close = open === '{' ? '}' : ']'

  // 逐字符扫描，截取首个平衡片段（处理字符串中的转义与嵌套）
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < source.length; i++) {
    const ch = source[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === open) {
      depth++
    } else if (ch === close) {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(source.slice(start, i + 1)) as T
        } catch {
          return null
        }
      }
    }
  }
  return null
}
