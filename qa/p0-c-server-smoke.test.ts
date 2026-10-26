/**
 * P0-C 部署服务冒烟测试（QA 独立补充）：真实启动 `node server.js`，用真实 HTTP 请求验收。
 *
 * 覆盖 PRD C3 / §5「代理端点」在**部署形态**下的行为：
 * - 代理路由必须优先于静态托管与 SPA 回退（`GET /` 仍返回页面、`/version.json` 仍返回版本）；
 * - 方法/协议/端口/私网四类拒绝在真实服务上生效。
 *
 * 说明：本用例会占用端口 3410 并启动子进程，结束时 kill。
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import { readFileSync } from 'node:fs'

const PORT = 3410
const BASE = `http://127.0.0.1:${PORT}`
// 编译产物位于 qa/dist/<name>.cjs，向上两级即仓库根目录。
const ROOT = typeof __dirname === 'string' ? path.resolve(__dirname, '..', '..') : process.cwd()

let child: ChildProcess | null = null
let startupLog = ''

/** 端口是否已被占用。 */
function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer()
    probe.once('error', () => resolve(false))
    probe.once('listening', () => probe.close(() => resolve(true)))
    probe.listen(port, '127.0.0.1')
  })
}

/** 轮询等待服务可用。 */
async function waitForServer(timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/version.json`)
      if (res.ok) return
    } catch {
      /* 还没起来 */
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`server.js 未在 ${timeoutMs}ms 内就绪；启动日志：\n${startupLog}`)
}

before(async () => {
  assert.ok(await portFree(PORT), `端口 ${PORT} 已被占用，无法启动 server.js 冒烟测试`)
  child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout?.on('data', (buf: Buffer) => {
    startupLog += buf.toString()
  })
  child.stderr?.on('data', (buf: Buffer) => {
    startupLog += buf.toString()
  })
  await waitForServer()
})

after(() => {
  if (child && child.exitCode === null) child.kill()
  child = null
})

test('真实 server.js：GET / 仍返回页面（代理路由不破坏静态托管）', async () => {
  const res = await fetch(`${BASE}/`)
  const body = await res.text()

  assert.equal(res.status, 200)
  assert.match(String(res.headers.get('content-type')), /text\/html/)
  assert.match(body, /<div id="root">|<html/i)
})

test('真实 server.js：GET /version.json 返回 package.json 版本号', async () => {
  const expected = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version as string
  const res = await fetch(`${BASE}/version.json`)
  const body = (await res.json()) as { version?: string }

  assert.equal(res.status, 200)
  assert.equal(body.version, expected)
})

/** POST 预览端点（生产主路径：WAF 只放行 body，不放行 GET 查询参数里的 URL）。 */
async function postPreview(url: string | null): Promise<Response> {
  return fetch(`${BASE}/api/link-preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: url ?? '' }),
  })
}

test('真实 server.js：PUT /api/link-preview → 405（POST 已是合法主路径）', async () => {
  const res = await fetch(`${BASE}/api/link-preview`, { method: 'PUT' })
  const body = (await res.json()) as { ok: boolean; code?: string }

  assert.equal(res.status, 405)
  assert.equal(body.ok, false)
  assert.equal(body.code, 'METHOD_NOT_ALLOWED')
})

test('真实 server.js：POST 缺 url → 400 BAD_REQUEST', async () => {
  const res = await postPreview(null)
  const body = (await res.json()) as { code?: string; message?: string }

  assert.equal(res.status, 400)
  assert.equal(body.code, 'BAD_REQUEST')
  assert.ok(body.message, '应带中文原因')
})

