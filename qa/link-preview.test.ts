/**
 * server/link-preview.js 单元测试（P0-C）。
 *
 * 覆盖：地址判定矩阵（C3）、OG 解析与图片绝对化、限流、错误码（405/400/403/404/413/415/429）、
 * 重定向逐跳复验、成功缓存。HTTP 层用 node:http 本地桩（仅测试钩子允许私网 + 随机端口）。
 */
import { test, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import lp from '../server/link-preview.js'

const { isPrivateAddress, isBlockedHostname, parseOg, resolveImageUrl, createRateLimiter, handleLinkPreview, resolveProxy } = lp

/**
 * 代理环境变量：测试默认清空（桩服务都在 127.0.0.1，若本机配了 https_proxy 会被真的转发出去）。
 * 代理路径的用例自己临时设置，`beforeEach` 统一复位。
 */
const PROXY_ENV_KEYS = ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy']
const savedProxyEnv = new Map<string, string | undefined>(PROXY_ENV_KEYS.map((key) => [key, process.env[key]]))

function clearProxyEnv(): void {
  for (const key of PROXY_ENV_KEYS) delete process.env[key]
}

clearProxyEnv()

beforeEach(() => {
  lp.__resetForTest()
  clearProxyEnv()
})

/* ----------------------------- 地址判定矩阵 ----------------------------- */

test('isPrivateAddress：回环 / 私网 / 链路本地 / NAT / 保留 IPv4', () => {
  const blocked = [
    '127.0.0.1',
    '127.255.255.254',
    '10.0.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '100.127.255.255',
    '0.0.0.0',
    '0.1.2.3',
    '224.0.0.1',
    '240.0.0.1',
    '255.255.255.255',
  ]
  for (const ip of blocked) assert.equal(isPrivateAddress(ip), true, `${ip} 应为受限地址`)
})

test('isPrivateAddress：公网 IPv4 放行', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '100.128.0.1', '203.0.113.9', '198.20.0.1']) {
    assert.equal(isPrivateAddress(ip), false, `${ip} 应为公网地址`)
  }
})

