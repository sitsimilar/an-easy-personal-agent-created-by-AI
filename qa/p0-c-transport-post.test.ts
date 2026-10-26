/**
 * P0-C 传输层改造（GET → POST + JSON body）· 对抗性测试（QA 独立补充）。
 *
 * 背景：线上腾讯云 WAF 会 403 拦截「GET 查询参数里带完整 URL」的请求，所以前端改走
 * `POST /api/link-preview` + `{"url": ...}`，服务端 GET/POST 都收。传输方式变了，
 * **输入面就变了**，必须重新验证：
 * - Content-Type 判定是否过严/过松（带 charset、大写、缺失、错误类型）；
 * - 请求体上限（8KB）的精确边界与超限不挂连接；
 * - 非法 JSON / 非字符串 url / 数组 / null 一律 400，不得 500 或挂死；
 * - **SSRF 校验链在两种传输方式下结果必须完全一致**（不能因为换了入口就绕过）；
 * - 缓存与限流跨传输共享（防止 GET/POST 双份配额或双份外呼）；
 * - OPTIONS 等其它方法仍 405，响应带 no-store。
 */
import { test, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import lp from '../server/link-preview.js'

/**
 * 测试期间清空代理环境变量：本文件所有目标都是 `127.0.0.1` 桩服务，
 * 若本机配了 `HTTPS_PROXY`/`HTTP_PROXY` 等，被测代码会把请求真的交给代理，
 * 导致「命中错误的桩 / 结果串味」这类与被测逻辑无关的抖动。
 * 代理路径本身由 `qa/link-preview.test.ts` 用本地假代理覆盖。
 */
const PROXY_ENV_KEYS = ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy']
const savedProxyEnv = new Map<string, string | undefined>(PROXY_ENV_KEYS.map((key) => [key, process.env[key]]))
for (const key of PROXY_ENV_KEYS) delete process.env[key]

function restoreProxyEnv(): void {
  for (const key of PROXY_ENV_KEYS) {
    const value = savedProxyEnv.get(key)
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

process.on('exit', restoreProxyEnv)

interface Resp {
  status: number
  code?: string
  message?: string
  ok: boolean
  data?: Record<string, unknown>
  contentType: string
  cacheControl: string
}

interface Srv {
  base: string
  close: () => Promise<void>
}

const servers: Srv[] = []

function listen(handler: http.RequestListener): Promise<Srv> {
  return new Promise((resolve) => {
    const server = http.createServer(handler)
    server.on('clientError', () => undefined)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      const srv: Srv = {
        base: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(() => done())),
      }
      servers.push(srv)
      resolve(srv)
    })
  })
}

/** 把请求交给被测 handler（真实 socket / 真实 req.res）。 */
async function previewService(): Promise<Srv> {
  return listen((req, res) => {
    void lp.handleLinkPreview(req, res)
  })
}

/** 返回固定 HTML 的 fixture 站点（统计命中次数）。 */
async function htmlFixture(html: string): Promise<Srv & { hits: () => number }> {
  let hits = 0
  const base = await listen((_req, res) => {
    hits += 1
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(html)
  })
  return Object.assign(base, { hits: () => hits })
}

function toResp(res: Response, raw: string): Resp {
  const body = JSON.parse(raw) as { ok?: boolean; code?: string; message?: string; data?: Record<string, unknown> }
  return {
    status: res.status,
    ok: body.ok === true,
    code: body.code,
    message: body.message,
    data: body.data,
    contentType: String(res.headers.get('content-type') ?? ''),
    cacheControl: String(res.headers.get('cache-control') ?? ''),
  }
}

/** POST + JSON body（生产主路径）。 */
async function post(srv: Srv, body: unknown, headers: Record<string, string> = {}): Promise<Resp> {
  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }
  const res = await fetch(`${srv.base}/api/link-preview`, init)
  return toResp(res, await res.text())
}

/** GET 兼容路径。 */
async function get(srv: Srv, target: string | null, headers: Record<string, string> = {}): Promise<Resp> {
  const query = target === null ? '' : `?url=${encodeURIComponent(target)}`
  const res = await fetch(`${srv.base}/api/link-preview${query}`, { method: 'GET', headers })
  return toResp(res, await res.text())
}

/** 需要允许私网后才能访问本地 fixture。 */
function allowPrivate(): void {
  lp.__setAllowPrivateForTest(true)
}

beforeEach(() => {
  lp.__resetForTest()
})

after(async () => {
  await Promise.all(servers.map((s) => s.close()))
})