test('真实 server.js：POST 坏 JSON → 400 BAD_REQUEST', async () => {
  const res = await fetch(`${BASE}/api/link-preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{not-json',
  })
  const body = (await res.json()) as { code?: string }

  assert.equal(res.status, 400)
  assert.equal(body.code, 'BAD_REQUEST')
})

test('真实 server.js：POST http://127.0.0.1/ → 403 BLOCKED_HOST（C3 主机层校验）', async () => {
  const res = await postPreview('http://127.0.0.1/')
  const body = (await res.json()) as { code?: string; message?: string }

  assert.equal(res.status, 403)
  assert.equal(body.code, 'BLOCKED_HOST')
  assert.ok(body.message, '应带中文原因')
})

test('真实 server.js：POST file:// → 400 UNSUPPORTED_PROTOCOL（C3）', async () => {
  const res = await postPreview('file:///etc/passwd')
  const body = (await res.json()) as { code?: string }

  assert.equal(res.status, 400)
  assert.equal(body.code, 'UNSUPPORTED_PROTOCOL')
})

test('真实 server.js：POST 非 80/443 端口 → 400 PORT_NOT_ALLOWED（C3）', async () => {
  const res = await postPreview('http://example.com:8080/')
  const body = (await res.json()) as { code?: string }

  assert.equal(res.status, 400)
  assert.equal(body.code, 'PORT_NOT_ALLOWED')
})

test('真实 server.js：url 指向本机（自带端口）→ 4xx 拒绝，中文原因（C3）', async () => {
  const res = await postPreview(`${BASE}/`)
  const body = (await res.json()) as { ok: boolean; code?: string; message?: string }

  // 端口校验先于主机校验：3410 不是 80/443 → 400 PORT_NOT_ALLOWED（同样满足 C3「4xx + 中文原因」）
  assert.ok(res.status >= 400 && res.status < 500, `应为 4xx，实际 ${res.status}`)
  assert.equal(body.ok, false)
  assert.ok(['PORT_NOT_ALLOWED', 'BLOCKED_HOST'].includes(String(body.code)), `应被拒绝，实际 ${body.code}`)
  assert.match(String(body.message), /[\u4e00-\u9fa5]/, '必须带中文原因')
})

test('真实 server.js：GET 兼容路径仍可用（本地开发），127.0.0.1 → 403', async () => {
  const res = await fetch(`${BASE}/api/link-preview?url=${encodeURIComponent('http://127.0.0.1/')}`)
  const body = (await res.json()) as { code?: string }

  assert.equal(res.status, 403)
  assert.equal(body.code, 'BLOCKED_HOST')
})

test('真实 server.js：GET /api/link-preview 永不返回原始 HTML（仅 JSON）', async () => {
  const res = await fetch(`${BASE}/api/link-preview?url=${encodeURIComponent('http://127.0.0.1/')}`)
  const raw = await res.text()

  assert.match(String(res.headers.get('content-type')), /application\/json/)
  assert.doesNotMatch(raw, /<html|<meta/i)
})

test('公开站点成功路径（POST https://example.com）', async (t) => {
  let res: Response
  try {
    res = await fetch(`${BASE}/api/link-preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/' }),
      signal: AbortSignal.timeout(15_000),
    })
  } catch (error) {
    // 只有「外部网络不可用」才允许 skip（超时/中断）。其余异常——例如我们自己的服务没起来、
    // 连接被拒、响应无法解析——必须让用例失败：否则真缺陷会被伪装成「未验证」而漏过去。
    const name = (error as { name?: string } | undefined)?.name ?? ''
    if (name !== 'TimeoutError' && name !== 'AbortError') throw error
    t.skip(`当前环境网络受限（${name}），公开站点抓取未验证`)
    return
  }

  if (res.status === 502 || res.status === 504) {
    t.skip(`当前环境无法访问公网（HTTP ${res.status}），公开站点抓取未验证`)
    return
  }

  const body = (await res.json()) as { ok: boolean; data?: { title?: string; site?: string } }
  assert.equal(res.status, 200)
  assert.equal(body.ok, true)
  assert.ok((body.data?.title ?? '').length > 0, 'title 不应为空')
  assert.equal(body.data?.site, 'example.com')
})
