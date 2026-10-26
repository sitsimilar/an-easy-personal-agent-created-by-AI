'use strict'

/**
 * 链接元数据代理（P0-C，纯 Node，零第三方依赖）。
 *
 * 安全模型（SSRF 防护）：
 *   1. 协议仅 http/https；拒绝 userinfo；端口仅 80/443（且与协议匹配）；
 *   2. 主机名黑名单：localhost / *.localhost / *.local / *.internal / metadata.google.internal；
 *   3. DNS 解析取**全部** A/AAAA，每个地址都必须通过 isPrivateAddress（回环/私网/链路本地/预留）；
 *   4. 建连时用 `lookup` 钩子钉住已校验 IP（防 DNS rebinding），Host 头保留域名，HTTPS 带 servername；
 *   5. 重定向 ≤3 跳，每跳重跑 2/3/4；
 *   6. 预算：单次 5s 总超时（504）、响应累计 >512KB 立即中断（413）、只接受 HTML（415）；
 *   7. 只读流不落盘，成功结果缓存 10 分钟（上限 200 条），失败不缓存。
 *   8. 出网可经 HTTP 代理（读 `HTTPS_PROXY`/`HTTP_PROXY`/`ALL_PROXY` 等环境变量）：
 *      HTTPS 目标用 CONNECT 到**已校验 IP** 后再自行 TLS（保留 DNS 钉扎）；
 *      HTTP 目标用 absolute-form 交给代理（无法端到端钉 IP，仅保留前置 DNS 校验）。
 *
 * 注：`__setAllowPrivateForTest` 仅用于单测打本地桩，生产默认关闭。
 */

const dns = require('dns')
const http = require('http')
const https = require('https')
const net = require('net')
const tls = require('tls')

/** 响应体上限 512KB。 */
const MAX_BYTES = 512 * 1024
/** 单次抓取总超时 5s。 */
const TIMEOUT_MS = 5000
/** 最大重定向跳数。 */
const MAX_REDIRECTS = 3
/** 成功结果缓存 10 分钟。 */
const CACHE_TTL_MS = 10 * 60 * 1000
/** 缓存上限（条）。 */
const CACHE_MAX = 200
/** 限流：每 IP 每 60s 最多 30 次。 */
const RATE_LIMIT = 30
const RATE_WINDOW_MS = 60 * 1000
/** url 参数长度上限。 */
const MAX_URL_LENGTH = 2048
/** POST 请求体上限 8KB（只承载 `{"url":"..."}`，无需更大）。 */
const MAX_BODY_BYTES = 8 * 1024
/** 抓取 UA。 */
const USER_AGENT = 'PersonalAgentBot/2.11'
/** 标题 / 描述截断长度。 */
const TITLE_MAX = 200
const DESCRIPTION_MAX = 300
/** 代理端口上限（仅做合法性兜底）。 */
const PROXY_PORT_MAX = 65535

/**
 * 各目标协议可用的代理环境变量（按优先级，大小写都认）。
 * 部署沙箱出网必须经代理，而 Node 原生 http/https 不读这些变量，故此处自行实现。
 */
const PROXY_ENV_KEYS = {
  'https:': ['HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy'],
  'http:': ['HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy'],
}

/** 仅测试用：允许私网地址（默认关闭，生产必须为 false）。 */
let allowPrivateForTest = false
/** 仅测试用：替换真实 DNS 解析，便于用「域名 + 本地桩」验证钉 IP 逻辑。 */
let lookupForTest = null

/* ----------------------------- 地址判定 ----------------------------- */

/** 去掉 IPv6 的方括号与 zone id。 */
function stripBrackets(host) {
  let value = String(host || '').trim().toLowerCase()
  if (value.startsWith('[') && value.endsWith(']')) value = value.slice(1, -1)
  const zone = value.indexOf('%')
  if (zone >= 0) value = value.slice(0, zone)
  return value
}

/** IPv4 私网/保留地址判定。 */
function isPrivateV4(address) {
  const parts = address.split('.').map((n) => Number(n))
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true
  const [a, b] = parts
  if (a === 0) return true // 0.0.0.0/8
  if (a === 10) return true // 10/8
  if (a === 127) return true // 回环
  if (a === 169 && b === 254) return true // 链路本地（含云元数据 169.254.169.254）
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16/12
  if (a === 192 && b === 168) return true // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true // 100.64/10 运营商 NAT
  if (a === 192 && (b === 0 || b === 2)) return true // 192.0.0/24 + 192.0.2/24 保留
  if (a === 198 && (b === 18 || b === 19)) return true // 198.18/15 基准测试
  if (a >= 224) return true // 224/4 组播 + 240/4 保留
  return false
}

