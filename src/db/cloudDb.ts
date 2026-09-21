import { supabase } from './supabaseClient'

/**
 * 模仿 Dexie Table 的常用 API，让业务代码（db.products.toArray() 等）零改动。
 * 只实现项目里实际用到的方法，缺什么补什么。
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

  private build() {
    let q = this.client.from(this.table).select('*')
    if (this.eqVal !== undefined) q = q.eq(this.field, this.eqVal)
    if (this.inVals) q = q.in(this.field, this.inVals)
    return q
  }

  async toArray<T = any>(): Promise<T[]> {
    const { data, error } = await this.build()
    if (error) throw new Error(`CloudQuery.toArray: ${error.message}`)
    return (data as T[]) || []
  }

  async first<T = any>(): Promise<T | undefined> {
    const arr = await this.toArray<T>()
    return arr[0]
  }
}

/** 基础档案表：变化少，启用内存缓存，切页面秒开 */
const CACHED_TABLES = new Set([
  'products', 'customers', 'suppliers', 'locations', 'users', 'rolePerms',
])

export class CloudTable<T = any> {
  private _cache: T[] | null = null
  private _cachePromise: Promise<T[]> | null = null

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
    const { data, error } = await this.client.from(this.name).select('*')
    if (error) throw new Error(`${this.name}.toArray: ${error.message}`)
    return (data as T[]) || []
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

  async update(id: number | string, changes: Partial<T>): Promise<number> {
    const { error } = await this.client.from(this.name).update(changes as any).eq('id', id)
    if (error) throw new Error(`${this.name}.update: ${error.message}`)
    this.invalidate()
    return 1
  }

  async count(): Promise<number> {
    const { count, error } = await this.client.from(this.name).select('*', { count: 'exact', head: true })
    if (error) throw new Error(`${this.name}.count: ${error.message}`)
    return count || 0
  }

  where(field: string): CloudQuery {
    return new CloudQuery(this.client, this.name, field)
  }

  /** Dexie 兼容：按字段排序（在内存里排，因为数据量小） */
  orderBy(field: string): { reverse: () => { toArray: () => Promise<T[]> } } {
    return {
      reverse: () => ({
        toArray: async () => {
          const all = await this._fetchAll()
          return all.slice().sort((a: any, b: any) => {
            const av = a[field], bv = b[field]
            if (av == null) return 1
            if (bv == null) return -1
            if (av < bv) return -1
            if (av > bv) return 1
            return 0
          }).reverse()
        }
      })
    }
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
  return db as any
}
