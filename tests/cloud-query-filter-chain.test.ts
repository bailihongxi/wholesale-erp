/**
 * 线上事故回归：`where().equals().filter()` 在「一页就取完」的快路径上把 filter 丢了。
 *
 * 现象（2026-09-25 老板反馈）：采购单详情的「付款记录（5）」把**所有**采购单的付款
 * 都列了出来，明明这张单只付过 0 笔 / 只有自己那笔。
 *
 * 根因（src/db/cloudDb.ts · CloudQuery.toArray）：
 *   ```
 *   const total = count ?? rows.length
 *   if (total <= ROW_PAGE) return rows      // ← filter 在这里被静默丢掉（不报错）
 *   ...
 *   return this._filterFn ? all.filter(this._filterFn) : all   // 只有翻页路径是对的
 *   ```
 * 也就是说：数据量 ≤ 1000 行时 filter 完全失效，> 1000 行时才碰巧正确 ——
 * 所以本地小数据永远复现不了，一上云端就错。
 *
 * 受影响的调用点（都靠这条链）：
 *   - PurchaseOrderDetailView 付款记录 / SaleOrderDetailView 收款记录
 *   - finance.recordPay / recordReceive 的「已付合计」→ 单据 paid / partial 状态判断
 *
 * ⚠️ 反向锁：如果谁把 `if (total <= ROW_PAGE) return rows` 改回去，本文件立刻变红。
 */
import { describe, it, expect } from 'vitest'
import { CloudTable } from '../src/db/cloudDb'

/** 服务的 db-max-rows 上限：单次请求最多回 1000 行 */
const MAX_ROWS = 1000

/** 严格复刻 PostgREST 语义的假客户端（count 只在 from().select() 那次生效） */
class FakeBuilder {
  private seenSelect = false
  private countRequested = false
  private head = false
  private filters: Array<(r: any) => boolean> = []
  private from = 0
  private to = Number.MAX_SAFE_INTEGER

  constructor(private rows: any[]) {}

  select(_cols: string, opts?: { count?: string; head?: boolean }): this {
    if (!this.seenSelect && opts) {
      this.countRequested = !!opts.count
      this.head = !!opts.head
    }
    this.seenSelect = true
    return this
  }

  eq(field: string, v: any): this { this.filters.push(r => r[field] === v); return this }
  in(field: string, vals: any[]): this { this.filters.push(r => (vals as any[]).includes(r[field])); return this }
  range(from: number, to: number): this { this.from = from; this.to = to; return this }

  private exec() {
    const rows = this.rows.filter(r => this.filters.every(f => f(r)))
    const total = rows.length
    const want = Math.max(0, Math.min(this.to - this.from + 1, MAX_ROWS))
    return {
      data: this.head ? null : rows.slice(this.from, this.from + want),
      count: this.countRequested ? total : null,
      error: null,
      status: 200
    }
  }

  then(resolve: any, reject?: any): any { return Promise.resolve(this.exec()).then(resolve, reject) }
}

function fakeClient(tables: Record<string, any[]>): any {
  return { from: (name: string) => new FakeBuilder(tables[name] ?? []) }
}

/** 5 笔付款，分属 5 张不同的采购单 —— 就是出问题那天云端的真实形状 */
function payments() {
  return [
    { id: 1, type: 'pay', refOrderId: 101, amount: 3260 },
    { id: 2, type: 'pay', refOrderId: 102, amount: 32300 },
    { id: 3, type: 'pay', refOrderId: 101, amount: 500 },
    { id: 4, type: 'receive', refOrderId: 201, amount: 8630 },
    { id: 5, type: 'pay', refOrderId: 103, amount: 10500 }
  ]
}

function table(rows = payments()): CloudTable {
  return new CloudTable(fakeClient({ payments: rows }), 'payments')
}

describe('CloudQuery.where().equals().filter()：≤1000 行时 filter 不得被吞掉', () => {
  it('采购单详情付款记录：只返回本单据的流水（快路径回归）', async () => {
    const rows = await table().where('type').equals('pay').filter(p => p.refOrderId === 101).toArray()
    expect(rows.map(r => r.id)).toEqual([1, 3])
    // 反证：如果 filter 又被吞掉，这里会是 4 笔（全部 pay）
    expect(rows).toHaveLength(2)
  })

  it('销售单详情收款记录：同类链同样只返回本单据', async () => {
    const rows = await table().where('type').equals('receive').filter(p => p.refOrderId === 201).toArray()
    expect(rows.map(r => r.id)).toEqual([4])
  })

  it('没有任何流水命中时返回空数组，而不是整表', async () => {
    const rows = await table().where('type').equals('pay').filter(p => p.refOrderId === 999).toArray()
    expect(rows).toEqual([])
  })

  it('不写 filter 时行为不变，等价于 where().equals()', async () => {
    const rows = await table().where('type').equals('pay').toArray()
    expect(rows).toHaveLength(4)
  })

  it('超过 1000 行（翻页路径）时 filter 依然生效', async () => {
    const bulk = Array.from({ length: 1500 }, (_, i) => ({
      id: i + 1,
      type: 'pay',
      refOrderId: i % 5 === 0 ? 101 : 500 + i,
      amount: 1
    }))
    const rows = await table(bulk).where('type').equals('pay').filter(p => p.refOrderId === 101).toArray()
    expect(rows).toHaveLength(300)
    expect(rows.every(r => r.refOrderId === 101)).toBe(true)
  })

  it('count() 也认 filter：已付合计不能把别的单据算进来', async () => {
    const n = await table().where('type').equals('pay').filter(p => p.refOrderId === 101).count()
    expect(n).toBe(2)
  })

  it('first() 走的是过滤后的第一行', async () => {
    const row = await table().where('type').equals('pay').filter(p => p.refOrderId === 103).first()
    expect(row?.id).toBe(5)
  })
})