/** IPv6 私网/保留地址判定。 */
function isPrivateV6(address) {
  if (address === '::1' || address === '::') return true

  // IPv4 映射：::ffff:127.0.0.1 或 ::ffff:7f00:1
  if (address.startsWith('::ffff:')) {
    const tail = address.slice('::ffff:'.length)
    if (net.isIP(tail) === 4) return isPrivateV4(tail)
    const groups = tail.split(':')
    if (groups.length === 2) {
      const hi = parseInt(groups[0], 16)
      const lo = parseInt(groups[1], 16)
      if (Number.isInteger(hi) && Number.isInteger(lo)) {
        const v4 = `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`
        return isPrivateV4(v4)
      }
    }
    return true
  }

  const first = address.split(':')[0]
  if (/^f[cd][0-9a-f]{2}$/.test(first)) return true // fc00::/7 唯一本地
  if (/^fe[89ab][0-9a-f]$/.test(first)) return true // fe80::/10 链路本地
  if (/^ff[0-9a-f]{2}$/.test(first)) return true // ff00::/8 组播
  return false
}

/**
 * 是否属于不允许访问的地址（回环/私网/链路本地/组播/保留/非法输入）。
 * 非法或无法判定一律视为不安全。
 */
function isPrivateAddress(address) {
  if (typeof address !== 'string') return true
  const host = stripBrackets(address)
  if (!host) return true
  const version = net.isIP(host)
  if (version === 4) return isPrivateV4(host)
  if (version === 6) return isPrivateV6(host)
  return true
}

/** 主机名黑名单（不含 DNS 解析，纯字面量判定）。 */
function isBlockedHostname(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '')
  if (!host) return true
  if (host === 'localhost') return true
  if (host.endsWith('.localhost')) return true
  if (host.endsWith('.local')) return true
  if (host.endsWith('.internal')) return true
  if (host === 'metadata.google.internal') return true
  return false
}

/* ------------------------------- 限流 ------------------------------- */

/**
 * 滑动窗口限流器。
 *
 * @param {{limit?: number, windowMs?: number}} [options]
 */
function createRateLimiter(options) {
  const limit = options && Number.isFinite(options.limit) ? Number(options.limit) : RATE_LIMIT
  const windowMs = options && Number.isFinite(options.windowMs) ? Number(options.windowMs) : RATE_WINDOW_MS
  /** @type {Map<string, number[]>} */
  const hits = new Map()

  return {
    /** @returns {boolean} true 表示放行 */
    check(key) {
      const now = Date.now()
      const bucket = (hits.get(key) || []).filter((ts) => now - ts < windowMs)
      if (bucket.length >= limit) {
        hits.set(key, bucket)
        return false
      }
      bucket.push(now)
      hits.set(key, bucket)
      // 惰性清理：条目过多时清掉已全部过期的 key，避免长期运行内存增长
      if (hits.size > 5000) {
        for (const [k, v] of hits) {
          if (v.every((ts) => now - ts >= windowMs)) hits.delete(k)
        }
      }
      return true
    },
    reset() {
      hits.clear()
    },
    get size() {
      return hits.size
    },
  }
}

const limiter = createRateLimiter()

/* ------------------------------- 缓存 ------------------------------- */

/** @type {Map<string, {expires: number, data: object}>} */
const cache = new Map()

function readCache(key) {
  const hit = cache.get(key)
  if (!hit) return null
  if (hit.expires <= Date.now()) {
    cache.delete(key)
    return null
  }
  return hit.data
}

function writeCache(key, data) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, { expires: Date.now() + CACHE_TTL_MS, data })
}

/* ----------------------------- HTML 解析 ----------------------------- */

/** 解析一个标签内的属性（首个同名属性生效）。 */
function parseAttributes(tag) {
  /** @type {Record<string, string>} */
  const attrs = {}
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g
  let match
  while ((match = re.exec(tag)) !== null) {
    const name = match[1].toLowerCase()
    if (name in attrs) continue
    const value =
      match[3] !== undefined ? match[3] : match[4] !== undefined ? match[4] : match[5] !== undefined ? match[5] : ''
    attrs[name] = value
  }
  return attrs
}

/** 解码 5 个常见实体（按设计只处理这些，避免过度解码引入 XSS 面）。 */
function decodeEntities(input) {
  return String(input || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

/** 按字符截断（避免拆断代理对）。 */
function truncate(input, max) {
  const chars = Array.from(String(input || ''))
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}

/** 站点名：hostname 去掉 www. 前缀。 */
function siteOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, '')
  } catch {
    return ''
  }
}