/* --------------------------- Content-Type 判定 --------------------------- */

test('POST Content-Type 带 charset（application/json; charset=utf-8）应被接受', async () => {
  const fixture = await htmlFixture('<html><head><title>带 charset</title></head></html>')
  const srv = await previewService()
  allowPrivate()

  const r = await post(srv, { url: `${fixture.base}/p` }, { 'Content-Type': 'application/json; charset=utf-8' })

  assert.equal(r.status, 200, '常见客户端都会带 charset，不能因此 415')
  assert.equal(r.data?.title, '带 charset')
})

test('POST Content-Type 大小写不敏感（Application/JSON）', async () => {
  const fixture = await htmlFixture('<html><head><title>大写</title></head></html>')
  const srv = await previewService()
  allowPrivate()

  const r = await post(srv, { url: `${fixture.base}/p` }, { 'Content-Type': 'Application/JSON' })

  assert.equal(r.status, 200)
})

test('POST 缺少 Content-Type → 415；text/plain + 合法 JSON → 415（不解析、不外呼）', async () => {
  const fixture = await htmlFixture('<html><head><title>不该被访问</title></head></html>')
  const srv = await previewService()
  allowPrivate()

  const expect415 = (r: Resp): void => {
    assert.equal(r.status, 415)
    assert.equal(r.code, 'UNSUPPORTED_CONTENT_TYPE')
    assert.ok(r.message && r.message.length > 0, '应带中文原因')
  }

  const noType = await fetch(`${srv.base}/api/link-preview`, {
    method: 'POST',
    headers: {},
    body: JSON.stringify({ url: `${fixture.base}/p` }),
  })
  expect415(toResp(noType, await noType.text()))

  const wrongType = await post(srv, { url: `${fixture.base}/p` }, { 'Content-Type': 'text/plain' })
  expect415(wrongType)
  assert.equal(fixture.hits(), 0, '类型不对时不得外呼上游')
})

/* ---------------------------- 请求体大小边界 ---------------------------- */

test('POST 请求体：恰好 8KB 放行，8KB+1 字节 → 413 REQUEST_TOO_LARGE', async () => {
  const fixture = await htmlFixture('<html><head><title>边界</title></head></html>')
  const srv = await previewService()
  allowPrivate()

  const limit = Number(lp.MAX_BODY_BYTES)
  assert.ok(limit > 2048, '请求体上限应远大于 URL 长度上限')

  const shell = { url: `${fixture.base}/p`, pad: '' }
  const baseLen = Buffer.byteLength(JSON.stringify(shell))
  assert.ok(baseLen < limit, '基础 body 必须小于上限')

  const exact = { ...shell, pad: 'x'.repeat(limit - baseLen) }
  assert.equal(Buffer.byteLength(JSON.stringify(exact)), limit, '构造的 body 应恰好等于上限')
  const okResp = await post(srv, exact)
  assert.equal(okResp.status, 200, `恰好 ${limit} 字节应放行`)

  const over = { ...shell, pad: 'x'.repeat(limit - baseLen + 1) }
  assert.equal(Buffer.byteLength(JSON.stringify(over)), limit + 1)
  const tooLarge = await post(srv, over)
  assert.equal(tooLarge.status, 413)
  assert.equal(tooLarge.code, 'REQUEST_TOO_LARGE')
  assert.ok(tooLarge.message && tooLarge.message.length > 0)
})

test('POST 请求体：url 超过 2048 字符 → 400「链接过长」（不因 body 上限放宽）', async () => {
  const srv = await previewService()

  const r = await post(srv, { url: `https://example.com/${'a'.repeat(2100)}` })

  assert.equal(r.status, 400)
  assert.equal(r.code, 'BAD_REQUEST')
  assert.ok(r.message && r.message.length > 0)
})

/* ------------------------------ 非法载荷 ------------------------------ */

test('POST 非法 JSON / 空 body → 400（不 500、不挂连接）', async () => {
  const srv = await previewService()

  for (const raw of ['', '{', 'not json', '{"url":', '[}']) {
    const r = await post(srv, raw)
    assert.equal(r.status, 400, `raw=${JSON.stringify(raw)} 应 400`)
    assert.equal(r.code, 'BAD_REQUEST')
  }
})

test('POST url 非字符串 / 空串 / 数组 / null → 400（不得 500）', async () => {
  const srv = await previewService()

  for (const body of [{ url: 123 }, { url: null }, { url: '' }, { url: '   ' }, [], null, { other: 'x' }]) {
    const r = await post(srv, body)
    assert.equal(r.status, 400, `body=${JSON.stringify(body)} 应 400`)
    assert.equal(r.code, 'BAD_REQUEST')
  }
})

