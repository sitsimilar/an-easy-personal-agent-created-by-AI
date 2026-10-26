/**
 * P0-C 域名解析回归（QA 补的**缺陷钉死**用例，2026-10 线上 502 事故）。
 *
 * ## 事故与为什么要单独一个文件
 *
 * `requestOnce` 用 `lookup` 钩子把连接钉在已校验 IP 上（防 DNS rebinding），旧写法是：
 * ```js
 * lookup: (_host, _opts, cb) => cb(null, pinned.address, pinned.family)
 * ```
 * 但 Node ≥ 20 在 `module.request` 内部以 `{ all: true }` 调用 lookup，回调**必须返回数组**，
 * 否则 `ERR_INVALID_IP_ADDRESS: Invalid IP address: undefined` → 建连前就抛错 → 502。
 * 结果是：**只要目标是域名（非 IP 字面量），每一次抓取都必 502**；
 * 而 `https://example.com` 这类线上真实场景全是域名，于是 P0-C 全线 502。
 *
 * ## 为什么既有用例全绿却没抓到（本文件存在的意义）
 *
 * `qa/p0-c-link-preview-http.test.ts` / `p0-c-transport-post.test.ts` 都是打
 * `http://127.0.0.1:PORT` —— hostname 是 **IP 字面量**，`net` 直接跳过 lookup，
 * 于是「lookup 回调签名错」这个缺陷被完全绕过。
 * 教训：**SSRF/钉 IP 这套逻辑的本地桩不能再只用 IP 字面量**，必须至少有一条
 * 「域名 + 可注入 DNS」的路径。本文件即该路径，且刻意写死断言，
 * 不允许为了变绿而放宽（修复前应失败、修复后必须通过）。
 *
 * ## 依赖的测试钩子（工程师实现）
 * - `__setLookupForTest(fn)`：非 null 时 `resolveHost` 用它替代真实 DNS；
 *   `fn: (hostname) => Promise<Array<{ address: string, family: number }>>`；传 `null` 复位。
 * - `__setAllowPrivateForTest(true)`：允许连本地桩（桩在 127.0.0.1）。
 * - `__resetForTest()`：清缓存/限流，并复位上面两个钩子。
 */
