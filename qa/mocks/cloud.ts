/**
 * cloud 模块 mock（供 QA 纯 Node 环境测试 aiService / recordService 使用）。
 * 替换 web/src/lib/cloud.ts，提供可配置的 llm 与 database。
 * - llm：__setCloudMock / __resetCloudMock
 * - database：__setDbResult / __resetDbCalls（__dbCalls 记录查询链调用）
 */
export interface CloudMockState {
  modelsList: () => Array<{ id: string; disabled?: boolean }>
  chatCreate: (args: unknown) => AsyncIterable<unknown>
}

let state: CloudMockState = {
  modelsList: () => [{ id: 'mock-model' }],
  chatCreate: () => (async function* () {})(),
}

export function __setCloudMock(s: Partial<CloudMockState>): void {
  state = { ...state, ...s }
}

export function __resetCloudMock(): void {
  state = {
    modelsList: () => [{ id: 'mock-model' }],
    chatCreate: () => (async function* () {})(),
  }
}

/* ------------------------- database mock ------------------------- */

let dbResult: { data: unknown; error?: unknown } = { data: [] }

/** FIFO 结果队列：逐次 await 消费，用于模拟「条件更新 0 行 / 1 行」等多段查询。 */
const dbQueue: Array<{ data: unknown; error?: unknown }> = []

/** 记录 database 查询链的调用序列（供断言 from/select/eq/gte/lte/order/limit）。 */
export const __dbCalls: string[] = []

/**
 * 写入载荷记录（P0 增补，向后兼容）：
 * - `__dbInserts`：每次 insert 的行数据（断言「复制字段是否正确」）；
 * - `__dbUpdates`：每次 update 的字段对象（断言「回写 recurrence_next_id / 补偿恢复 pending」）。
 * `__dbCalls` 里的 token 格式保持不变，避免影响既有断言。
 */
export const __dbInserts: unknown[] = []
export const __dbUpdates: Array<Record<string, unknown>> = []

export function __resetDbWrites(): void {
  __dbInserts.length = 0
  __dbUpdates.length = 0
}

export function __setDbResult(result: { data: unknown; error?: unknown }): void {
  dbResult = result
}

/** 按 FIFO 预置多次查询结果；队列取空后回落到 __setDbResult 的固定结果。 */
export function __queueDbResults(results: Array<{ data: unknown; error?: unknown }>): void {
  for (const r of results) dbQueue.push(r)
}

/** 清空结果队列（每个用例开始前调用）。 */
export function __resetDbQueue(): void {
  dbQueue.length = 0
}

export function __resetDbCalls(): void {
  __dbCalls.length = 0
}

class QueryBuilder {
  select(...cols: unknown[]): this {
    __dbCalls.push(`select(${cols.join(',')})`)
    return this
  }
  or(filter: string): this {
    __dbCalls.push(`or(${filter})`)
    return this
  }
  insert(_rows: unknown): this {
    __dbCalls.push('insert')
    __dbInserts.push(_rows)
    return this
  }
  update(rows: unknown): this {
    // 记录被更新的字段名，便于断言「回写 recurrence_next_id」等具体写入
    const keys = rows && typeof rows === 'object' ? Object.keys(rows as Record<string, unknown>).join(',') : ''
    __dbCalls.push(`update(${keys})`)
    if (rows && typeof rows === 'object') __dbUpdates.push(rows as Record<string, unknown>)
    return this
  }
  delete(): this {
    __dbCalls.push('delete')
    return this
  }
  maybeSingle(): this {
    __dbCalls.push('maybeSingle')
    return this
  }
  eq(col: string, val: unknown): this {
    __dbCalls.push(`eq(${col},${JSON.stringify(val)})`)
    return this
  }
  gte(col: string, val: unknown): this {
    __dbCalls.push(`gte(${col},${JSON.stringify(val)})`)
    return this
  }
  lte(col: string, val: unknown): this {
    __dbCalls.push(`lte(${col},${JSON.stringify(val)})`)
    return this
  }
  order(col: string, opts?: { ascending?: boolean }): this {
    __dbCalls.push(`order(${col},asc:${opts?.ascending})`)
    return this
  }
  contains(col: string, val: unknown): this {
    __dbCalls.push(`contains(${col},${JSON.stringify(val)})`)
    return this
  }
  neq(col: string, val: unknown): this {
    __dbCalls.push(`neq(${col},${JSON.stringify(val)})`)
    return this
  }
  in(col: string, val: unknown): this {
    __dbCalls.push(`in(${col},${JSON.stringify(val)})`)
    return this
  }
  range(from: number, to: number): this {
    __dbCalls.push(`range(${from},${to})`)
    return this
  }
  upsert(_rows: unknown, _opts?: unknown): this {
    __dbCalls.push('upsert')
    return this
  }
  limit(n: number): this {
    __dbCalls.push(`limit(${n})`)
    return this
  }
  then<T>(resolve: (v: unknown) => T, reject: (e: unknown) => T): Promise<T> {
    const next = dbQueue.length > 0 ? (dbQueue.shift() as { data: unknown; error?: unknown }) : dbResult
    return Promise.resolve(next).then(resolve, reject)
  }
}

export const cloud = {
  llm: {
    models: {
      list: () => state.modelsList(),
    },
    chat: {
      completions: {
        create: (args: unknown) => state.chatCreate(args),
      },
    },
  },
  database: {
    from: (table: string): QueryBuilder => {
      __dbCalls.push(`from(${table})`)
      return new QueryBuilder()
    },
  },
}