/**
 * 把 OG 图片地址绝对化。
 * 支持相对路径与协议相对（`//cdn.example.com/a.png`）；非 http(s) 返回 null。
 */
function resolveImageUrl(raw, baseUrl) {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    const resolved = new URL(trimmed, baseUrl)
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null
    return resolved.toString()
  } catch {
    return null
  }
}

/**
 * 解析 OG / Twitter Card / 基础 meta。
 *
 * 优先级：og:title → twitter:title → <title>；og:description → twitter:description → description；
 * og:image → og:image:url → twitter:image。
 */
function parseOg(html, finalUrl) {
  const text = String(html || '')
  /** @type {Array<Record<string, string>>} */
  const metas = []
  const metaRe = /<meta\b[^>]*>/gi
  let match
  while ((match = metaRe.exec(text)) !== null) {
    metas.push(parseAttributes(match[0]))
  }

  const pick = (keys) => {
    for (const key of keys) {
      for (const attrs of metas) {
        const name = String(attrs.property || attrs.name || '').toLowerCase()
        if (name !== key) continue
        const content = attrs.content
        if (typeof content === 'string' && content.trim()) return decodeEntities(content.trim())
      }
    }
    return ''
  }

  const titleTagMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text)
  const titleTag = titleTagMatch ? decodeEntities(titleTagMatch[1].trim()) : ''

  const title = truncate(pick(['og:title', 'twitter:title']) || titleTag, TITLE_MAX)
  const description = truncate(pick(['og:description', 'twitter:description', 'description']), DESCRIPTION_MAX)
  const imageRaw = pick(['og:image', 'og:image:url', 'twitter:image'])
  const image = resolveImageUrl(imageRaw, finalUrl)
  const site = siteOf(finalUrl)

  return { title, description, image, site }
}

/* ------------------------------- 代理配置 ------------------------------- */

/**
 * 解析单个代理地址（仅支持 `http://[user:pass@]host:port`）。
 *
 * 代理本身一律按 **HTTP 代理** 处理（不支持 socks/hTTPS 代理协议），
 * 因此 `https:` / `socks5:` 等 scheme 视为解析失败。
 *
 * @param {string} raw
 * @returns {{host: string, port: number, auth: string|null}|null} 解析失败返回 null
 */
