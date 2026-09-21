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
  /** 范围过滤（日期/数值），键为字段名，值为 ISO/日期串 */
  gte?: Record<string, string>
  lte?: Record<string, string>
  /** in 过滤：键为字段名，值为候选数组（如 customerId 列表） */
  inFilter?: Record<string, any[]>
  /** 原始 PostgREST or 表达式，用于跨字段 OR（如 单号模糊 OR 对方ID in） */
  orExpr?: string
  /**
   * 本地/测试模式专用的自定义行匹配（云端 queryPage 会忽略它）。
   * 用于「跨表名搜索」：例如按客户名搜销售单，云端用 orExpr 解析客户ID，
   * 本地模式没有 orExpr 语义，就用 extraFilter 直接对行做 OR 匹配。
   */
  extraFilter?: (row: any) => boolean
  orderBy?: string
  ascending?: boolean
}

/** 转义 PostgREST .or() 语法里的特殊字符，避免关键词破坏查询 */
export function escapeOr(kw: string): string {
  return kw.replace(/([\\*,()%])/g, '\\$1')
}

/**
 * Supabase/PostgREST 单次请求最多返回 1000 行（服务的 db-max-rows 上限）。
 * 实测：即使 `.range(0, 9999)` 也只回 1000 行；但 `.range(1000, 1999)` 能正常取到第 2 页，
 * 所以「超过 1000 就必须靠 Range 并行翻页」，没有别的办法一次拿全。
 */
const ROW_PAGE = 1000

