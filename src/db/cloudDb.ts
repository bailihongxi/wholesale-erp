import { supabase, USE_CLOUD } from './supabaseClient'

/**
 * 模仿 Dexie Table 的常用 API，让业务代码（db.products.toArray() 等）零改动。
 * 只实现项目里实际用到的方法，缺什么补什么。
 */

/** orderBy 链式：reverse()/limit(n) 可链式，最终 toArray() 走 CloudTable.toArray 缓存 */
type OrderChain<T> = {
  reverse: () => OrderChain<T>
  limit: (n: number) => OrderChain<T>
  toArray: () => Promise<T[]>
}

/** 服务端分页查询选项 */
export interface QueryPageOpts {
  page?: number
  pageSize?: number
  eq?: Record<string, any>
  search?: { fields: string[]; keyword: string }
  orderBy?: string
  ascending?: boolean
}

/** 转义 PostgREST .or() 语法里的特殊字符，避免关键词破坏查询 */
function escapeOr(kw: string): string {
  return kw.replace(/([\\*,()%])/g, '\\$1')
}

class CloudQuery {
  private eqVal: any = undefined
  private inVals: any[] | undefined = undefined

  constructor(
    private client: typeof supabase,
    private table: string,
    private field: string,
  ) {}

  equals(v: any): this { this.eqVal = v; return this }
  anyOf(arr: any[]): this { this.inVals = arr; return this }
  startsWithAnyOf(arr: string[]): this { this.inVals = arr; return this }

  private build() {
    let q = this.client.from(this.table).select('*')
    if (this.eqVal !== undefined) q = q.eq(this.field, this.eqVal)
    if (this.inVals) q = q.in(this.field, this.inVals)
    return q
  }

  async toArray<T = any>(): Promise<T[]> {
    // Supabase select 默认只返回前 1000 行，自动并行分页拉完
    const PAGE = 1000
    const { data: firstPage, error, count } = await (this.build() as any).select('*', { count: 'exact' }).range(0, PAGE - 1)
    if (error) throw new Error(`CloudQuery.toArray: ${error.message}`)
    const rows = (firstPage as T[]) || []
    const total = count ?? rows.length
    if (total <= PAGE) return rows
    const pages = Math.ceil(total / PAGE) - 1
    const promises = []
    for (let i = 1; i <= pages; i++) {
      promises.push(this.build().range(i * PAGE, (i + 1) * PAGE - 1))
    }
    const results = await Promise.all(promises)
    const all = [...rows]
    for (const r of results) {
      if (r.error) throw new Error(`CloudQuery.toArray: ${r.error.message}`)
      all.push(...((r.data as T[]) || []))
    }
    return all
  }

  async first<T = any>(): Promise<T | undefined> {
    const arr = await this.toArray<T>()
    return arr[0]
  }

  async count(): Promise<number> {
    const { count, error } = await (this.build() as any).select("*", { count: "exact", head: true })
    if (error) throw new Error(`CloudQuery.count: ${error.message}`)
    return count || 0
  }
}

/** 基础档案表：变化少，启用内存缓存，切页面秒开 */
const CACHED_TABLES = new Set([
  'products', 'customers', 'suppliers', 'locations', 'users', 'rolePerms',
  // 业务主表也缓存：用户在页面间切换时不用重复拉全表
  // 写操作（增删改）会自动 invalidate，所以数据不会脏
  'saleOrders', 'purchaseOrders', 'quoteOrders',
])

export class CloudTable<T = any> {
  private _cache: T[] | null = null
  private _cachePromise: Promise<T[]> | null = null
  private _countCache: number | null = null

  constructor(
    private client: typeof supabase,
    public readonly name: string,
  ) {
    this.useCache = CACHED_TABLES.has(name)
  }
  private useCache: boolean

  /** 手动清缓存（新增/删除/改数据后自动清；外部刷新也可调） */
  invalidate() {
    this._cache = null
    this._cachePromise = null
    this._countCache = null
  }

  async toArray(): Promise<T[]> {
    if (this.useCache) {
      if (this._cache) return this._cache
      if (this._cachePromise) return this._cachePromise
      this._cachePromise = this._fetchAll().then(d => { this._cache = d; this._cachePromise = null; return d })
      return this._cachePromise
    }
    return this._fetchAll()
  }