test('isPrivateAddress：IPv6 回环 / ULA / 链路本地 / 组播 / 映射地址', () => {
  for (const ip of [
    '::1',
    '::',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'fe80::abcd',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:192.168.0.1',
    '[::1]',
  ]) {
    assert.equal(isPrivateAddress(ip), true, `${ip} 应为受限地址`)
  }
  for (const ip of ['2001:4860:4860::8888', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
    assert.equal(isPrivateAddress(ip), false, `${ip} 应为公网地址`)
  }
})

test('isPrivateAddress：非法输入按不安全处理', () => {
  for (const value of ['', 'not-an-ip', '999.1.1.1', '1.2.3', null, undefined]) {
    assert.equal(isPrivateAddress(value as string), true)
  }
})

test('isBlockedHostname：localhost 系与内网后缀', () => {
  for (const host of ['localhost', 'LOCALHOST', 'a.localhost', 'printer.local', 'svc.internal', 'metadata.google.internal']) {
    assert.equal(isBlockedHostname(host), true, `${host} 应被拒`)
  }
  for (const host of ['example.com', 'github.com', 'www.example.com']) {
    assert.equal(isBlockedHostname(host), false, `${host} 应放行`)
  }
})

/* -------------------------------- OG 解析 -------------------------------- */

test('parseOg：og 优先 + 实体解码 + 协议相对图片 + 站点去 www', () => {
  const html = `<html><head>
    <meta property="og:title" content="OG 标题 &amp; 更多">
    <meta property="og:description" content="描述 &lt;b&gt; &quot;引号&quot; &#39;单引号&#39;">
    <meta property="og:image" content="//cdn.example.com/a.png">
    <title>HTML 标题</title>
  </head><body></body></html>`
  const og = parseOg(html, 'https://www.example.com/post/1')
  assert.equal(og.title, 'OG 标题 & 更多')
  assert.equal(og.description, '描述 <b> "引号" \'单引号\'')
  assert.equal(og.image, 'https://cdn.example.com/a.png')
  assert.equal(og.site, 'example.com')
})

test('parseOg：twitter 回退 + 相对图片 + <title> 兜底', () => {
  const html = `<html><head>
    <meta name="twitter:title" content="Twitter 标题">
    <meta name="twitter:description" content="Twitter 描述">
    <meta name="twitter:image" content="/img/t.png">
    <title>HTML 标题</title>
  </head></html>`
  const og = parseOg(html, 'https://example.com/post')
  assert.equal(og.title, 'Twitter 标题')
  assert.equal(og.description, 'Twitter 描述')
  assert.equal(og.image, 'https://example.com/img/t.png')

  const onlyTitle = parseOg('<html><head><title>  只有标题  </title></head></html>', 'https://example.com/x')
  assert.equal(onlyTitle.title, '只有标题')
  assert.equal(onlyTitle.image, null)
})

test('parseOg：title 截断 200、description 截断 300', () => {
  const longTitle = 'A'.repeat(260)
  const longDesc = 'B'.repeat(400)
  const html = `<meta property="og:title" content="${longTitle}"><meta property="og:description" content="${longDesc}">`
  const og = parseOg(html, 'https://example.com/')
  assert.equal(og.title.length, 200)
  assert.equal(og.description.length, 300)
})

test('resolveImageUrl：相对 / 协议相对 / 非法协议', () => {
  assert.equal(resolveImageUrl('/a.png', 'https://example.com/dir/page'), 'https://example.com/a.png')
  assert.equal(resolveImageUrl('img/a.png', 'https://example.com/dir/page'), 'https://example.com/dir/img/a.png')
  assert.equal(resolveImageUrl('//cdn.x.com/a.png', 'https://example.com/'), 'https://cdn.x.com/a.png')
  assert.equal(resolveImageUrl('data:image/png;base64,AAA', 'https://example.com/'), null)
  assert.equal(resolveImageUrl('javascript:alert(1)', 'https://example.com/'), null)
  assert.equal(resolveImageUrl('', 'https://example.com/'), null)
})

/* --------------------------------- 限流 --------------------------------- */

test('createRateLimiter：窗口内超限拒绝，reset 后恢复', () => {
  const limiter = createRateLimiter({ limit: 2, windowMs: 1000 })
  assert.equal(limiter.check('a'), true)
  assert.equal(limiter.check('a'), true)
  assert.equal(limiter.check('a'), false)
  assert.equal(limiter.check('b'), true, '不同 key 互不影响')
  limiter.reset()
  assert.equal(limiter.check('a'), true)
})

/* ------------------------------ HTTP 层桩 ------------------------------ */

/** 构造假 req/res 直接调用 handler。 */
interface FakeResponse {
  status: number
  body: { ok: boolean; code?: string; message?: string; data?: Record<string, unknown>; viaProxy?: boolean }
}

function invoke(rawUrl: string | null, options: { method?: string; ip?: string } = {}): Promise<FakeResponse> {
  const query = rawUrl === null ? '' : `?url=${encodeURIComponent(rawUrl)}`
  const req = {
    method: options.method ?? 'GET',
    url: `/api/link-preview${query}`,
    headers: {} as Record<string, string>,
    socket: { remoteAddress: options.ip ?? '203.0.113.9' },
  }
  return new Promise((resolve, reject) => {
    let status = 0
    const res = {
      headersSent: false,
      writeHead(nextStatus: number) {
        status = nextStatus
        this.headersSent = true
      },
      end(payload: string) {
        try {
          resolve({ status, body: JSON.parse(payload) as FakeResponse['body'] })
        } catch (err) {
          reject(err as Error)
        }
      },
    }
    Promise.resolve(handleLinkPreview(req as never, res as never)).catch(reject)
  })
}

test('HTTP 405：非 GET/POST 方法拒绝', async () => {
  const r = await invoke('https://example.com/', { method: 'PUT' })
  assert.equal(r.status, 405)
  assert.equal(r.body.code, 'METHOD_NOT_ALLOWED')
  assert.ok(r.body.message && /仅支持 GET\/POST/.test(r.body.message))
})

test('HTTP 400：缺参 / file 协议 / 非 80-443 端口', async () => {
  const missing = await invoke(null)
  assert.equal(missing.status, 400)
  assert.equal(missing.body.code, 'BAD_REQUEST')

  const file = await invoke('file:///C:/secret.txt')
  assert.equal(file.status, 400)
  assert.equal(file.body.code, 'UNSUPPORTED_PROTOCOL')

  const port = await invoke('http://example.com:8080/path')
  assert.equal(port.status, 400)
  assert.equal(port.body.code, 'PORT_NOT_ALLOWED')

  const userinfo = await invoke('http://user:pass@example.com/')
  assert.equal(userinfo.status, 400)
  assert.equal(userinfo.body.code, 'BAD_REQUEST')
})

test('HTTP 403：localhost / 127.0.0.1 / [::1] / 169.254.169.254 / 192.168.1.1', async () => {
  for (const target of [
    'http://localhost/',
    'http://127.0.0.1/',
    'http://[::1]/',
    'http://169.254.169.254/latest/meta-data/',
    'http://192.168.1.1/',
  ]) {
    const r = await invoke(target)
    assert.equal(r.status, 403, `${target} 应返回 403`)
    assert.equal(r.body.code, 'BLOCKED_HOST')
    assert.ok(r.body.message && r.body.message.length > 0, '应带中文原因')
  }
})

test('HTTP 429：同 IP 超过 30 次/分钟', async () => {
  const ip = '198.51.100.7'
  for (let i = 0; i < 30; i++) {
    const r = await invoke('http://127.0.0.1/', { ip })
    assert.equal(r.status, 403, `第 ${i + 1} 次应仍被 SSRF 拒绝（未触发限流）`)
  }
  const limited = await invoke('http://127.0.0.1/', { ip })
  assert.equal(limited.status, 429)
  assert.equal(limited.body.code, 'RATE_LIMITED')
})

/* ------------------------- 本地桩：成功 / 413 / 415 / 404 / 重定向 ------------------------- */

interface StubServer {
  base: string
  hits: () => number
  close: () => Promise<void>
}

function startStub(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<StubServer> {
  return new Promise((resolve) => {
    let hits = 0
    const server = http.createServer((req, res) => {
      hits++
      handler(req, res)
    })
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve({
        base: `http://127.0.0.1:${port}`,
        hits: () => hits,
        close: () => new Promise((done) => server.close(() => done())),
      })
    })
  })
}