function parseProxyUrl(raw) {
  let parsed
  try {
    parsed = new URL(String(raw).trim())
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:') return null

  const host = stripBrackets(parsed.hostname)
  if (!host) return null

  const port = parsed.port ? Number(parsed.port) : 80
  if (!Number.isInteger(port) || port <= 0 || port > PROXY_PORT_MAX) return null

  let auth = null
  if (parsed.username || parsed.password) {
    let decoded = ''
    try {
      decoded = `${decodeURIComponent(parsed.username)}:${decodeURIComponent(parsed.password)}`
    } catch {
      return null
    }
    auth = `Basic ${Buffer.from(decoded).toString('base64')}`
  }

  return { host, port, auth }
}

/**
 * 按目标协议读取代理配置。
 *
 * - `https:` 读 `HTTPS_PROXY` / `https_proxy` / `ALL_PROXY` / `all_proxy`；
 * - `http:` 读 `HTTP_PROXY` / `http_proxy` / `ALL_PROXY` / `all_proxy`；
 * - 首个非空值决定结果，解析失败即按直连（返回 null），不静默改用低优先级候选，
 *   避免「配错了却悄悄换了出口」这种难排查的情况。
 *
 * @param {string} protocol 目标协议（`http:` 或 `https:`）
 * @returns {{host: string, port: number, auth: string|null}|null}
 */
function resolveProxy(protocol) {
  const keys = PROXY_ENV_KEYS[protocol === 'http:' ? 'http:' : 'https:']
  if (!keys) return null
  for (const key of keys) {
    const raw = process.env[key]
    if (typeof raw !== 'string') continue
    const trimmed = raw.trim()
    if (!trimmed) continue
    return parseProxyUrl(trimmed)
  }
  return null
}

/**
 * 地址排序：IPv4 优先，保持原有相对顺序并去重。
 *
 * 两条理由：① 部分网络/代理没有 IPv6 出口，AAAA 排在前面会白等；② 建连失败时可
 * 依次回退到下一个地址（见 `requestOnce`）。
 *
 * @param {Array<{address: string, family: number}>} addresses
 * @returns {Array<{address: string, family: number}>}
 */
function orderAddresses(addresses) {
  const list = Array.isArray(addresses) ? addresses : []
  const seen = new Set()
  const ordered = []
  for (const item of list) {
    if (!item || typeof item.address !== 'string' || !item.address) continue
    const key = `${item.family}|${item.address}`
    if (seen.has(key)) continue
    seen.add(key)
    ordered.push({ address: item.address, family: item.family === 6 ? 6 : 4 })
  }
  // Array#sort 在 V8 中稳定，同族地址保持 DNS 返回顺序
  ordered.sort((a, b) => (a.family === 4 ? 0 : 1) - (b.family === 4 ? 0 : 1))
  return ordered
}

/** 把 IP 格式化成 authority 里的主机部分（IPv6 需方括号）。 */
function toAuthorityHost(address, family) {
  return family === 6 ? `[${address}]` : address
}

/* ------------------------------ 抓取实现 ------------------------------ */

/** 统一错误对象。 */
function errorResult(status, code, message) {
  return { ok: false, status, code, message }
}

/** 校验并准备目标 URL（协议/端口/userinfo/主机名黑名单）。 */
function prepareTarget(rawUrl) {
  let url
  try {
    url = new URL(String(rawUrl))
  } catch {
    return { error: errorResult(400, 'BAD_REQUEST', '链接格式不正确') }
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { error: errorResult(400, 'UNSUPPORTED_PROTOCOL', '仅支持 http/https 链接') }
  }
  if (url.username || url.password) {
    return { error: errorResult(400, 'BAD_REQUEST', '链接不能包含账号信息') }
  }

  const expectedPort = url.protocol === 'https:' ? '443' : '80'
  if (!allowPrivateForTest) {
    if (url.port && url.port !== '80' && url.port !== '443') {
      return { error: errorResult(400, 'PORT_NOT_ALLOWED', '仅允许 80/443 端口') }
    }
    if (url.port && url.port !== expectedPort) {
      return { error: errorResult(400, 'PORT_NOT_ALLOWED', '端口与协议不匹配') }
    }
  }

  const hostname = url.hostname.toLowerCase()
  if (isBlockedHostname(hostname)) {
    return { error: errorResult(403, 'BLOCKED_HOST', '该地址不允许访问') }
  }

  return { url, hostname }
}

/**
 * 解析主机名并校验所有地址。
 * @returns {{addresses: Array<{address: string, family: number}>} | {blocked: boolean} | {failed: boolean}}
 */
async function resolveHost(hostname) {
  const bare = stripBrackets(hostname)
  const literalFamily = net.isIP(bare)
  if (literalFamily) {
    if (!allowPrivateForTest && isPrivateAddress(bare)) return { blocked: true }
    return { addresses: [{ address: bare, family: literalFamily }] }
  }

  try {
    // 测试钩子：用注入的解析结果替代真实 DNS（让「域名 + 本地桩」路径可验证）
    const list =
      typeof lookupForTest === 'function'
        ? await lookupForTest(bare)
        : await dns.promises.lookup(bare, { all: true, verbatim: true })
    if (!Array.isArray(list) || list.length === 0) return { failed: true }
    for (const item of list) {
      if (!allowPrivateForTest && isPrivateAddress(item && item.address)) return { blocked: true }
    }
    return { addresses: list.map((i) => ({ address: i.address, family: i.family })) }
  } catch {
    return { failed: true }
  }
}

/** 请求头（直连与代理共用；Host 由各路径显式给出）。 */
function requestHeadersFor(url) {
  return {
    Host: url.host,
    'User-Agent': USER_AGENT,
    Accept: 'text/html,application/xhtml+xml',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  }
}

/**
 * 单跳请求：按已校验 IP 建连（直连钉 IP；HTTPS 代理用 CONNECT 到已校验 IP 后自行 TLS）。
 *
 * 三条路径：
 *   1. 直连：`lookup` 钩子钉住已校验 IP，Host 头保留域名，HTTPS 带 servername；
 *   2. HTTPS 走代理：CONNECT 目标用**已校验 IP**（IPv6 加方括号）→ TLS（servername=域名）
 *      → 在该 TLS socket 上发明文 HTTP/1.1。DNS 钉扎得以保留（代理解析不到域名）；
 *   3. HTTP 走代理：absolute-form 请求行交给代理转发。HTTP 无法端到端钉 IP，
 *      此处仅保留前置的 DNS 校验（残余风险：代理侧可能把域名解析到内网地址）。
 *
 * 结果统一附带 `viaProxy`，便于线上确认实际走的哪条路径。
 *
 * @returns {Promise<{html: string, finalUrl: string, viaProxy: boolean}
 *   | {redirect: string, viaProxy: boolean}
 *   | {error: object}>}
 */
function requestOnce(url, addresses, deadline) {
  const proxy = resolveProxy(url.protocol)

  // HTTP 目标走代理时由代理侧解析域名，本地没有可切换的地址
  if (proxy && url.protocol !== 'https:') {
    return attemptOnce(url, null, proxy, deadline).then((outcome) => outcome.value)
  }

  const candidates = orderAddresses(addresses)
  if (candidates.length === 0) {
    const empty = errorResult(502, 'UPSTREAM_ERROR', '无法连接目标站点')
    empty.viaProxy = Boolean(proxy)
    return Promise.resolve(empty)
  }

  const run = (index) =>
    attemptOnce(url, candidates[index], proxy, deadline).then((outcome) => {
      // 只有在「一个响应都没收到」、还有下一个地址、且还留有预算时才切换地址
      if (outcome.retryable && index + 1 < candidates.length && deadline - Date.now() > 200) {
        return run(index + 1)
      }
      return outcome.value
    })

  return run(0)
}

/**
 * 用单个已校验地址发起一次尝试。
 *
 * @param {URL} url
 * @param {{address: string, family: number}|null} pinned 已校验地址（HTTP 走代理时为 null）
 * @param {{host: string, port: number, auth: string|null}|null} proxy
 * @param {number} deadline
 * @returns {Promise<{retryable: boolean, value: object}>} `retryable` 表示尚未收到任何响应，
 *   上层可安全换下一个地址重试（不会导致对上游的重复请求）。
 */
function attemptOnce(url, pinned, proxy, deadline) {
  const isHttps = url.protocol === 'https:'
  const viaProxy = Boolean(proxy)
  const timeoutMs = Math.max(1, deadline - Date.now())
  const hostname = stripBrackets(url.hostname)
  const port = url.port ? Number(url.port) : isHttps ? 443 : 80
  const path = `${url.pathname || '/'}${url.search || ''}`
  const headers = requestHeadersFor(url)
  let responseSeen = false

  return new Promise((resolve) => {
    let settled = false
    let timer = null
    /** 需要随请求结束一起销毁的对象（socket / request / agent）。 */
    const resources = []

    const cleanup = () => {
      for (const item of resources) {
        try {
          item.destroy()
        } catch {
          /* 已关闭：忽略 */
        }
      }
      resources.length = 0
    }

    const finish = (value) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (value && value.error) value.error.viaProxy = viaProxy
      else if (value) value.viaProxy = viaProxy
      // 不复用连接：收尾时统一断开，避免 socket 泄漏
      cleanup()
      resolve({ retryable: !responseSeen && Boolean(value && value.error), value })
    }

    const abort = (error) => finish({ error })

    const onResponse = (res) => {
      responseSeen = true
      const status = res.statusCode || 0
      const responseHeaders = res.headers || {}

      if (status >= 300 && status < 400 && responseHeaders.location) {
        res.resume()
        finish({ redirect: String(responseHeaders.location) })
        return
      }
      if (status === 404 || status === 410) {
        res.resume()
        abort(errorResult(404, 'UPSTREAM_NOT_FOUND', '目标页面不存在'))
        return
      }
      if (status < 200 || status >= 300) {
        res.resume()
        abort(errorResult(502, 'UPSTREAM_ERROR', '目标站点返回异常状态'))
        return
      }

      const contentType = String(responseHeaders['content-type'] || '')
        .split(';')[0]
        .trim()
        .toLowerCase()
      if (contentType !== 'text/html' && contentType !== 'application/xhtml+xml') {
        res.resume()
        abort(errorResult(415, 'UNSUPPORTED_CONTENT_TYPE', '目标不是网页（仅支持 HTML）'))
        return
      }

      const chunks = []
      let total = 0
      res.on('data', (chunk) => {
        total += chunk.length
        if (total > MAX_BYTES) {
          res.destroy()
          abort(errorResult(413, 'RESPONSE_TOO_LARGE', '目标网页过大（超过 512KB）'))
          return
        }
        chunks.push(chunk)
      })
      res.on('end', () => {
        finish({ html: Buffer.concat(chunks).toString('utf8'), finalUrl: url.toString() })
      })
      res.on('error', () => {
        abort(errorResult(502, 'UPSTREAM_ERROR', '读取目标网页失败'))
      })
    }

    timer = setTimeout(() => abort(errorResult(504, 'TIMEOUT', '抓取超时，请稍后重试')), timeoutMs)
    if (typeof timer.unref === 'function') timer.unref()

    /* ------------------------------ 路径 1：直连 ------------------------------ */
    if (!proxy) {
      if (!pinned) {
        abort(errorResult(502, 'UPSTREAM_ERROR', '无法连接目标站点'))
        return
      }

      const pinnedList = [{ address: pinned.address, family: pinned.family }]
      const options = {
        protocol: url.protocol,
        hostname,
        port,
        path,
        method: 'GET',
        headers,
        // 防 DNS rebinding：实际连接强制使用已校验 IP（Host 头仍为域名）。
        // 注意：Node ≥20 会以 `{ all: true }` 调用本钩子，此时必须回**数组**，
        // 否则内部拿到的 ip 为 undefined → ERR_INVALID_IP_ADDRESS（域目标全线 502）。
        lookup: (_host, opts, cb) => {
          if (opts && opts.all) cb(null, pinnedList)
          else cb(null, pinned.address, pinned.family)
        },
        timeout: timeoutMs,
      }
      if (isHttps && net.isIP(hostname) === 0) options.servername = hostname

      let req
      try {
        req = (isHttps ? https : http).request(options, onResponse)
      } catch {
        abort(errorResult(502, 'UPSTREAM_ERROR', '无法连接目标站点'))
        return
      }
      resources.push(req)
      req.on('timeout', () => abort(errorResult(504, 'TIMEOUT', '抓取超时，请稍后重试')))
      req.on('error', () => abort(errorResult(502, 'UPSTREAM_ERROR', '无法连接目标站点')))
      req.end()
      return
    }

    /* --------------------- 路径 3：HTTP 目标走代理（absolute-form） --------------------- */
    if (!isHttps) {
      const proxyHeaders = requestHeadersFor(url)
      if (proxy.auth) proxyHeaders['Proxy-Authorization'] = proxy.auth

      let req
      try {
        req = http.request(
          {
            host: proxy.host,
            port: proxy.port,
            method: 'GET',
            // absolute-form：由代理解析域名并回源
            path: url.href,
            headers: proxyHeaders,
            // 一次性请求，不复用代理连接（避免跨目标串用 keep-alive socket）
            agent: false,
            setHost: false,
            timeout: timeoutMs,
          },
          onResponse,
        )
      } catch {
        abort(errorResult(502, 'UPSTREAM_ERROR', '无法连接代理服务器'))
        return
      }
      resources.push(req)
      req.on('timeout', () => abort(errorResult(504, 'TIMEOUT', '抓取超时，请稍后重试')))
      req.on('error', () => abort(errorResult(502, 'UPSTREAM_ERROR', '无法连接代理服务器')))
      req.end()
      return
    }

    /* -------------------- 路径 2：HTTPS 目标走代理（CONNECT 钉 IP） -------------------- */
    if (!pinned) {
      abort(errorResult(502, 'UPSTREAM_ERROR', '无法连接目标站点'))
      return
    }
    const authority = `${toAuthorityHost(pinned.address, pinned.family)}:${port}`

    const connectHeaders = { Host: authority }
    if (proxy.auth) connectHeaders['Proxy-Authorization'] = proxy.auth

    let connectReq
    try {
      connectReq = http.request({
        host: proxy.host,
        port: proxy.port,
        method: 'CONNECT',
        path: authority,
        headers: connectHeaders,
        setHost: false,
        timeout: timeoutMs,
      })
    } catch {
      abort(errorResult(502, 'UPSTREAM_ERROR', '无法连接代理服务器'))
      return
    }
    resources.push(connectReq)

    connectReq.on('connect', (connectRes, socket, head) => {
      resources.push(socket)
      if (connectRes.statusCode !== 200) {
        abort(errorResult(502, 'UPSTREAM_ERROR', '代理连接被拒绝'))
        return
      }
      // CONNECT 成功后紧随的数据属于 TLS 流，必须回填后再握手
      if (head && head.length) {
        try {
          socket.unshift(head)
        } catch {
          /* 忽略：极少出现，握手会自然失败 */
        }
      }

      const serverName = net.isIP(hostname) === 0 ? hostname : undefined
      let tlsSocket
      try {
        tlsSocket = tls.connect({ socket, servername: serverName })
      } catch {
        abort(errorResult(502, 'UPSTREAM_ERROR', '代理加密通道建立失败'))
        return
      }
      resources.push(tlsSocket)
      tlsSocket.on('error', () => abort(errorResult(502, 'UPSTREAM_ERROR', '代理加密通道建立失败')))

      tlsSocket.once('secureConnect', () => {
        if (settled) return
        // 在已建立的 TLS 通道上发明文 HTTP/1.1：用 Agent 注入 socket，避免二次 TLS
        const agent = new http.Agent({ keepAlive: false, maxSockets: 1 })
        agent.createConnection = () => tlsSocket
        resources.push(agent)

        let req
        try {
          req = http.request(
            { host: hostname, port, path, method: 'GET', headers, agent },
            onResponse,
          )
        } catch {
          abort(errorResult(502, 'UPSTREAM_ERROR', '无法连接目标站点'))
          return
        }
        resources.push(req)
        req.on('error', () => abort(errorResult(502, 'UPSTREAM_ERROR', '无法连接目标站点')))
        req.end()
      })
    })

    connectReq.on('timeout', () => abort(errorResult(504, 'TIMEOUT', '抓取超时，请稍后重试')))
    connectReq.on('error', () => abort(errorResult(502, 'UPSTREAM_ERROR', '无法连接代理服务器')))
    connectReq.end()
  })
}

