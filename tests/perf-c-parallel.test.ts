import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * C 档（V2.1-2.34-C）· 页面加载并行化 回归锁
 *
 * 这一档只做一件事：**把「串行等待」改成「并发等待」，把「重复拉同一张表」改成复用**。
 * 因为这类改动极易在半年后被一次随手重构改回串行（而且改回去不会报错、只是变慢），
 * 所以这里把两条不变量锁死：
 *
 *   1. 语义等价：传 ordersAll / paysAll 复用已拉的数据，算出来的结果与「内部自己拉」完全一致；
 *   2. 请求有界：列表详情的请求次数**与单据条数无关**（原来是每张单据一次查询的 N+1）。
 *
 * 另有第三类静态契约，用于防止 LH（最早ailand人）把 Promise.all 改回逐行 await。
 *
 * ⚠️ 与 A/B 档同理：这里刻意不用 fake-indexeddb（本地 Dexie 在 CI 里批量建索引极慢），
 * 直接给一个内存版 db 替身，并记录每张表被读了多少次 —— 请求次数才是要验证的对象。
 */

// ---------------------------------------------------------------- db 替身

vi.mock('../src/db', () => {
  const counts: Record<string, number> = {}
  const bump = (k: string) => { counts[k] = (counts[k] ?? 0) + 1 }

  function make(name: string) {
    let rows: Array<Record<string, any>> = []
    let seq = 0
    const byId = (a: Record<string, any>, b: Record<string, any>) => (a.id ?? 0) - (b.id ?? 0)
    const T: any = {
      async toArray() {
        bump(`${name}.toArray`)
        return rows.slice().sort(byId)
      },
      async add(o: Record<string, any>) {
        bump(`${name}.add`)
        const id = o.id ?? ++seq
        rows.push({ ...o, id })
        return id
      },
      async bulkAdd(list: Array<Record<string, any>>) {
        bump(`${name}.bulkAdd`)
        for (const o of list) await T.add(o)
      },
      async bulkPut(list: Array<Record<string, any>>) {
        bump(`${name}.bulkPut`)
        for (const o of list) {
          const hit = rows.find(x => x.id != null && x.id === o.id)
          if (hit) Object.assign(hit, o)
          else rows.push({ ...o })
        }
      },
      async put(o: Record<string, any>) {
        bump(`${name}.put`)
        const hit = rows.find(x => x.id != null && x.id === o.id)
        if (hit) Object.assign(hit, o)
        else rows.push({ ...o })
      },
      async get(id: number) {
        bump(`${name}.get`)
        return rows.find(x => x.id === id)
      },
      async update(id: number, ch: Record<string, any>) {
        bump(`${name}.update`)
        const hit = rows.find(x => x.id === id)
        if (hit) Object.assign(hit, ch)
      },
      async clear() { rows = [] },
      // ⚠️ equals / anyOf 必须**同步返回**查询对象：真实 Dexie 与 anyOfBatch 都是这样用的
      // （`table.where(f).anyOf(list).toArray()` 中间没有 await）。
      where(field: string) {
        return {
          equals(v: any) {
            bump(`${name}.equals`)
            return {
              async toArray() {
                return rows.filter(r => r[field] === v).sort(byId)
              }
            }
          },
          anyOf(list: any[]) {
            bump(`${name}.anyOf`)
            return {
              async toArray() {
                const set = new Set(list)
                return rows.filter(r => set.has(r[field])).sort(byId)
              }
            }
          }
        }
      }
    }
    return T
  }

  const NAMES = [
    'users', 'customers', 'suppliers', 'products', 'stock', 'locationStock',
    'purchaseOrders', 'purchaseOrderItems', 'saleOrders', 'saleOrderItems',
    'stockRecords', 'payments', 'auditLogs', 'locations',
    'transferOrders', 'transferItems', 'stocktakes', 'stocktakeItems',
    'returnOrders', 'returnItems', 'rolePerms', 'ledgerEntries',
    'quoteOrders', 'quoteOrderItems'
  ]
  const db: Record<string, any> = {}
  for (const n of NAMES) db[n] = make(n)

  return {
    db,
    localDb: db,
    initDefaultAdmin: async () => {},
    __counts: counts,
    __resetCounts: () => { for (const k of Object.keys(counts)) delete counts[k] }
  }
})

import * as dbModule from '../src/db'
import { setActivePinia, createPinia } from 'pinia'
import { useFinanceStore } from '../src/stores/finance'
import { useInventoryStore } from '../src/stores/inventory'

