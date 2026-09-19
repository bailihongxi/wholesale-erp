import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import 'fake-indexeddb/auto'
import PurchaseOrdersView from '../src/views/purchase/PurchaseOrdersView.vue'
import SalesOrdersView from '../src/views/sales/SalesOrdersView.vue'
import InboundView from '../src/views/warehouse/InboundView.vue'
import OutboundView from '../src/views/warehouse/OutboundView.vue'
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
    { path: '/', redirect: '/purchase/orders' },
    { path: '/purchase/orders', component: { template: '<div>po</div>' } },
    { path: '/purchase/orders/new', component: { template: '<div>new</div>' } },
    { path: '/purchase/orders/:id', component: { template: '<div>detail</div>' } },
    { path: '/sales/orders', component: { template: '<div>so</div>' } },
    { path: '/sales/orders/new', component: { template: '<div>new</div>' } },
    { path: '/sales/orders/:id', component: { template: '<div>detail</div>' } },
    { path: '/warehouse/inbound', component: { template: '<div>in</div>' } },
    { path: '/warehouse/inbound/:id', component: { template: '<div>ind</div>' } },
    { path: '/warehouse/outbound', component: { template: '<div>out</div>' } },
    { path: '/warehouse/outbound/:id', component: { template: '<div>outd</div>' } },
    { path: '/finance/reconcile', component: { template: '<div>recon</div>' } },
    { path: '/:pathMatch(.*)*', component: { template: '<div></div>' } }
  ]
})

function setRole(role: string): void {
  const u = useUserStore()
  u.currentUser = {
    id: 1, name: ' tester', phone: '1', password: '',
    role: role as any, status: 'active', createdAt: ''
  }
}

