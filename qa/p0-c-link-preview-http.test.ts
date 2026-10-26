/**
 * P0-C 链接代理 · 真实 HTTP 层测试（QA 独立补充）。
 *
 * 与工程师用例的差异：这里**真的起 MySQL/HTTP 服务**——用 `node:http` 起一个 fixture 站点，
 * 再起一个把请求交给 `handleLinkPreview` 的本地预览服务，然后用真实 `fetch` 打过去。
 * 目的是验证「HTTP 层契约」（状态码、Content-Type、body 结构、req.url 解析、逐跳复验），
 * 而不是只测纯函数。
 */
import { test, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import lp from '../server/link-preview.js'

interface PreviewResponse {
  status: number
  contentType: string
  body: { ok: boolean; code?: string; message?: string; data?: Record<string, unknown> }
  raw: string
}

interface RunningServer {
  port: number
  base: string
  close: () => Promise<void>
}

const servers: RunningServer[] = []

function listen(handler: http.RequestListener): Promise<RunningServer> {
  return new Promise((resolve) => {
    const server = http.createServer(handler)
    server.on('clientError', () => {
      /* 客户端中断（413 用例会主动断开）不算失败 */
    })
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      servers.push({
        port,
        base: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(() => done())),
      })
      resolve(servers[servers.length - 1])
    })
  })
}

/** 预览服务：把 /api/link-preview 交给被测 handler（真实 socket + 真实 req/res）。 */
async function startPreviewService(): Promise<RunningServer> {
  return listen((req, res) => {
    void lp.handleLinkPreview(req, res)
  })
}

after(async () => {
  await Promise.all(servers.map((s) => s.close()))
})

beforeEach(() => {
  lp.__resetForTest()
})

/**
 * 真实 HTTP 调用预览端点。
 *
 * 默认走 **POST + JSON body**（生产主路径：线上 WAF 拦截 GET 查询参数带 URL 的请求）；
 * 传 `{ method: 'GET' }` 可验证本地兼容路径。
 */
async function callPreview(
  service: RunningServer,
  targetUrl: string | null,
  options: { method?: string; headers?: Record<string, string>; rawBody?: string } = {},
): Promise<PreviewResponse> {
  const method = options.method ?? 'POST'
  const headers: Record<string, string> = { ...(options.headers ?? {}) }
  const init: RequestInit = { method, headers }
  let endpoint = `${service.base}/api/link-preview`

  if (method === 'GET') {
    const query = targetUrl === null ? '' : `?url=${encodeURIComponent(targetUrl)}`
    endpoint += query
  } else if (method === 'POST') {
    if (!headers['Content-Type'] && !headers['content-type']) headers['Content-Type'] = 'application/json'
    init.body = options.rawBody ?? JSON.stringify({ url: targetUrl ?? '' })
  }

  const res = await fetch(endpoint, init)
  const raw = await res.text()
  return {
    status: res.status,
    contentType: String(res.headers.get('content-type') ?? ''),
    body: JSON.parse(raw) as PreviewResponse['body'],
    raw,
  }
}

/** 起一个返回 HTML 的 fixture 页面站点。 */
async function startHtmlFixture(html: string): Promise<RunningServer> {
  return listen((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(html)
  })
}

/* ------------------------------ 成功解析路径 ------------------------------ */

test('HTTP 200：真实请求下解析 og:title / og:description / 协议相对封面 / site', async () => {
  const fixture = await startHtmlFixture(`<!doctype html><html><head>
    <meta property="og:title" content="示例文章标题">
    <meta property="og:description" content="示例文章描述">
    <meta property="og:image" content="//cdn.example.com/cover.png">
    <title>HTML 标题不应胜出</title>
  </head><body>正文</body></html>`)
  const service = await startPreviewService()
  lp.__setAllowPrivateForTest(true)

  const r = await callPreview(service, `${fixture.base}/post/1`)

  assert.equal(r.status, 200)
  assert.match(r.contentType, /application\/json/, '必须是 JSON 响应')
  assert.equal(r.body.ok, true)
  assert.equal(r.body.data?.title, '示例文章标题')
  assert.equal(r.body.data?.description, '示例文章描述')
  assert.equal(r.body.data?.site, '127.0.0.1')
  assert.equal(r.body.data?.finalUrl, `${fixture.base}/post/1`)
  assert.equal(r.body.data?.status, 'ok')

  const image = new URL(String(r.body.data?.image))
  assert.equal(image.hostname, 'cdn.example.com', '协议相对地址应绝对化到 CDN 域名')
  assert.equal(image.pathname, '/cover.png')

  // 永不返回原始 HTML
  assert.ok(!r.raw.includes('<meta'), 'body 中不得出现原始 HTML')
  assert.ok(!r.raw.includes('<html'), 'body 中不得出现原始 HTML')
})