const stubServers: StubServer[] = []

after(async () => {
  await Promise.all(stubServers.map((s) => s.close()))
  // 还原代理环境变量（保持进程环境与进入时一致）
  for (const key of PROXY_ENV_KEYS) {
    const value = savedProxyEnv.get(key)
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

async function createStub(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<StubServer> {
  const stub = await startStub(handler)
  stubServers.push(stub)
  return stub
}

/** 开启测试钩子（允许私网 + 随机端口）。 */
function enablePrivateForTest(): void {
  lp.__setAllowPrivateForTest(true)
}

test('HTTP 200：成功解析 OG 并回写最终 URL', async () => {
  const stub = await createStub((req, res) => {
    if (req.url === '/page') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(
        '<html><head><meta property="og:title" content="桩页面"><meta property="og:image" content="/cover.png"></head></html>',
      )
      return
    }
    res.writeHead(404)
    res.end()
  })
  enablePrivateForTest()

  const r = await invoke(`${stub.base}/page`)
  assert.equal(r.status, 200)
  assert.equal(r.body.ok, true)
  assert.equal(r.body.data?.title, '桩页面')
  assert.equal(r.body.data?.image, `${stub.base}/cover.png`)
  assert.equal(r.body.data?.site, '127.0.0.1')
  assert.equal(r.body.data?.viaProxy, false, '未配置代理时应为直连')

  // 缓存：同 URL 第二次不再打到桩
  const before = stub.hits()
  const again = await invoke(`${stub.base}/page`)
  assert.equal(again.status, 200)
  assert.equal(stub.hits(), before, '成功结果应命中 10 分钟缓存')
})

test('HTTP 415：非 HTML（application/pdf）', async () => {
  const stub = await createStub((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/pdf' })
    res.end('%PDF-1.4')
  })
  enablePrivateForTest()

  const r = await invoke(`${stub.base}/doc.pdf`)
  assert.equal(r.status, 415)
  assert.equal(r.body.code, 'UNSUPPORTED_CONTENT_TYPE')
})

test('HTTP 413：响应体超过 512KB 立即中断', async () => {
  const stub = await createStub((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.write('<html><head><title>big</title></head><body>')
    // 分块写入 700KB，超过 512KB 上限
    for (let i = 0; i < 7; i++) res.write('x'.repeat(100 * 1024))
    res.end('</body></html>')
  })
  enablePrivateForTest()

  const r = await invoke(`${stub.base}/big`)
  assert.equal(r.status, 413)
  assert.equal(r.body.code, 'RESPONSE_TOO_LARGE')
})

test('HTTP 404：目标 404', async () => {
  const stub = await createStub((_req, res) => {
    res.writeHead(404, { 'Content-Type': 'text/html' })
    res.end('<html>not found</html>')
  })
  enablePrivateForTest()

  const r = await invoke(`${stub.base}/missing`)
  assert.equal(r.status, 404)
  assert.equal(r.body.code, 'UPSTREAM_NOT_FOUND')
})

test('重定向：跟随相对 Location（≤3 跳）', async () => {
  const stub = await createStub((req, res) => {
    if (req.url === '/start') {
      res.writeHead(302, { Location: '/final' })
      res.end()
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end('<html><head><title>最终页</title></head></html>')
  })
  enablePrivateForTest()

  const r = await invoke(`${stub.base}/start`)
  assert.equal(r.status, 200)
  assert.equal(r.body.data?.title, '最终页')
  assert.equal(r.body.data?.finalUrl, `${stub.base}/final`)
})

test('重定向到内网主机名：逐跳复验后拒绝', async () => {
  const stub = await createStub((_req, res) => {
    res.writeHead(302, { Location: 'http://localhost/secret' })
    res.end()
  })
  enablePrivateForTest()

  const r = await invoke(`${stub.base}/jump`)
  assert.equal(r.status, 403)
  assert.equal(r.body.code, 'BLOCKED_HOST')
})

/* -------------------------------- 代理支持 -------------------------------- */

test('resolveProxy：无配置 / 空白值 → null（直连）', () => {
  assert.equal(resolveProxy('https:'), null)
  assert.equal(resolveProxy('http:'), null)

  process.env.HTTPS_PROXY = '   '
  process.env.HTTP_PROXY = ''
  assert.equal(resolveProxy('https:'), null, '空白值按未配置处理')
  assert.equal(resolveProxy('http:'), null)
})

test('resolveProxy：按目标协议选变量，HTTPS_PROXY 不串用到 http 目标', () => {
  process.env.HTTPS_PROXY = 'http://127.0.0.1:1111'
  assert.deepEqual(resolveProxy('https:'), { host: '127.0.0.1', port: 1111, auth: null })
  assert.equal(resolveProxy('http:'), null, 'http 目标不应读 HTTPS_PROXY')

  process.env.HTTP_PROXY = 'http://127.0.0.1:2222'
  assert.deepEqual(resolveProxy('http:'), { host: '127.0.0.1', port: 2222, auth: null })

  // https 目标在 HTTPS_PROXY 缺失时也会读 HTTP_PROXY（很多环境只配这一个）
  delete process.env.HTTPS_PROXY
  assert.equal((resolveProxy('https:') as { port: number }).port, 2222, 'https 目标应回落到 HTTP_PROXY')
})

test('resolveProxy：小写变量可用，空值降级到下一个候选', () => {
  // 注意：Windows 的 process.env 大小写不敏感（HTTPS_PROXY 与 https_proxy 是同一个变量），
  // 因此「大写优先于小写」只在非 Windows 上可验证；两者的读取本身都覆盖到了。
  process.env.https_proxy = 'http://127.0.0.1:3333'
  assert.equal((resolveProxy('https:') as { port: number }).port, 3333, '小写变量应可用')

  if (process.platform !== 'win32') {
    process.env.HTTPS_PROXY = 'http://127.0.0.1:4444'
    assert.equal((resolveProxy('https:') as { port: number }).port, 4444, 'HTTPS_PROXY 优先于 https_proxy')
    delete process.env.HTTPS_PROXY
  }

  // 空值降级：HTTPS_PROXY/https_proxy 为空 → 回落到 ALL_PROXY
  process.env.HTTPS_PROXY = '   '
  delete process.env.https_proxy
  process.env.ALL_PROXY = 'http://127.0.0.1:5555'
  assert.equal((resolveProxy('https:') as { port: number }).port, 5555, '回落到 ALL_PROXY')
  assert.equal((resolveProxy('http:') as { port: number }).port, 5555, 'http 目标亦可回落 ALL_PROXY')
})

test('resolveProxy：user:pass → Basic 认证头；无端口默认 80', () => {
  process.env.HTTPS_PROXY = 'http://alice:s3cr3t@proxy.local'
  const proxy = resolveProxy('https:')
  assert.deepEqual(proxy, {
    host: 'proxy.local',
    port: 80,
    auth: `Basic ${Buffer.from('alice:s3cr3t').toString('base64')}`,
  })
})

test('resolveProxy：坏 URL / 非 http scheme / 缺主机 → null（按直连处理）', () => {
  for (const bad of ['not-a-url', 'socks5://127.0.0.1:1080', 'https://127.0.0.1:8443', 'http://', 'http://h:70000']) {
    process.env.HTTPS_PROXY = bad
    assert.equal(resolveProxy('https:'), null, `${bad} 应视为解析失败`)
  }
})

test('代理（HTTP）：absolute-form 转发 + Host / Proxy-Authorization，viaProxy=true', async () => {
  let seenUrl = ''
  let seenHost = ''
  let seenAuth = ''

  const origin = await createStub((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end('<html><head><title>不该被直连访问</title></head></html>')
  })
  const proxy = await createStub((req, res) => {
    seenUrl = String(req.url)
    seenHost = String(req.headers.host)
    seenAuth = String(req.headers['proxy-authorization'] ?? '')
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end('<html><head><meta property="og:title" content="经代理抓到的页面"></head></html>')
  })
  enablePrivateForTest()

  const proxyPort = Number(new URL(proxy.base).port)
  process.env.HTTP_PROXY = `http://user:pass@127.0.0.1:${proxyPort}`

  const r = await invoke(`${origin.base}/page`)
  assert.equal(r.status, 200)
  assert.equal(r.body.data?.title, '经代理抓到的页面')
  assert.equal(r.body.data?.viaProxy, true, '应标记为走代理')
  assert.equal(seenUrl, `${origin.base}/page`, '代理收到的应是 absolute-form 请求行')
  assert.equal(seenHost, new URL(origin.base).host, 'Host 头应保留目标站点')
  assert.equal(seenAuth, `Basic ${Buffer.from('user:pass').toString('base64')}`, '应带 Basic 代理认证')
  assert.equal(origin.hits(), 0, '不应绕过代理直连目标')
})

test('代理（HTTPS）：CONNECT 目标用已校验 IP，代理拒绝 → 502 + viaProxy=true', async () => {
  const seen = { method: '', line: '', host: '' }

  // CONNECT 请求走 server 的 'connect' 事件，普通 request handler 收不到
  const server = http.createServer((_req, res) => {
    res.writeHead(405)
    res.end()
  })
  server.on('connect', (req, socket) => {
    seen.method = String(req.method)
    seen.line = String(req.url)
    seen.host = String(req.headers.host)
    socket.write('HTTP/1.1 500 CONNECT_FAILED\r\n\r\n')
    socket.destroy()
  })
  const proxyPort = await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port))
  })
  stubServers.push({
    base: `http://127.0.0.1:${proxyPort}`,
    hits: () => 0,
    close: () => new Promise((done) => server.close(() => done())),
  })

  enablePrivateForTest()
  process.env.HTTPS_PROXY = `http://127.0.0.1:${proxyPort}`

  const target = 'https://127.0.0.1:8443/secret'
  const r = await invoke(target)
  assert.equal(r.status, 502)
  assert.equal(r.body.code, 'UPSTREAM_ERROR')
  assert.equal(r.body.viaProxy, true, '失败响应也应标记走代理')
  assert.match(String(r.body.message), /代理/, '应提示代理相关原因')
  assert.equal(seen.method, 'CONNECT')
  assert.equal(seen.line, '127.0.0.1:8443', 'CONNECT 目标必须是已校验 IP，不能是域名')
  assert.equal(seen.host, '127.0.0.1:8443')
  assert.doesNotMatch(String(r.body.message), /127\.0\.0\.1|8443/, '错误提示不得暴露代理/目标地址')
})
