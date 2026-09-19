import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import 'fake-indexeddb/auto'
import InboundView from '../src/views/warehouse/InboundView.vue'
import InboundDetailView from '../src/views/warehouse/InboundDetailView.vue'
import OutboundView from '../src/views/warehouse/OutboundView.vue'
import OutboundDetailView from '../src/views/warehouse/OutboundDetailView.vue'
import StockManageView from '../src/views/stock/StockManageView.vue'
import ReconcileView from '../src/views/finance/ReconcileView.vue'
import { usePurchaseStore } from '../src/stores/purchase'
import { useSalesStore } from '../src/stores/sales'
import { useProductStore } from '../src/stores/product'
import { useUserStore } from '../src/stores/user'
import { useFinanceStore } from '../src/stores/finance'
import { db } from '../src/db'
import type { Product } from '../src/types'

function setWidth(w: number): void {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: w })
}

const testRouter = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/', redirect: '/warehouse/inbound' },
    { path: '/warehouse/inbound', component: { template: '<div>list</div>' } },
    { path: '/warehouse/inbound/:id', component: { template: '<div>detail</div>' } },
    { path: '/warehouse/outbound', component: { template: '<div>list</div>' } },
    { path: '/warehouse/outbound/:id', component: { template: '<div>detail</div>' } },
    { path: '/warehouse/stock', component: { template: '<div>stock</div>' } },
    { path: '/finance/reconcile', component: { template: '<div>recon</div>' } },
    { path: '/:pathMatch(.*)*', component: { template: '<div></div>' } }
  ]
})

function setRole(role: string): void {
  const u = useUserStore()
  u.currentUser = {
    id: 1, name: 'tester', phone: '1', password: '',
    role: role as any, status: 'active', createdAt: ''
  }
}