test('HTTP 200：站内相对图片 /img.png 按最终 URL 绝对化', async () => {
  const fixture = await startHtmlFixture(
    `<html><head><meta property="og:title" content="相对图"><meta property="og:image" content="/img.png"></head></html>`,
  )
  const service = await startPreviewService()
  lp.__setAllowPrivateForTest(true)

  const r = await callPreview(service, `${fixture.base}/a/b`)

  assert.equal(r.status, 200)
  assert.equal(r.body.data?.image, `${fixture.base}/img.png`)
})

test('HTTP 200 缓存：同一 URL 第二次命中缓存（不再打到 fixture）', async () => {
  let hits = 0
  const fixture = await listen((_req, res) => {
    hits++
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end('<html><head><title>缓存页</title></head></html>')
  })
  const service = await startPreviewService()
  lp.__setAllowPrivateForTest(true)

  const target = `${fixture.base}/cached`
  const first = await callPreview(service, target)
  const after1 = hits
  const second = await callPreview(service, target)

  assert.equal(first.status, 200)
  assert.equal(second.status, 200)
  assert.equal(second.body.data?.title, '缓存页')
  assert.equal(hits, after1, '第二次应命中 10 分钟缓存，不再请求上游')
})

/* -------------------------------- 错误码 -------------------------------- */

test('HTTP 413：响应体超过 512KB（真实分块写入）', async () => {
  const fixture = await listen((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    try {
      res.write('<html><head><title>big</title></head><body>')
      for (let i = 0; i < 8; i++) res.write('y'.repeat(100 * 1024)) // 800KB
      res.end('</body></html>')
    } catch {
      /* 下游已断开 */
    }
  })
  const service = await startPreviewService()
  lp.__setAllowPrivateForTest(true)

  const r = await callPreview(service, `${fixture.base}/big`)

  assert.equal(r.status, 413)
  assert.equal(r.body.code, 'RESPONSE_TOO_LARGE')
  assert.ok(r.body.message, '应带中文原因')
})

test('HTTP 415：application/pdf 非 HTML', async () => {
  const fixture = await listen((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/pdf' })
    res.end('%PDF-1.4 fake')
  })
  const service = await startPreviewService()
  lp.__setAllowPrivateForTest(true)

  const r = await callPreview(service, `${fixture.base}/doc.pdf`)

  assert.equal(r.status, 415)
  assert.equal(r.body.code, 'UNSUPPORTED_CONTENT_TYPE')
})

test('HTTP 415：text/plain 同样被拒（不只是 pdf）', async () => {
  const fixture = await listen((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('just text')
  })
  const service = await startPreviewService()
  lp.__setAllowPrivateForTest(true)

  const r = await callPreview(service, `${fixture.base}/a.txt`)

  assert.equal(r.status, 415)
})

test('HTTP 404：上游 404', async () => {
  const fixture = await listen((_req, res) => {
    res.writeHead(404, { 'Content-Type': 'text/html' })
    res.end('<html>gone</html>')
  })
  const service = await startPreviewService()
  lp.__setAllowPrivateForTest(true)

  const r = await callPreview(service, `${fixture.base}/missing`)

  assert.equal(r.status, 404)
  assert.equal(r.body.code, 'UPSTREAM_NOT_FOUND')
})

