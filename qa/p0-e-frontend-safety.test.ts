/**
 * P0 前端安全与降级 · 测试（QA 独立补充）。
 *
 * 覆盖：
 * - C5 封面只读展示安全（`LinkCover` 源码级约束：仅 http(s)、onError 隐藏、16:9、不撑破布局）；
 * - C5 详情链接新窗口 + noreferrer；
 * - C4 `fetchLinkMeta` 6s 超时 / 永不抛错 / 失败降级；
 * - C1 `enrichLinkMeta` 为 fire-and-forget（保存链路不 await，静态验证）；
 * - A 提醒候选查询条件（recordService.listReminderCandidates 的查询链）。
 */
import { test, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { InfoRecord } from '../shared/types/domain'

const ROOT = typeof __dirname === 'string' ? path.resolve(__dirname, '..', '..') : process.cwd()

function readSource(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), 'utf8')
}

/* ------------------------- C5 封面展示安全（静态） ------------------------- */

test('C5 LinkCover：仅 http(s) 渲染 + onError 隐藏 + 16:9 裁切', () => {
  const src = readSource('web/src/components/LinkCover.tsx')

  assert.match(src, /isHttpUrl\(image\)/, '必须用 isHttpUrl 守卫，避免 javascript:/data: 注入')
  assert.match(src, /broken \|\| !isHttpUrl\(image\)/, '守卫与 onError 状态必须一起短路渲染')
  assert.match(src, /onError=\{\(\) => setBroken\(true\)\}/, '加载失败必须隐藏（返回 null 而非留占位）')
  assert.match(src, /aspectRatio: '16 \/ 9'/, '必须 16:9')
  assert.match(src, /objectFit: 'cover'/, '必须裁切填充')
  assert.match(src, /loading="lazy"/, '应懒加载')
  assert.match(src, /referrerPolicy="no-referrer"/, '不应泄露来源页')
  assert.match(src, /return null/, '失败时返回 null，不占位')
})

test('C5 详情/卡片：外链新窗口打开且带 noreferrer', () => {
  const detail = readSource('web/src/components/RecordDetail.tsx')
  assert.match(detail, /target="_blank"/, '链接应新窗口打开')
  assert.match(detail, /rel="noreferrer"/, '必须带 noreferrer')
  assert.match(detail, /isHttpUrl\(record\.url\)/, '非 http(s) 链接不应作为外链渲染')
})

test('C5 域名角标：link_meta.site 优先，缺失时由 record.url 推导（不二次抓取）', () => {
  const card = readSource('web/src/components/RecordCard.tsx')
  assert.match(card, /record\.linkMeta\?\.site \|\| prettyHost\(record\.url\)/)
  const detail = readSource('web/src/components/RecordDetail.tsx')
  assert.match(detail, /record\.linkMeta\?\.site \|\| prettyHost\(record\.url\)/)
})

test('C1 enrichLinkMeta 为 fire-and-forget（保存链路不 await）', () => {
  const dialog = readSource('web/src/components/RecordCreateDialog.tsx')
  const createIdx = dialog.indexOf('recordService.createRecord')
  const enrichIdx = dialog.indexOf('void enrichLinkMeta(created)')

  assert.ok(createIdx > 0, '应调用 createRecord')
  assert.ok(enrichIdx > createIdx, '抓取必须发生在创建成功之后')
  assert.doesNotMatch(dialog, /await enrichLinkMeta/, '保存链路不得 await 抓取（C1：保存 ≤1s）')
})

/* ---------------------------- C4 fetchLinkMeta ---------------------------- */

type FetchLike = typeof globalThis.fetch

const realFetch = globalThis.fetch

beforeEach(() => {
  globalThis.fetch = realFetch
})

function stubFetch(impl: FetchLike): void {
  globalThis.fetch = impl
}

