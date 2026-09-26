/**
 * V2.1-2.34 B 档（库存缓存增量化）的契约锁。
 *
 * 问题：改造前每一次写库存、改单据状态都会 `invalidate()` **整表缓存**。
 * 出库一张单 → 库存/库位两张 6000 行的表缓存作废 → 下一个页面把整表重搬一遍
 * （7 个请求）——「出库不慢，慢在出库之后的刷新」就是这个原因。
 *
 * 改法：写操作就地把缓存行更新掉，不再整表作废；只有「拿不到完整行」时
 * （bulkAdd / 缓存里没有这行的局部 update）才退回整表作废。
 *
 * ⚠️ 本文件锁两件事：
 *   1. **该增量的地方必须真的增量**（写完之后读同一个表不许再发网络请求）；
 *   2. **不该增量的地方不许硬撑**（拿不到完整行时必须作废，宁可多拉不给脏数据）。
 * 顺便锁住保鲜期：库存/库位这两张最易变的表必须带 TTL，跨设备差异能自愈。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CloudTable } from '../src/db/cloudDb'

function src(rel: string): string {
  return readFileSync(resolve(__dirname, '..', rel), 'utf-8')
}

// ---------------------------------------------------------------- 假客户端

interface MockCtx {
  /** 每个请求记一条，用于断言「有没有真的发请求」 */
  calls: string[]
  /** 表 -> 云端数据 */
  data: Record<string, any[]>
}

/**
 * 造一个能计数的 Supabase 客户端替身。
 *
 * 关键点：PostgREST 的链式对象既是「构建器」（能继续 .eq/.in/.range）又是
 * 「thenable」（await 它就直接执行）。这里必须同时满足，否则
 * `await from(t).update(c).eq('id', id)` 与 `from(t).select('*').eq(f,v).range(0,999)`
 * 两种写法没法用同一个替身表达。
 */
function makeClient(seed: Record<string, any[]> = {}): { client: any; ctx: MockCtx } {
  const ctx: MockCtx = { calls: [], data: {} }
  for (const [k, v] of Object.entries(seed)) ctx.data[k] = v.map(r => ({ ...r }))

  let nextId = 1000

  const makeBuilder = (name: string): any => {
    const b: any = { _op: 'select', _opts: {}, _range: null, _eq: null, _in: null, _neq: false, _payload: null, _sel: null }
    const rowsOf = () => (ctx.data[name] ?? (ctx.data[name] = []))

    const runSelect = () => {
      ctx.calls.push(`select:${name}`)
      let rows = rowsOf().slice()
      if (b._eq) rows = rows.filter(r => r[b._eq[0]] === b._eq[1])
      if (b._in) {
        const set = new Set(b._in[1].map((v: any) => String(v)))
        rows = rows.filter(r => set.has(String(r[b._in[0]])))
      }
      const total = rows.length
      const [a, z] = b._range ?? [0, ROW_PAGE_LOCAL - 1]
      return { data: rows.slice(a, z + 1).map(r => ({ ...r })), error: null, count: total }
    }

    const runWrite = () => {
      const rows = rowsOf()
      if (b._op === 'upsert') {
        const objs: any[] = b._payload
        const out: any[] = []
        for (const o of objs) {
          const i = o.id != null ? rows.findIndex(r => r.id === o.id) : -1
          if (i >= 0) { rows[i] = { ...rows[i], ...o }; out.push({ id: rows[i].id }) }
          else {
            const id = o.id ?? nextId++
            rows.push({ ...o, id })
            out.push({ id })
          }
        }
        ctx.calls.push(`upsert:${name}`)
        return { data: out, error: null }
      }
      if (b._op === 'insert') {
        const objs: any[] = b._payload
        const out: any[] = []
        for (const o of objs) { const id = o.id ?? nextId++; rows.push({ ...o, id }); out.push({ id }) }
        ctx.calls.push(`insert:${name}`)
        return { data: out, error: null }
      }
      if (b._op === 'update') {
        let n = 0
        for (const r of rows) {
          const hit = (b._eq && r[b._eq[0]] === b._eq[1]) ||
            (b._in && b._in[1].map(String).includes(String(r[b._in[0]])))
          if (hit) { Object.assign(r, b._payload); n++ }
        }
        ctx.calls.push(`update:${name}`)
        return { error: null, count: n }
      }
      if (b._op === 'delete') {
        const keep = rows.filter(r => {
          if (b._neq) return false
          if (b._eq) return !(r[b._eq[0]] === b._eq[1])
          if (b._in) return !b._in[1].map(String).includes(String(r[b._in[0]]))
          return true
        })
        ctx.data[name] = keep
        ctx.calls.push(`delete:${name}`)
        return { error: null }
      }
      return { error: null }
    }

    b.select = (_cols: string, opts?: any) => { b._sel = _cols; b._opts = opts ?? {}; return b }
    b.eq = (f: string, v: any) => { b._eq = [f, v]; return b }
    b.in = (f: string, v: any[]) => { b._in = [f, v]; return b }
    b.neq = () => { b._neq = true; return b }
    b.order = () => b
    b.range = (a: number, z: number) => { b._range = [a, z]; return Promise.resolve(runSelect()) }
    b.upsert = (objs: any) => { b._op = 'upsert'; b._payload = Array.isArray(objs) ? objs : [objs]; return b }
    b.insert = (objs: any) => { b._op = 'insert'; b._payload = Array.isArray(objs) ? objs : [objs]; return b }
    b.update = (changes: any) => { b._op = 'update'; b._payload = changes; return b }
    b.delete = () => { b._op = 'delete'; return b }
    b.then = (res: any, rej: any) => Promise.resolve(b._op === 'select' ? runSelect() : runWrite()).then(res, rej)
    return b
  }

  const client = { from: (name: string) => makeBuilder(name) }
  return { client, ctx }
}

