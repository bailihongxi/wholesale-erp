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
 *
 * V2.1-2.34 B 档起：如果所属表**有热缓存**，等值 / in 过滤直接在内存里做，
 * 不再发网络请求（`stock`、`locationStock`、单据主表这些高频读尤其明显）。
 * 返回的是**行副本**——调用方（库存过账）会就地改 quantity 再写回，
 * 直接给缓存行的引用会把「还没落库的值」污染进缓存。
 */
class CloudQuery {
  private eqVal: any = undefined
  private inVals: any[] | undefined = undefined

  constructor(
    private client: typeof supabase,
    private table: string,
    private field: string,
    /** 宿主表：用于读它的热缓存、以及删除后同步缓存 */
    private host?: { readCache(): any[] | null; evict(ids: any[]): void; invalidate(): void },
  ) {}

  equals(v: any): this { this.eqVal = v; return this }
  anyOf(arr: any[]): this { this.inVals = arr; return this }
  startsWithAnyOf(arr: string[]): this { this.inVals = arr; return this }

  /** 命中热缓存则返回过滤后的副本；没有缓存返回 null（继续走网络） */
  private readCache(): any[] | null {
    const rows = this.host?.readCache()
    if (!rows) return null
    let out = rows
    if (this.eqVal !== undefined) out = out.filter(r => (r as any)[this.field] === this.eqVal)
    if (this.inVals) {
      const set = new Set(this.inVals.map(v => String(v)))
      out = out.filter(r => set.has(String((r as any)[this.field])))
    }
    return out.map(r => ({ ...r }))
  }

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
    // B 档：命中热缓存就不发请求（返回的是副本，调用方可安全就地修改）
    const cached = this.readCache()
    if (cached) return this.applyFilter(cached) as T[]
    const { data: firstPage, error, count } = await this.build({ count: true }).range(0, ROW_PAGE - 1)
    if (error) throw new Error(`CloudQuery.toArray: ${error.message}`)
    const rows = (firstPage as T[]) || []
    const total = count ?? rows.length
    // ⚠️ 铁律：filter() 必须在下面那条「一页就取完」的快路径上也生效。
    //
    // 2026-09-25 事故：这行原本是 `return rows`，把 _filterFn 静默丢了（不报错）。
    // 于是 `db.payments.where('type').equals('pay').filter(p => p.refOrderId === id)`
    // 返回的是**全表同类型流水**：采购单详情的「付款记录」列出了所有采购单的付款，
    // 收款记录同理；recordPay/recordReceive 里的「已付合计」也把别的单据算进来，
    // 单据的 paid/partial 状态判断跟着一起错。
    // 只有超过 1000 行（走下面的翻页分支）才碰巧是对的 —— 数据量小的时候永远发现不了。
    if (total <= ROW_PAGE) return this.applyFilter(rows)
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
    return this.applyFilter(all)
  }

  /** filter() 的唯一落地点：快路径与翻页路径都必须走这里，别再各写一份 */
  private applyFilter<T>(rows: T[]): T[] {
    return this._filterFn ? rows.filter(this._filterFn) : rows
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
    // 挂了 filter() 就必须按过滤后的行数算（Dexie 语义如此）。服务端 count 是
    // 「先 count 再过滤」做不到的，只能走 toArray 拿过滤结果 —— 这也是
    // 2026-09-25 那个 filter 被吞的 bug 的同一类陷阱：不要以为 count() 会自动带上条件。
    if (this._filterFn) return (await this.toArray()).length
    // B 档：热缓存里数一下就够了，不用再发一次 head 请求
    const cached = this.readCache()
    if (cached) return cached.length
    const { count, error } = await this.build({ count: true, head: true })
    if (error) throw new Error(`CloudQuery.count: ${error.message}`)
    return count || 0
  }

  /** Dexie 兼容：按 where 条件删除（云端实现） */
  async delete(): Promise<number> {
    let q: any = this.client.from(this.table).delete()
    if (this.eqVal !== undefined) q = q.eq(this.field, this.eqVal)
    if (this.inVals) q = q.in(this.field, this.inVals)
    const { error } = await q
    if (error) throw new Error(`CloudQuery.delete: ${error.message}`)
    // B 档：删掉的行要同步从缓存里摘掉，否则读缓存还会读到已删的行
    const hit = this.readCache()
    if (hit && this.host) this.host.evict(hit.map(r => (r as any).id))
    return 1
  }
}

