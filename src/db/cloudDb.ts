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

export class CloudTable<T = any> {
  constructor(
    private client: typeof supabase,
    public readonly name: string,
  ) {}

  async toArray(): Promise<T[]> {
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
    return (data as any[])[0].id
  }

  async add(obj: any): Promise<number> {
    const { data, error } = await this.client.from(this.name).insert(obj).select('id')
    if (error) throw new Error(`${this.name}.add: ${error.message}`)
    return (data as any[])[0].id
  }

  async bulkPut(objs: any[]): Promise<void> {
    if (!objs.length) return
    const { error } = await this.client.from(this.name).upsert(objs)
    if (error) throw new Error(`${this.name}.bulkPut: ${error.message}`)
  }

  async bulkAdd(objs: any[]): Promise<void> {
    if (!objs.length) return
    const { error } = await this.client.from(this.name).insert(objs)
    if (error) throw new Error(`${this.name}.bulkAdd: ${error.message}`)
  }

  async delete(id: number | string): Promise<void> {
    const { error } = await this.client.from(this.name).delete().eq('id', id)
    if (error) throw new Error(`${this.name}.delete: ${error.message}`)
  }

  async bulkDelete(ids: (number | string)[]): Promise<void> {
    if (!ids.length) return
    const { error } = await this.client.from(this.name).delete().in('id', ids as any)
    if (error) throw new Error(`${this.name}.bulkDelete: ${error.message}`)
  }

  async update(id: number | string, changes: Partial<T>): Promise<number> {
    const { error } = await this.client.from(this.name).update(changes as any).eq('id', id)
    if (error) throw new Error(`${this.name}.update: ${error.message}`)
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
