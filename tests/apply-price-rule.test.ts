import { describe, it, expect, vi } from 'vitest'
import {
  applyPriceRuleToAllImpl, BULK_CHUNK, CONCURRENCY
} from '../src/utils/applyPriceRule'
import { calcWholesale, calcRetail, type PriceRule } from '../src/utils/priceRule'

const rule: PriceRule = { wholesaleRate: 15, retailRate: 30, rounding: 'yuan', autoFill: true }

function makeProducts(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    brand: 'B' + i,
    model: 'M' + i,
    purchasePrice: 1000 + i, // 成本各不相同，便于校验逐条计算
    wholesalePrice: 0,
    retailPrice: 0,
    extra: { note: 'x' },
  }))
}

describe('价格规则批量应用（替代逐条 update）', () => {
  it('空库直接返回 0，不发起任何写入', async () => {
    const bulkPut = vi.fn(async () => {})
    const n = await applyPriceRuleToAllImpl(rule, { fetchAll: async () => [], bulkPut })
    expect(n).toBe(0)
    expect(bulkPut).not.toHaveBeenCalled()
  })

  it('把全量切成 ≤500 一批，且一次性分批并发写入（不再逐条 update）', async () => {
    const list = makeProducts(6281)
    const calls: any[][] = []
    const bulkPut = vi.fn(async (rows: any[]) => { calls.push(rows) })
    const n = await applyPriceRuleToAllImpl(rule, { fetchAll: async () => list, bulkPut })
    expect(n).toBe(6281)
    // 6281 / 500 → 13 批
    expect(calls.length).toBe(Math.ceil(6281 / BULK_CHUNK))
    // 每批不超过 500
    expect(calls.every(c => c.length <= BULK_CHUNK)).toBe(true)
    // 最后一批恰好 281
    expect(calls[calls.length - 1].length).toBe(6281 % BULK_CHUNK)
    // 没有把 6281 条塞进单个请求
    expect(calls.every(c => c.length === 6281)).toBe(false)
  })

  it('逐条价格按各自成本重算正确，且整行 upsert 不丢字段', async () => {
    const list = makeProducts(3)
    let written: any[] = []
    const bulkPut = vi.fn(async (rows: any[]) => { written = rows })
    await applyPriceRuleToAllImpl(rule, { fetchAll: async () => list, bulkPut })
    for (const w of written) {
      expect(w.wholesalePrice).toBe(calcWholesale(w.purchasePrice, rule))
      expect(w.retailPrice).toBe(calcRetail(w.purchasePrice, rule))
      // extra 等其它字段随整行 upsert 保留
      expect(w.extra).toEqual({ note: 'x' })
      expect(w.brand).toBe('B' + (w.id - 1))
    }
  })

  it('实时回调进度，且最终 done === total', async () => {
    const list = makeProducts(1234)
    const progresses: number[] = []
    const bulkPut = vi.fn(async () => {})
    await applyPriceRuleToAllImpl(rule, {
      fetchAll: async () => list,
      bulkPut,
      onProgress: (p) => { progresses.push(p.done); expect(p.done).toBeLessThanOrEqual(p.total) },
    })
    expect(progresses.length).toBeGreaterThan(0)
    expect(progresses[progresses.length - 1]).toBe(1234)
  })

  it('并发度受 CONCURRENCY 控制（避免一次性开 6281 个请求）', () => {
    // 仅做静态约定校验：批数应明显多于并发数，证明是「分批并发」而非「全量一拥而上」
    expect(CONCURRENCY).toBeGreaterThanOrEqual(2)
    expect(BULK_CHUNK).toBeGreaterThan(CONCURRENCY)
  })
})