test('C4 fetchLinkMeta：POST + JSON body 调代理（线上 WAF 只放行 POST），成功映射为 ok 元数据', async () => {
  const { fetchLinkMeta } = await import('../web/src/services/linkPreviewService')
  let calledUrl = ''
  let calledInit: RequestInit | undefined
  stubFetch(((input: RequestInfo | URL, init?: RequestInit) => {
    calledUrl = String(input)
    calledInit = init
    return Promise.resolve(
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            title: '标题',
            description: '描述',
            image: 'https://cdn.example.com/a.png',
            site: 'example.com',
            finalUrl: 'https://example.com/a',
            fetchedAt: '2026-10-12T00:00:00.000Z',
            status: 'ok',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
  }) as FetchLike)

  const meta = await fetchLinkMeta('https://example.com/a')

  // 传输契约：POST + JSON body（GET 查询参数会被腾讯云 WAF 403 拦截）
  assert.equal(calledUrl, '/api/link-preview', '不得把 URL 放进查询参数')
  assert.equal(calledInit?.method, 'POST')
  const headers = (calledInit?.headers ?? {}) as Record<string, string>
  assert.equal(headers['Content-Type'], 'application/json')
  assert.deepEqual(JSON.parse(String(calledInit?.body)), { url: 'https://example.com/a' })

  assert.equal(meta.status, 'ok')
  assert.equal(meta.title, '标题')
  assert.equal(meta.description, '描述')
  assert.equal(meta.image, 'https://cdn.example.com/a.png')
  assert.equal(meta.site, 'example.com')
  assert.equal(meta.fetchedAt, '2026-10-12T00:00:00.000Z')
})

test('C4 fetchLinkMeta：服务端 4xx/5xx → failed + 服务端错误码，不抛错', async () => {
  const { fetchLinkMeta } = await import('../web/src/services/linkPreviewService')

  for (const [status, code] of [
    [404, 'UPSTREAM_NOT_FOUND'],
    [415, 'UNSUPPORTED_CONTENT_TYPE'],
    [413, 'RESPONSE_TOO_LARGE'],
    [504, 'TIMEOUT'],
    [403, 'BLOCKED_HOST'],
  ] as Array<[number, string]>) {
    stubFetch((async () =>
      new Response(JSON.stringify({ ok: false, code, message: 'x' }), {
        status,
        headers: { 'content-type': 'application/json' },
      })) as FetchLike)

    const meta = await fetchLinkMeta('https://example.com/')
    assert.equal(meta.status, 'failed', `${status} 应降级为 failed`)
    assert.equal(meta.errorCode, code)
  }
})

test('C4 fetchLinkMeta：非 JSON 响应体 → 回落到 HTTP_<status> 错误码且不抛错', async () => {
  const { fetchLinkMeta } = await import('../web/src/services/linkPreviewService')
  stubFetch((async () => new Response('<html>oops</html>', { status: 502 })) as FetchLike)

  const meta = await fetchLinkMeta('https://example.com/')
  assert.equal(meta.status, 'failed')
  assert.equal(meta.errorCode, 'HTTP_502')
})

test('C4 fetchLinkMeta：网络异常 → NETWORK_ERROR，不抛错', async () => {
  const { fetchLinkMeta } = await import('../web/src/services/linkPreviewService')
  stubFetch((async () => {
    throw new TypeError('fetch failed')
  }) as FetchLike)

  const meta = await fetchLinkMeta('https://example.com/')
  assert.equal(meta.status, 'failed')
  assert.equal(meta.errorCode, 'NETWORK_ERROR')
})

test('C4 fetchLinkMeta：6s 超时中止 → TIMEOUT（POST 路径，不永久 loading）', async (t) => {
  const { fetchLinkMeta } = await import('../web/src/services/linkPreviewService')
  mock.timers.enable({ apis: ['setTimeout'] })
  t.after(() => mock.timers.reset())

  let aborted = false
  let method = ''
  stubFetch(((input: RequestInfo | URL, init?: RequestInit) => {
    method = String(init?.method ?? '')
    const signal = init?.signal
    return new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => {
        aborted = true
        const err = new Error('aborted')
        err.name = 'AbortError'
        reject(err)
      })
    })
  }) as FetchLike)

  const pending = fetchLinkMeta('https://example.com/slow')
  // 5.9s 仍未超时（服务端 5s + 1s 余量）
  mock.timers.tick(5900)
  assert.equal(aborted, false, '6s 前不应中止')
  assert.equal(method, 'POST', '超时用例同样走 POST')

  mock.timers.tick(200)
  const meta = await pending
  assert.equal(aborted, true, '6s 应触发 AbortController')
  assert.equal(meta.status, 'failed')
  assert.equal(meta.errorCode, 'TIMEOUT')
})

test('C4 fetchLinkMeta：非 http(s) 直接失败且不发请求', async () => {
  const { fetchLinkMeta } = await import('../web/src/services/linkPreviewService')
  let calls = 0
  stubFetch((async () => {
    calls++
    throw new Error('should not be called')
  }) as FetchLike)

  for (const url of ['javascript:alert(1)', 'file:///etc/passwd', '', 'data:text/html,<b>x</b>']) {
    const meta = await fetchLinkMeta(url)
    assert.equal(meta.status, 'failed')
    assert.equal(meta.errorCode, 'INVALID_URL')
  }
  assert.equal(calls, 0, '非法协议不应发起请求')
})

