/**
 * V2.1-2.34 A 档（单据写入批量化·退货单试点）的契约锁。
 *
 * 老板的硬要求：**不许改功能、不许变慢、不许更容易失败**。批量写是把
 * 「循环里逐行 await」换成「一次 bulk kAdd/bulkPut」，风险全落在两件事上：
 *
 *   1. **语义是否等价** —— 逐个算和批量算必须得到同一个数字。
 *      陷阱在于 `Math.max(0, ...)` 不是线性运算：按序逐条截断 ≠ 先求和再截断。
 *   2. **失败是否更糟** —— 批量接口一旦整批失败，必须能自动退回逐行重试。
 *
 * 本文件两条都锁死：第 1 条用「逐行参考实现」跑随机用例做对比，第 2 条用脆弱表模拟失败。
 * ⚠️ 反向锁：谁再把 `clampZero` 改成先求和、或去掉降级分支，本文件立刻变红。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import 'fake-indexeddb/auto'
import {
  foldQuantityDeltas, safeBulkAdd, safeBulkPut, safeBulkUpdate, anyOfBatch, applyQuantityDeltas
} from '../src/utils/bulkWrite'
import { db } from '../src/db/index'

/** 读源码做静态契约扫描（防止日后有人把代码改回逐行写） */
function src(rel: string): string {
  return readFileSync(resolve(__dirname, '..', rel), 'utf-8')
}

// ---------------------------------------------------------------- 参考实现

interface RefOpts {
  clampZero: boolean
  createIfMissing: boolean
}

/** 改之前的行为：一行一行地「读当前值 → 算新值 → 写回」 */
function legacyFold(
  initial: Array<Record<string, any>>,
  deltas: Array<{ key: string; delta: number }>,
  opts: RefOpts
): Map<string, number> {
  const rows = initial.map(r => ({ ...r }))
  for (const d of deltas) {
    const hit = rows.find(r => String(r.productId) === d.key)
    if (hit) {
      const cur = Number(hit.quantity) || 0
      hit.quantity = opts.clampZero ? Math.max(0, cur + d.delta) : cur + d.delta
    } else if (opts.createIfMissing) {
      rows.push({ productId: Number(d.key), quantity: opts.clampZero ? Math.max(0, d.delta) : d.delta })
    }
  }
  return new Map(rows.map(r => [String(r.productId), Number(r.quantity)]))
}

/** 批量版跑完后，把结果摊平成同样形状便于比较 */
function bulkFold(
  initial: Array<Record<string, any>>,
  deltas: Array<{ key: string; delta: number }>,
  opts: RefOpts
): Map<string, number> {
  const { adds, puts } = foldQuantityDeltas({
    existing: initial.map(r => ({ ...r })),
    getKey: r => String(r.productId),
    deltas,
    clampZero: opts.clampZero,
    buildNew: (key, delta) => opts.createIfMissing
      ? { productId: Number(key), quantity: opts.clampZero ? Math.max(0, delta) : delta }
      : null
  })
  const untouched = initial.filter(r => !puts.some(p => String(p.productId) === String(r.productId)))
  const finalRows = [...untouched, ...puts, ...adds]
  return new Map(finalRows.map(r => [String(r.productId), Number(r.quantity)]))
}

function sortEntries(m: Map<string, number>): Array<[string, number]> {
  return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
}

// ---------------------------------------------------------------- 1. 语义等价

