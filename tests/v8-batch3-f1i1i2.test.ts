/**
 * V8 批三（V2.2-2.3）回归测试
 *  - F1 财务工作台：payments / saleOrders / purchaseOrders 各只拉一次，
 *    透传 listReceivables / listPayables 复用（payments 3 次→1 次、orders 各 2 次→1 次）
 *  - I1 库存明细：distributionAll 的 locationStock 改窄字段 + 支持透传 locRows 复用
 *  - I2 库存管理：商品改窄字段 listProductLites；locationStock 自愈 + 分布合并成 1 次读取
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import 'fake-indexeddb/auto'
import { db } from '../src/db'
import { useFinanceStore } from '../src/stores/finance'
import { useInventoryStore } from '../src/stores/inventory'
import FinanceHomeView from '../src/views/finance/FinanceHomeView.vue'
import StockManageView from '../src/views/stock/StockManageView.vue'

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/', component: { template: '<div/>' } },
    { path: '/:pathMatch(.*)*', component: { template: '<div/>' } }
  ]
})

beforeEach(async () => {
  setActivePinia(createPinia())
  localStorage.clear()
  await db.open()
  await Promise.all(db.tables.map(t => t.clear()))
})

describe('F1 财务工作台：payments / orders 各只拉一次', () => {
  it('reload 只调用 db.payments.toArray 一次（不是 3 次）', async () => {
    const spy = vi.spyOn(db.payments, 'toArray')
    const wrapper = mount(FinanceHomeView, { global: { plugins: [router, createPinia()] } })
    // onMounted(reload) 异步执行
    await flushPromises()
    await new Promise(r => setTimeout(r, 20))
    await flushPromises()
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
    wrapper.unmount()
  })

  it('listReceivables 复用透传的 pays/orders，不再各自 toArray', async () => {
    const spy = vi.spyOn(db.payments, 'toArray')
    const pays = [
      { id: 1, type: 'receive', refOrderId: 10, amount: 100 } as any,
      { id: 2, type: 'pay', refOrderId: 99, amount: 50 } as any
    ]
    const orders = [
      { id: 10, orderNo: 'S10', customerId: 1, totalAmount: 200, orderDate: '2026-01-01' } as any
    ]
    const store = useFinanceStore()
    const res = await store.listReceivables(false, pays, orders)
    // 透传复用，绝不再暗地拉 payments 全表
    expect(spy).not.toHaveBeenCalled()
    expect(res.length).toBe(1)
    expect(res[0].balance).toBe(100) // 200 - 100
    spy.mockRestore()
  })
})

describe('I1 库存明细：distributionAll 窄字段 + 透传复用', () => {
  it('distributionAll 复用透传 locRows，不读 locationStock', async () => {
    const spy = vi.spyOn(db.locationStock, 'toArray')
    const inv = useInventoryStore()
    const locRows = [
      { productId: 1, locationId: 1, quantity: 5 },
      { productId: 1, locationId: 2, quantity: 3 }
    ] as any
    const { byProduct, byLocation } = await inv.distributionAll({ locRows })
    // 透传时绝不再读表
    expect(spy).not.toHaveBeenCalled()
    expect(byProduct[1][1]).toBe(5)
    expect(byProduct[1][2]).toBe(3)
    expect(byLocation[2][1]).toBe(3)
    spy.mockRestore()
  })

  it('distributionAll 不传 locRows 时仍正常工作（本地回退 toArray）', async () => {
    await db.locationStock.add({ productId: 7, locationId: 1, quantity: 9 })
    const inv = useInventoryStore()
    const { byProduct } = await inv.distributionAll()
    expect(byProduct[7][1]).toBe(9)
  })
})

describe('I2 库存管理：locationStock 合并成 1 次读取', () => {
  it('reconcileProducts 复用透传 stockRows/locRows，不读两张表', async () => {
    const stockSpy = vi.spyOn(db.stock, 'toArray')
    const locSpy = vi.spyOn(db.locationStock, 'toArray')
    const inv = useInventoryStore()
    // 总库存与分布一致（diff=0）→ 不触发任何 upsert
    const stockRows = [{ productId: 1, quantity: 5 }] as any
    const locRows = [{ productId: 1, locationId: 1, quantity: 5, row: { id: 1 } }] as any
    await inv.reconcileProducts([1], { stockRows, locRows })
    expect(stockSpy).not.toHaveBeenCalled()
    expect(locSpy).not.toHaveBeenCalled()
    stockSpy.mockRestore()
    locSpy.mockRestore()
  })

  it('库存管理页进明细只拉 1 次 locationStock（自愈+分布合并，非 2 次）', async () => {
    const locSpy = vi.spyOn(db.locationStock, 'toArray')
    const wrapper = mount(StockManageView, { global: { plugins: [router, createPinia()] } })
    await flushPromises()
    // 默认落在「库存作业」，切到「库存明细」触发 loadHeavy
    ;(wrapper.vm as any).tab = 'detail'
    await flushPromises()
    await new Promise(r => setTimeout(r, 20))
    await flushPromises()
    // 改进后：locationStock 只读 1 次（自愈与分布共用），而非各拉一遍
    expect(locSpy).toHaveBeenCalledTimes(1)
    locSpy.mockRestore()
    wrapper.unmount()
  })
})