  private async _fetchAll(): Promise<T[]> {
    // Supabase select 默认只返回前 1000 行，自动并行分页拉完
    const PAGE = 1000
    // 先拉第1页 + 总数
    const { data: firstPage, error, count } = await this.client
      .from(this.name).select('*', { count: 'exact' } as any).range(0, PAGE - 1)
    if (error) throw new Error(`${this.name}.toArray: ${error.message}`)
    const rows = (firstPage as T[]) || []
    const total = count ?? rows.length
    if (total <= PAGE) return rows
    // 并行拉剩余页
    const pages = Math.ceil(total / PAGE) - 1
    const promises = []
    for (let i = 1; i <= pages; i++) {
      promises.push(this.client.from(this.name).select('*').range(i * PAGE, (i + 1) * PAGE - 1))
    }
    const results = await Promise.all(promises)
    const all = [...rows]
    for (const r of results) {
      if (r.error) throw new Error(`${this.name}.toArray: ${r.error.message}`)
      all.push(...((r.data as T[]) || []))
    }
    return all
  }

  async get(id: number | string): Promise<T | undefined> {
    const { data, error } = await this.client.from(this.name).select('*').eq('id', id).single()
    if (error) return undefined
    return data as T
  }

  /** put：有 id 就 upsert（覆盖），没 id 就 insert */
  async put(obj: any): Promise<number> {
    const { data, error } = await this.client.from(this.name).upsert(obj).select('id')
    if (error) throw new Error(`${this.name}.put: ${error.message}`)
    this.invalidate()
    return (data as any[])[0].id
  }

  async add(obj: any): Promise<number> {
    const { data, error } = await this.client.from(this.name).insert(obj).select('id')
    if (error) throw new Error(`${this.name}.add: ${error.message}`)
    this.invalidate()
    return (data as any[])[0].id
  }

  async bulkPut(objs: any[]): Promise<void> {
    if (!objs.length) return
    const { error } = await this.client.from(this.name).upsert(objs)
    if (error) throw new Error(`${this.name}.bulkPut: ${error.message}`)
    this.invalidate()
  }

  async bulkAdd(objs: any[]): Promise<void> {
    if (!objs.length) return
    const { error } = await this.client.from(this.name).insert(objs)
    if (error) throw new Error(`${this.name}.bulkAdd: ${error.message}`)
    this.invalidate()
  }

  /** 批量插入并返回新插入行的 id（绕过 Supabase select 1000 行限制） */
  async bulkAddReturningIds(objs: any[]): Promise<number[]> {
    if (!objs.length) return []
    const { data, error } = await this.client.from(this.name).insert(objs).select('id')
    if (error) throw new Error(`${this.name}.bulkAddReturningIds: ${error.message}`)
    this.invalidate()
    return (data as any[]).map(r => r.id)
  }

  async delete(id: number | string): Promise<void> {
    const { error } = await this.client.from(this.name).delete().eq('id', id)
    if (error) throw new Error(`${this.name}.delete: ${error.message}`)
    this.invalidate()
  }

  async bulkDelete(ids: (number | string)[]): Promise<void> {
    if (!ids.length) return
    const { error } = await this.client.from(this.name).delete().in('id', ids as any)
    if (error) throw new Error(`${this.name}.bulkDelete: ${error.message}`)
    this.invalidate()
  }

  async clear(): Promise<void> {
    const { error } = await this.client.from(this.name).delete().neq("id", 0)
    if (error) throw new Error(`${this.name}.clear: ${error.message}`)
    this.invalidate()
  }

  async update(id: number | string, changes: Partial<T>): Promise<number> {
    const { error } = await this.client.from(this.name).update(changes as any).eq('id', id)
    if (error) throw new Error(`${this.name}.update: ${error.message}`)
    this.invalidate()
    return 1
  }

  async count(): Promise<number> {
    // 缓存表：count 跟随 toArray 同一生命周期，避免首页/设置页每次重发请求
    if (this.useCache && this._countCache !== null) return this._countCache
    if (this.useCache && this._cache) {
      this._countCache = (this._cache as T[]).length
      return this._countCache
    }
    const { count, error } = await this.client.from(this.name).select('*', { count: 'exact', head: true })
    if (error) throw new Error(`${this.name}.count: ${error.message}`)
    const n = count || 0
    if (this.useCache) this._countCache = n
    return n
  }