describe('foldQuantityDeltas：批量算必须与「逐行算」结果完全一致', () => {
  it('常规场景：多行多商品各加减一次', () => {
    const initial = [{ id: 1, productId: 10, quantity: 5 }, { id: 2, productId: 20, quantity: 8 }]
    const deltas = [{ key: '10', delta: 3 }, { key: '20', delta: -2 }, { key: '10', delta: 1 }]
    expect(sortEntries(bulkFold(initial, deltas, { clampZero: true, createIfMissing: true })))
      .toEqual(sortEntries(legacyFold(initial, deltas, { clampZero: true, createIfMissing: true })))
    expect([...bulkFold(initial, deltas, { clampZero: true, createIfMissing: true }).values()].sort())
      .toEqual([6, 9])
  })

  it('⚠️ 关键陷阱：先负后正时必须「逐条截断」，不能先求和', () => {
    const initial = [{ id: 1, productId: 10, quantity: 5 }]
    const deltas = [{ key: '10', delta: -10 }, { key: '10', delta: 3 }]
    // 逐条算：max(0, -5)=0 → max(0, 0+3)=3　｜　先求和（错误做法）：max(0, -2)=0
    expect([...bulkFold(initial, deltas, { clampZero: true, createIfMissing: true }).values()]).toEqual([3])
    expect(sortEntries(bulkFold(initial, deltas, { clampZero: true, createIfMissing: true })))
      .toEqual(sortEntries(legacyFold(initial, deltas, { clampZero: true, createIfMissing: true })))
  })

  it('同一批里新建的行会被后续 delta 接着累加（不是被覆盖）', () => {
    const initial: Array<Record<string, any>> = []
    const deltas = [{ key: '30', delta: 4 }, { key: '30', delta: 6 }]
    expect([...bulkFold(initial, deltas, { clampZero: true, createIfMissing: true }).values()]).toEqual([10])
    expect(sortEntries(bulkFold(initial, deltas, { clampZero: true, createIfMissing: true })))
      .toEqual(sortEntries(legacyFold(initial, deltas, { clampZero: true, createIfMissing: true })))
  })

  it('createIfMissing=false（采购退货语义）：缺行的商品不产生任何库存行', () => {
    const initial = [{ id: 1, productId: 10, quantity: 5 }]
    const deltas = [{ key: '99', delta: 7 }, { key: '10', delta: -1 }]
    const res = bulkFold(initial, deltas, { clampZero: true, createIfMissing: false })
    expect(res.has('99')).toBe(false)
    expect(res.get('10')).toBe(4)
  })

  it('clampZero=false（销售退货入库语义）：允许负数/不做截断', () => {
    const initial = [{ id: 1, productId: 10, quantity: 5 }]
    const deltas = [{ key: '10', delta: -10 }]
    expect(bulkFold(initial, deltas, { clampZero: false, createIfMissing: true }).get('10')).toBe(-5)
    expect(sortEntries(bulkFold(initial, deltas, { clampZero: false, createIfMissing: true })))
      .toEqual(sortEntries(legacyFold(initial, deltas, { clampZero: false, createIfMissing: true })))
  })

  it('随机 200 组：批量结果恒等于逐行结果', () => {
    let seed = 20260926
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
    for (let round = 0; round < 200; round++) {
      const nRows = Math.floor(rnd() * 4)
      const initial: Array<Record<string, any>> = []
      for (let i = 0; i < nRows; i++) initial.push({ id: i + 1, productId: 10 + i, quantity: Math.floor(rnd() * 20) })
      const nDelta = 1 + Math.floor(rnd() * 5)
      const deltas: Array<{ key: string; delta: number }> = []
      for (let i = 0; i < nDelta; i++) {
        deltas.push({ key: String(10 + Math.floor(rnd() * 5)), delta: Math.floor(rnd() * 21) - 10 })
      }
      for (const clampZero of [true, false]) {
        for (const createIfMissing of [true, false]) {
          const opts = { clampZero, createIfMissing }
          expect(sortEntries(bulkFold(initial, deltas, opts)))
            .toEqual(sortEntries(legacyFold(initial, deltas, opts)))
        }
      }
    }
  })

  it('未被任何 delta 命中的行不进 puts（不产生多余写请求）', () => {
    const initial = [
      { id: 1, productId: 10, quantity: 5 },
      { id: 2, productId: 20, quantity: 8 }
    ]
    const { puts, adds } = foldQuantityDeltas({
      existing: initial,
      getKey: r => String(r.productId),
      deltas: [{ key: '10', delta: 2 }],
      clampZero: true,
      buildNew: () => null
    })
    expect(puts.map(r => r.productId)).toEqual([10])
    expect(adds).toHaveLength(0)
  })
})

// ---------------------------------------------------------------- 2. 失败降级