test('HTTP 502：上游 500', async () => {  const fixture = await listen((_req, res) => {
    res.writeHead(500, { 'Content-Type': 'text/html' })
    res.end('<html>err</html>')
  })
  const service = await startPreviewService()
  lp.__setAllowPrivateForTest(true)

  const r = await callPreview(service, `${fixture.base}/boom`)

  assert.equal(r.status, 502)
  assert.equal(r.body.code, 'UPSTREAM_ERROR')
})

test('HTTP 405：PUT 等非 GET/POST 方法被拒', async () => {
  const service = await startPreviewService()

  const r = await callPreview(service, 'https://example.com/', { method: 'PUT' })

  assert.equal(r.status, 405)
  assert.equal(r.body.code, 'METHOD_NOT_ALLOWED')
})

test('GET 兼容路径：本地开发仍可用（线上 WAF 会拦，属已知环境限制）', async () => {
  const fixture = await startHtmlFixture(
    '<html><head><meta property="og:title" content="GET 兼容页"></head></html>',
  )
  const service = await startPreviewService()
  lp.__setAllowPrivateForTest(true)

  const r = await callPreview(service, `${fixture.base}/legacy`, { method: 'GET' })

  assert.equal(r.status, 200)
  assert.equal(r.body.data?.title, 'GET 兼容页')
})

test('POST 400：坏 JSON / 缺 url', async () => {
  const service = await startPreviewService()

  const badJson = await callPreview(service, null, { rawBody: '{not-json' })
  assert.equal(badJson.status, 400)
  assert.equal(badJson.body.code, 'BAD_REQUEST')
  assert.ok(badJson.body.message && /JSON/.test(badJson.body.message))

  const emptyObject = await callPreview(service, null, { rawBody: '{}' })
  assert.equal(emptyObject.status, 400)
  assert.equal(emptyObject.body.code, 'BAD_REQUEST')

  const notString = await callPreview(service, null, { rawBody: '{"url":123}' })
  assert.equal(notString.status, 400)
  assert.equal(notString.body.code, 'BAD_REQUEST')
})

test('POST 413：请求体超过 8KB', async () => {
  const service = await startPreviewService()
  // 用合法 JSON 但填充超 8KB，确保触发的是体积限制而非解析错误
  const bigBody = JSON.stringify({ url: 'https://example.com/', pad: 'x'.repeat(9 * 1024) })
  assert.ok(Buffer.byteLength(bigBody) > 8 * 1024)

  const r = await callPreview(service, null, { rawBody: bigBody })

  assert.equal(r.status, 413)
  assert.equal(r.body.code, 'REQUEST_TOO_LARGE')
  assert.ok(r.body.message && /8KB/.test(r.body.message))
})

test('POST 415：content-type 非 application/json', async () => {
  const service = await startPreviewService()

  const r = await callPreview(service, null, {
    rawBody: JSON.stringify({ url: 'https://example.com/' }),
    headers: { 'Content-Type': 'text/plain' },
  })

  assert.equal(r.status, 415)
  assert.equal(r.body.code, 'UNSUPPORTED_CONTENT_TYPE')
})

test('HTTP 400：缺参 / file 协议 / 非 80-443 端口', async () => {
  const service = await startPreviewService()

  const missing = await callPreview(service, null)
  assert.equal(missing.status, 400)
  assert.equal(missing.body.code, 'BAD_REQUEST')

  const file = await callPreview(service, 'file:///etc/passwd')
  assert.equal(file.status, 400)
  assert.equal(file.body.code, 'UNSUPPORTED_PROTOCOL')

  const port = await callPreview(service, 'http://example.com:8080/')
  assert.equal(port.status, 400)
  assert.equal(port.body.code, 'PORT_NOT_ALLOWED')
})

test('HTTP 504：目标 5s 不响应 → 超时（前端 6s 内必然降级，C4）', async () => {
  // 上游一直不响应：服务端 5s 超时后必须返回 504，而不是挂住连接
  const fixture = await listen(() => {
    /* 故意不响应 */
  })
  const service = await startPreviewService()
  lp.__setAllowPrivateForTest(true)

  const startedAt = Date.now()
  const r = await callPreview(service, `${fixture.base}/hang`)
  const elapsed = Date.now() - startedAt

  assert.equal(r.status, 504)
  assert.equal(r.body.code, 'TIMEOUT')
  assert.ok(elapsed >= 4500, `应在约 5s 后超时，实际 ${elapsed}ms`)
  assert.ok(elapsed < 7000, `不应超过前端 6s 超时预算太多，实际 ${elapsed}ms`)
})