const db = (dbModule as any).db as Record<string, any>
const counts = (dbModule as any).__counts as Record<string, number>
const resetCounts = (dbModule as any).__resetCounts as () => void

async function clearAll(): Promise<void> {
  for (const k of Object.keys(db)) await db[k].clear()
  resetCounts()
}

// ======================================================================
// 一、finance：ordersAll / paysAll 复用必须与原结果完全一致，且不多发一次请求
// ======================================================================

describe('C 档 · 应收/应付支持复用已拉的订单与流水（结果不变、请求减半）', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await clearAll()
  })

  async function seedFinanceData() {
    await db.saleOrders.bulkAdd([
      { id: 1, orderNo: 'XS-1', customerId: 11, totalAmount: 1000, orderDate: '2026-09-01T10:00:00.000Z' },
      { id: 2, orderNo: 'XS-2', customerId: 12, totalAmount: 2500, orderDate: '2026-09-05T10:00:00.000Z' },
      { id: 3, orderNo: 'XS-3', customerId: 11, totalAmount: 800, orderDate: '2026-08-20T10:00:00.000Z' }
    ])
    await db.purchaseOrders.bulkAdd([
      { id: 1, orderNo: 'CG-1', supplierId: 21, totalAmount: 5600, orderDate: '2026-09-02T10:00:00.000Z' },
      { id: 2, orderNo: 'CG-2', supplierId: 22, totalAmount: 1200, orderDate: '2026-09-09T10:00:00.000Z' }
    ])
    // 同一单据多笔流水 + 红冲混合，确保聚合逻辑被覆盖
    await db.payments.bulkAdd([
      { type: 'receive', refOrderId: 1, amount: 300 },
      { type: 'receive', refOrderId: 1, amount: 200 },
      { type: 'refund', refOrderId: 1, amount: 50 },
      { type: 'receive', refOrderId: 2, amount: 2500 },
      { type: 'pay', refOrderId: 1, amount: 5600 },
      { type: 'supplier_credit', refOrderId: 2, amount: 200 }
    ])
  }

  it('传 ordersAll + paysAll 时，应收结果与不传参数完全一致', async () => {
    await seedFinanceData()
    const s = useFinanceStore()

    const baseline = await s.listReceivables(true)

    resetCounts()
    const so = await db.saleOrders.toArray()
    const pays = await db.payments.toArray()
    resetCounts()
    const reused = await s.listReceivables(true, pays, so)

    expect(reused).toEqual(baseline)
    // 复用生效：这一轮里既没有再读 saleOrders，也没有再读 payments
    expect(counts['saleOrders.toArray'] ?? 0).toBe(0)
    expect(counts['payments.toArray'] ?? 0).toBe(0)
  })

  it('传 ordersAll + paysAll 时，应付结果与不传参数完全一致', async () => {
    await seedFinanceData()
    const s = useFinanceStore()

    const baseline = await s.listPayables(true)

    resetCounts()
    const po = await db.purchaseOrders.toArray()
    const pays = await db.payments.toArray()
    resetCounts()
    const reused = await s.listPayables(true, pays, po)

    expect(reused).toEqual(baseline)
    expect(counts['purchaseOrders.toArray'] ?? 0).toBe(0)
    expect(counts['payments.toArray'] ?? 0).toBe(0)
  })

  it('不传参数时行为不变：仍然内部自行读取（向后兼容）', async () => {
    await seedFinanceData()
    const s = useFinanceStore()
    resetCounts()
    const r = await s.listReceivables(true)
    expect(r.length).toBe(3)
    expect(counts['saleOrders.toArray'] ?? 0).toBe(1)
    expect(counts['payments.toArray'] ?? 0).toBe(1)
  })

  it('只传 paysAll 不传 ordersAll 时也不出错（分步落地不会炸）', async () => {
    await seedFinanceData()
    const s = useFinanceStore()
    const baseline = await s.listReceivables(true)
    const pays = await db.payments.toArray()
    const half = await s.listReceivables(true, pays)
    expect(half).toEqual(baseline)
  })

  it('余额口径不变：应收 = 总额 - 收款 - 红冲；应付 = 总额 - 付款 - 供应商 Credit', async () => {
    await seedFinanceData()
    const s = useFinanceStore()
    const [rs, ps] = [await s.listReceivables(true), await s.listPayables(true)]

    expect(rs.find(r => r.orderId === 1)?.balance).toBe(1000 - 300 - 200 - 50)
    expect(rs.find(r => r.orderId === 2)?.balance).toBe(0)
    expect(rs.find(r => r.orderId === 3)?.balance).toBe(800)
    expect(ps.find(p => p.orderId === 1)?.balance).toBe(0)
    expect(ps.find(p => p.orderId === 2)?.balance).toBe(1200 - 200)
  })
})

