import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * 内存版 db 替身。
 * 刻意不用 fake-indexeddb：本地 Dexie 在 CI 环境下批量建索引极慢（单文件超 10 分钟），
 * 而这里要验的是「余额怎么算」，跟存储引擎无关。
 */
function memTable() {
  let rows: Array<Record<string, any>> = []
  return {
    async toArray() { return rows.slice() },
    async add(o: Record<string, any>) {
      const id = rows.length + 1
      rows.push({ ...o, id })
      return id
    },
    async bulkAdd(list: Array<Record<string, any>>) {
      for (const o of list) await this.add(o)
    },
    async clear() { rows = [] },
    async get(id: number) { return rows.find(r => r.id === id) },
    async update(id: number, ch: Record<string, any>) {
      const r = rows.find(x => x.id === id)
      if (r) Object.assign(r, ch)
    }
  }
}

// 注意：vi.mock 会被提升到文件顶部，factory 内不能引用外部变量，全部得在 factory 里现场造
vi.mock('../src/db', () => {
  const mk = () => memTable()
  const t: Record<string, any> = {
    saleOrders: mk(), purchaseOrders: mk(), payments: mk(), customers: mk(), suppliers: mk()
  }
  return { db: t, localDb: t, initDefaultAdmin: async () => {} }
})

import { db as tables } from '../src/db'
import { setActivePinia, createPinia } from 'pinia'
import { useFinanceStore } from '../src/stores/finance'

/**
 * 应收 / 应付余额计算（2026-09-25 修复）。
 *
 * 事故：finance.ts 里写的是 `db.payments.filter(...)`，但云端 db 是 CloudTable，
 * CloudTable 只有 where() 没有 filter()（filter 只存在于 where() 返回的 CloudQuery 上），
 * 调用直接抛 TypeError → listReceivables / listPayables 整体崩掉 →
 * 应收应付列表一片空白，且异常被 onMounted 吞掉，页面上没有任何提示。
 *
 * 这里锁死两条不变量：
 *   1. 流水表为空、单据没登记过收付款时，余额照样算得出来、单据照样列得出来；
 *   2. 同一单据的多笔流水要合并计算，不能只算最后一笔。
 */
describe('应收应付余额：无流水时也要算得出来', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    for (const t of Object.keys(tables)) await tables[t].clear()
  })

  it('销售单没登记任何收款时，仍然出现在应收列表且余额为全额', async () => {
    await tables.saleOrders.add({
      orderNo: 'XSCK001', customerId: 1, totalAmount: 5000,
      receiveStatus: 'unreceived', orderDate: '2026-09-01T00:00:00.000Z'
    })
    const store = useFinanceStore()
    const list = await store.listReceivables(false)
    expect(list).toHaveLength(1)
    expect(list[0].balance).toBe(5000)
    expect(list[0].orderNo).toBe('XSCK001')
  })

  it('采购单没登记任何付款时，仍然出现在应付列表且余额为全额', async () => {
    await tables.purchaseOrders.add({
      orderNo: 'CGD001', supplierId: 2, totalAmount: 8000,
      payStatus: 'unpaid', orderDate: '2026-09-01T00:00:00.000Z'
    })
    const store = useFinanceStore()
    const list = await store.listPayables(false)
    expect(list).toHaveLength(1)
    expect(list[0].balance).toBe(8000)
  })

  it('同一单据的多笔收款要累加，余额 = 总额 - 累计收款', async () => {
    const id = await tables.saleOrders.add({
      orderNo: 'XSCK002', customerId: 1, totalAmount: 9000,
      receiveStatus: 'partial', orderDate: '2026-09-02T00:00:00.000Z'
    })
    await tables.payments.bulkAdd([
      { type: 'receive', refOrderId: id, counterpartyId: 1, amount: 3000, payDate: '', operatorId: 1, remark: '' },
      { type: 'receive', refOrderId: id, counterpartyId: 1, amount: 2000, payDate: '', operatorId: 1, remark: '' }
    ])
    const store = useFinanceStore()
    const list = await store.listReceivables(false)
    expect(list).toHaveLength(1)
    expect(list[0].receivedAmount).toBe(5000)
    expect(list[0].balance).toBe(4000)
  })

  it('已结清单据不计入未结清列表，但传 includeSettled 时会出现', async () => {
    const id = await tables.saleOrders.add({
      orderNo: 'XSCK003', customerId: 1, totalAmount: 1000,
      receiveStatus: 'received', orderDate: '2026-09-03T00:00:00.000Z'
    })
    await tables.payments.add({
      type: 'receive', refOrderId: id, counterpartyId: 1, amount: 1000,
      payDate: '', operatorId: 1, remark: ''
    })
    const store = useFinanceStore()
    expect(await store.listReceivables(false)).toHaveLength(0)
    expect(await store.listReceivables(true)).toHaveLength(1)
  })

  it('销售退货（refund）从应收余额中冲减', async () => {
    const id = await tables.saleOrders.add({
      orderNo: 'XSCK004', customerId: 1, totalAmount: 5000,
      receiveStatus: 'partial', orderDate: '2026-09-04T00:00:00.000Z'
    })
    await tables.payments.add({
      type: 'refund', refOrderId: id, counterpartyId: 1, amount: 1500,
      payDate: '', operatorId: 1, remark: '退货'
    })
    const store = useFinanceStore()
    const list = await store.listReceivables(false)
    expect(list).toHaveLength(1)
    expect(list[0].balance).toBe(3500)
  })

  it('采购退货（supplier_credit）从应付余额中冲减', async () => {
    const id = await tables.purchaseOrders.add({
      orderNo: 'CGD002', supplierId: 2, totalAmount: 6000,
      payStatus: 'partial', orderDate: '2026-09-05T00:00:00.000Z'
    })
    await tables.payments.add({
      type: 'supplier_credit', refOrderId: id, counterpartyId: 2, amount: 1000,
      payDate: '', operatorId: 1, remark: '采购退货'
    })
    const store = useFinanceStore()
    const list = await store.listPayables(false)
    expect(list).toHaveLength(1)
    expect(list[0].balance).toBe(5000)
  })

  it('流水表里混着其它类型的记录时不影响应收应付计算', async () => {
    const id = await tables.saleOrders.add({
      orderNo: 'XSCK005', customerId: 1, totalAmount: 2000,
      receiveStatus: 'unreceived', orderDate: '2026-09-06T00:00:00.000Z'
    })
    await tables.payments.add({
      type: 'pay', refOrderId: id, counterpartyId: 1, amount: 9999,
      payDate: '', operatorId: 1, remark: '付款流水不该影响应收'
    })
    const store = useFinanceStore()
    expect((await store.listReceivables(false))[0].balance).toBe(2000)
  })

  it('收付款流水为空表时，应收应付总额均为 0 而不是抛错', async () => {
    const store = useFinanceStore()
    await expect(store.getReceivableTotal()).resolves.toBe(0)
    await expect(store.getPayableTotal()).resolves.toBe(0)
  })
})