/** 可注入故障的假表：bulkXxx 抛错时，逐行 put/add 仍要能把数据写进去 */
function fragileTable(opts: { failBulk: boolean }) {
  const calls: string[] = []
  const written: any[] = []
  return {
    calls,
    written,
    async bulkPut(rows: any[]) {
      calls.push('bulkPut')
      if (opts.failBulk) throw new Error('bulk failed')
      written.push(...rows)
    },
    async bulkAdd(rows: any[]) {
      calls.push('bulkAdd')
      if (opts.failBulk) throw new Error('bulk failed')
      written.push(...rows)
    },
    async put(row: any) { calls.push('put'); written.push(row) },
    async add(row: any) { calls.push('add'); written.push(row) },
    async update(_id: any, _p: any) { calls.push('update') },
    where() { return { anyOf: () => ({ toArray: async () => [] as any[] }) } }
  } as any
}

describe('safeBulk*：批量失败必须自动降级为逐行重试（不能比改之前更容易失败）', () => {
  it('safeBulkPut：正常时只发一次批量请求', async () => {
    const t = fragileTable({ failBulk: false })
    await safeBulkPut(t, [{ id: 1 }, { id: 2 }, { id: 3 }])
    expect(t.calls).toEqual(['bulkPut'])
    expect(t.written).toHaveLength(3)
  })

  it('safeBulkPut：批量失败 → 降级逐行 put，数据一条不少', async () => {
    const t = fragileTable({ failBulk: true })
    await safeBulkPut(t, [{ id: 1 }, { id: 2 }, { id: 3 }])
    expect(t.calls).toEqual(['bulkPut', 'put', 'put', 'put'])
    expect(t.written).toHaveLength(3)
  })

  it('safeBulkAdd：批量失败 → 降级逐行 add，数据一条不少', async () => {
    const t = fragileTable({ failBulk: true })
    await safeBulkAdd(t, [{ productId: 1 }, { productId: 2 }])
    expect(t.calls).toEqual(['bulkAdd', 'add', 'add'])
    expect(t.written).toHaveLength(2)
  })

  it('空数组不发任何请求（避免空 upsert 报错）', async () => {
    const t = fragileTable({ failBulk: false })
    await safeBulkPut(t, [])
    await safeBulkAdd(t, [])
    expect(t.calls).toEqual([])
  })

  it('⚠️ safeBulkUpdate 在 Dexie 真表上必须真实更新字段（V2.2-1.0 入库备注事故回归锁）', async () => {
    // 事故：Dexie 4 的 Table.bulkUpdate 签名是 [{key,changes}]，误传 (ids, patch)
    // 会把 patch 静默吞掉且不抛错 → 备注永远改不动
    await db.open()
    await Promise.all(db.tables.map(t => t.clear()))
    const ids = await db.stockRecords.bulkAdd([
      { type: 'purchase_in', productId: 1, quantity: 1, batchNo: 'PD-A1', remark: '旧备注' },
      { type: 'purchase_in', productId: 2, quantity: 2, batchNo: 'PD-A1', remark: '旧备注' }
    ], { allKeys: true }) as number[]
    await safeBulkUpdate(db.stockRecords as any, ids, { remark: '已与供应商协商换货' })
    const rows = await db.stockRecords.where('batchNo').equals('PD-A1').toArray()
    expect(rows).toHaveLength(2)
    rows.forEach(r => expect(r.remark).toBe('已与供应商协商换货'))
  })

  it('safeBulkUpdate 在云端风格表上走 (ids, patch) 批量签名', async () => {
    const got: any[] = []
    const cloud = {
      client: {} as any,
      async bulkUpdate(ids: any[], patch: any) { got.push([ids, patch]); return ids.length },
      async update(_id: any, _p: any) { throw new Error('不应走逐行') }
    } as any
    await safeBulkUpdate(cloud, [7, 8], { remark: 'x' })
    expect(got).toHaveLength(1)
    expect(got[0][0]).toEqual([7, 8])
    expect(got[0][1]).toEqual({ remark: 'x' })
  })
})

// ---------------------------------------------------------------- 3. anyOfBatch