/**
 * 抓取并解析（含重定向逐跳复验）。
 * @returns {Promise<{ok: true, data: object} | {ok: false, status: number, code: string, message: string}>}
 */
async function resolveMeta(rawUrl) {
  const deadline = Date.now() + TIMEOUT_MS
  let current = String(rawUrl)

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const prepared = prepareTarget(current)
    if (prepared.error) return prepared.error

    const resolved = await resolveHost(prepared.hostname)
    if (resolved.blocked) return errorResult(403, 'BLOCKED_HOST', '该地址不允许访问')
    if (resolved.failed) return errorResult(502, 'UPSTREAM_ERROR', '无法解析该域名')
    if (Date.now() >= deadline) return errorResult(504, 'TIMEOUT', '抓取超时，请稍后重试')

    const response = await requestOnce(prepared.url, resolved.addresses, deadline)
    if (response.error) return response.error

    if (response.redirect) {
      if (hop === MAX_REDIRECTS) return errorResult(502, 'UPSTREAM_ERROR', '重定向次数过多')
      try {
        current = new URL(response.redirect, prepared.url).toString()
      } catch {
        return errorResult(502, 'UPSTREAM_ERROR', '重定向地址无效')
      }
      continue
    }

    const og = parseOg(response.html, response.finalUrl)
    return {
      ok: true,
      data: {
        title: og.title,
        description: og.description,
        image: og.image,
        site: og.site,
        finalUrl: response.finalUrl,
        fetchedAt: new Date().toISOString(),
        status: 'ok',
        // 诊断用：是否经代理出网（不含代理地址/凭据）
        viaProxy: response.viaProxy === true,
      },
    }
  }

  return errorResult(502, 'UPSTREAM_ERROR', '重定向次数过多')
}