/**
 * 按字段等值 / in 过滤的查询链（Dexie `where().equals()` 的云端对应物）。
 */
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

  /**
   * ⚠️ 铁律：`{ count }` / `{ head }` 必须在 `client.from().select()` 这一次调用里传。
   *
   * PostgREST 的 select 选项只在这一层生效。一旦链式变成 FilterBuilder（`.eq()` 之后），
   * 再调 `.select('*', { count: 'exact' })` 只会替换列名，**选项被静默忽略、不报错**，
   * count 回 null、head 失效。
   *
   * 历史实现正是 `this.build().select('*', { count: 'exact' })` 这种链式二次 select：
   *   → toArray 拿到的 count 恒为 null，退化成 rows.length = 1000，
   *     于是 `total <= 1000` 直接 return，第 2 页永远不拉 ——「选商品只显示 1000 条」的根因；
   *   → count() 的 head 失效，恒返回 0。
   * 所以这里必须按需从 from() 重新构建，绝不能改回链式二次 select。
   */
  private build(opts: { count?: boolean; head?: boolean } = {}) {
    let q: any = opts.count || opts.head
      ? this.client.from(this.table).select('*', { count: 'exact', head: !!opts.head } as any)
      : this.client.from(this.table).select('*')
    if (this.eqVal !== undefined) q = q.eq(this.field, this.eqVal)
    if (this.inVals) q = q.in(this.field, this.inVals)
    return q
  }

  async toArray<T = any>(): Promise<T[]> {
    const { data: firstPage, error, count } = await this.build({ count: true }).range(0, ROW_PAGE - 1)
    if (error) throw new Error(`CloudQuery.toArray: ${error.message}`)
    const rows = (firstPage as T[]) || []
    const total = count ?? rows.length
    if (total <= ROW_PAGE) return rows
    // 并行拉剩余页：6281 行 = 1 + 6 个请求，而不是 7 次串行
    const pages = Math.ceil(total / ROW_PAGE) - 1
    const promises = []
    for (let i = 1; i <= pages; i++) {
      promises.push(this.build().range(i * ROW_PAGE, (i + 1) * ROW_PAGE - 1))
    }
    const results = await Promise.all(promises)
    const all = [...rows]
    for (const r of results) {
      if (r.error) throw new Error(`CloudQuery.toArray: ${r.error.message}`)
      all.push(...((r.data as T[]) || []))
    }
    return this._filterFn ? all.filter(this._filterFn) : all
  }

  async first<T = any>(): Promise<T | undefined> {
    const arr = await this.toArray<T>()
    return arr[0]
  }

  /** Dexie 兼容：前端 filter（拉完再过滤） */
  filter(fn: (row: any) => boolean): this {
    this._filterFn = fn
    return this
  }
  private _filterFn?: (row: any) => boolean

  async count(): Promise<number> {
    const { count, error } = await this.build({ count: true, head: true })
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
    // Supabase 单次请求最多 1000 行，自动并行分页拉完
    const PAGE = ROW_PAGE
    // 先拉第 1 页 + 总数（count 必须在 from().select() 这一步传入才生效）
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

  /**
   * Dexie 兼容：按 id 批量取（只发 `id in (...)` 查询，不拉全表）。
   *
   * ⚠️ 必须保持**入参顺序**——调用方用 `products[i]` 与 `ids[i]` 一一对齐
   * （见 stores/quotes.ts 报价单转销售单）。顺序一错就会把 A 商品的名字/进价
   * 挂到 B 行的 id 上，属于静默串数据的严重问题。
   * 找不到的 id 返回 undefined，与 Dexie 行为一致。
   *
   * id 多于 1000 个时分批（每批 500），绕开单请求 1000 行上限。
   */
  async bulkGet(ids: (number | string)[]): Promise<(T | undefined)[]> {
    const list = ids ?? []
    if (!list.length) return []
    const byId = new Map<string, T>()
    const want = list.filter(v => v !== null && v !== undefined)
    for (let i = 0; i < want.length; i += 500) {
      const chunk = want.slice(i, i + 500)
      const { data, error } = await this.client.from(this.name).select('*').in('id', chunk as any)
      if (error) throw new Error(`${this.name}.bulkGet: ${error.message}`)
      for (const row of (data as T[]) || []) byId.set(String((row as any).id), row)
    }
    return list.map(id => byId.get(String(id)))
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
    if (opts.gte) {
      for (const [k, v] of Object.entries(opts.gte)) { if (v != null && v !== '') q = q.gte(k, v) }
    }
    if (opts.lte) {
      for (const [k, v] of Object.entries(opts.lte)) { if (v != null && v !== '') q = q.lte(k, v) }
    }
    if (opts.inFilter) {
      for (const [k, vals] of Object.entries(opts.inFilter)) {
        if (Array.isArray(vals) && vals.length) q = q.in(k, vals as any)
      }
    }
    if (opts.orExpr) q = q.or(opts.orExpr)
    if (opts.orderBy) q = q.order(opts.orderBy, { ascending: !!opts.ascending })
    const { data, error, count } = await q.range(start, end)
    if (error) throw new Error(`${this.name}.queryPage: ${error.message}`)
    return { rows: (data as T[]) || [], total: count ?? 0 }
  }

  /**
   * 窄字段扫描：只取指定列、按 Range 并行翻页拉完（绕过单次 1000 行上限）。
   *
   * 用于「分类下拉」「有货商品 id」这类只需要一两列、却可能超过 1000 行的集合：
   * 相比 toArray() 拉全字段全量，传输量与内存占用小一个数量级。
   */
  async scanNarrow<R = any>(fields: string, apply?: (q: any) => any): Promise<R[]> {
    const build = (withCount: boolean) => {
      // 同 CloudQuery：count 只能在 from().select() 这一步开
      let q: any = withCount
        ? this.client.from(this.name).select(fields, { count: 'exact' } as any)
        : this.client.from(this.name).select(fields)
      if (apply) q = apply(q)
      return q
    }
    const { data, error, count } = await build(true).range(0, ROW_PAGE - 1)
    if (error) throw new Error(`${this.name}.scanNarrow: ${error.message}`)
    const rows = (data as R[]) || []
    const total = count ?? rows.length
    if (total <= ROW_PAGE) return rows
    const pages = Math.ceil(total / ROW_PAGE) - 1
    const results = await Promise.all(
      Array.from({ length: pages }, (_, i) =>
        build(false).range((i + 1) * ROW_PAGE, (i + 2) * ROW_PAGE - 1)
      )
    )
    const all = [...rows]
    for (const r of results) {
      if (r.error) throw new Error(`${this.name}.scanNarrow: ${r.error.message}`)
      all.push(...((r.data as R[]) || []))
    }
    return all
  }

  /**
   * 取某字段的去重值列表（用于分类下拉等）。
   * 窄字段并行翻页，商品 6281 条时也不会只看到前 1000 条里的那几个分类。
   */
  async distinct(field: string): Promise<string[]> {
    const rows = await this.scanNarrow<Record<string, any>>(field)
    const set = new Set<string>()
    for (const r of rows) {
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