test('C1/C2 isHttpUrl + prettyHost：展示用域名推导', async () => {
  const { isHttpUrl, prettyHost } = await import('../web/src/services/linkPreviewService')

  assert.equal(isHttpUrl('https://www.github.com/a'), true)
  assert.equal(isHttpUrl('http://example.com'), true)
  assert.equal(isHttpUrl('ftp://example.com'), false)
  assert.equal(isHttpUrl(null), false)
  assert.equal(prettyHost('https://www.github.com/a/b'), 'github.com')
  assert.equal(prettyHost('not a url'), '')
})

/* --------------------- C6/A 历史记录不自动抓取 & 候选查询 --------------------- */

test('C6 历史记录不自动重抓：只有创建后与手动重试两处触发抓取', () => {
  const detail = readSource('web/src/components/RecordDetail.tsx')
  const card = readSource('web/src/components/RecordCard.tsx')
  const page = readSource('web/src/pages/TodoPage.tsx')

  assert.match(detail, /retryLinkMeta/, '详情应有手动「重新抓取」入口')
  assert.doesNotMatch(card, /enrichLinkMeta|fetchLinkMeta|retryLinkMeta/, '卡片不得自动抓取')
  assert.doesNotMatch(page, /enrichLinkMeta|fetchLinkMeta/, '列表页不得自动抓取')
  assert.doesNotMatch(detail, /enrichLinkMeta/, '详情不得在打开时自动抓取（仅手动）')
})

test('A 提醒候选查询：todo + pending + 未删除 + remind_at 区间 + 升序 + limit 200', async () => {
  const { __dbCalls, __resetDbCalls, __setDbResult } = await import('./mocks/cloud')
  const { recordService } = await import('../web/src/services/recordService')

  __resetDbCalls()
  __setDbResult({ data: [] })

  const from = '2026-10-11T00:00:00.000Z'
  const to = '2026-10-12T01:00:00.000Z'
  const result = await recordService.listReminderCandidates(from, to)

  assert.deepEqual(result, [])
  assert.deepEqual(__dbCalls, [
    'from(records)',
    'select(*)',
    'eq(is_deleted,false)',
    'eq(type,"todo")',
    'eq(todo_status,"pending")',
    `gte(remind_at,${JSON.stringify(from)})`,
    `lte(remind_at,${JSON.stringify(to)})`,
    'order(remind_at,asc:true)',
    'limit(200)',
  ])
})

test('A 提醒候选查询：行数据经 mapRecord 归一（脏 recurrence/link_meta → null）', async () => {
  const { __resetDbCalls, __setDbResult } = await import('./mocks/cloud')
  const { recordService } = await import('../web/src/services/recordService')

  __resetDbCalls()
  __setDbResult({
    data: [
      {
        id: 1,
        owner_id: 'u1',
        type: 'todo',
        title: '提醒我',
        content: null,
        url: null,
        file_path: null,
        category: null,
        tags: null,
        summary: null,
        todo_status: 'pending',
        priority: null,
        remind_at: '2026-10-12T01:00:00.000Z',
        recurrence: { freq: 'weekly', interval: 0, weekdays: [1, 9] },
        recurrence_parent_id: null,
        recurrence_next_id: null,
        link_meta: 'not-json',
        is_deleted: false,
        deleted_at: null,
        created_at: '2026-10-01T00:00:00.000Z',
        updated_at: '2026-10-01T00:00:00.000Z',
      },
    ],
  })

  const [record] = await recordService.listReminderCandidates('2026-10-11T00:00:00.000Z', '2026-10-12T02:00:00.000Z')

  assert.equal(record.id, 1)
  assert.equal(record.remindAt, '2026-10-12T01:00:00.000Z')
  assert.deepEqual(record.recurrence, { freq: 'weekly', interval: 1, endDate: null, weekdays: [1] }, '脏规则被归一')
  assert.equal(record.linkMeta, null, '脏 link_meta 归一为 null')
})