test('HTTP 403：私网 / 回环 / 元数据地址在真实 HTTP 层被拒（hook 关闭时）', async () => {
  const service = await startPreviewService()

  for (const target of ['http://127.0.0.1/', 'http://localhost/', 'http://169.254.169.254/latest/meta-data/']) {
    const r = await callPreview(service, target)
    assert.equal(r.status, 403, `${target} 应 403`)
    assert.equal(r.body.code, 'BLOCKED_HOST')
    assert.ok(r.body.message && r.body.message.length > 0)
  }
})

/* ------------------------------- 重定向链 ------------------------------- */

test('重定向：302 到内网主机名 → 逐跳复验后 403（不允许把公网跳成内网）', async () => {
  const fixture = await listen((_req, res) => {
    res.writeHead(302, { Location: 'http://localhost/secret' })
    res.end()
  })
  const service = await startPreviewService()
  lp.__setAllowPrivateForTest(true)

  const r = await callPreview(service, `${fixture.base}/jump`)

  assert.equal(r.status, 403)
  assert.equal(r.body.code, 'BLOCKED_HOST')
})

test('重定向：302 到 file: 协议 → 逐跳复验后 400', async () => {
  const fixture = await listen((_req, res) => {
    res.writeHead(302, { Location: 'file:///etc/passwd' })
    res.end()
  })
  const service = await startPreviewService()
  lp.__setAllowPrivateForTest(true)

  const r = await callPreview(service, `${fixture.base}/to-file`)

  assert.equal(r.status, 400)
  assert.equal(r.body.code, 'UNSUPPORTED_PROTOCOL')
})

test('重定向：>3 跳 → 502 重定向次数过多', async () => {
  const fixture = await listen((req, res) => {
    const next = Number(String(req.url).replace('/r', '')) + 1
    res.writeHead(302, { Location: `/r${next}` })
    res.end()
  })
  const service = await startPreviewService()
  lp.__setAllowPrivateForTest(true)

  const r = await callPreview(service, `${fixture.base}/r1`)

  assert.equal(r.status, 502)
  assert.equal(r.body.code, 'UPSTREAM_ERROR')
})

test('重定向：3 跳内正常跟随并解析最终页', async () => {
  const fixture = await listen((req, res) => {
    if (req.url === '/s1') {
      res.writeHead(301, { Location: '/s2' })
      res.end()
      return
    }
    if (req.url === '/s2') {
      res.writeHead(302, { Location: '/s3' })
      res.end()
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end('<html><head><title>终点页</title></head></html>')
  })
  const service = await startPreviewService()
  lp.__setAllowPrivateForTest(true)

  const r = await callPreview(service, `${fixture.base}/s1`)

  assert.equal(r.status, 200)
  assert.equal(r.body.data?.title, '终点页')
  assert.equal(r.body.data?.finalUrl, `${fixture.base}/s3`)
})

/* --------------------------------- 限流 --------------------------------- */

test('HTTP 429：同一客户端 IP 超过 30 次/分钟', async () => {
  const fixture = await startHtmlFixture('<html><head><title>限流页</title></head></html>')
  const service = await startPreviewService()
  lp.__setAllowPrivateForTest(true)

  const ip = '198.51.100.77'
  const target = `${fixture.base}/rate`

  for (let i = 0; i < 30; i++) {
    const r = await callPreview(service, target, { headers: { 'x-forwarded-for': ip } })
    assert.equal(r.status, 200, `第 ${i + 1} 次应放行`)
  }

  const limited = await callPreview(service, target, { headers: { 'x-forwarded-for': ip } })
  assert.equal(limited.status, 429)
  assert.equal(limited.body.code, 'RATE_LIMITED')

  // 不同 IP 不受影响
  const other = await callPreview(service, target, { headers: { 'x-forwarded-for': '203.0.113.9' } })
  assert.equal(other.status, 200)
})