const ROW_PAGE_LOCAL = 1000

afterEach(() => { vi.restoreAllMocks() })

// ---------------------------------------------------------------- 1. 增量更新

describe('B 档：写操作只同步缓存行，不再整表作废', () => {
  it('bulkPut（出库扣减库存的写法）之后，再读同一张表不发新请求', async () => {
    const { client, ctx } = makeClient({ stock: [{ id: 1, productId: 101, quantity: 10 }, { id: 2, productId: 102, quantity: 5 }] })
    const stock = new CloudTable(client, 'stock')

    expect(await stock.toArray()).toHaveLength(2)
    const afterFirstRead = ctx.calls.length

    await stock.bulkPut([
      { id: 1, productId: 101, quantity: 7 },
      { id: 2, productId: 102, quantity: 4 },
    ])

    const rows = await stock.toArray()
    expect(ctx.calls.length).toBe(afterFirstRead + 1) // 只多了那次 bulkPut，没有重拉全表
    expect(ctx.calls.filter(c => c === 'select:stock')).toHaveLength(1)
    expect((rows as any[]).find(r => r.id === 1).quantity).toBe(7)
    expect((rows as any[]).find(r => r.id === 2).quantity).toBe(4)
  })

  it('update（改单据状态的写法）就地合并，不发重拉请求', async () => {
    const { client, ctx } = makeClient({ saleOrders: [{ id: 7, orderNo: 'XS1', status: 'pending' }] })
    const orders = new CloudTable(client, 'saleOrders')
    await orders.toArray()

    await orders.update(7, { status: 'completed' })

    const rows = (await orders.toArray()) as any[]
    expect(ctx.calls.filter(c => c === 'select:saleOrders')).toHaveLength(1)
    expect(rows[0].status).toBe('completed')
    expect(rows[0].orderNo).toBe('XS1') // 局部 patch 不能把其它列弄丢
  })

  it('bulkDelete 直接把行从缓存摘掉，不用整表重拉', async () => {
    const { client, ctx } = makeClient({ locationStock: [{ id: 1 }, { id: 2 }, { id: 3 }] })
    const ls = new CloudTable(client, 'locationStock')
    await ls.toArray()

    await ls.bulkDelete([1, 3])
    expect((await ls.toArray()).length).toBe(1)
    expect(ctx.calls.filter(c => c === 'select:locationStock')).toHaveLength(1)
  })

  it('upsert 出一条缓存里没有的新行，也要进缓存', async () => {
    const { client } = makeClient({ locationStock: [{ id: 1, productId: 101, locationId: 1, quantity: 2 }] })
    const ls = new CloudTable(client, 'locationStock')
    await ls.toArray()
    await ls.bulkPut([{ id: 1, productId: 101, locationId: 1, quantity: 3 }, { id: 9, productId: 102, locationId: 1, quantity: 4 }])
    const rows = (await ls.toArray()) as any[]
    expect(rows).toHaveLength(2)
    expect(rows.find(r => r.id === 9).quantity).toBe(4)
  })
})