test('C2 回归：link_meta 为空的历史记录不得显示「未能抓取网页信息」', () => {
  const detail = readSource('web/src/components/RecordDetail.tsx')

  // 修复后必须是「先判存在，再判状态」；旧写法 `linkMeta?.status !== 'ok'` 会把 null 也命中
  assert.match(detail, /\{record\.linkMeta && record\.linkMeta\.status !== 'ok' && \(/)
  assert.doesNotMatch(detail, /\{record\.linkMeta\?\.status !== 'ok' && \(/)
})

/* ------------------- C1 保存后异步回填（fire-and-forget 结果） ------------------- */

/** 构造一条链接类记录（material）。 */
function materialRecord(over: Partial<InfoRecord> = {}): InfoRecord {
  return {
    id: 88,
    type: 'material',
    title: '',
    content: '',
    url: 'https://github.com/foo/bar',
    filePath: null,
    category: null,
    tags: [],
    summary: null,
    todoStatus: null,
    priority: null,
    remindAt: null,
    recurrence: null,
    recurrenceParentId: null,
    recurrenceNextId: null,
    linkMeta: null,
    isDeleted: false,
    deletedAt: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...over,
  } as InfoRecord
}

function stubOgSuccess(title: string): void {
  stubFetch((async () =>
    new Response(
      JSON.stringify({
        ok: true,
        data: { title, description: '描述', image: 'https://cdn.example.com/c.png', site: 'github.com', status: 'ok' },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )) as FetchLike)
}

test('C1 enrichLinkMeta：标题为空 → 回填 link_meta 且补 title', async () => {
  const { __dbUpdates, __resetDbCalls, __resetDbWrites, __setDbResult } = await import('./mocks/cloud')
  const { enrichLinkMeta } = await import('../web/src/services/linkPreviewService')

  __resetDbCalls()
  __resetDbWrites()
  __setDbResult({ data: [{ id: 88, type: 'material', title: 'GitHub 标题', is_deleted: false }] })
  stubOgSuccess('GitHub 标题')

  const meta = await enrichLinkMeta(materialRecord({ title: '   ' }))

  assert.equal(meta?.status, 'ok')
  assert.equal(meta?.title, 'GitHub 标题')
  const patch = __dbUpdates[__dbUpdates.length - 1] ?? {}
  assert.ok('link_meta' in patch, '必须写 link_meta')
  assert.equal(patch.title, 'GitHub 标题', '原标题为空应回填')
})

test('C1 enrichLinkMeta：用户已填标题 → 只写 link_meta，不覆盖 title', async () => {
  const { __dbUpdates, __resetDbCalls, __resetDbWrites, __setDbResult } = await import('./mocks/cloud')
  const { enrichLinkMeta } = await import('../web/src/services/linkPreviewService')

  __resetDbCalls()
  __resetDbWrites()
  __setDbResult({ data: [{ id: 88, type: 'material', title: '我的标题', is_deleted: false }] })
  stubOgSuccess('网页标题')

  await enrichLinkMeta(materialRecord({ title: '我的标题' }))

  const patch = __dbUpdates[__dbUpdates.length - 1] ?? {}
  assert.ok('link_meta' in patch)
  assert.ok(!('title' in patch), '不得覆盖用户已填标题')
})

test('C2 enrichLinkMeta：抓取失败 → 写入 failed 元数据，不抛错（记录照常保存）', async () => {
  const { __dbUpdates, __resetDbCalls, __resetDbWrites, __setDbResult } = await import('./mocks/cloud')
  const { enrichLinkMeta } = await import('../web/src/services/linkPreviewService')

  __resetDbCalls()
  __resetDbWrites()
  __setDbResult({ data: [{ id: 88, type: 'material', title: '我的标题', is_deleted: false }] })
  stubFetch((async () => new Response(JSON.stringify({ ok: false, code: 'UPSTREAM_NOT_FOUND' }), { status: 404 })) as FetchLike)

  const meta = await enrichLinkMeta(materialRecord({ title: '我的标题' }))

  assert.equal(meta?.status, 'failed')
  assert.equal(meta?.errorCode, 'UPSTREAM_NOT_FOUND')
  const patch = __dbUpdates[__dbUpdates.length - 1] ?? {}
  assert.equal((patch.link_meta as { status?: string })?.status, 'failed')
  assert.ok(!('title' in patch), '失败时不得写标题')
})

test('C2 enrichLinkMeta：落库异常被吞掉（保存链路不受影响）', async () => {
  const { __resetDbCalls, __resetDbWrites, __setDbResult } = await import('./mocks/cloud')
  const { enrichLinkMeta } = await import('../web/src/services/linkPreviewService')

  __resetDbCalls()
  __resetDbWrites()
  __setDbResult({ data: null, error: new Error('db down') })
  stubOgSuccess('随便')

  const meta = await enrichLinkMeta(materialRecord())

  assert.equal(meta, null, '异常时应静默返回 null，不向外抛')
})

test('C1 enrichLinkMeta：非 material / 非 http(s) 不发请求', async () => {
  const { enrichLinkMeta } = await import('../web/src/services/linkPreviewService')
  let calls = 0
  stubFetch((async () => {
    calls++
    throw new Error('should not be called')
  }) as FetchLike)

  assert.equal(await enrichLinkMeta(materialRecord({ type: 'idea' })), null)
  assert.equal(await enrichLinkMeta(materialRecord({ url: 'ftp://x/y' })), null)
  assert.equal(calls, 0)
})

/** 类型守卫：确保测试里构造的记录形状与领域类型一致（编译期约束，运行期无副作用）。 */
export type _RecordShape = InfoRecord