/** 基础档案表：变化少，启用内存缓存，切页面秒开 */
const CACHED_TABLES = new Set([
  'products', 'customers', 'suppliers', 'locations', 'users', 'rolePerms', 'stock',
  // B 档加入：库位库存以前不缓存，于是每次出库/改单都要把整张表重拉一遍（6000 行 = 7 个请求）
  'locationStock',
  // 业务主表也缓存：用户在页面间切换时不用重复拉全表
  // 写操作（增删改）会自动同步缓存，所以数据不会脏
  'saleOrders', 'purchaseOrders', 'quoteOrders',
])

/**
 * 缓存的保鲜期（V2.1-2.34 B 档）。
 *
 * 写操作不再「整表作废」而是「就地更新缓存行」——这样出一张单之后，
 * 库存/库位两张 6000 行的表不用重搬。代价是本机看不到**别的设备**的改动，
 * 所以给最易变的库存两张表加一个短保鲜期：超过 1 分钟没动过就自动重拉一次，
 * 跨设备的差异最多残留 1 分钟，之后自愈。
 * 档案类表（商品/客户/供应商…）变化更慢，给 5 分钟。
 * 设为 0 表示永不过期。
 */
const CACHE_TTL_MS: Record<string, number> = {
  stock: 60_000,
  locationStock: 60_000,
}
const DEFAULT_CACHE_TTL_MS = 5 * 60_000

export class CloudTable<T = any> {
  private _cache: T[] | null = null
  private _cachePromise: Promise<T[]> | null = null
  private _countCache: number | null = null
  /** 缓存建立时间，用于保鲜期判断 */
  private _cacheAt = 0

  constructor(
    private client: typeof supabase,
    public readonly name: string,
  ) {
    this.useCache = CACHED_TABLES.has(name)
  }
  private useCache: boolean

  /** 手动清缓存（新增/删除/改数据后自动同步；外部刷新也可调） */
  invalidate() {
    this._cache = null
    this._cachePromise = null
    this._countCache = null
    this._cacheAt = 0
  }

  /**
   * 读热缓存（B 档）：只有缓存存在**且未过保鲜期**才返回，否则作废重拉。
   * 供 CloudQuery 复用，避免同一个 where 条件还去发一次网络。
   */
  readCache(): T[] | null {
    if (!this.useCache || !this._cache) return null
    const ttl = CACHE_TTL_MS[this.name] ?? DEFAULT_CACHE_TTL_MS
    if (ttl > 0 && Date.now() - this._cacheAt > ttl) {
      this.invalidate()
      return null
    }
    return this._cache
  }

  /** 把删掉的行从缓存里摘掉（B 档：避免读缓存还能读到已删行） */
  evict(ids: any[]): void {
    const cache = this._cache as any[] | null
    if (!cache || !ids.length) return
    const kill = new Set(ids.filter(v => v != null).map(v => String(v)))
    const kept = cache.filter(r => !kill.has(String((r as any).id)))
    if (kept.length === cache.length) return
    this._cache = kept as T[]
    if (this._countCache !== null) this._countCache = kept.length
  }

  /**
   * 就地更新缓存（B 档核心）：把写下去的行同步进缓存，**不再整表作废**。
   *
   * @param allowInsert true = 这批行是 upsert 的整行，找不到就往缓存里加；
   *                    false = 只是局部 patch（update），缓存里没有该行时
   *                    拿不到完整行，必须返回 false 让调用方走 invalidate。
   * @returns true = 缓存已同步；false = 不适合增量，调用方应 invalidate
   */
  private patchCache(rows: any[], allowInsert: boolean): boolean {
    const cache = this._cache as any[] | null
    if (!cache) return true // 本来就没缓存，什么都不用做
    if (rows.some(r => r == null || r.id == null)) return false
    const idx = new Map<string, number>()
    cache.forEach((r, i) => idx.set(String((r as any).id), i))
    if (!allowInsert && rows.some(r => !idx.has(String(r.id)))) return false
    for (const r of rows) {
      const k = String(r.id)
      const i = idx.get(k)
      if (i === undefined) {
        cache.push(r)
        idx.set(k, cache.length - 1)
      } else {
        cache[i] = { ...(cache[i] as any), ...r }
      }
    }
    if (this._countCache !== null) this._countCache = cache.length
    return true
  }

