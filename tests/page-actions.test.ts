import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import 'fake-indexeddb/auto'
import PageActions from '../src/components/PageActions.vue'
import PurchaseOrderDetailView from '../src/views/purchase/PurchaseOrderDetailView.vue'
import SaleOrderDetailView from '../src/views/sales/SaleOrderDetailView.vue'
import PurchaseCreateView from '../src/views/purchase/PurchaseCreateView.vue'
import SalesCreateView from '../src/views/sales/SalesCreateView.vue'
import InboundDetailView from '../src/views/warehouse/InboundDetailView.vue'
import OutboundDetailView from '../src/views/warehouse/OutboundDetailView.vue'
import ProductEditView from '../src/views/boss/ProductEditView.vue'
import { usePurchaseStore } from '../src/stores/purchase'
import { useSalesStore } from '../src/stores/sales'
import { useProductStore } from '../src/stores/product'
import { useUserStore } from '../src/stores/user'
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
    { path: '/boss/products', component: { template: '<div>pl</div>' } },
    { path: '/boss/products/new', component: { template: '<div>pn</div>' } },
    { path: '/boss/products/edit/:id', component: { template: '<div>pe</div>' } },
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

describe('二级页面的返回 / 取消按钮', () => {
  let purchaseStore: ReturnType<typeof usePurchaseStore>
  let salesStore: ReturnType<typeof useSalesStore>
  let productStore: ReturnType<typeof useProductStore>

  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.open()
    await Promise.all(db.tables.map(t => t.clear()))
    purchaseStore = usePurchaseStore()
    salesStore = useSalesStore()
    productStore = useProductStore()
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
  async function seedSupplier(name = '海尔总代'): Promise<number> {
    return await purchaseStore.createSupplier({ name, contact: '王', phone: '1', address: '', paymentTerm: '', remark: '' })
  }
  async function seedCustomer(name = '城南电器'): Promise<number> {
    return await salesStore.createCustomer({ name, contact: '李', phone: '2', address: '', level: 'A', creditLimit: 0, paymentTerm: '', loginPhone: '', loginPassword: '', status: 'active', remark: '' })
  }

  // ============ 通用组件 ============
  it('PageActions 默认渲染「返回」，传 confirmText 时同时给出主操作', async () => {
    const w1 = mount(PageActions)
    expect(w1.find('.pa-cancel').text()).toBe('返回')
    expect(w1.find('.pa-confirm').exists()).toBe(false)

    const w2 = mount(PageActions, { props: { cancelText: '取消', confirmText: '提交采购单' } })
    expect(w2.find('.pa-cancel').text()).toBe('取消')
    expect(w2.find('.pa-confirm').text()).toBe('提交采购单')
  })

  it('PageActions 在 loading 时禁用主操作并显示「处理中…」', async () => {
    const wrapper = mount(PageActions, {
      props: { cancelText: '取消', confirmText: '确认入库', loading: true }
    })
    expect(wrapper.find('.pa-confirm').text()).toBe('处理中…')
    expect((wrapper.find('.pa-confirm').element as HTMLButtonElement).disabled).toBe(true)

    // loading 期间点击不应冒泡
    await wrapper.find('.pa-confirm').trigger('click')
    expect(wrapper.emitted('confirm')).toBeFalsy()
  })

  it('PageActions 取消/确认按钮分别触发 cancel / confirm', async () => {
    const wrapper = mount(PageActions, { props: { cancelText: '返回', confirmText: '保存' } })
    await wrapper.find('.pa-cancel').trigger('click')
    await wrapper.find('.pa-confirm').trigger('click')
    expect(wrapper.emitted('cancel')).toBeTruthy()
    expect(wrapper.emitted('confirm')).toBeTruthy()
  })

  // ============ 详情页：返回 ============
  it('采购单详情页有「返回」按钮，点击回到采购单列表', async () => {
    const sid = await seedSupplier()
    const p = await seedProduct()
    const res = await purchaseStore.createOrder({ supplierId: sid, purchaserId: 1, items: [{ product: p, quantity: 1 }], remark: '' })
    await testRouter.push(`/purchase/orders/${res.orderId}`)
    await testRouter.isReady()

    const wrapper = mount(PurchaseOrderDetailView, { global: { plugins: [testRouter] } })
    await vi.waitFor(() => expect(wrapper.find('.pa-cancel').exists()).toBe(true), { timeout: 3000 })
    expect(wrapper.find('.pa-cancel').text()).toBe('返回')

    await wrapper.find('.pa-cancel').trigger('click')
    await flushPromises()
    expect(testRouter.currentRoute.value.path).toBe('/purchase/orders')
  })

  it('销售单详情页有「返回」按钮，点击回到销售单列表', async () => {
    const cid = await seedCustomer()
    const p = await seedProduct()
    await db.stock.where('productId').equals(p.id!).modify({ quantity: 100 })
    const res = await salesStore.createOrder({ customerId: cid, salesId: 1, items: [{ product: p, quantity: 1 }], remark: '' })
    await testRouter.push(`/sales/orders/${res.orderId}`)
    await testRouter.isReady()

    const wrapper = mount(SaleOrderDetailView, { global: { plugins: [testRouter] } })
    await vi.waitFor(() => expect(wrapper.find('.pa-cancel').exists()).toBe(true), { timeout: 3000 })
    expect(wrapper.find('.pa-cancel').text()).toBe('返回')

    await wrapper.find('.pa-cancel').trigger('click')
    await flushPromises()
    expect(testRouter.currentRoute.value.path).toBe('/sales/orders')
  })

  // ============ 表单页：取消 ============
  it('新建采购单页有「取消」按钮，点击回到列表且不产生单据', async () => {
    await seedSupplier()
    await testRouter.push('/purchase/orders/new')
    await testRouter.isReady()

    const wrapper = mount(PurchaseCreateView, { global: { plugins: [testRouter] } })
    await flushPromises()
    expect(wrapper.find('.pa-cancel').text()).toBe('取消')
    expect(wrapper.find('.pa-confirm').text()).toBe('提交采购单')

    await wrapper.find('.pa-cancel').trigger('click')
    await flushPromises()
    expect(testRouter.currentRoute.value.path).toBe('/purchase/orders')
    expect(await db.purchaseOrders.count()).toBe(0)
  })

  it('新建销售单页有「取消」按钮，点击回到列表且不产生单据', async () => {
    await seedCustomer()
    await testRouter.push('/sales/orders/new')
    await testRouter.isReady()

    const wrapper = mount(SalesCreateView, { global: { plugins: [testRouter] } })
    await flushPromises()
    expect(wrapper.find('.pa-cancel').text()).toBe('取消')
    expect(wrapper.find('.pa-confirm').text()).toBe('提交销售单')

    await wrapper.find('.pa-cancel').trigger('click')
    await flushPromises()
    expect(testRouter.currentRoute.value.path).toBe('/sales/orders')
    expect(await db.saleOrders.count()).toBe(0)
  })

  it('新增商品页有「取消」与「保存」按钮，取消回到商品档案', async () => {
    await testRouter.push('/boss/products/new')
    await testRouter.isReady()

    const wrapper = mount(ProductEditView, { global: { plugins: [testRouter] } })
    await flushPromises()
    expect(wrapper.find('.pa-cancel').text()).toBe('取消')
    expect(wrapper.find('.pa-confirm').text()).toBe('保存')

    await wrapper.find('.pa-cancel').trigger('click')
    await flushPromises()
    expect(testRouter.currentRoute.value.path).toBe('/boss/products')
    expect(await db.products.count()).toBe(0)
  })

  // ============ 库房作业页：取消 + 确认 ============
  it('入库验货页有「取消」与「确认入库」，取消回到待收货列表', async () => {
    const sid = await seedSupplier()
    const p = await seedProduct()
    const res = await purchaseStore.createOrder({ supplierId: sid, purchaserId: 1, items: [{ product: p, quantity: 2 }], remark: '' })
    await testRouter.push(`/warehouse/inbound/${res.orderId}`)
    await testRouter.isReady()

    const wrapper = mount(InboundDetailView, { global: { plugins: [testRouter] } })
    await vi.waitFor(() => expect((wrapper.vm as any).items.length).toBeGreaterThan(0), { timeout: 3000 })
    await flushPromises()

    expect(wrapper.find('.pa-cancel').text()).toBe('取消')
    expect(wrapper.find('.pa-confirm').text()).toBe('确认入库')

    await wrapper.find('.pa-cancel').trigger('click')
    await flushPromises()
    expect(testRouter.currentRoute.value.path).toBe('/warehouse/inbound')
    // 取消不应产生任何出入库流水
    expect(await db.stockRecords.count()).toBe(0)
  })

  it('出库拣货页有「取消」与「确认出库」，取消回到待发货列表', async () => {
    const cid = await seedCustomer()
    const p = await seedProduct()
    await db.stock.where('productId').equals(p.id!).modify({ quantity: 100 })
    const res = await salesStore.createOrder({ customerId: cid, salesId: 1, items: [{ product: p, quantity: 2 }], remark: '' })
    await testRouter.push(`/warehouse/outbound/${res.orderId}`)
    await testRouter.isReady()

    const wrapper = mount(OutboundDetailView, { global: { plugins: [testRouter] } })
    await vi.waitFor(() => expect((wrapper.vm as any).items.length).toBeGreaterThan(0), { timeout: 3000 })
    await flushPromises()

    expect(wrapper.find('.pa-cancel').text()).toBe('取消')
    expect(wrapper.find('.pa-confirm').text()).toBe('确认出库')

    await wrapper.find('.pa-cancel').trigger('click')
    await flushPromises()
    expect(testRouter.currentRoute.value.path).toBe('/warehouse/outbound')
    expect(await db.stockRecords.count()).toBe(0)
  })
})