  where(field: string): CloudQuery {
    return new CloudQuery(this.client, this.name, field)
  }

  /** Dexie 兼容：按字段排序（走 toArray 缓存，大表也不会每次重拉全量）；reverse()/limit(n) 可链式 */
  orderBy(field: string): OrderChain<T> {
    const self = this
    const builder: any = {
      _reversed: false,
      _lim: Infinity,
      reverse() { this._reversed = true; return this },
      limit(n: number) { this._lim = n; return this },
      async toArray() {
        const all = await self.toArray()
        const sorted = (all as any[]).slice().sort((a: any, b: any) => {
          const av = a[field], bv = b[field]
          if (av == null) return 1
          if (bv == null) return -1
          if (av < bv) return -1
          if (av > bv) return 1
          return 0
        })
        if (this._reversed) sorted.reverse()
        return this._lim === Infinity ? sorted : sorted.slice(0, this._lim)
      },
    }
    return builder as OrderChain<T>
  }

  /** 服务端分页：只拉当前页 + 带总数，支持等值过滤与多字段模糊搜索。大表列表首屏专用。 */
  async queryPage(opts: QueryPageOpts = {}): Promise<{ rows: T[]; total: number }> {
    const page = Math.max(1, opts.page ?? 1)
    const pageSize = opts.pageSize ?? 20
    const start = (page - 1) * pageSize
    const end = start + pageSize - 1
    let q: any = this.client.from(this.name).select('*', { count: 'exact' } as any)
    if (opts.eq) {
      for (const [k, v] of Object.entries(opts.eq)) {
        if (v !== '' && v !== null && v !== undefined) q = q.eq(k, v)
      }
    }
    if (opts.search && opts.search.keyword) {
      const kw = opts.search.keyword.trim()
      if (kw) {
        const parts = (opts.search.fields ?? []).map(f => `${f}.ilike.*${escapeOr(kw)}*`)
        if (parts.length) q = q.or(parts.join(','))
      }
    }
    if (opts.orderBy) q = q.order(opts.orderBy, { ascending: !!opts.ascending })
    const { data, error, count } = await q.range(start, end)
    if (error) throw new Error(`${this.name}.queryPage: ${error.message}`)
    return { rows: (data as T[]) || [], total: count ?? 0 }
  }

  /** 取某字段的去重值列表（用于分类下拉等），窄字段全量拉一次前端去重 */
  async distinct(field: string): Promise<string[]> {
    const { data, error } = await this.client.from(this.name).select(field)
    if (error) throw new Error(`${this.name}.distinct: ${error.message}`)
    const set = new Set<string>()
    for (const r of (data as any[]) || []) {
      const v = r[field]
      if (v) set.add(String(v))
    }
    return [...set].sort()
  }
}

/**
 * 云端版 db：结构与 Dexie db 一致（db.products / db.users ...），
 * 业务代码 import { db } 不用改，只是后端从 IndexedDB 换成 Supabase。
 */
export function createCloudDb() {
  const tables = [
    'users', 'customers', 'suppliers', 'products', 'locations',
    'stock', 'locationStock',
    'purchaseOrders', 'purchaseOrderItems',
    'saleOrders', 'saleOrderItems',
    'stockRecords',
    'transferOrders', 'transferItems',
    'stocktakes', 'stocktakeItems',
    'returnOrders', 'returnItems',
    'payments', 'ledgerEntries', 'auditLogs', 'rolePerms',
    'quoteOrders', 'quoteOrderItems',
  ] as const

  const db: Record<string, CloudTable> = {}
  for (const t of tables) db[t] = new CloudTable(supabase, t)

  /** 登录后预拉常用缓存表到内存，后续切页面命中缓存秒开（不阻塞首屏）。失败静默忽略。 */
  async function warmUp(): Promise<void> {
    if (!USE_CLOUD) return
    const warm = ['products', 'customers', 'suppliers', 'users', 'locations', 'rolePerms']
    await Promise.allSettled(
      warm.map(t => {
        const tbl = (db as Record<string, CloudTable>)[t]
        return tbl ? tbl.toArray().catch(() => {}) : Promise.resolve()
      })
    )
  }

  return Object.assign(db, { warmUp }) as any
}