describe('各模块查询与历史痕迹', () => {
  let purchaseStore: ReturnType<typeof usePurchaseStore>
  let salesStore: ReturnType<typeof useSalesStore>
  let productStore: ReturnType<typeof useProductStore>
  let financeStore: ReturnType<typeof useFinanceStore>

  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.open()
    await Promise.all(db.tables.map(t => t.clear()))
    purchaseStore = usePurchaseStore()
    salesStore = useSalesStore()
    productStore = useProductStore()
    financeStore = useFinanceStore()
    // 让操作人姓名可解析
    await db.users.add({ id: 1, name: '库管员', phone: '138', password: '', role: 'warehouse', status: 'active', createdAt: '' })
    setWidth(1280)
    setRole('boss')
    await testRouter.push('/purchase/orders')
    await testRouter.isReady()
  })

  async function seedProduct(over: Partial<Product> = {}): Promise<Product> {
    await productStore.createProduct({
      brand: '格力', model: 'KFR-35GW', category: '空调', spec: '1.5匹', unit: '台',
      purchasePrice: 1000, wholesalePrice: 1200, retailPrice: 1400, warnStock: 5,
      status: 'active', remark: '', extra: {}, ...over
    })
    const list = await productStore.search('')
    return list[list.length - 1]
  }
  async function seedSupplier(name: string): Promise<number> {
    return await purchaseStore.createSupplier({ name, contact: '王', phone: '1', address: '', paymentTerm: '', remark: '' })
  }
  async function seedCustomer(name: string): Promise<number> {
    return await salesStore.createCustomer({ name, contact: '李', phone: '2', address: '', level: 'A', creditLimit: 0, paymentTerm: '', loginPhone: '', loginPassword: '', status: 'active', remark: '' })
  }

  // ===================== 采购单列表查询 =====================
  it('采购单列表带搜索框，可按供应商名称过滤', async () => {
    const sid1 = await seedSupplier('海尔总代')
    const sid2 = await seedSupplier('美的华南')
    const p = await seedProduct()
    await purchaseStore.createOrder({ supplierId: sid1, purchaserId: 1, items: [{ product: p, quantity: 1 }], remark: '' })
    await purchaseStore.createOrder({ supplierId: sid2, purchaserId: 1, items: [{ product: p, quantity: 1 }], remark: '' })

    const wrapper = mount(PurchaseOrdersView, { global: { plugins: [testRouter] } })
    await vi.waitFor(() => expect(wrapper.findAll('.order-table tbody tr').length).toBe(2), { timeout: 3000 })

    // 搜索框必须存在，且自带清除按钮
    expect(wrapper.find('.search-field').exists()).toBe(true)
    expect(wrapper.find('.clear-btn').exists()).toBe(true)

    await wrapper.find('.search-field').setValue('海尔')
    await vi.waitFor(() => expect(wrapper.findAll('.order-table tbody tr').length).toBe(1), { timeout: 3000 })
    expect(wrapper.text()).toContain('海尔总代')
    expect(wrapper.text()).not.toContain('美的华南')
  })

  it('采购单列表可按单号过滤，并支持日期区间', async () => {
    const sid = await seedSupplier('海尔总代')
    const p = await seedProduct()
    const res = await purchaseStore.createOrder({ supplierId: sid, purchaserId: 1, items: [{ product: p, quantity: 1 }], remark: '' })
    const order = await purchaseStore.getOrder(res.orderId!)

    // 把该单日期改到 2020 年，用于验证区间过滤
    await db.purchaseOrders.update(res.orderId!, { orderDate: '2020-05-10T00:00:00.000Z' })

    const wrapper = mount(PurchaseOrdersView, { global: { plugins: [testRouter] } })
    await vi.waitFor(() => expect(wrapper.findAll('.order-table tbody tr').length).toBe(1), { timeout: 3000 })

    // 按单号搜索
    await wrapper.find('.search-field').setValue(order!.orderNo)
    await vi.waitFor(() => expect(wrapper.findAll('.order-table tbody tr').length).toBe(1), { timeout: 3000 })

    // 清空后按日期区间过滤（2021 年之后应查不到这张 2020 的单）
    await wrapper.find('.clear-btn').trigger('click')
    await vi.waitFor(() => expect(wrapper.findAll('.order-table tbody tr').length).toBe(1), { timeout: 3000 })

    const dateInputs = wrapper.findAll('input[type="date"]')
    expect(dateInputs.length).toBe(2)
    await dateInputs[0].setValue('2021-01-01')
    await dateInputs[0].trigger('change')
    await vi.waitFor(() => expect(wrapper.text()).toContain('没有符合条件的采购单'), { timeout: 3000 })
  })

  // ===================== 销售单列表查询 =====================
  it('销售单列表带搜索框，可按客户名称过滤', async () => {
    const c1 = await seedCustomer('城南电器')
    const c2 = await seedCustomer('北苑家电')
    const p = await seedProduct()
    await db.stock.where('productId').equals(p.id!).modify({ quantity: 100 })
    await salesStore.createOrder({ customerId: c1, salesId: 1, items: [{ product: p, quantity: 1 }], remark: '' })
    await salesStore.createOrder({ customerId: c2, salesId: 1, items: [{ product: p, quantity: 1 }], remark: '' })

    const wrapper = mount(SalesOrdersView, { global: { plugins: [testRouter] } })
    await vi.waitFor(() => expect(wrapper.findAll('.order-table tbody tr').length).toBe(2), { timeout: 3000 })

    await wrapper.find('.search-field').setValue('城南')
    await vi.waitFor(() => expect(wrapper.findAll('.order-table tbody tr').length).toBe(1), { timeout: 3000 })
    expect(wrapper.text()).toContain('城南电器')
    expect(wrapper.text()).not.toContain('北苑家电')
  })

  // ===================== 入库历史 =====================
  it('入库页有「入库历史」页签，能看到时间/单号/供应商/商品/数量/操作人', async () => {
    const sid = await seedSupplier('海尔总代')
    const p = await seedProduct()
    const res = await purchaseStore.createOrder({ supplierId: sid, purchaserId: 1, items: [{ product: p, quantity: 3 }], remark: '' })
    await purchaseStore.inbound(res.orderId!, { [p.id!]: 3 }, 1)

    const wrapper = mount(InboundView, { global: { plugins: [testRouter] } })
    await vi.waitFor(() => expect(wrapper.findAll('.ui-seg button').length).toBe(2), { timeout: 3000 })

    // 默认「待收货」；入库完成后该单不再待收
    expect(wrapper.findAll('.ui-seg button')[0].text()).toContain('待收货')
    expect(wrapper.findAll('.ui-seg button')[1].text()).toContain('入库历史')

    await wrapper.findAll('.ui-seg button')[1].trigger('click')
    await flushPromises()
    // 等待真实流水出现（空态也会占一行 tr，故以内容为准）
    await vi.waitFor(() => expect(wrapper.text()).toContain('海尔总代'), { timeout: 3000 })

    const rowText = wrapper.findAll('.order-table tbody tr')[0].text()
    expect(rowText).toContain('海尔总代')
    expect(rowText).toContain('KFR-35GW')
    expect(rowText).toContain('+3')
    expect(rowText).toContain('库管员')
  })

  it('入库历史支持关键词搜索与重置', async () => {
    const sid1 = await seedSupplier('海尔总代')
    const sid2 = await seedSupplier('美的华南')
    const p1 = await seedProduct()
    const p2 = await seedProduct({ brand: '美的', model: 'BCD-253', category: '冰箱' })

    const r1 = await purchaseStore.createOrder({ supplierId: sid1, purchaserId: 1, items: [{ product: p1, quantity: 1 }], remark: '' })
    const r2 = await purchaseStore.createOrder({ supplierId: sid2, purchaserId: 1, items: [{ product: p2, quantity: 2 }], remark: '' })
    await purchaseStore.inbound(r1.orderId!, { [p1.id!]: 1 }, 1)
    await purchaseStore.inbound(r2.orderId!, { [p2.id!]: 2 }, 1)

    const wrapper = mount(InboundView, { global: { plugins: [testRouter] } })
    await flushPromises()
    await wrapper.findAll('.ui-seg button')[1].trigger('click')
    await flushPromises()
    await vi.waitFor(() => expect(wrapper.findAll('.order-table tbody tr').length).toBe(2), { timeout: 3000 })

    await wrapper.find('.search-field').setValue('美的')
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('BCD-253')
      expect(wrapper.text()).not.toContain('KFR-35GW')
    }, { timeout: 3000 })

    await wrapper.find('.reset-btn').trigger('click')
    await flushPromises()
    await vi.waitFor(() => expect(wrapper.findAll('.order-table tbody tr').length).toBe(2), { timeout: 3000 })
  })

  // ===================== 出库历史 =====================
  it('出库页有「出库历史」页签，能看到发货痕迹', async () => {
    const cid = await seedCustomer('城南电器')
    const p = await seedProduct()
    await db.stock.where('productId').equals(p.id!).modify({ quantity: 100 })
    const res = await salesStore.createOrder({ customerId: cid, salesId: 1, items: [{ product: p, quantity: 4 }], remark: '' })
    await salesStore.outbound(res.orderId!, { [p.id!]: 4 }, 1)

    const wrapper = mount(OutboundView, { global: { plugins: [testRouter] } })
    await vi.waitFor(() => expect(wrapper.findAll('.ui-seg button').length).toBe(2), { timeout: 3000 })

    await wrapper.findAll('.ui-seg button')[1].trigger('click')
    await flushPromises()
    await vi.waitFor(() => expect(wrapper.text()).toContain('城南电器'), { timeout: 3000 })

    const rowText = wrapper.findAll('.order-table tbody tr')[0].text()
    expect(rowText).toContain('城南电器')
    expect(rowText).toContain('KFR-35GW')
    expect(rowText).toContain('4')
    expect(rowText).toContain('库管员')
  })

  it('出库历史支持关键词搜索', async () => {
    const c1 = await seedCustomer('城南电器')
    const c2 = await seedCustomer('北苑家电')
    const p = await seedProduct()
    await db.stock.where('productId').equals(p.id!).modify({ quantity: 100 })
    const r1 = await salesStore.createOrder({ customerId: c1, salesId: 1, items: [{ product: p, quantity: 1 }], remark: '' })
    const r2 = await salesStore.createOrder({ customerId: c2, salesId: 1, items: [{ product: p, quantity: 2 }], remark: '' })
    await salesStore.outbound(r1.orderId!, { [p.id!]: 1 }, 1)
    await salesStore.outbound(r2.orderId!, { [p.id!]: 2 }, 1)

    const wrapper = mount(OutboundView, { global: { plugins: [testRouter] } })
    await flushPromises()
    await wrapper.findAll('.ui-seg button')[1].trigger('click')
    await flushPromises()
    await vi.waitFor(() => expect(wrapper.findAll('.order-table tbody tr').length).toBe(2), { timeout: 3000 })

    await wrapper.find('.search-field').setValue('北苑')
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('北苑家电')
      expect(wrapper.text()).not.toContain('城南电器')
    }, { timeout: 3000 })
  })

  // ===================== 财务历史 =====================
  it('财务「收付款流水」页签能看到已结清单据的收款历史', async () => {
    const cid = await seedCustomer('城南电器')
    const p = await seedProduct()
    await db.stock.where('productId').equals(p.id!).modify({ quantity: 100 })
    const res = await salesStore.createOrder({ customerId: cid, salesId: 1, items: [{ product: p, quantity: 1 }], remark: '' })
    await financeStore.recordReceive({ orderId: res.orderId!, amount: 1200, operatorId: 1, remark: '微信转账' })

    const wrapper = mount(ReconcileView, { global: { plugins: [testRouter] } })
    await vi.waitFor(() => expect(wrapper.findAll('.ui-seg button').length).toBe(3), { timeout: 3000 })

    // 已全额收款 → 默认「未结清」下应收列表为空。
    // 注意：列表在首屏加载完成前显示骨架（不再直接闪空态），所以要轮询等待，
    // 断言本身没有放宽 —— 仍然要求出现这句空态文案。
    await vi.waitFor(() => expect(wrapper.text()).toContain('没有符合条件的应收'), { timeout: 3000 })

    // 切到流水页仍能看到这笔收款
    await wrapper.findAll('.ui-seg button')[2].trigger('click')
    await flushPromises()
    await vi.waitFor(() => expect(wrapper.text()).toContain('微信转账'), { timeout: 3000 })

    const rowText = wrapper.findAll('.pay-table tbody tr')[0].text()
    expect(rowText).toContain('收款')
    expect(rowText).toContain('城南电器')
    expect(rowText).toContain('1,200')
    expect(rowText).toContain('微信转账')
  })

  it('财务应收可切到「已结清」查看历史单据，默认只看未结清', async () => {
    const cid = await seedCustomer('城南电器')
    const p = await seedProduct()
    await db.stock.where('productId').equals(p.id!).modify({ quantity: 100 })
    const res = await salesStore.createOrder({ customerId: cid, salesId: 1, items: [{ product: p, quantity: 1 }], remark: '' })
    const order = await salesStore.getOrder(res.orderId!)
    await financeStore.recordReceive({ orderId: res.orderId!, amount: 1200, operatorId: 1, remark: '' })

    const wrapper = mount(ReconcileView, { global: { plugins: [testRouter] } })
    await vi.waitFor(() => expect(wrapper.text()).toContain('没有符合条件的应收'), { timeout: 3000 })

    // 切到「已结清」
    const settleSelect = wrapper.find('select')
    await settleSelect.setValue('settled')
    await flushPromises()
    await vi.waitFor(() => expect(wrapper.findAll('.recon-card').length).toBe(1), { timeout: 3000 })
    expect(wrapper.text()).toContain(order!.orderNo)
    expect(wrapper.text()).toContain('已结清')
  })

  it('财务流水可按收/付款类型筛选', async () => {
    const cid = await seedCustomer('城南电器')
    const sid = await seedSupplier('海尔总代')
    const p = await seedProduct()
    await db.stock.where('productId').equals(p.id!).modify({ quantity: 100 })
    const so = await salesStore.createOrder({ customerId: cid, salesId: 1, items: [{ product: p, quantity: 1 }], remark: '' })
    const po = await purchaseStore.createOrder({ supplierId: sid, purchaserId: 1, items: [{ product: p, quantity: 1 }], remark: '' })
    await financeStore.recordReceive({ orderId: so.orderId!, amount: 1200, operatorId: 1, remark: '' })
    await financeStore.recordPay({ orderId: po.orderId!, amount: 1000, operatorId: 1, remark: '' })

    const wrapper = mount(ReconcileView, { global: { plugins: [testRouter] } })
    await flushPromises()
    await wrapper.findAll('.ui-seg button')[2].trigger('click')
    await flushPromises()
    await vi.waitFor(() => expect(wrapper.findAll('.pay-table tbody tr').length).toBe(2), { timeout: 3000 })

    await wrapper.find('select').setValue('receive')
    await flushPromises()
    await vi.waitFor(() => {
      const rows = wrapper.findAll('.pay-table tbody tr')
      expect(rows.length).toBe(1)
      expect(rows[0].text()).toContain('收款')
    }, { timeout: 3000 })
  })
})