describe('anyOfBatch：明细批量拉取', () => {
  it('按 300 一批切分并行，结果合并完整', async () => {
    const seen: number[][] = []
    const rows = Array.from({ length: 700 }, (_, i) => ({ id: i + 1, returnOrderId: i + 1 }))
    const table = {
      where: (_f: string) => ({
        anyOf: (ids: number[]) => ({
          toArray: async () => {
            seen.push(ids)
            return rows.filter(r => ids.includes(r.returnOrderId))
          }
        })
      })
    } as any
    const out = await anyOfBatch<any>(table, 'returnOrderId', rows.map(r => r.returnOrderId))
    expect(seen.map(s => s.length)).toEqual([300, 300, 100])   // 700 = 300+300+100
    expect(out).toHaveLength(700)
  })

  it('⚠️ 任一批读失败必须整体抛错：库存场景不能把「读失败」当成「没有这一行」', async () => {
    // 反例：若这里静默返回空数组，过账逻辑会以为该商品没有库存行 → 去 insert 一条，
    // 同一商品在 stock 表出现两行、库存凭空翻倍（账目事故）。
    let n = 0
    const table = {
      where: () => ({
        anyOf: (ids: number[]) => ({
          toArray: async () => {
            n++
            if (n === 2) throw new Error('batch 2 exploded')
            return ids.map(id => ({ id }))
          }
        })
      })
    } as any
    await expect(anyOfBatch<any>(table, 'id', [1, 2, 3, 4], 2)).rejects.toThrow('batch 2 exploded')
  })

  it('空 id 列表不产生任何查询', async () => {
    const table = { where: () => ({ anyOf: () => ({ toArray: async () => [{ id: 1 }] }) }) } as any
    expect(await anyOfBatch(table, 'id', [])).toEqual([])
  })
})

// ---------------------------------------------------------------- 4. 静态契约