// ======================================================================
// 二、inventory：调拨 / 盘点列表的请求次数与单据条数无关（N+1 已消灭）
// ======================================================================

describe('C 档 · 调拨/盘点列表：明细一次查完，请求数与单据数无关', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await clearAll()
  })

  async function seedProductsAndUsers() {
    await db.products.bulkAdd([
      { id: 101, brand: '美的', model: 'A1', unit: '台' },
      { id: 102, brand: '格力', model: 'B2', unit: '台' },
      { id: 103, brand: '海尔', model: 'C3', unit: '台' },
      { id: 104, brand: '奥克斯', model: 'D4', unit: '台' }
    ])
    await db.users.bulkAdd([
      { id: 1, name: '老板' },
      { id: 2, name: '库管' }
    ])
    await db.locations.bulkAdd([
      { id: 1, name: '总仓' },
      { id: 2, name: '门店' }
    ])
  }

  /** 造 N 张调拨单，每张若干明细 */
  async function seedTransfers(orderCount: number, itemsPerOrder: number) {
    let itemId = 0
    for (let i = 1; i <= orderCount; i++) {
      await db.transferOrders.add({
        id: i,
        orderNo: `DB2026092${i % 10}-${String(i).padStart(3, '0')}`,
        fromLoc: 1,
        toLoc: 2,
        date: new Date(Date.UTC(2026, 8, i)).toISOString(),
        operatorId: (i % 2) + 1,
        status: 'done'
      })
      for (let k = 0; k < itemsPerOrder; k++) {
        await db.transferItems.add({
          id: ++itemId,
          transferOrderId: i,
          productId: 101 + ((i + k) % 4),
          quantity: k + 1
        })
      }
    }
  }

  /** 旧实现：每个单据一次 where(...).equals(...).toArray()——用来做语义对照 */
  async function oldListTransfers() {
    const orders = await db.transferOrders.toArray()
    if (!orders.length) return []
    const users = await db.users.toArray()
    const userMap = new Map(users.map((u: any) => [u.id, u.name]))
    const locs = await db.locations.toArray()
    const locMap = new Map(locs.map((l: any) => [l.id, l.name]))
    const products = await db.products.toArray()
    const pmap = new Map(products.map((p: any) => [p.id, `${p.brand} ${p.model}`.trim()]))

    const rows: Array<Record<string, any>> = []
    for (const o of orders) {
      const items = await db.transferItems.where('transferOrderId').equals(o.id).toArray()
      rows.push({
        orderNo: o.orderNo,
        fromLoc: o.fromLoc,
        toLoc: o.toLoc,
        fromName: locMap.get(o.fromLoc) ?? `库位${o.fromLoc}`,
        toName: locMap.get(o.toLoc) ?? `库位${o.toLoc}`,
        date: (o.date ?? '').slice(0, 16).replace('T', ' '),
        operatorName: userMap.get(o.operatorId) ?? `#${o.operatorId}`,
        itemCount: items.length,
        totalQty: items.reduce((s: number, it: any) => s + it.quantity, 0),
        items: items.map((it: any) => ({
          productName: pmap.get(it.productId) ?? `商品#${it.productId}`,
          quantity: it.quantity
        }))
      })
    }
    return rows.sort((a: any, b: any) => (a.date < b.date ? 1 : -1))
  }

  it('12 张调拨单：新实现的结果与旧实现逐字段一致', async () => {
    await seedProductsAndUsers()
    await seedTransfers(12, 3)
    const inv = useInventoryStore()

    const expected = await oldListTransfers()
    const actual = await inv.listTransfers()
    expect(actual).toEqual(expected)
  })

  it('调拨明细只读一次（anyOf 批量），请求数与单据条数无关', async () => {
    await seedProductsAndUsers()
    await seedTransfers(12, 3)
    const inv = useInventoryStore()

    resetCounts()
    await inv.listTransfers()

    // 关键：明细表既没有 toArray 全表拉，也没有每单一次 equals
    expect(counts['transferItems.toArray'] ?? 0).toBe(0)
    expect(counts['transferItems.equals'] ?? 0).toBe(0)
    expect(counts['transferItems.anyOf'] ?? 0).toBe(1)
  })

  it('单据数量翻 4 倍，明细请求数仍是 1（原来是 N 次）', async () => {
    await seedProductsAndUsers()
    await seedTransfers(48, 2)
    const inv = useInventoryStore()

    resetCounts()
    const rows = await inv.listTransfers()
    expect(rows.length).toBe(48)
    expect(counts['transferItems.anyOf'] ?? 0).toBe(1)
    expect(counts['transferItems.equals'] ?? 0).toBe(0)
  })

  it('三张字典表（users/locations/products）并发后只读一次', async () => {
    await seedProductsAndUsers()
    await seedTransfers(5, 2)
    const inv = useInventoryStore()

    resetCounts()
    await inv.listTransfers()
    expect(counts['users.toArray'] ?? 0).toBe(1)
    expect(counts['locations.toArray'] ?? 0).toBe(1)
    expect(counts['products.toArray'] ?? 0).toBe(1)
  })

  // ---------- 盘点 ----------

  async function seedStocktakes(orderCount: number, itemsPerOrder: number) {
    let itemId = 0
    for (let i = 1; i <= orderCount; i++) {
      await db.stocktakes.add({
        id: i,
        orderNo: `PD2026092${i % 10}-${String(i).padStart(3, '0')}`,
        locationId: (i % 2) + 1,
        date: new Date(Date.UTC(2026, 8, i)).toISOString(),
        operatorId: (i % 2) + 1,
        status: 'done'
      })
      for (let k = 0; k < itemsPerOrder; k++) {
        const sys = 10 + k
        const actual = k % 3 === 0 ? sys + 2 : sys - 1 // 制造盘盈 / 盘亏 / 无差异三种情形
        await db.stocktakeItems.add({
          id: ++itemId,
          stocktakeId: i,
          productId: 101 + ((i + k) % 4),
          systemQty: sys,
          actualQty: actual
        })
      }
    }
  }

  async function oldListStocktakes() {
    const orders = await db.stocktakes.toArray()
    if (!orders.length) return []
    const users = await db.users.toArray()
    const userMap = new Map(users.map((u: any) => [u.id, u.name]))
    const locs = await db.locations.toArray()
    const locMap = new Map(locs.map((l: any) => [l.id, l.name]))
    const products = await db.products.toArray()
    const pmap = new Map(products.map((p: any) => [p.id, `${p.brand} ${p.model}`.trim()]))

    const rows: Array<Record<string, any>> = []
    for (const o of orders) {
      const items = await db.stocktakeItems.where('stocktakeId').equals(o.id).toArray()
      const detail = items.map((it: any) => ({
        productName: pmap.get(it.productId) ?? `商品#${it.productId}`,
        systemQty: it.systemQty,
        actualQty: it.actualQty,
        diff: it.actualQty - it.systemQty
      }))
      rows.push({
        orderNo: o.orderNo,
        locationId: o.locationId,
        locationName: locMap.get(o.locationId) ?? `库位${o.locationId}`,
        date: (o.date ?? '').slice(0, 16).replace('T', ' '),
        operatorName: userMap.get(o.operatorId) ?? `#${o.operatorId}`,
        itemCount: items.length,
        profit: detail.filter((d: any) => d.diff > 0).reduce((s: number, d: any) => s + d.diff, 0),
        loss: detail.filter((d: any) => d.diff < 0).reduce((s: number, d: any) => s + -d.diff, 0),
        items: detail
      })
    }
    return rows.sort((a: any, b: any) => (a.date < b.date ? 1 : -1))
  }

  it('9 张盘点单：新实现与旧实现逐字段一致（含盘盈/盘亏合计）', async () => {
    await seedProductsAndUsers()
    await seedStocktakes(9, 4)
    const inv = useInventoryStore()

    const expected = await oldListStocktakes()
    const actual = await inv.listStocktakes()
    expect(actual).toEqual(expected)
  })

  it('盘点明细同样只读一次，且盘盈盘亏合计与旧实现一致', async () => {
    await seedProductsAndUsers()
    await seedStocktakes(9, 4)
    const inv = useInventoryStore()

    resetCounts()
    const rows = await inv.listStocktakes()

    expect(counts['stocktakeItems.toArray'] ?? 0).toBe(0)
    expect(counts['stocktakeItems.equals'] ?? 0).toBe(0)
    expect(counts['stocktakeItems.anyOf'] ?? 0).toBe(1)

    // 每张单的明细行：第 1 行盈 2、其余亏 1
    for (const r of rows) {
      expect(r.itemCount).toBe(4)
      expect(r.profit).toBe(2 + 2)   // k=0 与 k=3 为盈
      expect(r.loss).toBe(1 + 1)     // k=1 与 k=2 为亏
    }
  })

  it('空库时两个列表都返回空数组，不报错', async () => {
    const inv = useInventoryStore()
    await expect(inv.listTransfers()).resolves.toEqual([])
    await expect(inv.listStocktakes()).resolves.toEqual([])
  })
})