describe('阶段6：库房+财务模块重写', () => {
  let purchaseStore: ReturnType<typeof usePurchaseStore>
  let salesStore: ReturnType<typeof useSalesStore>
  let productStore: ReturnType<typeof useProductStore>
  let financeStore: ReturnType<typeof useFinanceStore>

  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.open()
    await Promise.all(db.tables.map((t) => t.clear()))
    purchaseStore = usePurchaseStore()
    salesStore = useSalesStore()
    productStore = useProductStore()
    financeStore = useFinanceStore()
    await testRouter.push('/warehouse/inbound')
    await testRouter.isReady()
  })

  async function seedProduct(over: Partial<Product> = {}): Promise<Product> {
    await productStore.createProduct({
      brand: '格力', model: 'KFR-35GW', category: '空调', spec: '1.5匹', unit: '台',
      purchasePrice: 1000, wholesalePrice: 1200, retailPrice: 1400, warnStock: 10,
      status: 'active', remark: '', extra: {}, ...over
    })
    const list = await productStore.search('')
    return list[list.length - 1]
  }
  async function seedSupplier(name = '供应商A'): Promise<number> {
    return await purchaseStore.createSupplier({ name, contact: '王', phone: '1', address: '', paymentTerm: '月结30天', remark: '' })
  }
  async function seedCustomer(name = '客户A'): Promise<number> {
    return await salesStore.createCustomer({ name, contact: '李', phone: '2', address: '', level: 'A', creditLimit: 0, paymentTerm: '', loginPhone: '', loginPassword: '', status: 'active', remark: '' })
  }

  it('6.1 入库确认后库存正确增加', async () => {
    setWidth(1280); setRole('warehouse')
    const sid = await seedSupplier()
    const p = await seedProduct()
    const res = await purchaseStore.createOrder({ supplierId: sid, purchaserId: 1, items: [{ product: p, quantity: 2 }], remark: '' })
    const oid = res.orderId!

    await testRouter.push(`/warehouse/inbound/${oid}`)
    await testRouter.isReady()
    const wrapper = mount(InboundDetailView, { global: { plugins: [testRouter] } })
    await vi.waitFor(() => expect((wrapper.vm as any).items.length).toBeGreaterThan(0), { timeout: 3000 })
    await flushPromises()

    expect(wrapper.find('.qty-input').exists()).toBe(true)
    expect((wrapper.vm as any).inboundQty[p.id!]).toBe(2)

    await wrapper.find('.pa-confirm').trigger('click')

    await vi.waitFor(async () => {
      expect(await productStore.getStock(p.id!)).toBe(2)
    }, { timeout: 3000 })
  })

  it('6.2 出库确认后库存正确减少', async () => {
    setWidth(1280); setRole('warehouse')
    const cid = await seedCustomer()
    const p = await seedProduct()
    await db.stock.where('productId').equals(p.id!).modify({ quantity: 100 })
    const res = await salesStore.createOrder({ customerId: cid, salesId: 2, items: [{ product: p, quantity: 2 }], remark: '' })
    const oid = res.orderId!

    await testRouter.push(`/warehouse/outbound/${oid}`)
    await testRouter.isReady()
    const wrapper = mount(OutboundDetailView, { global: { plugins: [testRouter] } })
    await vi.waitFor(() => expect((wrapper.vm as any).items.length).toBeGreaterThan(0), { timeout: 3000 })
    await flushPromises()

    await wrapper.find('.pa-confirm').trigger('click')

    await vi.waitFor(async () => {
      expect(await productStore.getStock(p.id!)).toBe(98)
    }, { timeout: 3000 })
  })

  it('6.3 库房库存管理页不显示任何价格；老板可见价格', async () => {
    // 电脑端宽度，验证表头列的控制逻辑
    setWidth(1280); setRole('warehouse')
    await seedProduct()
    // 前一个用例遗留的异步任务可能覆盖登录态，mount 前再明确一次角色
    setRole('warehouse')
    const whWrapper = mount(StockManageView, { global: { plugins: [testRouter] } })
    // 等列表真正渲染出来再断言，否则表格还没出现，断言等于没验证到权限
    await vi.waitFor(() => expect(whWrapper.text()).toContain('格力'), { timeout: 3000 })
    expect(whWrapper.text()).not.toContain('批发价')
    expect(whWrapper.text()).not.toContain('进价')
    expect(whWrapper.text()).not.toContain('库存金额')
    expect(whWrapper.text()).not.toContain('¥')
    // 卸载后再切角色，避免同一个 wrapper 因角色变化重新渲染出价格，污染上面的断言
    whWrapper.unmount()

    setRole('boss')
    const bossWrapper = mount(StockManageView, { global: { plugins: [testRouter] } })
    await flushPromises()
    expect(bossWrapper.text()).toContain('批发价')
    expect(bossWrapper.text()).toContain('¥1,200')
  })

  it('6.4 财务能看到应收明细（客户欠款）', async () => {
    setWidth(1280); setRole('finance')
    const cid = await seedCustomer()
    const p = await seedProduct()
    await db.stock.where('productId').equals(p.id!).modify({ quantity: 100 })
    const res = await salesStore.createOrder({ customerId: cid, salesId: 2, items: [{ product: p, quantity: 1 }], remark: '' })
    const no = (await salesStore.listOrders())[0].orderNo

    const wrapper = mount(ReconcileView, { global: { plugins: [testRouter] } })
    await vi.waitFor(() => expect(wrapper.text()).toContain(no), { timeout: 3000 })
  })

  it('6.5 登记收款后单据状态更新为已收', async () => {
    setWidth(1280); setRole('finance')
    const cid = await seedCustomer()
    const p = await seedProduct()
    await db.stock.where('productId').equals(p.id!).modify({ quantity: 100 })
    const res = await salesStore.createOrder({ customerId: cid, salesId: 2, items: [{ product: p, quantity: 1 }], remark: '' })
    const oid = res.orderId!

    const wrapper = mount(ReconcileView, { global: { plugins: [testRouter] } })
    await vi.waitFor(() => expect(wrapper.find('.link-btn').exists()).toBe(true), { timeout: 3000 })

    await wrapper.find('.link-btn').trigger('click') // 登记收款
    await flushPromises()
    await wrapper.find('.confirm-btn').trigger('click') // 确认

    await vi.waitFor(async () => {
      const order = await db.saleOrders.get(oid)
      expect(order!.receiveStatus).toBe('received')
    }, { timeout: 3000 })
    const no5 = (await salesStore.listOrders())[0].orderNo
    await vi.waitFor(() => expect(wrapper.text()).not.toContain(no5), { timeout: 3000 })
  })

  it('6.6 财务能看到应付明细并登记付款后状态更新', async () => {
    setWidth(1280); setRole('finance')
    const sid = await seedSupplier()
    const p = await seedProduct()
    const res = await purchaseStore.createOrder({ supplierId: sid, purchaserId: 1, items: [{ product: p, quantity: 1 }], remark: '' })
    const oid = res.orderId!
    const no = (await purchaseStore.listOrders())[0].orderNo

    const wrapper = mount(ReconcileView, { global: { plugins: [testRouter] } })
    await flushPromises()
    await wrapper.findAll('.ui-seg button')[1].trigger('click') // 切到应付
    await flushPromises()
    await vi.waitFor(() => expect(wrapper.text()).toContain(no), { timeout: 3000 })

    await wrapper.find('.link-btn').trigger('click') // 登记付款
    await flushPromises()
    await wrapper.find('.confirm-btn').trigger('click') // 确认

    await vi.waitFor(async () => {
      const order = await db.purchaseOrders.get(oid)
      expect(order!.payStatus).toBe('paid')
    }, { timeout: 3000 })
  })
})