/* ------------------------------ HTTP 层 ------------------------------ */

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  try {
    if (!res.headersSent) {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Length': Buffer.byteLength(payload),
      })
    }
    res.end(payload)
  } catch {
    /* 连接已断开：忽略 */
  }
}

/**
 * 回写失败响应。
 *
 * @param {object} res
 * @param {number} status
 * @param {string} code
 * @param {string} message
 * @param {boolean} [viaProxy] 已知出网方式时带上，便于线上排障（不含代理地址/凭据）
 */
function fail(res, status, code, message, viaProxy) {
  const body = { ok: false, code, message }
  if (typeof viaProxy === 'boolean') body.viaProxy = viaProxy
  sendJson(res, status, body)
}

function readQueryParam(rawUrl, name) {
  try {
    const parsed = new URL(String(rawUrl || '/'), 'http://localhost')
    const value = parsed.searchParams.get(name)
    return value ? value.trim() : ''
  } catch {
    return ''
  }
}

function clientIp(req) {
  const forwarded = req.headers && req.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.trim()) {
    const first = forwarded.split(',')[0].trim()
    if (first) return first
  }
  const socket = req.socket || req.connection
  return (socket && socket.remoteAddress) || 'unknown'
}

/**
 * 读取 POST 请求体（上限 limit 字节）。
 *
 * - 超限：立即返回 `{ tooLarge: true }`，由调用方回 413（不继续累积内存）；
 * - 读失败/5s 内未读完：返回 `{ error: true }`，避免挂住连接。
 */