test('POST 额外字段被忽略，url 前后空格被 trim', async () => {
  const fixture = await htmlFixture('<html><head><title>trim</title></head></html>')
  const srv = await previewService()
  allowPrivate()

  const r = await post(srv, { url: `  ${fixture.base}/p  `, extra: { foo: 1 }, nested: [1, 2] })

  assert.equal(r.status, 200)
  assert.equal(r.data?.title, 'trim')
})

/* --------------------- SSRF 校验链在两种传输下必须一致 --------------------- */

test('SSRF 一致性：GET 与 POST 对同一目标返回完全相同的 status + code', async () => {
  const srv = await previewService()

  const targets = [
    'file:///etc/passwd',
    'ftp://example.com/a',
    'http://127.0.0.1/',
    'http://[::1]/',
    'http://localhost/',
    'http://169.254.169.254/latest/meta-data/',
    'http://192.168.1.1/',
    'http://example.com:8080/',
    'http://user:pass@example.com/',
  ]

  for (const target of targets) {
    const viaGet = await get(srv, target)
    const viaPost = await post(srv, { url: target })

    assert.ok(viaGet.status >= 400 && viaGet.status < 500, `GET ${target} 应 4xx，实际 ${viaGet.status}`)
    assert.equal(viaPost.status, viaGet.status, `POST ${target} 状态码应与 GET 一致`)
    assert.equal(viaPost.code, viaGet.code, `POST ${target} 错误码应与 GET 一致`)
    assert.ok(viaPost.message, '应带中文原因')
  }
})

/* ------------------------ 缓存 / 限流跨传输共享 ------------------------ */

test('缓存跨传输共享：POST 抓取成功后 GET 同一 URL 命中缓存（不重复外呼）', async () => {
  const fixture = await htmlFixture('<html><head><title>跨传输缓存</title></head></html>')
  const srv = await previewService()
  allowPrivate()

  const target = `${fixture.base}/shared`
  const first = await post(srv, { url: target })
  assert.equal(first.status, 200)
  const hitsAfterPost = fixture.hits()

  const second = await get(srv, target)
  assert.equal(second.status, 200)
  assert.equal(second.data?.title, '跨传输缓存')
  assert.equal(fixture.hits(), hitsAfterPost, 'GET 应命中 POST 写入的缓存，不得二次外呼')
})

test('限流跨传输共享：GET+POST 混合共用一个 30 次/分钟配额', async () => {
  const fixture = await htmlFixture('<html><head><title>限流</title></head></html>')
  const srv = await previewService()
  allowPrivate()

  const ip = { 'x-forwarded-for': '198.51.100.88' }
  const target = `${fixture.base}/rate-mix`

  for (let i = 0; i < 30; i++) {
    const r = i % 2 === 0 ? await post(srv, { url: target }, ip) : await get(srv, target, ip)
    assert.equal(r.status, 200, `第 ${i + 1} 次应放行`)
  }

  const blockedByGet = await get(srv, target, ip)
  assert.equal(blockedByGet.status, 429, 'GET 与 POST 必须共用配额')
  assert.equal(blockedByGet.code, 'RATE_LIMITED')

  const blockedByPost = await post(srv, { url: target }, ip)
  assert.equal(blockedByPost.status, 429)

  // 其它 IP 不受影响
  const other = await post(srv, { url: target }, { 'x-forwarded-for': '203.0.113.50' })
  assert.equal(other.status, 200)
})

/* ------------------------------ 方法与响应头 ------------------------------ */

test('OPTIONS / HEAD / PUT / DELETE 一律 405（不崩、不落静态回退）', async () => {
  const srv = await previewService()

  for (const method of ['OPTIONS', 'HEAD', 'PUT', 'DELETE']) {
    const res = await fetch(`${srv.base}/api/link-preview`, { method })
    const text = await res.text()
    assert.equal(res.status, 405, `${method} 应 405`)
    if (method !== 'HEAD') {
      const body = JSON.parse(text) as { code?: string }
      assert.equal(body.code, 'METHOD_NOT_ALLOWED')
    }
  }
})

test('响应头：Content-Type 为 JSON 且带 no-store（代理结果不落浏览器缓存）', async () => {
  const srv = await previewService()

  const r = await post(srv, { url: 'http://127.0.0.1/' })

  assert.match(r.contentType, /application\/json/)
  assert.match(r.cacheControl, /no-store/)
})