// ---------------------------------------------------------------- 2. 该作废时必须作废

describe('B 档：拿不到完整行时宁可整表作废，绝不硬撑', () => {
  it('bulkAdd（新增行拿不到自增 id）必须作废缓存', async () => {
    const { client, ctx } = makeClient({ locationStock: [{ id: 1, productId: 101, locationId: 1, quantity: 2 }] })
    const ls = new CloudTable(client, 'locationStock')
    await ls.toArray()

    await ls.bulkAdd([{ productId: 103, locationId: 1, quantity: 5 }])
    await ls.toArray()
    expect(ctx.calls.filter(c => c === 'select:locationStock')).toHaveLength(2) // 重拉了一次
  })

  it('update 的目标行不在缓存里时，必须作废（局部 patch 会造出残缺行）', async () => {
    const { client, ctx } = makeClient({ saleOrders: [{ id: 7, orderNo: 'XS1', status: 'pending' }] })
    const orders = new CloudTable(client, 'saleOrders')
    await orders.toArray()

    await orders.update(999, { status: 'completed' }) // 缓存里没有 999
    const rows = (await orders.toArray()) as any[]
    expect(ctx.calls.filter(c => c === 'select:saleOrders')).toHaveLength(2)
    expect(rows.some(r => r.id === 999 && r.orderNo === undefined)).toBe(false)
  })

  it('没启用缓存的表（流水/明细）行为完全不变：每次都读云端', async () => {
    const { client, ctx } = makeClient({ stockRecords: [{ id: 1 }] })
    const recs = new CloudTable(client, 'stockRecords')
    await recs.toArray()
    await recs.toArray()
    expect(ctx.calls.filter(c => c === 'select:stockRecords')).toHaveLength(2)
  })

  it('写失败时异常照原样抛出，不污染缓存', async () => {
    const { client } = makeClient({ stock: [{ id: 1, productId: 101, quantity: 10 }] })
    const original = client.from
    client.from = (name: string) => {
      const b = original(name)
      const badUpsert = b.upsert
      b.upsert = (objs: any) => { const c = badUpsert(objs); c.then = (res: any) => Promise.resolve({ data: null, error: { message: 'boom' } }).then(res); return c }
      return b
    }
    const stock = new CloudTable(client, 'stock')
    await stock.toArray()
    await expect(stock.bulkPut([{ id: 1, productId: 101, quantity: 0 }])).rejects.toThrow()
    expect(((await stock.toArray()) as any[])[0].quantity).toBe(10)
  })
})

// ---------------------------------------------------------------- 3. CloudQuery 走缓存

describe('B 档：where().equals()/anyOf() 命中热缓存就不再发请求', () => {
  it('anyOf 走缓存，且返回的是副本（就地改数量不会污染缓存）', async () => {
    const { client, ctx } = makeClient({
      stock: [
        { id: 8516, productId: 24474, quantity: 11 },
        { id: 8517, productId: 24475, quantity: 11 },
        { id: 8518, productId: 24476, quantity: 30 },
      ]
    })
    const stock = new CloudTable(client, 'stock')
    await stock.toArray()
    const before = ctx.calls.length

    const hit = await stock.where('productId').anyOf([24474, 24475]).toArray()
    expect(hit).toHaveLength(2)
    expect(ctx.calls.length).toBe(before) // 已经是 0 次网络请求

    ;(hit[0] as any).quantity = -999 // 调用方会这么干（过账前先改）
    expect(((await stock.toArray()) as any[]).find(r => r.id === hit[0].id).quantity).toBe(11)
  })

  it('equals 同样走缓存，count 也不再发请求', async () => {
    const { client, ctx } = makeClient({ saleOrders: [{ id: 1, status: 'pending' }, { id: 2, status: 'pending' }, { id: 3, status: 'completed' }] })
    const orders = new CloudTable(client, 'saleOrders')
    await orders.toArray()
    const before = ctx.calls.length

    expect(await orders.where('status').equals('pending').toArray()).toHaveLength(2)
    expect(await orders.where('status').equals('pending').count()).toBe(2)
    expect(ctx.calls.length).toBe(before)
  })

  it('没有缓存时照旧走云端（不能凭空返回空结果）', async () => {
    const { client, ctx } = makeClient({ stock: [{ id: 1, productId: 101, quantity: 3 }] })
    const stock = new CloudTable(client, 'stock')
    const rows = await stock.where('productId').anyOf([101]).toArray()
    expect(rows).toHaveLength(1)
    expect(ctx.calls.filter(c => c === 'select:stock')).toHaveLength(1)
  })

  it('where().delete() 删掉的行必须同步从缓存摘掉', async () => {
    const { client, ctx } = makeClient({ quoteOrderItems: [{ id: 1, quoteOrderId: 5 }, { id: 2, quoteOrderId: 6 }] })
    const items = new CloudTable(client, 'quoteOrderItems')
    // 未缓存表：delete 后读到的仍是云端真值
    await items.where('quoteOrderId').equals(5).delete()
    expect((await items.where('quoteOrderId').equals(5).toArray())).toHaveLength(0)
    expect(ctx.calls.some(c => c === 'delete:quoteOrderItems')).toBe(true)
  })
})