function readRequestBody(req, limit) {
  return new Promise((resolve) => {
    let total = 0
    const chunks = []
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }

    const timer = setTimeout(() => finish({ error: true }), 5000)
    if (typeof timer.unref === 'function') timer.unref()

    req.on('data', (chunk) => {
      if (settled) return
      total += chunk.length
      if (total > limit) {
        finish({ tooLarge: true })
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      clearTimeout(timer)
      finish({ raw: Buffer.concat(chunks).toString('utf8') })
    })
    req.on('error', () => {
      clearTimeout(timer)
      finish({ error: true })
    })
  })
}

/** 从 POST body 中取出 url（content-type 必须含 application/json）。 */
async function readPostUrl(req, res) {
  const contentType = String((req.headers && req.headers['content-type']) || '').toLowerCase()
  if (!contentType.includes('application/json')) {
    fail(res, 415, 'UNSUPPORTED_CONTENT_TYPE', '请求体必须是 application/json')
    return null
  }

  const body = await readRequestBody(req, MAX_BODY_BYTES)
  if (body.tooLarge) {
    fail(res, 413, 'REQUEST_TOO_LARGE', '请求体过大（上限 8KB）')
    return null
  }
  if (body.error) {
    fail(res, 400, 'BAD_REQUEST', '读取请求体失败')
    return null
  }

  let payload
  try {
    payload = JSON.parse(body.raw || '')
  } catch {
    fail(res, 400, 'BAD_REQUEST', '请求体不是合法 JSON')
    return null
  }

  const url = payload && typeof payload.url === 'string' ? payload.url.trim() : ''
  if (!url) {
    fail(res, 400, 'BAD_REQUEST', '缺少 url 参数')
    return null
  }
  return url
}