describe('A 档契约锁：退货过账不得退回「逐行 await」的写法', () => {
  const returns = src('src/stores/returns.ts')
  const inventory = src('src/stores/inventory.ts')
  const bulk = src('src/utils/bulkWrite.ts')

  it('退货写明细 / 写流水不再是逐行 await', () => {
    expect(returns).not.toMatch(/await\s+db\.returnItems\.add/)
    expect(returns).not.toMatch(/await\s+db\.stockRecords\.add/)
  })

  it('退货调整库存不再逐条 first() 再 update()', () => {
    expect(returns).not.toMatch(/await\s+db\.stock\.where\('productId'\)\.equals/)
    expect(returns).not.toMatch(/await\s+db\.stock\.update\(/)
  })

  it('退货调整库存统一走 inventory.applyStockDeltas（收敛到唯一实现）', () => {
    expect(returns).toContain('inv.applyStockDeltas')
    expect(returns).toContain('safeBulkAdd')
    expect(returns).toContain('applyLocationDeltas')
    // 退货侧不得再自己写一版叠加逻辑
    expect(returns).not.toMatch(/async function applyStockDeltas\(/)
  })

  it('listReturns 的明细查询不再是循环里逐单 await（N+1 清零）', () => {
    expect(returns).not.toMatch(/for \(const o of filtered\)[\s\S]*?await db\.returnItems/)
    expect(returns).toContain("anyOfBatch")
  })

  it('批量工具必须保留「失败降级为逐行」的兜底分支', () => {
    expect(bulk).toContain('for (const r of rows) await table.put(r)')
    expect(bulk).toContain('for (const r of rows) await table.add(r)')
    // 以及批量失败时要兜住异常，不能直接抛给业务
    expect(bulk.match(/catch \{/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
  })

  it('inventory 保留了逐行版 applyLocationDelta（对账自愈等单行场景仍在用）', () => {
    expect(inventory).toContain('async function applyLocationDelta(')
    expect(inventory).toContain('async function applyLocationDeltas(')
    expect(inventory).toContain('applyLocationDeltas')
  })

  it('过账相关的表不允许直接 bulkPut/bulkAdd，必须走 safeBulk* 兜底', () => {
    // 只锁库存/流水/明细这类「写错就是账目事故」的表；
    // locations 这类基础档案的既有写法（ensureLocations）不在本次改造范围，不强约束。
    const forbidden = /db\.(stock|locationStock|stockRecords|returnItems|saleOrderItems|purchaseOrderItems|transferItems|stocktakeItems)\.bulk(Put|Add)\(/g
    for (const file of [
      'src/stores/returns.ts', 'src/stores/inventory.ts', 'src/stores/stockDoc.ts',
      'src/stores/sales.ts', 'src/stores/purchase.ts', 'src/stores/quotes.ts'
    ]) {
      const hits = src(file).match(forbidden) ?? []
      expect(hits, `${file} 仍有裸批量写`).toHaveLength(0)
    }
  })
})

// ---------------------------------------------------------------- 5. A2 档契约

describe('A2 档语义：applyQuantityDeltas 等价于「逐行 读→改→写」', () => {
  /** 假表：记录实际落到行上的数量，用于和参考实现对比 */
  function makeFixtures(initialRows: Array<Record<string, any>>) {
    const written = new Map<string | number, number>()
    const calls = { reads: 0, bulkAdd: 0, bulkPut: 0 }
    const rowsByKey = new Map<string, Record<string, any>>()
    for (const r of initialRows) rowsByKey.set(String(r.productId), { ...r })
    const table = {
      where: (field: string) => ({
        anyOf: (ids: any[]) => ({
          toArray: async () => {
            calls.reads++
            return Array.from(rowsByKey.values())
              .filter(r => ids.includes(r.productId))
              .map(r => ({ ...r }))
          }
        })
      }),
      bulkAdd: async (rows: any[]) => { calls.bulkAdd++; for (const r of rows) written.set(String(r.productId), r.quantity) },
      bulkPut: async (rows: any[]) => { calls.bulkPut++; for (const r of rows) written.set(String(r.productId), r.quantity) },
      add: async (r: any) => { written.set(String(r.productId), r.quantity) },
      put: async (r: any) => { written.set(String(r.productId), r.quantity) },
      update: async () => 1,
    } as any
    return { table, written, calls, rowsByKey }
  }

  /** 逐行参考实现：与改造前的行为一一对应 */
  function referenceApply(
    initial: number | null,
    deltas: number[],
    clampZero: boolean,
    createIfMissing: boolean
  ): number | null {
    let cur = initial
    for (const d of deltas) {
      if (cur === null) {
        if (!createIfMissing) continue
        cur = clampZero ? Math.max(0, d) : d
      } else {
        cur = clampZero ? Math.max(0, cur + d) : cur + d
      }
    }
    return cur
  }

  it('随机场景下批量结果与逐行参考实现完全一致', async () => {
    let seed = 20260926
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
    for (let round = 0; round < 60; round++) {
      const hasRow = rnd() > 0.25
      const initial = hasRow ? Math.floor(rnd() * 20) : null
      const clampZero = rnd() > 0.5
      const createIfMissing = rnd() > 0.4
      const deltas = Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => Math.floor(rnd() * 21) - 10)

      const { table, written } = makeFixtures(initial === null ? [] : [{ productId: 1, quantity: initial }])
      await applyQuantityDeltas({
        table,
        keyField: 'productId',
        keys: [1],
        deltas: deltas.map(d => ({ key: '1', delta: d })),
        getKey: r => String(r.productId),
        clampZero,
        buildNew: (_k, delta) => createIfMissing ? { productId: 1, quantity: clampZero ? Math.max(0, delta) : delta } : null,
        touch: r => { r.updatedAt = 'T' }
      })
      const expected = referenceApply(initial, deltas, clampZero, createIfMissing)
      if (expected === null) expect(written.has('1')).toBe(false)
      else expect(written.get('1')).toBe(expected)
    }
  })

  it('一次调用只发 1 次批量读 + 至多 2 次批量写', async () => {
    const { table, calls } = makeFixtures([{ productId: 1, quantity: 5 }])
    await applyQuantityDeltas({
      table, keyField: 'productId', keys: [1],
      deltas: [1, 2, 3].map(d => ({ key: '1', delta: d })),
      getKey: r => String(r.productId),
      clampZero: true,
      buildNew: (_k, delta) => ({ productId: 1, quantity: delta })
    })
    expect(calls.reads).toBe(1)
    expect(calls.bulkPut).toBe(1)
    expect(calls.bulkAdd).toBe(0)
  })

  it('增量为空时不查库、不写库', async () => {
    const { table, calls } = makeFixtures([{ productId: 1, quantity: 5 }])
    await applyQuantityDeltas({
      table, keyField: 'productId', keys: [],
      deltas: [], getKey: r => String(r.productId), clampZero: true, buildNew: () => null
    })
    expect(calls.reads).toBe(0)
    expect(calls.bulkPut + calls.bulkAdd).toBe(0)
  })
})

describe('A2 档契约锁：出入库 / 调拨 / 盘点 / 报价明细不得退回逐行写', () => {
  it('销售出库的库存改动走批量 upsert，不再是 N 条 update', () => {
    const s = src('src/stores/sales.ts')
    expect(s).not.toMatch(/\.map\(u => db\.stock\.update\(/)
    expect(s).not.toMatch(/\.map\(u => db\.locationStock\.update\(/)
    expect(s).toContain('safeBulkPut(db.stock')
    expect(s).toContain('safeBulkPut(db.locationStock')
  })

  it('采购入库的库存改动同样走批量', () => {
    const p = src('src/stores/purchase.ts')
    expect(p).not.toMatch(/\.map\(u => db\.stock\.update\(/)
    expect(p).not.toMatch(/\.map\(r => db\.stock\.add\(/)
    expect(p).toContain('safeBulkPut(db.stock')
    expect(p).toContain('safeBulkAdd(db.locationStock')
  })

  it('调拨不再逐行 await 四种写入', () => {
    const inv = src('src/stores/inventory.ts')
    expect(inv).not.toMatch(/await\s+db\.transferItems\.add/)
    expect(inv).not.toMatch(/for \(const e of entries\)[\s\S]{0,600}?await applyLocationDelta\(/)
    expect(inv).toContain('safeBulkAdd(db.transferItems')
  })

  it('盘点不再逐行 await 四种写入', () => {
    const inv = src('src/stores/inventory.ts')
    expect(inv).not.toMatch(/for \(const e of entries\)[\s\S]{0,800}?await db\.stock\.where\('productId'\)/)
    expect(inv).not.toMatch(/for \(const e of entries\)[\s\S]{0,800}?await db\.stocktakeItems\.add/)
    expect(inv).toContain('safeBulkAdd(db.stocktakeItems')
  })

  it('⚠️ 盘点必须保留「无差异也写明细与流水」的原语义', () => {
    // 曾经在这里误加 filter(delta !== 0)，会把「数量一致」的盘点行静默丢掉
    const inv = src('src/stores/inventory.ts')
    const block = inv.slice(inv.indexOf('async function stocktake('), inv.indexOf('async function listStocktakes('))
    expect(block).not.toMatch(/filter\(d => d\.delta !== 0\)/)
    expect(block).toContain('applyLocationDeltas')
    expect(block).toContain('applyStockDeltas')
  })

  it('库存自愈 reconcileProducts 不再逐商品写库', () => {
    const inv = src('src/stores/inventory.ts')
    const block = inv.slice(inv.indexOf('async function reconcileProducts('), inv.indexOf('async function ensureLocations('))
    expect(block).not.toMatch(/await db\.locationStock\.update\(/)
    expect(block).not.toMatch(/await applyLocationDelta\(/)
    // 批量 upsert 必须传播整行，否则会把 productId 等列抹掉
    expect(block).toContain('{ ...r.row, quantity')
  })

  it('出入库单改单 / 撤回的库存退回归批量', () => {
    const sd = src('src/stores/stockDoc.ts')
    expect(sd).not.toMatch(/for \(const r of records\) await applyStockDelta/)
    expect(sd).toContain('async function applyStockDeltas(')
    expect(sd).not.toContain('async function applyStockDelta(')
  })

  it('报价单明细一次批量写入（新增 / 改单两处）', () => {
    const q = src('src/stores/quotes.ts')
    expect(q).not.toMatch(/for \(const (item|it) of (data\.items|items)\)[\s\S]{0,400}?await db\.quoteOrderItems\.add/)
    expect(q.match(/safeBulkAdd\(db\.quoteOrderItems/g)?.length).toBe(2)
  })
})