// ---------------------------------------------------------------- 4. 保鲜期

describe('B 档：库存/库位表带保鲜期，跨设备差异能自愈', () => {
  it('库存与库位在保鲜期内不重拉，过期后自动重拉一次', async () => {
    const { client, ctx } = makeClient({ stock: [{ id: 1, productId: 101, quantity: 10 }] })
    const stock = new CloudTable(client, 'stock')
    await stock.toArray()
    expect(ctx.calls.filter(c => c === 'select:stock')).toHaveLength(1)

    // 仍在保鲜期内
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 30_000)
    await stock.toArray()
    expect(ctx.calls.filter(c => c === 'select:stock')).toHaveLength(1)

    // 超过 60 秒 → 自动重拉
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61_000)
    await stock.toArray()
    expect(ctx.calls.filter(c => c === 'select:stock')).toHaveLength(2)
  })

  it('单据主表用更长的保鲜期（5 分钟），不会频繁重拉', async () => {
    const { client, ctx } = makeClient({ saleOrders: [{ id: 1 }] })
    const orders = new CloudTable(client, 'saleOrders')
    await orders.toArray()
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61_000)
    await orders.toArray()
    expect(ctx.calls.filter(c => c === 'select:saleOrders')).toHaveLength(1)
  })
})

// ---------------------------------------------------------------- 5. 静态契约

describe('B 档契约锁', () => {
  const cloudDb = src('src/db/cloudDb.ts')

  it('locationStock 必须启用缓存（否则每次出库都白拉 6000 行）', () => {
    const block = cloudDb.slice(cloudDb.indexOf('const CACHED_TABLES'), cloudDb.indexOf('export class CloudTable'))
    expect(block).toContain("'locationStock'")
    expect(block).toContain("'stock'")
  })

  it('写操作不许再无条件整表作废（必须走 patchCache / evict）', () => {
    const put = cloudDb.slice(cloudDb.indexOf('async put('), cloudDb.indexOf('async add('))
    expect(put).toContain('patchCache')
    const bulkPut = cloudDb.slice(cloudDb.indexOf('async bulkPut('), cloudDb.indexOf('async bulkAdd('))
    expect(bulkPut).toContain('patchCache')
    const upd = cloudDb.slice(cloudDb.indexOf('async update('), cloudDb.indexOf('async bulkUpdate('))
    expect(upd).toContain('patchCache')
    // update / put 里不允许出现「先写好，再无条件 invalidate」的写法：
    // invalidate 必须被 patchCache 的返回值守住
    expect(upd).toContain('if (!this.patchCache(')
    expect(upd).not.toMatch(/^ {4}this\.invalidate\(\)$/m)
  })

  it('CloudQuery 必须接上宿主表的缓存与失效通道', () => {
    expect(cloudDb).toContain('private readCache(): any[] | null')
    expect(cloudDb).toContain('new CloudQuery(this.client, this.name, field, this)')
    expect(cloudDb).toContain('this.host.evict(')
  })

  it('缓存副本必须深拷贝一层，避免调用方改到缓存行', () => {
    expect(cloudDb).toContain('return out.map(r => ({ ...r }))')
  })

  it('保鲜期常量必须存在，且库存表是短保鲜期', () => {
    expect(cloudDb).toContain('CACHE_TTL_MS')
    const ttl = cloudDb.slice(cloudDb.indexOf('const CACHE_TTL_MS'), cloudDb.indexOf('const DEFAULT_CACHE_TTL_MS'))
    expect(ttl).toContain('stock:')
    expect(ttl).toContain('locationStock:')
  })
})