/**
 * 链接元数据处理器。
 *
 * 传输方式：
 * - `POST /api/link-preview` + JSON `{ url }`：**生产主路径**（腾讯云 WAF 会拦截
 *   GET 查询参数里带 URL 的请求，POST body 不受影响）；
 * - `GET /api/link-preview?url=`：本地开发/兼容路径（线上会被 WAF 拦，属已知环境限制）。
 *
 * 两种方式共用同一套校验链（协议/端口/DNS/重定向/预算），永远返回结构化 JSON。
 */
async function handleLinkPreview(req, res) {
  try {
    const method = String(req.method || 'GET').toUpperCase()
    if (method !== 'GET' && method !== 'POST') {
      fail(res, 405, 'METHOD_NOT_ALLOWED', '仅支持 GET/POST 请求')
      return
    }

    const rawUrl = method === 'POST' ? await readPostUrl(req, res) : readQueryParam(req.url, 'url')
    // readPostUrl 已自行响应错误
    if (!rawUrl) {
      if (method === 'GET') fail(res, 400, 'BAD_REQUEST', '缺少 url 参数')
      return
    }
    if (rawUrl.length > MAX_URL_LENGTH) {
      fail(res, 400, 'BAD_REQUEST', '链接过长')
      return
    }

    if (!limiter.check(clientIp(req))) {
      fail(res, 429, 'RATE_LIMITED', '请求过于频繁，请稍后再试')
      return
    }

    const cached = readCache(rawUrl)
    if (cached) {
      sendJson(res, 200, { ok: true, data: cached })
      return
    }

    const result = await resolveMeta(rawUrl)
    if (!result.ok) {
      fail(res, result.status, result.code, result.message, result.viaProxy)
      return
    }

    writeCache(rawUrl, result.data)
    sendJson(res, 200, { ok: true, data: result.data })
  } catch {
    fail(res, 502, 'UPSTREAM_ERROR', '抓取失败，请稍后重试')
  }
}

/* ------------------------------ 测试钩子 ------------------------------ */

/** 清空缓存与限流计数（QA 用例间隔离）。 */
function __resetForTest() {
  cache.clear()
  limiter.reset()
  allowPrivateForTest = false
  lookupForTest = null
}

/**
 * 仅测试用：临时允许私网地址，便于用本地 `node:http` 桩验证 413/415/404/重定向。
 * 生产代码不得调用。
 */
function __setAllowPrivateForTest(value) {
  allowPrivateForTest = Boolean(value)
}

/**
 * 仅测试用：注入 DNS 解析结果，让「域名目标 + 本地桩」路径可验证。
 *
 * @param {((hostname: string) => Promise<Array<{address: string, family: number}>>)|null} fn
 *   传 `null` 复位为真实 DNS。
 */
function __setLookupForTest(fn) {
  lookupForTest = typeof fn === 'function' ? fn : null
}

module.exports = {
  handleLinkPreview,
  isPrivateAddress,
  isBlockedHostname,
  parseOg,
  resolveImageUrl,
  createRateLimiter,
  resolveProxy,
  parseProxyUrl,
  __resetForTest,
  __setAllowPrivateForTest,
  __setLookupForTest,
  MAX_BYTES,
  MAX_BODY_BYTES,
  MAX_URL_LENGTH,
  TIMEOUT_MS,
  MAX_REDIRECTS,
  RATE_LIMIT,
}