  async toArray(): Promise<T[]> {
    if (this.useCache) {
      const fresh = this.readCache()
      if (fresh) return fresh
      if (this._cachePromise) return this._cachePromise
      this._cachePromise = this._fetchAll().then(d => {
        this._cache = d
        this._cacheAt = Date.now()
        this._cachePromise = null
        return d
      })
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

  /**
   * ⚠️ 语义陷阱（2026-09-25 登录误踢事故的根源，改动前务必读完）：
   * PostgREST 的 `.single()` 在「一条都没查到」时**也会返回 error**（code=PGRST116），
   * 所以「拿不到数据」和「请求失败」在这里是同一个信号——无法只凭 error 区分二者。
   * 因此本方法目前把任何失败都收敛成 `undefined`，**调用方只能当「没有这一行」处理**，
   * 绝不能推导出「这个记录不存在」以外的结论。
   *
   * 若将来要区分「没找到」与「请求失败」（例如启动时校验账号是否仍有效），
   * 正确做法是按 `error.code === 'PGRST116'` 分流：PGRST116 → undefined，其余 → throw。
   * 但那会让本方法对全部 50+ 个调用方从「软失败」变成「硬失败」，
   * 属于独立档次的改造，需逐个页面实机验证，不要夹带在日常发版里。
   */
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
    // B 档：写整行 → 直接同步进缓存；同步不了才整表作废
    if (!this.patchCache([{ ...obj, id: (data as any[])[0].id }], true)) this.invalidate()
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
    // B 档：整行 upsert → 逐行同步缓存（库存/库位表因此不必再整表重搬）
    if (!this.patchCache(objs, true)) this.invalidate()
  }

  async bulkAdd(objs: any[]): Promise<void> {
    if (!objs.length) return
    const { error } = await this.client.from(this.name).insert(objs)
    if (error) throw new Error(`${this.name}.bulkAdd: ${error.message}`)
    // 新增行拿不到服务端自增 id，缓存只能作废
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
    this.evict([id])
  }

  async bulkDelete(ids: (number | string)[]): Promise<void> {
    if (!ids.length) return
    const { error } = await this.client.from(this.name).delete().in('id', ids as any)
    if (error) throw new Error(`${this.name}.bulkDelete: ${error.message}`)
    this.evict(ids)
  }

  async clear(): Promise<void> {
    const { error } = await this.client.from(this.name).delete().neq("id", 0)
    if (error) throw new Error(`${this.name}.clear: ${error.message}`)
    this.invalidate()
  }

  async update(id: number | string, changes: Partial<T>): Promise<number> {
    const { error } = await this.client.from(this.name).update(changes as any).eq('id', id)
    if (error) throw new Error(`${this.name}.update: ${error.message}`)
    // 局部 patch：缓存里必须有该行才能安全合并，否则退回整表作废
    if (!this.patchCache([{ id, ...(changes as any) }], false)) this.invalidate()
    return 1
  }

  /**
   * 批量更新：一次请求更新多个id的记录
   * 每批最多500条，避免请求体过大
   */
  async bulkUpdate(ids: (number | string)[], changes: Partial<T>): Promise<number> {
    if (!ids.length) return 0
    const list = ids.filter(v => v !== null && v !== undefined)
    let updated = 0
    // 每批500条
    for (let i = 0; i < list.length; i += 500) {
      const chunk = list.slice(i, i + 500)
      const { error } = await this.client.from(this.name).update(changes as any).in('id', chunk as any)
      if (error) throw new Error(`${this.name}.bulkUpdate: ${error.message}`)
      updated += chunk.length
    }
    // 同一个 patch 应用到多行：缓存齐了就地合并，缺行则整表作废
    if (!this.patchCache(list.map(id => ({ id, ...(changes as any) })), false)) this.invalidate()
    return updated
  }

  async count(): Promise<number> {
    // 缓存表：count 跟随 toArray 同一生命周期，避免首页/设置页每次重发请求
    if (this.useCache && this._countCache !== null) return this._countCache
    const fresh = this.readCache()
    if (fresh) {
      this._countCache = fresh.length
      return this._countCache
    }
    const { count, error } = await this.client.from(this.name).select('*', { count: 'exact', head: true })
    if (error) throw new Error(`${this.name}.count: ${error.message}`)
    const n = count || 0
    if (this.useCache) this._countCache = n
    return n
  }

  where(field: string): CloudQuery {
    return new CloudQuery(this.client, this.name, field, this)
  }

  /**
   * Dexie 兼容：拉全表后在内存里过滤。
   *
   * ⚠️ 返回值是 **Promise**，不是数组——Dexie 的 filter() 返回 Collection，
   * 这里简化成一次性返回过滤后的数组，用 `await db.x.filter(f)` 取。
   * 需要条数请用 `(await db.x.filter(f)).length`，不要写 `.count()`（Promise 上没有）。
   *
   * 注意这是「先取回再过滤」，不是索引过滤：大表慎用。
   * 能走 where()/queryPage() 的服务端过滤优先用服务端，只有 pairs 这种
   * 「需要先拿到全量再按业务规则筛」的场景才用这里。
   */
  async filter(fn: (row: any) => boolean): Promise<T[]> {
    const rows = await this.toArray()
    return rows.filter(fn) as T[]
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
    let q: any = this.client.from(this.name).select('*', { count: 'estimated' } as any)
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
