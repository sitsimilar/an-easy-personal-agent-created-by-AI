/**
 * 链接元数据抓取（P0-C）。
 *
 * 约定：
 * - 抓取永远不抛错、不阻塞保存：任何失败都降级为 `{ status: 'failed', errorCode }`；
 * - 前端超时 6s（服务端 5s + 1s 余量），保证界面不会出现永久 loading；
 * - 开发态无 `/api/link-preview` 端点时（Vite 5173 直连）fetch 失败 → 静默降级。
 */

import { recordService } from '@/services/recordService'
import type { InfoRecord, LinkMeta } from '@shared/types/domain'

/** 代理端点路径（与 server.js 路由一致）。 */
const ENDPOINT = '/api/link-preview'
/** 客户端超时（服务端 5s 总超时 + 1s 余量）。 */
const FETCH_TIMEOUT_MS = 6_000

/** 服务端成功响应体。 */
interface LinkPreviewSuccess {
  ok: true
  data: {
    title?: string | null
    description?: string | null
    image?: string | null
    site?: string | null
    finalUrl?: string | null
    fetchedAt?: string
    status?: string
  }
}

/** 服务端失败响应体。 */
interface LinkPreviewFailure {
  ok: false
  code?: string
  message?: string
}

/** 是否是 http(s) 链接（唯一允许渲染/抓取的协议）。 */
export function isHttpUrl(url: string | null | undefined): boolean {
  if (!url) return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/** 展示用域名：去掉 `www.` 前缀；非法 URL 返回空串。 */
export function prettyHost(url: string | null | undefined): string {
  if (!url) return ''
  try {
    return new URL(url).hostname.replace(/^www\./i, '')
  } catch {
    return ''
  }
}

/** 组装失败元数据。 */
function failedMeta(errorCode: string): LinkMeta {
  return { status: 'failed', errorCode }
}

/** 读取服务端失败响应里的错误码（拿不到就用兜底码）。 */
function readErrorCode(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object') {
    const code = (payload as { code?: unknown }).code
    if (typeof code === 'string' && code) return code
  }
  return fallback
}

/**
 * 抓取单个链接的元数据；**永不抛错**。
 *
 * 传输方式为 `POST /api/link-preview` + JSON `{ url }`：
 * 线上腾讯云 WAF 会拦截「GET 查询参数里带完整 URL」的请求（直接 403 拦截页），
 * 而 POST body 可正常到达应用；服务端仍保留 GET 作为本地开发/兼容路径。
 */
export async function fetchLinkMeta(url: string): Promise<LinkMeta> {
  if (!isHttpUrl(url)) return failedMeta('INVALID_URL')

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer =
    controller !== null
      ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
      : null

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ url }),
      signal: controller?.signal,
    })

    const payload = (await res.json().catch(() => null)) as LinkPreviewSuccess | LinkPreviewFailure | null

    if (!res.ok || !payload || payload.ok !== true) {
      return failedMeta(readErrorCode(payload, `HTTP_${res.status}`))
    }

    const data = payload.data
    return {
      title: data.title ?? null,
      description: data.description ?? null,
      image: data.image ?? null,
      site: data.site ?? null,
      fetchedAt: data.fetchedAt ?? new Date().toISOString(),
      status: 'ok',
    }
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError'
    return failedMeta(aborted ? 'TIMEOUT' : 'NETWORK_ERROR')
  } finally {
    if (timer !== null) clearTimeout(timer)
  }
}

/**
 * 创建后异步补全链接元数据（fire-and-forget）。
 *
 * - 仅 `material` 且 URL 为 http(s) 才抓取；
 * - 抓取成功写 `link_meta`，**仅当原标题为空**才回填 `title`（不覆盖用户输入）；
 * - 任何异常吞掉，不打断保存链路。
 */
export async function enrichLinkMeta(record: InfoRecord): Promise<LinkMeta | null> {
  if (record.type !== 'material') return null
  const url = record.url ?? null
  if (!isHttpUrl(url)) return null

  try {
    const meta = await fetchLinkMeta(url as string)
    const fields: Record<string, unknown> = { link_meta: meta }
    const backfillTitle = meta.status === 'ok' && meta.title && !record.title.trim()
    if (backfillTitle) fields.title = meta.title
    await recordService.patchRecord(record.id, fields)
    return meta
  } catch {
    return null
  }
}

/**
 * 详情页「重新抓取」：失败时抛出可读中文错误，由调用方展示。
 */
export async function retryLinkMeta(id: number): Promise<LinkMeta> {
  const record = await recordService.getRecord(id)
  if (!record) throw new Error('记录不存在')
  if (!isHttpUrl(record.url)) throw new Error('该记录没有可抓取的链接')

  const meta = await fetchLinkMeta(record.url as string)
  const fields: Record<string, unknown> = { link_meta: meta }
  if (meta.status === 'ok' && meta.title && !record.title.trim()) fields.title = meta.title
  await recordService.patchRecord(id, fields)
  return meta
}

/** service 单例（与项目其它 service 风格一致）。 */
export const linkPreviewService = {
  fetchLinkMeta,
  enrichLinkMeta,
  retryLinkMeta,
  isHttpUrl,
  prettyHost,
}