import { test, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import lp from '../server/link-preview.js'

/** 单次请求的客户端侧兜底超时（服务端自身 5s deadline，这里留足余量防挂住套件）。 */
const CLIENT_TIMEOUT_MS = 8000

/**
 * 测试期间清空代理环境变量：本文件所有目标都是注入 DNS 后落到 `127.0.0.1` 的本地桩，
 * 若本机/CI 配了 `HTTP_PROXY` 等，请求会被真的交给代理（代理解析不到 `example.test`），
 * 于是与被测逻辑无关地 502。代理路径本身由 `qa/link-preview.test.ts` 用本地假代理覆盖。
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
  ok: boolean
  code?: string
  message?: string
  data?: { title?: string; site?: string; viaProxy?: unknown }
  contentType: string
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
    // 动态端口（listen 0），避免与其他测试文件/并行进程抢固定端口
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

/** HTML 桩站点，带命中计数（用于断言「没有重复外呼」）。 */
async function htmlStub(html: string, status = 200): Promise<Srv & { hits: () => number }> {
  let hits = 0
  const base = await listen((_req, res) => {
    hits += 1
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(html)
  })
  return Object.assign(base, { hits: () => hits })
}

function toResp(res: Response, raw: string): Resp {
  const body = JSON.parse(raw) as { ok?: boolean; code?: string; message?: string; data?: Resp['data'] }
  return {
    status: res.status,
    ok: body.ok === true,
    code: body.code,
    message: body.message,
    data: body.data,
    contentType: String(res.headers.get('content-type') ?? ''),
  }
}

/** 生产主路径：POST + JSON body（GET 兼容路径单独在用例 1 里验证）。 */
async function post(srv: Srv, targetUrl: string): Promise<Resp> {
  const res = await fetch(`${srv.base}/api/link-preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: targetUrl }),
    signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS),
  })
  return toResp(res, await res.text())
}

async function get(srv: Srv, targetUrl: string): Promise<Resp> {
  const res = await fetch(`${srv.base}/api/link-preview?url=${encodeURIComponent(targetUrl)}`, {
    method: 'GET',
    signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS),
  })
  return toResp(res, await res.text())
}

/**
 * 断言「可注入 DNS」的测试钩子存在。
 *
 * 若钩子缺失（工程师还没落地），用明确的中文原因失败，而不是抛一个难懂的 TypeError。
 */
function requireLookupHook(): (fn: unknown) => void {
  const setter = (lp as unknown as { __setLookupForTest?: (fn: unknown) => void }).__setLookupForTest
  assert.equal(
    typeof setter,
    'function',
    '缺少测试钩子 __setLookupForTest：域名路径无法用本地桩验证（该钩子是本次缺陷回归的前提）',
  )
  return setter as (fn: unknown) => void
}

/** 注入固定 DNS 结果（模拟域名解析，但连接落到本地桩）。 */
function stubLookup(addresses: Array<{ address: string; family: number }>): void {
  const setter = requireLookupHook()
  setter(async () => addresses)
}

beforeEach(() => {
  // 复位缓存/限流 + allowPrivate + lookup 钩子
  lp.__resetForTest()
})

after(async () => {
  await Promise.all(servers.map((s) => s.close()))
})

/* ====================================================================== *
 * 1. 域名路径打通（核心回归：修复前必 502，修复后必须 ok:true）
 * ====================================================================== */

test('域名路径打通：可注入 DNS + 域名请求必须成功解析（修复前 502）', async () => {
  const stub = await htmlStub(`<html><head>
    <title>HTML 兜底标题</title>
    <meta property="og:title" content="域名路径标题">
    <meta property="og:description" content="域名路径描述">
  </head><body>ok</body></html>`)
  const svc = await previewService()
  lp.__setAllowPrivateForTest(true)
  // 域名 example.test 解析到本地桩；注意 URL 里带的是**域名**，不是 IP 字面量
  stubLookup([{ address: '127.0.0.1', family: 4 }])

  const r = await post(svc, `http://example.test:${new URL(stub.base).port}/`)

  assert.equal(r.status, 200, '域名目标必须 200（修复前因 lookup 回调签名错 → 502）')
  assert.equal(r.ok, true)
  assert.equal(r.data?.title, '域名路径标题', 'OG 标题应被解析（证明真的取到了 HTML）')
  // Host 头必须保留域名，不能被改写成钉住的 IP（否则 site 会变成 127.0.0.1）
  assert.equal(r.data?.site, 'example.test', 'site 应来自原域名，证明 Host 未被 IP 覆盖')
  // viaProxy 只断言类型：真假取决于运行环境是否配置了 HTTP(S)_PROXY
  assert.equal(typeof r.data?.viaProxy, 'boolean', 'data.viaProxy 必须是布尔（线上排障用）')

  // GET 兼容路径同样要走通（两条传输共用同一套建连逻辑）
  const viaGet = await get(svc, `http://example.test:${new URL(stub.base).port}/`)
  assert.equal(viaGet.status, 200, 'GET 兼容路径也必须 200')
  assert.equal(viaGet.data?.title, '域名路径标题')
})

/* ====================================================================== *
 * 2. IPv4 优先 + 坏地址跳过
 * ====================================================================== */

test('地址选择：IPv6 不可达在前、IPv4 在后时仍能成功（跳过不可达地址）', async () => {
  const stub = await htmlStub('<html><head><title>v4 可达</title></head></html>')
  const svc = await previewService()
  lp.__setAllowPrivateForTest(true)
  // ::1 上没有桩（连接必然失败），127.0.0.1 才有
  stubLookup([
    { address: '::1', family: 6 },
    { address: '127.0.0.1', family: 4 },
  ])

  const r = await post(svc, `http://prefer-v4.test:${new URL(stub.base).port}/`)

  assert.equal(r.status, 200, '应选中可达的 IPv4，而不是只用列表第一个地址')
  assert.equal(r.ok, true)
  assert.equal(r.data?.title, 'v4 可达')
  assert.equal(stub.hits(), 1, '不应因地址切换而对上游发两次请求')
})

/* ====================================================================== *
 * 3. 全部地址不可达 → 502 且结构化 JSON
 * ====================================================================== */

test('全部地址不可达：502 UPSTREAM_ERROR，且响应体是结构化 JSON（不是挂住/空响应）', async () => {
  const svc = await previewService()
  lp.__setAllowPrivateForTest(true)
  stubLookup([{ address: '::1', family: 6 }]) // 只有不可达地址

  const r = await post(svc, `http://unreachable.test:${new URL(svc.base).port}/`)

  assert.equal(r.status, 502)
  assert.equal(r.ok, false, '必须是 { ok:false } 结构')
  assert.equal(r.code, 'UPSTREAM_ERROR')
  assert.ok(r.message && r.message.length > 0, '必须带中文原因')
  assert.match(r.contentType, /application\/json/, '错误也必须是 JSON，不能是空响应')
})

/* ====================================================================== *
 * 4. 切换地址不能污染 HTTP 语义（404 不能变 502，且不得重复外呼）
 * ====================================================================== */

test('HTTP 语义不被切换污染：坏地址在前 + 桩返回 404 → 仍是 404，且上游只被请求 1 次', async () => {
  const stub = await htmlStub('<html><body>not found</body></html>', 404)
  const svc = await previewService()
  lp.__setAllowPrivateForTest(true)
  stubLookup([
    { address: '::1', family: 6 }, // 先失败
    { address: '127.0.0.1', family: 4 }, // 再成功建连
  ])

  const r = await post(svc, `http://not-found.test:${new URL(stub.base).port}/missing`)

  assert.equal(r.status, 404, '上游 404 必须原样返回，不能因为「先连失败过」就变 502')
  assert.equal(r.code, 'UPSTREAM_NOT_FOUND')
  assert.equal(stub.hits(), 1, '地址回退不得导致对同一上游重复请求')
})

/* ====================================================================== *
 * 5. 新增的地址选择逻辑不得绕过私网闸门
 * ====================================================================== */

test('DNS 返回私网地址时仍 403 BLOCKED_HOST（新增切换逻辑不得绕过私网校验）', async () => {
  const svc = await previewService()
  // 关键：不调用 __setAllowPrivateForTest(true)，保持生产档位的拦截行为
  lp.__setAllowPrivateForTest(false)
  stubLookup([{ address: '10.0.0.7', family: 4 }])

  const r = await post(svc, 'http://internal.test/')

  assert.equal(r.status, 403, '私网地址必须被拦（与是否新增地址选择逻辑无关）')
  assert.equal(r.code, 'BLOCKED_HOST')
  assert.ok(r.message && r.message.length > 0, '必须带中文原因')
})

/* ====================================================================== *
 * 6.（补充）同族地址失败回退 —— 真正驱动回退循环的那条路径
 *
 * 用例 2 的 `[::1 v6, 127.0.0.1 v4]` 会被 `orderAddresses` 的 IPv4 优先排序重排，
 * `::1` 根本不会被尝试，验的是「排序生效」，**没有走到**「建连失败 → 换下一个候选」
 * 这段代码（含 `deadline - Date.now() > 200` 预算门限）。
 *
 * 同族地址（都是 v4）排序不会改变顺序，首个候选必然 ECONNREFUSED，
 * 因此能确定性驱动回退，且不依赖任何网络状态。
 * ====================================================================== */

test('同族地址失败回退：首个 v4 不可达 → 换下一个 v4 成功（不重复外呼、不污染站点名、不超预算）', async () => {
  const stub = await htmlStub('<html><head><title>回退后可达</title></head></html>')
  const svc = await previewService()
  lp.__setAllowPrivateForTest(true)
  const port = new URL(stub.base).port
  // 桩只 listen 在 127.0.0.1；127.0.0.2 同族（v4）→ 排序不交换顺序 → 必先失败
  stubLookup([
    { address: '127.0.0.2', family: 4 },
    { address: '127.0.0.1', family: 4 },
  ])

  const startedAt = Date.now()
  const r = await post(svc, `http://fallback.test:${port}/`)
  const elapsed = Date.now() - startedAt

  assert.equal(r.status, 200, '首个地址被拒后必须回退到下一个候选（不回退则 502）')
  assert.equal(r.ok, true)
  assert.equal(r.data?.title, '回退后可达')
  // 回退 ≠ 重发请求：失败那次在建连阶段即终止，从未触及上游
  assert.equal(stub.hits(), 1, '回退不得导致对同一上游重复请求')
  // siteOf 取 finalUrl 的 hostname，不能被钉住的 IP 污染
  assert.equal(r.data?.site, 'fallback.test', '站点名必须仍来自域名，不能变成钉住的 IP')
  // 回退不应把时间预算消耗两倍：必须仍在服务端 5s deadline 之内
  assert.ok(elapsed < 5000, `回退后总耗时 ${elapsed}ms 应 < 服务端 5s deadline`)
})
