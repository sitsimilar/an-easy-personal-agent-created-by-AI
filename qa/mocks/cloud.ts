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

/** 记录 database 查询链的调用序列（供断言 from/select/eq/gte/lte/order/limit）。 */
export const __dbCalls: string[] = []

export function __setDbResult(result: { data: unknown; error?: unknown }): void {
  dbResult = result
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
    return this
  }
  update(_rows: unknown): this {
    __dbCalls.push('update')
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
    return Promise.resolve(dbResult).then(resolve, reject)
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