// ======================================================================
// 三、静态契约：防止被改回串行 / 改回重复拉同一张表
// ======================================================================

const root = resolve(__dirname, '..')
const src = (p: string) => readFileSync(resolve(root, p), 'utf8')

describe('C 档 · 静态契约（防止被改回串行）', () => {
  it('老板看板：原材料一轮并发，且把 orders / pays 复用给应收应付', () => {
    const t = src('src/stores/dashboard.ts')
    expect(t).toContain('const [saleOrders, purchaseOrders, saleItems, pays, lowStock] = await Promise.all([')
    expect(t).toContain('financeStore.listReceivables(false, pays, saleOrders)')
    expect(t).toContain('financeStore.listPayables(false, pays, purchaseOrders)')
    // 不允许退回到「不带复用参数」的写法
    expect(t).not.toContain('financeStore.listReceivables()')
    expect(t).not.toContain('financeStore.listPayables()')
  })

  it('老板看板：不再出现各算一半的串行 await 链', () => {
    const t = src('src/stores/dashboard.ts')
    expect(t).not.toContain('const receivables = await financeStore.listReceivables()')
    expect(t).not.toContain('const payables = await financeStore.listPayables()')
    expect(t).not.toContain('const saleItems = await db.saleOrderItems.toArray()')
    expect(t).not.toContain('const lowStock = await productStore.getLowStockProducts()')
  })

  it('finance store：listReceivables / listPayables 支持第三个参数 ordersAll', () => {
    const t = src('src/stores/finance.ts')
    expect(t).toContain('const orders = ordersAll ?? await db.saleOrders.toArray()')
    expect(t).toContain('const orders = ordersAll ?? await db.purchaseOrders.toArray()')
    expect((t.match(/ordersAll\?:/g) ?? []).length).toBeGreaterThanOrEqual(2)
  })

  it('采购工作台：四份数据一次并发，不再逐个 await', () => {
    const t = src('src/views/purchase/PurchaseHomeView.vue')
    expect(t).toContain('purchaseStore.listSuppliers(),')
    expect(t).toContain('purchaseStore.listPendingInbound(),')
    expect(t).toContain('purchaseStore.listOrders(),')
    expect(t).toContain('financeStore.listPayables()')
    expect(t).toContain('const [sups, pending, all, payables] = await Promise.all([')
    expect(t).not.toContain('suppliers.value = await purchaseStore.listSuppliers()')
    expect(t).not.toContain('const all = await purchaseStore.listOrders()')
  })

  it('销售工作台：四份数据一次并发，不再逐个 await', () => {
    const t = src('src/views/sales/SalesHomeView.vue')
    expect(t).toContain('const [custs, pending, all, receivables] = await Promise.all([')
    expect(t).toContain('salesStore.listCustomers(),')
    expect(t).toContain('salesStore.listPendingOutbound(),')
    expect(t).toContain('salesStore.listOrders(),')
    expect(t).toContain('financeStore.listReceivables()')
    expect(t).not.toContain('customers.value = await salesStore.listCustomers()')
    expect(t).not.toContain('const all = await salesStore.listOrders()')
  })

  it('库房工作台：今日流水并入同一轮并发（原来是第 5 段串行）', () => {
    const t = src('src/views/warehouse/WarehouseHomeView.vue')
    expect(t).toContain('const [pi, po, cs, ss, records] = await Promise.all([')
    expect(t).toContain('db.stockRecords.toArray()')
    expect(t).not.toContain('const records = await db.stockRecords.toArray()')
  })

  // 财务工作台本来就已经是单次 Promise.all 并发，这里只做「不许退化成串行」的锁。
  //
  // ⚠️ 试过把 payments 拉出来复用给 listReceivables / listPayables（少拉一遍），
  // 逻辑没问题，但会把 reload 拆成「先流水、后订单」两轮 —— 在 fake-indexeddb 环境下
  // 上一用例遗留的挂起事务会串扰到下一用例，tests/p1-workbench.test.ts 的
  // 「库房工作台：待收货/待发货数量与实际一致」会变成 suppliers[0] undefined。
  // 该页 payments 是小表、收益有限，不值得为它引入这种结构性风险，故保持原样。
  it('财务工作台：reload 保持单次并发，不许退化成串行', () => {
    const t = src('src/views/finance/FinanceHomeView.vue')
    expect(t).toContain('const [rs, ps, cs, ss, pays] = await Promise.all([')
    expect(t).toContain('financeStore.listReceivables(),')
    expect(t).toContain('financeStore.listPayables(),')
    expect(t).not.toContain('const receivables = await financeStore.listReceivables()')
    expect(t).not.toContain('const payables = await financeStore.listPayables()')
  })

  it('老板首页：统计 / 空态 / 密码提醒三者并发', () => {
    const t = src('src/views/boss/BossHomeView.vue')
    expect(t).toContain('await Promise.all([refreshDashboard(), refreshEmpty(), loadPwdTip()])')
    expect(t).toContain('async function loadPwdTip()')
    // 不允许退回「一个接一个 await」的三段串行
    expect(t).not.toMatch(/await refreshDashboard\(\)[\s\S]{0,30}await refreshEmpty\(\)/)
    expect(t).not.toMatch(/await refreshEmpty\(\)[\s\S]{0,30}showPwdTip\.value = await userStore/)
  })

  it('盘点页：四份数据并发，只有系统库存等库房确定后再取', () => {
    const t = src('src/views/warehouse/CountView.vue')
    expect(t).toContain('const [, locs, prods, hist] = await Promise.all([')
    expect(t).toContain('inv.syncLocationStock(),')
    expect(t).toContain('inv.listLocations(),')
    expect(t).toContain('productStore.listAll(),')
    expect(t).toContain('inv.listStocktakes()')
    expect(t).not.toContain('locations.value = await inv.listLocations()')
    expect(t).not.toContain('products.value = await productStore.listAll()')
  })

  it('调拨页：两个库位库存并发，init 里四份数据并发', () => {
    const t = src('src/views/warehouse/TransferView.vue')
    expect(t).toContain('const [from, to] = await Promise.all([')
    expect(t).toContain('inv.locationStockMap(fromLoc.value),')
    expect(t).toContain('inv.locationStockMap(toLoc.value)')
    expect(t).toContain('const [, locs, prods, hist] = await Promise.all([')
    expect(t).not.toContain('fromMap.value = await inv.locationStockMap(fromLoc.value)')
  })

  it('库存 store：明细不再逐单查询', () => {
    const t = src('src/stores/inventory.ts')
    expect(t).not.toMatch(/db\.transferItems\.where\(/)
    expect(t).not.toMatch(/db\.stocktakeItems\.where\(/)
    expect(t).toContain('db.transferItems as any,')
    expect(t).toContain("'transferOrderId',")
    expect(t).toContain('db.stocktakeItems as any,')
    expect(t).toContain("'stocktakeId',")
  })

  it('记一笔：关联单号下拉走窄字段，不再搬整张主表', () => {
    const t = src('src/views/finance/LedgerView.vue')
    expect(t).toContain("narrowRows('purchaseOrders', 'orderNo')")
    expect(t).toContain("narrowRows('saleOrders', 'orderNo')")
    expect(t).toContain("narrowRows('returnOrders', 'orderNo')")
    expect(t).toContain("narrowRows('transferOrders', 'orderNo')")
    expect(t).toContain("narrowRows('stocktakes', 'orderNo')")
    expect(t).toContain("'stockRecords', 'batchNo',")
    expect(t).toContain("q => q.eq('type', recType),")
    expect(t).toContain("() => db.stockRecords.where('type').equals(recType).toArray()")
    // 旧写法：把整张表拉回来只为了取一列
    expect(t).not.toContain('(await db.purchaseOrders.toArray()).map')
    expect(t).not.toContain('(await db.saleOrders.toArray()).map')
    expect(t).not.toContain('(await db.returnOrders.toArray()).map')
    expect(t).not.toContain('(await db.transferOrders.toArray()).map')
    expect(t).not.toContain('(await db.stocktakes.toArray()).map')
  })
})
